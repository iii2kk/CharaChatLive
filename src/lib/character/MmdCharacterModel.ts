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
  PhysicsController,
} from "./types";
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

interface MmdHelperMeshState {
  physics?: { setGravity(gravity: THREE.Vector3): void };
}

type HelperWithInternals = MMDAnimationHelper & {
  objects?: WeakMap<THREE.SkinnedMesh, MmdHelperMeshState>;
};

function getPhysicsControllerFromHelper(
  helper: MMDAnimationHelper | null,
  mesh: THREE.SkinnedMesh
) {
  if (!helper) return null;
  return (helper as HelperWithInternals).objects?.get(mesh)?.physics ?? null;
}

export class MmdCharacterModel implements CharacterModel {
  readonly id: string;
  readonly name: string;
  readonly kind = "mmd" as const;
  readonly object: THREE.Object3D;

  readonly expressions: ExpressionController;
  readonly expressionMapping: MutableExpressionMapping;
  readonly bones: BoneController;
  readonly animation: AnimationController;
  readonly physics: PhysicsController;

  private mesh: THREE.SkinnedMesh;
  private fileMap: FileMap | null;
  private helper: MMDAnimationHelper | null = null;
  private animationClip: THREE.AnimationClip | null = null;
  private physicsEnabled: boolean;
  private gravity: THREE.Vector3;
  private rebuildToken = 0;

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

    if (this.helper) {
      try {
        this.helper.remove(this.mesh);
      } catch {
        // ignore
      }
      this.helper = null;
    }

    if (!this.animationClip && !this.physicsEnabled) {
      return;
    }

    if (this.physicsEnabled) {
      await ensureAmmo();
    }

    if (token !== this.rebuildToken) return;

    const helper = new MMDAnimationHelper({
      afterglow: 2.0,
      resetPhysicsOnLoop: true,
    });

    helper.add(this.mesh, {
      animation: this.animationClip ?? undefined,
      physics: this.physicsEnabled,
      gravity: this.gravity.clone(),
    });

    if (!this.physicsEnabled) {
      helper.enable("physics", false);
    }

    this.helper = helper;
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

  private createAnimationController(): AnimationController {
    return {
      getCurrentClip: () => this.animationClip,
      isLoaded: () => this.animationClip !== null,
      loadAndPlay: async (urls, fileMap) => {
        if (urls.length === 0) return;
        const manager = buildLoadingManager(fileMap ?? this.fileMap);
        const loader = new MMDLoader(manager);
        const clip = await new Promise<THREE.AnimationClip>(
          (resolve, reject) => {
            loader.loadAnimation(
              urls.length === 1 ? urls[0] : urls,
              this.mesh,
              (result) => {
                resolve(Array.isArray(result) ? result[0] : result);
              },
              undefined,
              (err) => {
                reject(err instanceof Error ? err : new Error(String(err)));
              }
            );
          }
        );
        this.animationClip = clip;
        await this.rebuildHelper();
      },
      stop: () => {
        if (!this.helper) return;
        try {
          this.helper.remove(this.mesh);
        } catch {
          // ignore
        }
        this.helper = null;
        this.animationClip = null;
      },
      setPaused: (paused) => {
        if (!this.helper) return;
        this.helper.enable("animation", !paused);
      },
      setTime: () => {
        // MMDAnimationHelper は外部からの seek API を持たないため未対応
      },
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
