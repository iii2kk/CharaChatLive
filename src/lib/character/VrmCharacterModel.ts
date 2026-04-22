import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  VRMAnimation,
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import type { FileMap } from "@/lib/file-map";
import { categorizeMmdMorph } from "./expressionCategory";
import {
  buildAutoMapping,
  MutableExpressionMapping,
} from "./ExpressionMapping";
import type {
  AnimationController,
  BoneController,
  BoneRef,
  CharacterFrameContext,
  CharacterModel,
  ExpressionCategory,
  ExpressionController,
  ExpressionInfo,
  MotionCapability,
  MotionHandle,
  MotionInfo,
  MotionLayer,
  MotionLibrary,
  PhysicsController,
  PlayOptions,
} from "./types";
import { MotionHandleDisposedError } from "./types";
import { AnimationEventEmitter } from "./animationEvents";
import { MutableMotionMapping } from "./MotionMapping";
import { buildLoadingManager, revokeFileMapUrls } from "./urlModifier";

function deriveVrmaName(url: string): string {
  try {
    const path = new URL(url, "http://local/").pathname;
    const base = path.split("/").pop() ?? "vrma-motion";
    return decodeURIComponent(base);
  } catch {
    return url;
  }
}

interface VrmMotionEntry {
  handle: MotionHandle;
  info: MotionInfo;
  clip: THREE.AnimationClip;
  disposed: boolean;
}

interface VrmLayerState {
  entry: VrmMotionEntry;
  action: THREE.AnimationAction;
}

const VRM_CAPABILITY: MotionCapability = {
  layers: ["base", "overlay"],
  crossfade: true,
  seek: true,
  externalLoad: true,
  embeddedLibrary: false,
};

const DEFAULT_FADE_SEC = 0.2;

interface VRMGLTF extends GLTF {
  userData: GLTF["userData"] & {
    vrm?: VRM;
    vrmAnimations?: VRMAnimation[];
  };
}

/**
 * VRM は 1 unit = 1m、MMD は 1 unit ≈ 0.08m。
 * 同じシーンに並べたとき同じ縮尺にするための変換係数。
 */
export const VRM_TO_MMD_SCALE = 12.7;

interface VrmConstructorOptions {
  id: string;
  name: string;
  vrm: VRM;
  fileMap: FileMap | null;
}

function createVRMLoader(manager?: THREE.LoadingManager) {
  const loader = new GLTFLoader(manager);
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return loader;
}

function createVRMAnimationLoader(manager?: THREE.LoadingManager) {
  const loader = new GLTFLoader(manager);
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  return loader;
}

function categorizeVrmExpression(
  name: string,
  blinkSet: Set<string>,
  mouthSet: Set<string>
): ExpressionCategory {
  if (blinkSet.has(name)) return "eye";
  if (mouthSet.has(name)) return "lip";
  // VRM に「眉」プリセットは無いが、PMX 互換のためカスタム表情の名前
  // 由来カテゴリ判定をフォールバックとして使う
  const heuristic = categorizeMmdMorph(name);
  return heuristic === "other" ? "other" : heuristic;
}

export class VrmCharacterModel implements CharacterModel {
  readonly id: string;
  readonly name: string;
  readonly kind = "vrm" as const;
  readonly object: THREE.Object3D;

  readonly expressions: ExpressionController;
  readonly expressionMapping: MutableExpressionMapping;
  readonly bones: BoneController;
  readonly animation: AnimationController;
  readonly motionMapping: MutableMotionMapping;
  readonly physics: PhysicsController;

  private vrm: VRM;
  private fileMap: FileMap | null;
  private animationMixer: THREE.AnimationMixer | null = null;
  private animationClip: THREE.AnimationClip | null = null;
  private physicsEnabled = true;

  private motionEntries = new Map<string, VrmMotionEntry>();
  private motionCounter = 0;
  private layerStates: Record<MotionLayer, VrmLayerState | null> = {
    base: null,
    overlay: null,
  };
  private events = new AnimationEventEmitter();
  private mixerListenersBound = false;

  constructor(opts: VrmConstructorOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.vrm = opts.vrm;
    this.object = opts.vrm.scene;
    this.fileMap = opts.fileMap;

    this.expressions = this.createExpressionController();
    this.expressionMapping = buildAutoMapping((name) =>
      this.expressions.has(name)
    );
    this.bones = this.createBoneController();
    this.animation = this.createAnimationController();
    this.motionMapping = new MutableMotionMapping();
    this.motionMapping.subscribe(() => {
      this.applyIdleMotion();
    });
    this.physics = this.createPhysicsController();
  }

  private applyIdleMotion(): void {
    const id = this.motionMapping.idle;
    if (!id) {
      this.animation.stopLayer("base");
      return;
    }
    const handle = this.animation.library
      .list()
      .find((h) => h.id === id);
    if (!handle) return;
    void this.animation.play(handle, "base", { loop: true });
  }

  static load(opts: {
    id: string;
    name: string;
    url: string;
    fileMap: FileMap | null;
  }): Promise<VrmCharacterModel> {
    return new Promise((resolve, reject) => {
      const manager = buildLoadingManager(opts.fileMap);
      const loader = createVRMLoader(manager);
      loader.load(
        opts.url,
        (gltf) => {
          const vrm = (gltf as VRMGLTF).userData.vrm;
          if (!vrm) {
            reject(new Error("VRM データを取得できませんでした"));
            return;
          }

          VRMUtils.rotateVRM0(vrm);
          vrm.scene.scale.multiplyScalar(VRM_TO_MMD_SCALE);

          // スプリングボーンの stiffness / gravityPower はワールド空間
          // ベクトルに掛けられるため、スケール変更分を補正する
          if (vrm.springBoneManager) {
            for (const joint of vrm.springBoneManager.joints) {
              joint.settings.stiffness *= VRM_TO_MMD_SCALE;
              joint.settings.gravityPower *= VRM_TO_MMD_SCALE;
            }
          }

          vrm.scene.traverse((child) => {
            if (
              child instanceof THREE.Mesh ||
              child instanceof THREE.SkinnedMesh
            ) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          resolve(
            new VrmCharacterModel({
              id: opts.id,
              name: opts.name,
              vrm,
              fileMap: opts.fileMap,
            })
          );
        },
        undefined,
        (err) => {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      );
    });
  }

  update(delta: number): void {
    this.animationMixer?.update(delta);
    if (this.physicsEnabled) {
      this.vrm.update(delta);
    } else {
      // 物理を止めるため SpringBone を含む vrm.update をスキップ。
      // ただし表情マネージャの値反映は必要なので個別に呼ぶ。
      this.vrm.expressionManager?.update();
    }
  }

  prepareFrame(context: CharacterFrameContext): void {
    void context;
  }

  finalizeFrame(context: CharacterFrameContext): void {
    void context;
  }

  dispose(): void {
    if (this.animationMixer) {
      this.animationMixer.stopAllAction();
      this.animationMixer.uncacheRoot(this.vrm.scene);
      this.animationMixer = null;
    }
    this.animationClip = null;
    this.layerStates.base = null;
    this.layerStates.overlay = null;
    this.motionEntries.clear();
    this.events.clear();
    this.mixerListenersBound = false;
    VRMUtils.deepDispose(this.vrm.scene);

    if (this.fileMap) {
      revokeFileMapUrls(this.fileMap);
      this.fileMap = null;
    }
  }

  private createExpressionController(): ExpressionController {
    const manager = this.vrm.expressionManager;
    if (!manager) {
      // 表情マネージャを持たない VRM (ごく稀)
      return {
        list: () => [],
        has: () => false,
        get: () => 0,
        set: () => {},
        setMany: () => {},
        reset: () => {},
      };
    }

    const blinkSet = new Set(manager.blinkExpressionNames);
    const mouthSet = new Set(manager.mouthExpressionNames);
    const infos: ExpressionInfo[] = manager.expressions.map((expr) => ({
      name: expr.expressionName,
      category: categorizeVrmExpression(
        expr.expressionName,
        blinkSet,
        mouthSet
      ),
    }));

    return {
      list: () => infos,
      has: (name) => manager.getExpression(name) !== null,
      get: (name) => manager.getValue(name) ?? 0,
      set: (name, weight) => {
        if (manager.getExpression(name) === null) return;
        manager.setValue(name, THREE.MathUtils.clamp(weight, 0, 1));
      },
      setMany: (values) => {
        for (const [name, weight] of Object.entries(values)) {
          if (manager.getExpression(name) === null) continue;
          manager.setValue(name, THREE.MathUtils.clamp(weight, 0, 1));
        }
      },
      reset: () => {
        manager.resetValues();
      },
    };
  }

  private createBoneController(): BoneController {
    const refs: BoneRef[] = [];
    const map = new Map<string, BoneRef>();
    this.vrm.scene.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        const ref: BoneRef = { name: child.name, bone: child as THREE.Bone };
        refs.push(ref);
        if (!map.has(ref.name)) map.set(ref.name, ref);
      }
    });
    return {
      list: () => refs,
      find: (name) => map.get(name) ?? null,
    };
  }

  private ensureMixer(): THREE.AnimationMixer {
    if (this.animationMixer) return this.animationMixer;
    const mixer = new THREE.AnimationMixer(this.vrm.scene);
    this.animationMixer = mixer;
    this.bindMixerListeners(mixer);
    return mixer;
  }

  private bindMixerListeners(mixer: THREE.AnimationMixer): void {
    if (this.mixerListenersBound) return;
    mixer.addEventListener("finished", (e) => {
      const event = e as unknown as { action: THREE.AnimationAction };
      const layer = this.findLayerByAction(event.action);
      if (!layer) return;
      const state = this.layerStates[layer];
      if (!state) return;
      this.events.emit({
        type: "end",
        layer,
        handle: state.entry.handle,
      });
      // ワンショット (!loop) が終わったらスロットを掃除する
      if (state.action === event.action && !event.action.isRunning()) {
        this.layerStates[layer] = null;
      }
    });
    mixer.addEventListener("loop", (e) => {
      const event = e as unknown as { action: THREE.AnimationAction };
      const layer = this.findLayerByAction(event.action);
      if (!layer) return;
      const state = this.layerStates[layer];
      if (!state) return;
      this.events.emit({
        type: "loop",
        layer,
        handle: state.entry.handle,
      });
    });
    this.mixerListenersBound = true;
  }

  private findLayerByAction(
    action: THREE.AnimationAction
  ): MotionLayer | null {
    if (this.layerStates.base?.action === action) return "base";
    if (this.layerStates.overlay?.action === action) return "overlay";
    return null;
  }

  private buildMotionInfo(
    handle: MotionHandle,
    clip: THREE.AnimationClip,
    name: string
  ): MotionInfo {
    return {
      id: handle.id,
      name,
      durationSec: clip.duration,
      loopable: true,
      source: "vrma",
      embedded: false,
    };
  }

  private createMotionLibrary(): MotionLibrary {
    const mkId = () => `vrma:${++this.motionCounter}`;
    return {
      load: async (urls, fileMap, opts) => {
        const url = urls[0];
        if (!url) throw new Error("VRM library.load: urls が空です");

        const manager = buildLoadingManager(fileMap ?? this.fileMap);
        const loader = createVRMAnimationLoader(manager);
        const gltf = await new Promise<VRMGLTF>((resolve, reject) => {
          loader.load(
            url,
            (loaded) => resolve(loaded as VRMGLTF),
            undefined,
            (err) =>
              reject(err instanceof Error ? err : new Error(String(err)))
          );
        });

        const vrmAnimation = gltf.userData.vrmAnimations?.[0];
        if (!vrmAnimation) {
          throw new Error("VRMA データを取得できませんでした");
        }
        const clip = createVRMAnimationClip(vrmAnimation, this.vrm);
        const handle: MotionHandle = { id: mkId(), source: "vrma" };
        const name = opts?.name ?? clip.name ?? "vrma-motion";
        const entry: VrmMotionEntry = {
          handle,
          info: this.buildMotionInfo(handle, clip, name),
          clip,
          disposed: false,
        };
        this.motionEntries.set(handle.id, entry);
        return handle;
      },
      list: () =>
        Array.from(this.motionEntries.values())
          .filter((e) => !e.disposed)
          .map((e) => e.handle),
      listEmbedded: () => [],
      getInfo: (handle) => {
        const entry = this.motionEntries.get(handle.id);
        if (!entry || entry.disposed) {
          throw new MotionHandleDisposedError(handle.id);
        }
        return entry.info;
      },
      dispose: (handle) => {
        const entry = this.motionEntries.get(handle.id);
        if (!entry || entry.disposed) return;
        entry.disposed = true;
        for (const layer of ["base", "overlay"] as const) {
          if (this.layerStates[layer]?.entry === entry) {
            this.stopLayerInternal(layer, 0);
          }
        }
        if (this.animationMixer) {
          this.animationMixer.uncacheClip(entry.clip);
        }
        this.motionEntries.delete(handle.id);
      },
    };
  }

  private stopLayerInternal(layer: MotionLayer, fadeOutSec: number): void {
    const state = this.layerStates[layer];
    if (!state) return;
    if (fadeOutSec > 0) {
      state.action.fadeOut(fadeOutSec);
    } else {
      state.action.stop();
    }
    this.layerStates[layer] = null;
  }

  private async playLayer(
    entry: VrmMotionEntry,
    layer: MotionLayer,
    opts: PlayOptions | undefined
  ): Promise<void> {
    const mixer = this.ensureMixer();
    const loop = opts?.loop ?? layer === "base";
    const speed = opts?.speed ?? 1;
    const fadeInSec = opts?.fadeInSec ?? DEFAULT_FADE_SEC;
    const weight = opts?.weight ?? 1;

    // レイヤー毎に独立したアクションが必要なので毎回 clip を clone する。
    // (mixer.clipAction は (clip.uuid, root.uuid) で action をキャッシュするため、
    //  同じ clip を 2 回呼ぶと同じ action が返ってきてレイヤー衝突する)
    const clipInstance = entry.clip.clone();
    const newAction = mixer.clipAction(clipInstance);
    newAction.enabled = true;
    newAction.setLoop(
      loop ? THREE.LoopRepeat : THREE.LoopOnce,
      loop ? Infinity : 1
    );
    newAction.clampWhenFinished = !loop;
    newAction.timeScale = speed;
    newAction.weight = weight;
    newAction.reset();

    const existing = this.layerStates[layer];
    if (existing) {
      if (fadeInSec > 0) {
        existing.action.crossFadeTo(newAction, fadeInSec, false);
        newAction.play();
      } else {
        existing.action.stop();
        mixer.uncacheClip(existing.action.getClip());
        newAction.play();
      }
    } else {
      if (fadeInSec > 0) {
        newAction.fadeIn(fadeInSec);
      }
      newAction.play();
    }

    this.layerStates[layer] = { entry, action: newAction };
    if (layer === "base") {
      this.animationClip = entry.clip;
    }
    this.events.emit({ type: "start", layer, handle: entry.handle });
  }

  private createAnimationController(): AnimationController {
    const library = this.createMotionLibrary();
    return {
      getCurrentClip: () => this.animationClip,
      isLoaded: () => this.animationClip !== null,
      loadAndPlay: async (urls, fileMap) => {
        const url = urls[0];
        if (!url) return;
        const handle = await library.load([url], fileMap, {
          name: deriveVrmaName(url),
        });
        const entry = this.motionEntries.get(handle.id);
        if (!entry) return;
        // 既存呼び出し側の挙動を維持: base レイヤーをフェードなしで再生
        this.stopLayerInternal("overlay", 0);
        this.stopLayerInternal("base", 0);
        await this.playLayer(entry, "base", {
          loop: true,
          fadeInSec: 0,
        });
      },
      stop: () => {
        this.stopLayerInternal("overlay", 0);
        this.stopLayerInternal("base", 0);
        if (this.animationMixer) {
          this.animationMixer.stopAllAction();
          this.animationMixer.uncacheRoot(this.vrm.scene);
          this.animationMixer = null;
          this.mixerListenersBound = false;
        }
        this.animationClip = null;
      },
      setPaused: (paused) => {
        if (!this.animationMixer) return;
        this.animationMixer.timeScale = paused ? 0 : 1;
      },
      setTime: (seconds) => {
        if (!this.animationMixer) return;
        this.animationMixer.setTime(seconds);
      },

      library,
      capabilities: VRM_CAPABILITY,
      play: async (handle, layer, opts) => {
        const entry = this.motionEntries.get(handle.id);
        if (!entry || entry.disposed) {
          throw new MotionHandleDisposedError(handle.id);
        }
        await this.playLayer(entry, layer, opts);
      },
      stopLayer: (layer, fadeOutSec) => {
        this.stopLayerInternal(layer, fadeOutSec ?? DEFAULT_FADE_SEC);
        if (layer === "base") {
          this.animationClip =
            this.layerStates.base?.entry.clip ?? null;
        }
      },
      setLayerSpeed: (layer, timeScale) => {
        const state = this.layerStates[layer];
        if (!state) return;
        state.action.timeScale = timeScale;
      },
      getActive: (layer) => this.layerStates[layer]?.entry.info ?? null,
      on: (event, cb) => this.events.on(event, cb),
    };
  }

  private createPhysicsController(): PhysicsController {
    return {
      capability: "spring-bone",
      isEnabled: () => this.physicsEnabled,
      setEnabled: async (enabled) => {
        this.physicsEnabled = enabled;
      },
      setGravity: (gravity) => {
        const manager = this.vrm.springBoneManager;
        if (!manager) return;
        const length = gravity.length();
        const direction =
          length > 0
            ? gravity.clone().multiplyScalar(1 / length)
            : new THREE.Vector3(0, -1, 0);

        // VRM 内部のスプリングボーン重力をユーザー指定で上書き。
        // gravityPower にはスケール補正 (VRM_TO_MMD_SCALE) を適用しない。
        // MMD のデフォルト gravityY=-98 は元々 MMD スケール (約 8cm/unit) で
        // 設計された値なので、ワールド単位に直接当てると過大になる。
        // 入力は MMD と同じ感覚で扱ってもらうため /98 で正規化的に縮める。
        const normalizedPower = length / 98;
        for (const joint of manager.joints) {
          joint.settings.gravityDir.copy(direction);
          joint.settings.gravityPower = normalizedPower;
        }
      },
    };
  }
}
