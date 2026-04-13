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
  CharacterModel,
  ExpressionCategory,
  ExpressionController,
  ExpressionInfo,
  PhysicsController,
} from "./types";
import { buildLoadingManager, revokeFileMapUrls } from "./urlModifier";

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
  readonly physics: PhysicsController;

  private vrm: VRM;
  private fileMap: FileMap | null;
  private animationMixer: THREE.AnimationMixer | null = null;
  private animationClip: THREE.AnimationClip | null = null;
  private physicsEnabled = true;

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
    this.physics = this.createPhysicsController();
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

  dispose(): void {
    if (this.animationMixer) {
      this.animationMixer.stopAllAction();
      this.animationMixer.uncacheRoot(this.vrm.scene);
      this.animationMixer = null;
    }
    this.animationClip = null;
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

  private createAnimationController(): AnimationController {
    return {
      getCurrentClip: () => this.animationClip,
      isLoaded: () => this.animationClip !== null,
      loadAndPlay: async (urls, fileMap) => {
        const url = urls[0];
        if (!url) return;

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

        if (this.animationMixer) {
          this.animationMixer.stopAllAction();
          this.animationMixer.uncacheRoot(this.vrm.scene);
        }
        const mixer = new THREE.AnimationMixer(this.vrm.scene);
        const action = mixer.clipAction(clip);
        action.reset();
        action.play();

        this.animationMixer = mixer;
        this.animationClip = clip;
      },
      stop: () => {
        if (this.animationMixer) {
          this.animationMixer.stopAllAction();
          this.animationMixer.uncacheRoot(this.vrm.scene);
          this.animationMixer = null;
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
