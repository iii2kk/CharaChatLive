import * as THREE from "three";
import { MMDLoader } from "three/examples/jsm/loaders/MMDLoader";
import { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper";
import { ensureAmmo } from "@/lib/ammo";
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
  ExpressionController,
  ExpressionInfo,
  MotionCapability,
  MotionHandle,
  MotionInfo,
  MotionLibrary,
  PhysicsController,
  PlayOptions,
} from "./types";
import { MotionHandleDisposedError } from "./types";
import { AnimationEventEmitter } from "./animationEvents";
import { MutableMotionMapping } from "./MotionMapping";
import { buildLoadingManager, revokeFileMapUrls } from "./urlModifier";

interface MmdPhysicsState {
  enabled: boolean;
  gravity: THREE.Vector3;
}

interface MmdConstructorOptions {
  id: string;
  name: string;
  mesh: THREE.SkinnedMesh;
  fileMap: FileMap | null;
  initialPhysics: MmdPhysicsState;
}

interface MmdPhysicsRuntime {
  setGravity(gravity: THREE.Vector3): void;
  reset?(): void;
  warmup?(cycles: number): void;
}

interface MmdHelperMeshState {
  looped?: boolean;
  physics?: MmdPhysicsRuntime;
}

interface MmdHelperMeshStateWithMixer extends MmdHelperMeshState {
  mixer?: THREE.AnimationMixer;
}

type HelperWithInternals = MMDAnimationHelper & {
  objects?: WeakMap<THREE.SkinnedMesh, MmdHelperMeshStateWithMixer>;
};

function getPhysicsControllerFromHelper(
  helper: MMDAnimationHelper | null,
  mesh: THREE.SkinnedMesh
) {
  return getHelperMeshState(helper, mesh)?.physics ?? null;
}

function getMixerFromHelper(
  helper: MMDAnimationHelper | null,
  mesh: THREE.SkinnedMesh
): THREE.AnimationMixer | null {
  return getHelperMeshState(helper, mesh)?.mixer ?? null;
}

function getHelperMeshState(
  helper: MMDAnimationHelper | null,
  mesh: THREE.SkinnedMesh
): MmdHelperMeshStateWithMixer | null {
  if (!helper) return null;
  return (helper as HelperWithInternals).objects?.get(mesh) ?? null;
}

interface MmdMotionEntry {
  handle: MotionHandle;
  info: MotionInfo;
  clip: THREE.AnimationClip;
  disposed: boolean;
}

// VMD ファイルはボーン名・モーフ名等を固定長バッファに格納し、
// 空き領域にゴミ/ヌルバイトが入っていることがある。mmdparser はこのゴミを
// Shift_JIS として復号しようとして 'unknown char code NN.' を console.error
// で出力する。これは実害が無く (モーションは正常にロードされる) VMD 側の
// 実データの仕様なので、既知ノイズとして console.error → console.warn に
// 降格させて Next.js の Console Error オーバーレイを抑制する。
const inFlightLoads = new Set<string>();
let consoleHookInstalled = false;

function ensureMmdParserConsoleHook(): void {
  if (consoleHookInstalled) return;
  if (typeof window === "undefined") return;
  consoleHookInstalled = true;
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].startsWith("unknown char code")
    ) {
      // 既知ノイズ。warn に降格してオーバーレイを出さない。
      console.warn(
        "[mmdparser] VMD 内の文字列パディング領域の復号失敗 (無害):",
        args[0]
      );
      return;
    }
    original.apply(console, args as Parameters<typeof console.error>);
  };
}

function trackInFlightLoad(url: string): void {
  ensureMmdParserConsoleHook();
  inFlightLoads.add(url);
}

function untrackInFlightLoad(url: string): void {
  inFlightLoads.delete(url);
}

function deriveMotionName(urls: string[]): string {
  const url = urls[0];
  if (!url) return "motion";
  try {
    const path = new URL(url, "http://local/").pathname;
    const base = path.split("/").pop() ?? "motion";
    return decodeURIComponent(base);
  } catch {
    return url;
  }
}

const MMD_CAPABILITY: MotionCapability = {
  layers: ["base"],
  crossfade: false,
  seek: false,
  externalLoad: true,
  embeddedLibrary: false,
};

export class MmdCharacterModel implements CharacterModel {
  readonly id: string;
  readonly name: string;
  readonly kind = "mmd" as const;
  readonly object: THREE.Object3D;

  readonly expressions: ExpressionController;
  readonly expressionMapping: MutableExpressionMapping;
  readonly bones: BoneController;
  readonly animation: AnimationController;
  readonly motionMapping: MutableMotionMapping;
  readonly physics: PhysicsController;

  private mesh: THREE.SkinnedMesh;
  private fileMap: FileMap | null;
  private helper: MMDAnimationHelper | null = null;
  private animationClip: THREE.AnimationClip | null = null;
  private physicsEnabled: boolean;
  private gravity: THREE.Vector3;
  private rebuildToken = 0;

  private motionEntries = new Map<string, MmdMotionEntry>();
  private motionCounter = 0;
  private activeBase: MmdMotionEntry | null = null;
  private events = new AnimationEventEmitter();
  private mixerListenersBound = false;

  constructor(opts: MmdConstructorOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.mesh = opts.mesh;
    this.object = opts.mesh;
    this.fileMap = opts.fileMap;
    this.physicsEnabled = opts.initialPhysics.enabled;
    this.gravity = opts.initialPhysics.gravity.clone();

    this.expressions = this.createExpressionController();
    this.expressionMapping = buildAutoMapping((name) =>
      this.expressions.has(name)
    );
    this.bones = this.createBoneController();
    this.animation = this.createAnimationController();
    this.motionMapping = new MutableMotionMapping();
    this.physics = this.createPhysicsController();
  }

  static load(opts: {
    id: string;
    name: string;
    url: string;
    fileMap: FileMap | null;
    initialPhysics: MmdPhysicsState;
  }): Promise<MmdCharacterModel> {
    return new Promise((resolve, reject) => {
      const manager = buildLoadingManager(opts.fileMap);
      const loader = new MMDLoader(manager);
      loader.load(
        opts.url,
        (mesh) => {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          resolve(
            new MmdCharacterModel({
              id: opts.id,
              name: opts.name,
              mesh,
              fileMap: opts.fileMap,
              initialPhysics: opts.initialPhysics,
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
    this.helper?.update(delta);
  }

  prepareFrame(context: CharacterFrameContext): void {
    void context;
  }

  finalizeFrame(context: CharacterFrameContext): void {
    void context;
  }

  dispose(): void {
    if (this.helper) {
      try {
        this.helper.remove(this.mesh);
      } catch {
        // ignore
      }
      this.helper = null;
    }
    this.animationClip = null;
    this.activeBase = null;
    this.motionEntries.clear();
    this.events.clear();
    this.mixerListenersBound = false;

    this.mesh.geometry.dispose();
    const materials = Array.isArray(this.mesh.material)
      ? this.mesh.material
      : [this.mesh.material];
    for (const material of materials) {
      if (material instanceof THREE.Material) {
        for (const key of Object.keys(material)) {
          const value = (material as unknown as Record<string, unknown>)[key];
          if (value instanceof THREE.Texture) {
            value.dispose();
          }
        }
        material.dispose();
      }
    }

    if (this.fileMap) {
      revokeFileMapUrls(this.fileMap);
      this.fileMap = null;
    }
  }

  private async rebuildHelper(): Promise<void> {
    const token = ++this.rebuildToken;

    if (!this.animationClip && !this.physicsEnabled) {
      this.replaceHelperAnimation(null);
      return;
    }

    const hasPhysics = getPhysicsControllerFromHelper(this.helper, this.mesh);
    const needsNewHelper = !this.helper || (this.physicsEnabled && !hasPhysics);

    if (this.physicsEnabled && needsNewHelper) {
      await ensureAmmo();
    }

    if (token !== this.rebuildToken) return;

    if (needsNewHelper) {
      const helper = new MMDAnimationHelper({
        afterglow: 2.0,
        resetPhysicsOnLoop: true,
      });

      // 前回の物理計算で変形したボーンを次の VMD の初期状態に持ち越さない。
      this.mesh.pose();

      helper.add(this.mesh, {
        animation: this.animationClip ?? undefined,
        physics: this.physicsEnabled,
        gravity: this.gravity.clone(),
      });

      if (!this.physicsEnabled) {
        helper.enable("physics", false);
      }

      this.helper = helper;
      this.mixerListenersBound = false;
      return;
    }

    this.replaceHelperAnimation(this.animationClip);

    const physics = getPhysicsControllerFromHelper(this.helper, this.mesh);
    if (physics && this.physicsEnabled) {
      physics.reset?.();
      physics.warmup?.(60);
    }
  }

  private replaceHelperAnimation(clip: THREE.AnimationClip | null): void {
    const state = getHelperMeshState(this.helper, this.mesh);
    if (!state) return;

    if (state.mixer) {
      state.mixer.stopAllAction();
      state.mixer.uncacheRoot(this.mesh);
      state.mixer = undefined;
    }

    this.mixerListenersBound = false;
    state.looped = false;

    if (!clip) {
      return;
    }

    this.mesh.pose();

    const mixer = new THREE.AnimationMixer(this.mesh);
    mixer.clipAction(clip).play();
    mixer.addEventListener("loop", (event) => {
      const clipTracks =
        (event.action as THREE.AnimationAction & { _clip?: THREE.AnimationClip })
          ._clip?.tracks ?? [];
      if (
        clipTracks.length > 0 &&
        !clipTracks[0].name.startsWith(".bones")
      ) {
        return;
      }
      state.looped = true;
    });
    state.mixer = mixer;
  }

  private createExpressionController(): ExpressionController {
    const dict = this.mesh.morphTargetDictionary ?? {};
    const influences = this.mesh.morphTargetInfluences ?? [];
    const infos: ExpressionInfo[] = Object.keys(dict).map((name) => ({
      name,
      category: categorizeMmdMorph(name),
    }));

    const has = (name: string) => name in dict;
    const indexOf = (name: string): number | null => {
      const idx = dict[name];
      return typeof idx === "number" ? idx : null;
    };

    return {
      list: () => infos,
      has,
      get: (name) => {
        const idx = indexOf(name);
        if (idx === null) return 0;
        return influences[idx] ?? 0;
      },
      set: (name, weight) => {
        const idx = indexOf(name);
        if (idx === null) return;
        influences[idx] = THREE.MathUtils.clamp(weight, 0, 1);
      },
      setMany: (values) => {
        for (const [name, weight] of Object.entries(values)) {
          const idx = indexOf(name);
          if (idx === null) continue;
          influences[idx] = THREE.MathUtils.clamp(weight, 0, 1);
        }
      },
      reset: () => {
        for (let i = 0; i < influences.length; i++) {
          influences[i] = 0;
        }
      },
    };
  }

  private createBoneController(): BoneController {
    const refs: BoneRef[] = (this.mesh.skeleton?.bones ?? []).map((bone) => ({
      name: bone.name,
      bone,
    }));
    const map = new Map(refs.map((ref) => [ref.name, ref]));
    return {
      list: () => refs,
      find: (name) => map.get(name) ?? null,
    };
  }

  private loadClipFromUrls(
    urls: string[],
    fileMap: FileMap | null
  ): Promise<THREE.AnimationClip> {
    const manager = buildLoadingManager(fileMap ?? this.fileMap);
    const loader = new MMDLoader(manager);
    const targetLabel = urls.length === 1 ? urls[0] : urls.join(" + ");

    trackInFlightLoad(targetLabel);

    return new Promise<THREE.AnimationClip>((resolve, reject) => {
      loader.loadAnimation(
        urls.length === 1 ? urls[0] : urls,
        this.mesh,
        (result) => {
          untrackInFlightLoad(targetLabel);
          resolve(Array.isArray(result) ? result[0] : result);
        },
        undefined,
        (err) => {
          untrackInFlightLoad(targetLabel);
          console.error(`[MMD] VMD 読み込み失敗: ${targetLabel}`, err);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      );
    });
  }

  private buildMotionInfo(
    handle: MotionHandle,
    clip: THREE.AnimationClip,
    name: string,
    sortIndex: number | null
  ): MotionInfo {
    return {
      id: handle.id,
      name,
      durationSec: clip.duration,
      loopable: true,
      source: "vmd",
      embedded: false,
      sortIndex,
    };
  }

  private createMotionLibrary(): MotionLibrary {
    const mkId = () => `vmd:${++this.motionCounter}`;
    return {
      load: async (urls, fileMap, opts) => {
        if (urls.length === 0) {
          throw new Error("MMD library.load: urls が空です");
        }
        const clip = await this.loadClipFromUrls(urls, fileMap);
        const handle: MotionHandle = { id: mkId(), source: "vmd" };
        const name = opts?.name ?? clip.name ?? "vmd-motion";
        const sortIndex = opts?.sortIndex ?? null;
        const entry: MmdMotionEntry = {
          handle,
          info: this.buildMotionInfo(handle, clip, name, sortIndex),
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
        if (this.activeBase === entry) {
          this.stopBaseInternal();
        }
        this.motionEntries.delete(handle.id);
      },
    };
  }

  private ensureMixerListeners(): void {
    if (this.mixerListenersBound) return;
    const mixer = getMixerFromHelper(this.helper, this.mesh);
    if (!mixer) return;
    mixer.addEventListener("finished", () => {
      const entry = this.activeBase;
      if (!entry) return;
      this.events.emit({
        type: "end",
        layer: "base",
        handle: entry.handle,
      });
    });
    mixer.addEventListener("loop", () => {
      const entry = this.activeBase;
      if (!entry) return;
      this.events.emit({
        type: "loop",
        layer: "base",
        handle: entry.handle,
      });
    });
    this.mixerListenersBound = true;
  }

  private stopBaseInternal(): void {
    const prev = this.activeBase;
    if (prev) {
      this.events.emit({ type: "end", layer: "base", handle: prev.handle });
    }
    this.replaceHelperAnimation(null);
    this.animationClip = null;
    this.activeBase = null;
  }

  private async playBase(
    entry: MmdMotionEntry,
    opts: PlayOptions | undefined
  ): Promise<void> {
    // MMD は hard-cut 切替 (crossfade 未対応)
    if (this.activeBase && this.activeBase !== entry) {
      const prev = this.activeBase;
      this.events.emit({ type: "end", layer: "base", handle: prev.handle });
    }
    this.animationClip = entry.clip;
    this.activeBase = entry;
    await this.rebuildHelper();
    this.ensureMixerListeners();

    const mixer = getMixerFromHelper(this.helper, this.mesh);
    if (mixer) {
      mixer.timeScale = opts?.speed ?? 1;
    }

    this.events.emit({ type: "start", layer: "base", handle: entry.handle });
  }

  private createAnimationController(): AnimationController {
    const library = this.createMotionLibrary();
    return {
      getCurrentClip: () => this.animationClip,
      isLoaded: () => this.animationClip !== null,
      loadAndPlay: async (urls, fileMap) => {
        if (urls.length === 0) return;
        const handle = await library.load(urls, fileMap, {
          name: deriveMotionName(urls),
        });
        const entry = this.motionEntries.get(handle.id);
        if (!entry) return;
        await this.playBase(entry, { loop: true });
      },
      stop: () => {
        this.stopBaseInternal();
      },
      setPaused: (paused) => {
        if (!this.helper) return;
        this.helper.enable("animation", !paused);
      },
      setTime: () => {
        // MMDAnimationHelper は外部からの seek API を持たないため未対応
      },

      library,
      capabilities: MMD_CAPABILITY,
      play: async (handle, layer, opts) => {
        const entry = this.motionEntries.get(handle.id);
        if (!entry || entry.disposed) {
          throw new MotionHandleDisposedError(handle.id);
        }
        if (layer === "overlay") {
          console.warn("[MMD] overlay レイヤーは未対応のため no-op");
          return;
        }
        await this.playBase(entry, opts);
      },
      stopLayer: (layer) => {
        if (layer !== "base") return;
        this.stopBaseInternal();
      },
      setLayerSpeed: (layer, timeScale) => {
        if (layer !== "base") return;
        const mixer = getMixerFromHelper(this.helper, this.mesh);
        if (mixer) {
          mixer.timeScale = timeScale;
        }
      },
      getActive: (layer) => {
        if (layer !== "base") return null;
        return this.activeBase?.info ?? null;
      },
      on: (event, cb) => this.events.on(event, cb),
    };
  }

  private createPhysicsController(): PhysicsController {
    return {
      capability: "full",
      isEnabled: () => this.physicsEnabled,
      setEnabled: async (enabled) => {
        if (this.physicsEnabled === enabled && this.helper) return;
        this.physicsEnabled = enabled;

        // 既に helper がある場合は enable トグルだけで済むケースを試す
        if (this.helper) {
          const existing = getPhysicsControllerFromHelper(
            this.helper,
            this.mesh
          );
          if (existing) {
            this.helper.enable("physics", enabled);
            return;
          }
        }

        await this.rebuildHelper();
      },
      setGravity: (gravity) => {
        this.gravity.copy(gravity);
        const physics = getPhysicsControllerFromHelper(this.helper, this.mesh);
        if (physics) {
          physics.setGravity(this.gravity.clone());
        }
      },
    };
  }
}
