import * as THREE from "three";
import { MMDLoader } from "three/examples/jsm/loaders/MMDLoader";
import { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper";
import { loadPmxMesh, type LoadedPmxMesh } from "@/lib/mmd/loadPmxMesh";
import { PmxMaterialMorphController } from "@/lib/mmd/PmxMaterialMorphController";
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
  MmdBodyInfo,
  MmdBodyParams,
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
  /** 位置減衰の下限。PMX 値がこれ未満なら持ち上げる */
  positionDamping: number;
  /** 回転減衰の下限。PMX 値がこれ未満なら持ち上げる */
  rotationDamping: number;
  sleepEnabled: boolean;
  /** ジョイント spring の減衰 (0..1)。0 で MMDPhysics 既定挙動 (減衰なし) */
  jointSpringDamping: number;
}

interface TPoseCorrectionOption {
  enabled: boolean;
  armAngleDeg?: number;
}

interface ResolvedTPoseCorrection {
  enabled: boolean;
  armAngleDeg: number;
}

const DEFAULT_T_POSE_ARM_ANGLE_DEG = 35;

interface MmdConstructorOptions {
  id: string;
  name: string;
  mesh: THREE.SkinnedMesh;
  fileMap: FileMap | null;
  initialPhysics: MmdPhysicsState;
  tPoseCorrection?: TPoseCorrectionOption;
  pmxMorphData?: Pick<
    LoadedPmxMesh,
    "materialMorphs" | "groupMorphs" | "allMorphs"
  >;
}

interface AmmoVector3Like {
  setValue?(x: number, y: number, z: number): void;
}

interface AmmoCollisionShapeLike {
  calculateLocalInertia(mass: number, out: AmmoVector3Like): void;
}

interface AmmoRigidBodyLike {
  setDamping(linear: number, angular: number): void;
  setSleepingThresholds(linear: number, angular: number): void;
  setActivationState(state: number): void;
  activate(forceActivation?: boolean): void;
  setFriction(value: number): void;
  setRestitution(value: number): void;
  setMassProps(mass: number, inertia: AmmoVector3Like): void;
  updateInertiaTensor(): void;
  getCollisionShape(): AmmoCollisionShapeLike;
  setLinearVelocity(v: AmmoVector3Like): void;
  setAngularVelocity(v: AmmoVector3Like): void;
  clearForces(): void;
}

interface MmdRigidBodyEntry {
  body: AmmoRigidBodyLike;
  params: {
    type: number;
    name: string;
    /** PMX 由来の質量 */
    weight: number;
    /** PMX 由来の元値 (0..1) */
    positionDamping: number;
    /** PMX 由来の元値 (0..1) */
    rotationDamping: number;
    friction: number;
    restitution: number;
  };
}

interface AmmoModuleLike {
  btVector3: new (x: number, y: number, z: number) => AmmoVector3Like;
  destroy(obj: unknown): void;
}

interface MmdConstraintEntry {
  constraint: {
    /** axis: 0..5 (0-2=平行移動, 3-5=回転) */
    setDamping(axis: number, value: number): void;
    enableSpring(axis: number, enabled: boolean): void;
  };
  params: {
    /** 各軸の spring stiffness (0=spring 無効) */
    springPosition: number[];
    springRotation: number[];
  };
}

interface MmdPhysicsRuntime {
  setGravity(gravity: THREE.Vector3): void;
  reset?(): void;
  warmup?(cycles: number): void;
  bodies?: MmdRigidBodyEntry[];
  constraints?: MmdConstraintEntry[];
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
  private materialMorphController: PmxMaterialMorphController | null = null;
  private helper: MMDAnimationHelper | null = null;
  private animationClip: THREE.AnimationClip | null = null;
  private physicsEnabled: boolean;
  private gravity: THREE.Vector3;
  private positionDamping: number;
  private rotationDamping: number;
  private sleepEnabled: boolean;
  private jointSpringDamping: number;
  /** 剛体ごとのパラメータ上書き (mass/friction/restitution)。
   *  キーは physics.bodies のインデックス。値が undefined のフィールドは PMX 値を使う */
  private bodyOverrides: Map<number, MmdBodyParams> = new Map();
  private rebuildToken = 0;

  private motionEntries = new Map<string, MmdMotionEntry>();
  private motionCounter = 0;
  private activeBase: MmdMotionEntry | null = null;
  private events = new AnimationEventEmitter();
  private mixerListenersBound = false;
  private tPoseCorrection: ResolvedTPoseCorrection | null;
  private correctedClipCache = new WeakMap<
    THREE.AnimationClip,
    THREE.AnimationClip
  >();

  constructor(opts: MmdConstructorOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.mesh = opts.mesh;
    this.object = opts.mesh;
    this.fileMap = opts.fileMap;
    this.physicsEnabled = opts.initialPhysics.enabled;
    this.gravity = opts.initialPhysics.gravity.clone();
    this.positionDamping = opts.initialPhysics.positionDamping;
    this.rotationDamping = opts.initialPhysics.rotationDamping;
    this.sleepEnabled = opts.initialPhysics.sleepEnabled;
    this.jointSpringDamping = opts.initialPhysics.jointSpringDamping;
    this.tPoseCorrection = opts.tPoseCorrection?.enabled
      ? {
          enabled: true,
          armAngleDeg:
            opts.tPoseCorrection.armAngleDeg ?? DEFAULT_T_POSE_ARM_ANGLE_DEG,
        }
      : null;
    if (this.tPoseCorrection) {
      this.logTPoseDiagnostics();
      this.applyTPoseRestOffset();
    }

    if (opts.pmxMorphData) {
      this.materialMorphController = new PmxMaterialMorphController(
        this.mesh.material,
        opts.pmxMorphData.materialMorphs,
        opts.pmxMorphData.groupMorphs,
        opts.pmxMorphData.allMorphs
      );
    }

    this.expressions = this.createExpressionController();
    this.expressionMapping = buildAutoMapping((name) =>
      this.expressions.has(name)
    );
    this.bones = this.createBoneController();
    this.animation = this.createAnimationController();
    this.motionMapping = new MutableMotionMapping();
    this.physics = this.createPhysicsController();
  }

  static async load(opts: {
    id: string;
    name: string;
    url: string;
    fileMap: FileMap | null;
    initialPhysics: MmdPhysicsState;
    tPoseCorrection?: TPoseCorrectionOption;
  }): Promise<MmdCharacterModel> {
    const manager = buildLoadingManager(opts.fileMap);
    const loaded = await loadPmxMesh(opts.url, manager);
    const { mesh, materialMorphs, groupMorphs, allMorphs } = loaded;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return new MmdCharacterModel({
      id: opts.id,
      name: opts.name,
      mesh,
      fileMap: opts.fileMap,
      initialPhysics: opts.initialPhysics,
      tPoseCorrection: opts.tPoseCorrection,
      pmxMorphData: { materialMorphs, groupMorphs, allMorphs },
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

  setMaterialTuning(
    diffuseMultiplier: number,
    emissiveMultiplier: number
  ): void {
    this.materialMorphController?.setMaterialTuning(
      diffuseMultiplier,
      emissiveMultiplier
    );
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
    this.materialMorphController?.dispose();
    this.materialMorphController = null;

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
    this.applyTPoseRestOffset();

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

      if (this.physicsEnabled) {
        const newPhysics = getPhysicsControllerFromHelper(helper, this.mesh);
        if (newPhysics) {
          this.applyBodyTuning(newPhysics);
          this.applyJointTuning(newPhysics);
          newPhysics.warmup?.(60);
        }
      }
      return;
    }

    this.replaceHelperAnimation(this.animationClip);

    const physics = getPhysicsControllerFromHelper(this.helper, this.mesh);
    if (physics && this.physicsEnabled) {
      this.applyBodyTuning(physics);
      this.applyJointTuning(physics);
      physics.reset?.();
      physics.warmup?.(60);
    }
  }

  /**
   * MMDPhysics の各 btRigidBody に damping / スリープ設定を当てる。
   * type === 0 はキネマティック追従剛体 (mass=0) なのでスキップする。
   *
   * damping は PMX 値を上書きせず「下限を持ち上げる (lift)」セマンティクス:
   * `Math.max(pmxValue, sliderValue)` を当てる。スライダーを 0 に置けば PMX
   * の元値がそのまま尊重される。これは PMX 作者が高 damping で釣り合わせた
   * モデル (例: 質量 0.01kg + damping 0.999) を破壊しないため。
   *
   * Ammo の活性状態定数: 1=ACTIVE_TAG (自動スリープ可), 4=DISABLE_DEACTIVATION
   */
  private applyBodyTuning(physics: MmdPhysicsRuntime): void {
    const bodies = physics.bodies;
    if (!bodies) return;
    for (let i = 0; i < bodies.length; i++) {
      const rb = bodies[i];
      if (rb.params.type === 0) continue;

      // damping は PMX 値を尊重しつつ「下限を持ち上げる」
      const pos = Math.max(rb.params.positionDamping, this.positionDamping);
      const rot = Math.max(rb.params.rotationDamping, this.rotationDamping);
      rb.body.setDamping(pos, rot);

      // sleep 設定
      if (this.sleepEnabled) {
        rb.body.setSleepingThresholds(0.05, 0.05);
        rb.body.setActivationState(1);
      } else {
        rb.body.setSleepingThresholds(0, 0);
        rb.body.setActivationState(4);
      }

      // 個別オーバーライド (mass/friction/restitution)
      const ov = this.bodyOverrides.get(i);
      if (ov) {
        if (ov.friction !== undefined) rb.body.setFriction(ov.friction);
        if (ov.restitution !== undefined) rb.body.setRestitution(ov.restitution);
        if (ov.mass !== undefined) {
          this.applyMassToBody(rb, ov.mass);
        }
      }

      rb.body.activate(true);
    }
  }

  /** Bullet で質量を変えるには慣性テンソルの再計算が必須 */
  private applyMassToBody(rb: MmdRigidBodyEntry, mass: number): void {
    const Ammo = (window as unknown as { Ammo?: AmmoModuleLike }).Ammo;
    if (!Ammo) return;
    const inertia = new Ammo.btVector3(0, 0, 0);
    rb.body.getCollisionShape().calculateLocalInertia(mass, inertia);
    rb.body.setMassProps(mass, inertia);
    rb.body.updateInertiaTensor();
    Ammo.destroy(inertia);
  }

  /**
   * MMDPhysics は constraint の spring stiffness は設定するが damping を
   * 設定しないため、強剛性 + 軽質量モデルで振動が収束しない。Bullet の
   * btGeneric6DofSpringConstraint.setDamping(axisIdx, value) で各 spring 軸に
   * 減衰を入れる。0=減衰なし(既定)、典型値 0.3〜0.7。
   */
  private applyJointTuning(physics: MmdPhysicsRuntime): void {
    const constraints = physics.constraints;
    if (!constraints) return;
    const damping = this.jointSpringDamping;
    for (const c of constraints) {
      for (let i = 0; i < 3; i++) {
        if (c.params.springPosition[i] !== 0) {
          c.constraint.setDamping(i, damping);
        }
      }
      for (let i = 0; i < 3; i++) {
        if (c.params.springRotation[i] !== 0) {
          c.constraint.setDamping(i + 3, damping);
        }
      }
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
    this.applyTPoseRestOffset();

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

    const materialController = this.materialMorphController;
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
        const clamped = THREE.MathUtils.clamp(weight, 0, 1);
        influences[idx] = clamped;
        materialController?.setWeight(name, clamped);
      },
      setMany: (values) => {
        for (const [name, weight] of Object.entries(values)) {
          const idx = indexOf(name);
          if (idx === null) continue;
          const clamped = THREE.MathUtils.clamp(weight, 0, 1);
          influences[idx] = clamped;
          materialController?.setWeight(name, clamped);
        }
      },
      reset: () => {
        for (let i = 0; i < influences.length; i++) {
          influences[i] = 0;
        }
        materialController?.reset();
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
    this.animationClip = this.applyTPoseCorrection(entry.clip);
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

  private getTPoseBoneCorrections():
    | Array<{
        boneName: string;
        q: THREE.Quaternion;
        mode: "right-mult" | "conjugate";
      }>
    | null {
    const cfg = this.tPoseCorrection;
    if (!cfg || !cfg.enabled) return null;
    const angle = THREE.MathUtils.degToRad(cfg.armAngleDeg);
    const qLeft = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, -1),
      angle
    );
    const qRight = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      angle
    );
    // 腕: 右乗算 (q' = q_vmd * qOffset) で T-pose ボーン位置を A-pose 方向へ回転
    // ひじ/手首: 共役変換 (q' = qOffset⁻¹ * q_vmd * qOffset) で
    //           子ボーン位置の T→A 差分を相殺する
    return [
      { boneName: "左腕", q: qLeft, mode: "right-mult" },
      { boneName: "右腕", q: qRight, mode: "right-mult" },
      { boneName: "左ひじ", q: qLeft, mode: "conjugate" },
      { boneName: "右ひじ", q: qRight, mode: "conjugate" },
      { boneName: "左手首", q: qLeft, mode: "conjugate" },
      { boneName: "右手首", q: qRight, mode: "conjugate" },
    ];
  }

  private logTPoseDiagnostics(): void {
    const skel = this.mesh.skeleton;
    if (!skel) {
      console.warn("[MMD] Tポーズ補正: skeleton が存在しません");
      return;
    }
    const want = ["左腕", "右腕", "左ひじ", "右ひじ", "左手首", "右手首"];
    const found: string[] = [];
    const missing: string[] = [];
    for (const name of want) {
      if (skel.bones.some((b) => b.name === name)) found.push(name);
      else missing.push(name);
    }
    console.info(
      `[MMD] Tポーズ補正 有効 (armAngleDeg=${this.tPoseCorrection?.armAngleDeg}). 検出ボーン:`,
      found,
      "未検出:",
      missing
    );
    if (missing.length > 0) {
      const armish = skel.bones
        .map((b) => b.name)
        .filter((n) => /腕|肘|ひじ|手首|arm|elbow|wrist|肩|shoulder/i.test(n));
      console.info("[MMD] 参考: 腕系ボーン候補:", armish);
    }
  }

  private applyTPoseRestOffset(): void {
    const corrections = this.getTPoseBoneCorrections();
    if (!corrections) return;
    const skel = this.mesh.skeleton;
    if (!skel) return;
    // rest 時 (q_vmd=identity):
    //   right-mult: identity * qOffset = qOffset → ボーン回転をセット
    //   conjugate:  qOffset⁻¹ * identity * qOffset = identity → 何もしない
    for (const { boneName, q, mode } of corrections) {
      if (mode !== "right-mult") continue;
      const bone = skel.getBoneByName(boneName);
      if (!bone) continue;
      bone.quaternion.copy(q);
    }
    this.mesh.updateMatrixWorld(true);
  }

  private applyTPoseCorrection(
    clip: THREE.AnimationClip
  ): THREE.AnimationClip {
    const corrections = this.getTPoseBoneCorrections();
    if (!corrections) return clip;

    const cached = this.correctedClipCache.get(clip);
    if (cached) return cached;

    const out = clip.clone();
    const skeletonBoneNames = new Set(
      (this.mesh.skeleton?.bones ?? []).map((b) => b.name)
    );

    let modified = 0;
    let injected = 0;
    let skipped = 0;
    for (const { boneName, q: qOffset, mode } of corrections) {
      if (!skeletonBoneNames.has(boneName)) {
        skipped++;
        continue;
      }
      const trackName = `.bones[${boneName}].quaternion`;
      const track = out.tracks.find((t) => t.name === trackName);
      if (track && track instanceof THREE.QuaternionKeyframeTrack) {
        const values = track.values;
        const qVmd = new THREE.Quaternion();
        const qNew = new THREE.Quaternion();
        const qOffsetInv = qOffset.clone().invert();
        for (let i = 0; i < values.length; i += 4) {
          qVmd.set(values[i], values[i + 1], values[i + 2], values[i + 3]);
          if (mode === "right-mult") {
            qNew.copy(qVmd).multiply(qOffset);
          } else {
            qNew.copy(qOffsetInv).multiply(qVmd).multiply(qOffset);
          }
          values[i] = qNew.x;
          values[i + 1] = qNew.y;
          values[i + 2] = qNew.z;
          values[i + 3] = qNew.w;
        }
        modified++;
      } else if (mode === "right-mult") {
        // 腕は track が無くても rest で qOffset 必要なので注入
        out.tracks.push(
          new THREE.QuaternionKeyframeTrack(
            trackName,
            [0],
            [qOffset.x, qOffset.y, qOffset.z, qOffset.w]
          )
        );
        injected++;
      }
      // conjugate モードで track 無し → rest = identity で問題なし
    }
    console.info(
      `[MMD] Tポーズ補正 clip "${clip.name || "(unnamed)"}": modified=${modified}, injected=${injected}, skippedBones=${skipped}`
    );

    this.correctedClipCache.set(clip, out);
    return out;
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
      setDamping: (positionDamping, rotationDamping) => {
        this.positionDamping = positionDamping;
        this.rotationDamping = rotationDamping;
        const physics = getPhysicsControllerFromHelper(this.helper, this.mesh);
        if (physics) {
          this.applyBodyTuning(physics);
        }
      },
      setSleepEnabled: (enabled) => {
        this.sleepEnabled = enabled;
        const physics = getPhysicsControllerFromHelper(this.helper, this.mesh);
        if (physics) {
          this.applyBodyTuning(physics);
        }
      },
      setJointSpringDamping: (value) => {
        this.jointSpringDamping = value;
        const physics = getPhysicsControllerFromHelper(this.helper, this.mesh);
        if (physics) {
          this.applyJointTuning(physics);
        }
      },
      listBodies: (): MmdBodyInfo[] => {
        const physics = getPhysicsControllerFromHelper(this.helper, this.mesh);
        if (!physics?.bodies) return [];
        const out: MmdBodyInfo[] = [];
        for (let i = 0; i < physics.bodies.length; i++) {
          const rb = physics.bodies[i];
          const ov = this.bodyOverrides.get(i);
          out.push({
            id: i,
            name: rb.params.name,
            type: rb.params.type,
            mass: ov?.mass ?? rb.params.weight,
            friction: ov?.friction ?? rb.params.friction,
            restitution: ov?.restitution ?? rb.params.restitution,
          });
        }
        return out;
      },
      setBody: (id, params) => {
        const cur = this.bodyOverrides.get(id) ?? {};
        this.bodyOverrides.set(id, { ...cur, ...params });
        const physics = getPhysicsControllerFromHelper(this.helper, this.mesh);
        if (physics) {
          this.applyBodyTuning(physics);
        }
      },
      setAllBodies: (params) => {
        const physics = getPhysicsControllerFromHelper(this.helper, this.mesh);
        if (!physics?.bodies) return;
        for (let i = 0; i < physics.bodies.length; i++) {
          if (physics.bodies[i].params.type === 0) continue;
          const cur = this.bodyOverrides.get(i) ?? {};
          this.bodyOverrides.set(i, { ...cur, ...params });
        }
        this.applyBodyTuning(physics);
      },
      resetBodyPositions: () => {
        const physics = getPhysicsControllerFromHelper(this.helper, this.mesh);
        if (!physics) return;
        const Ammo = (window as unknown as { Ammo?: AmmoModuleLike }).Ammo;
        if (Ammo && physics.bodies) {
          // 速度・蓄積力もクリアしないと再リセット直後にまた暴れる
          const zero = new Ammo.btVector3(0, 0, 0);
          for (const rb of physics.bodies) {
            if (rb.params.type === 0) continue;
            rb.body.setLinearVelocity(zero);
            rb.body.setAngularVelocity(zero);
            rb.body.clearForces();
          }
          Ammo.destroy(zero);
        }
        // ボーン位置に剛体トランスフォームを戻す
        physics.reset?.();
        // 60 ステップ進めて拘束を解決し、揺れもの剛体を静定させる
        physics.warmup?.(60);
      },
      resetAllBodies: () => {
        this.bodyOverrides.clear();
        const physics = getPhysicsControllerFromHelper(this.helper, this.mesh);
        if (!physics?.bodies) return;
        for (const rb of physics.bodies) {
          if (rb.params.type === 0) continue;
          rb.body.setFriction(rb.params.friction);
          rb.body.setRestitution(rb.params.restitution);
          this.applyMassToBody(rb, rb.params.weight);
        }
        this.applyBodyTuning(physics);
      },
    };
  }
}
