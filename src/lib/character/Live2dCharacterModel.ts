import * as THREE from "three";
import type { FileMap } from "@/lib/file-map";
import type { ViewerSettings } from "@/lib/viewer-settings";
import {
  MutableExpressionMapping,
} from "./ExpressionMapping";
import {
  loadLive2dProfile,
  resolveLive2dSemanticOption,
  type Live2dSemanticProfile,
  type Live2dSemanticTarget,
} from "./live2dProfile";
import type {
  AnimationController,
  BoneController,
  CharacterFrameContext,
  CharacterModel,
  ExpressionController,
  ExpressionInfo,
  MotionCapability,
  MotionHandle,
  MotionInfo,
  MotionLayer,
  MotionLibrary,
  PhysicsController,
  PlayOptions,
  PresetExpressionController,
  SemanticExpressionKey,
} from "./types";
import { MotionHandleDisposedError, SEMANTIC_EXPRESSION_KEYS } from "./types";
import { AnimationEventEmitter } from "./animationEvents";
import { MutableMotionMapping } from "./MotionMapping";
import { revokeFileMapUrls } from "./urlModifier";

interface Live2dMotionRef {
  group: string;
  index: number;
}

interface Live2dMotionEntry {
  handle: MotionHandle;
  info: MotionInfo;
  ref: Live2dMotionRef;
  embedded: boolean;
  disposed: boolean;
}

const LIVE2D_CAPABILITY: MotionCapability = {
  layers: ["base", "overlay"],
  crossfade: true,
  seek: false,
  externalLoad: false,
  embeddedLibrary: true,
};

const DEFAULT_FADE_SEC = 0.2;
const PRIORITY_NORMAL = 2;
const PRIORITY_FORCE = 3;
// CubismInstance / loadModelSetting は Cubism Framework 経由で
// top-level に Live2DCubismCore を参照する enum を間接的に持ち込むため、
// Next.js の SSR/プリレンダリングでエラーになる。型のみ静的に import し、
// 実装は load() 内で dynamic import する。
import type { CubismInstance } from "./live2dThree/cubismInstance";
import {
  computeLive2DCanvasSize,
  renderSharedLive2DAtlas,
  registerInstance,
  resetSharedAtlasIfEmpty,
  setLive2DResolutionConfig,
  type Live2DAtlasHandle,
  type Live2DAtlasLayout,
} from "./live2dThree/sharedAtlasRenderer";
import {
  setThreeRendererRef,
  waitForThreeRenderer,
} from "./live2dThree/threeRendererRef";

/**
 * 板ポリの高さ。MMD/VRM と並べたときの身長を合わせる目安値。
 * MMD は 1 unit ≈ 8cm なので 20 unit ≈ 160cm。
 */
const BASE_PLANE_HEIGHT = 20;

interface Live2dConstructorOptions {
  id: string;
  name: string;
  instance: CubismInstance;
  atlasHandle: Live2DAtlasHandle;
  fileMap: FileMap | null;
  renderScale: number;
  planeScale: number;
  semanticProfile: Live2dSemanticProfile;
}

export function syncLive2dRenderer(
  renderer: THREE.WebGLRenderer | null
): void {
  // Live2D (Cubism direct renderer) が Canvas 外から WebGLRenderer を
  // 取得できるよう登録
  setThreeRendererRef(renderer);
}

export function syncLive2dViewerSettings(
  viewerSettings: Pick<
    ViewerSettings,
    "live2dQualityMultiplier" | "live2dViewportHeightUsage" | "live2dMaxEdge"
  >
): void {
  // Live2D グローバル品質設定を sharedAtlasRenderer に反映し、
  // 既存モデルを refresh
  setLive2DResolutionConfig({
    qualityMultiplier: viewerSettings.live2dQualityMultiplier,
    viewportHeightUsage: viewerSettings.live2dViewportHeightUsage,
    maxEdge: viewerSettings.live2dMaxEdge,
  });

  for (const instance of Live2dCharacterModel.instances) {
    instance.refreshAtlasSize();
  }
}

export class Live2dCharacterModel implements CharacterModel {
  static readonly instances = new Set<Live2dCharacterModel>();
  private static renderAccumulatorMs = 0;
  private static lastFinalizedFrameId = -1;

  readonly id: string;
  readonly name: string;
  readonly kind = "live2d" as const;
  readonly object: THREE.Object3D;

  readonly expressions: ExpressionController;
  readonly expressionMapping: MutableExpressionMapping;
  readonly presetExpressions: PresetExpressionController;
  readonly bones: BoneController;
  readonly animation: AnimationController;
  readonly motionMapping: MutableMotionMapping;
  readonly physics: PhysicsController;

  private instance: CubismInstance;
  private sharedTexture: THREE.Texture;
  private atlasHandle: Live2DAtlasHandle;
  private currentAtlasLayout: Live2DAtlasLayout | null = null;
  private planeMaterial: THREE.ShaderMaterial;
  private planeMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private group: THREE.Group;
  private fileMap: FileMap | null;
  private semanticProfile: Live2dSemanticProfile;
  private _renderScale: number;
  private _planeScale: number;
  private _distanceScale = 1;

  get renderScale(): number {
    return this._renderScale;
  }
  get effectiveRenderScale(): number {
    return this._renderScale * this._distanceScale;
  }
  get planeScale(): number {
    return this._planeScale;
  }

  /** 表情コントローラの最後の set 値 */
  private expressionWeights = new Map<string, number>();
  /** .exp3.json 由来の表情名集合 */
  private expressionNames: string[] = [];
  private currentPresetExpression: string | null = null;
  private hasStartedMotion = false;
  private physicsEnabled = true;
  private paused = false;
  private disposed = false;
  private needsSharedRender = true;

  private motionEntries = new Map<string, Live2dMotionEntry>();
  private layerStates: Record<MotionLayer, Live2dMotionEntry | null> = {
    base: null,
    overlay: null,
  };
  private animationEvents = new AnimationEventEmitter();

  constructor(opts: Live2dConstructorOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.instance = opts.instance;
    this.sharedTexture = opts.atlasHandle.getSharedTexture();
    this.atlasHandle = opts.atlasHandle;
    this.fileMap = opts.fileMap;
    this.semanticProfile = opts.semanticProfile;
    this._renderScale = opts.renderScale;
    this._planeScale = opts.planeScale;

    const initialLayout = this.atlasHandle.getLayout();
    this.currentAtlasLayout = initialLayout;
    const planeHeight = this.getPlaneHeight();
    const planeWidth = planeHeight * (initialLayout.width / initialLayout.height);

    // Cubism は sRGB 値を premultiplied alpha でそのまま RT に書き込む。
    // Three の outputColorSpace (linear→sRGB) を適用すると二重エンコードになるので、
    // ShaderMaterial で「テクセル素通し」の出力を行い、Three の自動エンコーディング
    // （<colorspace_fragment> chunk）を一切含めない。
    this.planeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.sharedTexture },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(map, vUv);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      premultipliedAlpha: true,
    });
    this.planeMesh = new THREE.Mesh(
      this.createPlaneGeometry(planeWidth, planeHeight, initialLayout),
      this.planeMaterial
    );
    this.planeMesh.position.y = planeHeight / 2; // 足元を原点に

    this.group = new THREE.Group();
    this.group.name = `live2d:${opts.id}`;
    this.group.add(this.planeMesh);
    this.object = this.group;
    Live2dCharacterModel.instances.add(this);

    this.expressionNames = this.instance
      .listExpressions()
      .map((e) => e.name);

    this.atlasHandle.setOnLayoutChange((layout) => {
      this.applyAtlasLayout(layout);
    });

    this.expressions = this.createExpressionController();
    this.expressionMapping = this.createExpressionMappingWithSemanticKeys();
    this.presetExpressions = this.createPresetExpressionController();
    this.bones = { list: () => [], find: () => null };
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

  static async load(opts: {
    id: string;
    name: string;
    url: string;
    fileMap: FileMap | null;
    renderScale: number;
    planeScale: number;
  }): Promise<Live2dCharacterModel> {
    const [
      { CubismInstance: CubismInstanceCtor },
      { loadModelSetting },
      semanticProfile,
    ] =
      await Promise.all([
        import("./live2dThree/cubismInstance"),
        import("./live2dThree/cubismSetting"),
        loadLive2dProfile(opts.url, opts.fileMap),
      ]);
    const instance = new CubismInstanceCtor();
    await instance.loadFromSource(opts.url, opts.fileMap);

    const threeRenderer = await waitForThreeRenderer();
    const gl = threeRenderer.getContext() as
      | WebGL2RenderingContext
      | WebGLRenderingContext;
    const { resolveAsset } = await loadModelSetting(opts.url, opts.fileMap);
    await instance.initializeRendering(gl, resolveAsset);

    const { width, height } = computeLive2DCanvasSize(
      instance.getCanvasWidth(),
      instance.getCanvasHeight(),
      opts.renderScale
    );
    // 解像度デバッグ用: 実際に確保されたスロット寸法と入力値
    console.log(
      `[Live2D] ${opts.name}: canvas=${instance.getCanvasWidth()}x${instance.getCanvasHeight()}, ` +
        `renderScale=${opts.renderScale}, slot=${width}x${height}, ` +
        `viewport=${window.innerWidth}x${window.innerHeight}, DPR=${window.devicePixelRatio}`
    );
    const atlasHandle = registerInstance(instance, width, height);

    return new Live2dCharacterModel({
      id: opts.id,
      name: opts.name,
      instance,
      atlasHandle,
      fileMap: opts.fileMap,
      renderScale: opts.renderScale,
      planeScale: opts.planeScale,
      semanticProfile,
    });
  }

  update(delta: number): void {
    if (this.disposed) return;
    if (this.paused) return;

    const dtMs = delta * 1000;
    this.instance.updateModel(dtMs, () => {
      this.applySemanticParameters();
    });
  }

  prepareFrame(context: CharacterFrameContext): void {
    if (this.disposed) return;

    // カメラ距離に応じて Live2D 解像度を自動調整
    const distance = context.camera.position.distanceTo(this.object.position);
    // モデルの視覚中心 (足元 + 板ポリ高さの半分) を推定
    // 基準距離 30 で factor=1.0。近いほど高解像度、遠いほど低解像度
    const factor = distance > 0 ? 70.0 / (distance + 20.0) : 2.0;
    this.setDistanceScale(factor);
  }

  finalizeFrame(context: CharacterFrameContext): void {
    if (this.disposed) return;
    if (Live2dCharacterModel.lastFinalizedFrameId === context.frameId) {
      return;
    }
    Live2dCharacterModel.lastFinalizedFrameId = context.frameId;

    const instances = Array.from(Live2dCharacterModel.instances).filter(
      (instance) => !instance.disposed
    );
    if (instances.length === 0) {
      Live2dCharacterModel.renderAccumulatorMs = 0;
      return;
    }

    Live2dCharacterModel.renderAccumulatorMs += context.deltaMs;
    const live2dRenderFps = THREE.MathUtils.clamp(
      context.viewerSettings.live2dRenderFps,
      1,
      60
    );
    const renderIntervalMs = 1000 / live2dRenderFps;
    const shouldForceSharedRender = instances.some((instance) =>
      instance.consumeSharedRenderRequest()
    );

    if (
      shouldForceSharedRender ||
      Live2dCharacterModel.renderAccumulatorMs >= renderIntervalMs
    ) {
      Live2dCharacterModel.renderAccumulatorMs = shouldForceSharedRender
        ? 0
        : Live2dCharacterModel.renderAccumulatorMs % renderIntervalMs;

      renderSharedLive2DAtlas(context.renderer);

      for (const instance of instances) {
        instance.afterSharedRender();
      }
    }
  }

  setRenderScale(scale: number): void {
    const clamped = THREE.MathUtils.clamp(scale, 0.4, 3.0);
    if (Math.abs(this.renderScale - clamped) < 0.001) return;
    this._renderScale = clamped;
    this.resizeCanvasForCurrentViewport();
  }

  setDisplayScale(scale: number): void {
    const clamped = THREE.MathUtils.clamp(scale, 0.4, 2.5);
    if (Math.abs(this.planeScale - clamped) < 0.001) return;
    this._planeScale = clamped;
    if (this.currentAtlasLayout) {
      this.applyAtlasLayout(this.currentAtlasLayout);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    Live2dCharacterModel.instances.delete(this);

    this.group.removeFromParent();
    this.atlasHandle.setOnLayoutChange(null);
    this.atlasHandle.dispose();
    resetSharedAtlasIfEmpty();

    try {
      this.instance.disposeAll();
    } catch {
      /* ignore */
    }

    this.planeMesh.geometry.dispose();
    this.planeMaterial.dispose();

    this.motionEntries.clear();
    this.layerStates.base = null;
    this.layerStates.overlay = null;
    this.animationEvents.clear();

    if (this.fileMap) {
      revokeFileMapUrls(this.fileMap);
      this.fileMap = null;
    }

    if (Live2dCharacterModel.instances.size === 0) {
      Live2dCharacterModel.renderAccumulatorMs = 0;
      Live2dCharacterModel.lastFinalizedFrameId = -1;
    }
  }

  // ──────────────────────────────────────────────
  // Expression
  // ──────────────────────────────────────────────

  private createExpressionController(): ExpressionController {
    const semanticInfos: ExpressionInfo[] = SEMANTIC_EXPRESSION_KEYS.map(
      (key) => ({
        name: key,
        category:
          key === "blink" || key === "blinkLeft" || key === "blinkRight"
            ? ("eye" as const)
            : ("lip" as const),
      })
    );

    const isSemantic = (name: string): name is SemanticExpressionKey =>
      (SEMANTIC_EXPRESSION_KEYS as readonly string[]).includes(name);

    return {
      list: () => semanticInfos,
      has: (name) => isSemantic(name),
      get: (name) => this.expressionWeights.get(name) ?? 0,
      set: (name, weight) => {
        if (!isSemantic(name)) return;
        const clamped = THREE.MathUtils.clamp(weight, 0, 1);
        this.expressionWeights.set(name, clamped);
        this.needsSharedRender = true;
      },
      setMany: (values) => {
        for (const [name, weight] of Object.entries(values)) {
          this.expressions.set(name, weight);
        }
      },
      reset: () => {
        for (const info of semanticInfos) {
          this.expressionWeights.set(info.name, 0);
        }
        this.presetExpressions.clear();
        this.needsSharedRender = true;
      },
    };
  }

  private createPresetExpressionController(): PresetExpressionController {
    const infos = this.expressionNames.map((name) => ({ name }));

    return {
      list: () => infos,
      getActive: () => this.currentPresetExpression,
      apply: (name) => {
        if (!this.expressionNames.includes(name)) return;
        if (this.instance.setExpression(name)) {
          this.currentPresetExpression = name;
          this.needsSharedRender = true;
        }
      },
      clear: () => {
        this.currentPresetExpression = null;
        this.instance.resetExpression();
        this.needsSharedRender = true;
      },
    };
  }

  private afterSharedRender(): void {
    if (this.disposed) return;
    this.needsSharedRender = false;
  }

  private consumeSharedRenderRequest(): boolean {
    return this.needsSharedRender;
  }

  refreshAtlasSize(): void {
    this.resizeCanvasForCurrentViewport();
  }

  private setDistanceScale(factor: number): void {
    const clamped = THREE.MathUtils.clamp(factor, 0.2, 2.0);
    if (Math.abs(this._distanceScale - clamped) < 0.01) return;
    this._distanceScale = clamped;
    this.resizeCanvasForCurrentViewport();
  }

  private resizeCanvasForCurrentViewport(): void {
    if (this.disposed) return;

    const { width, height } = computeLive2DCanvasSize(
      this.instance.getCanvasWidth(),
      this.instance.getCanvasHeight(),
      this.effectiveRenderScale
    );
    const currentLayout = this.atlasHandle.getLayout();
    if (currentLayout.width === width && currentLayout.height === height) {
      return;
    }

    this.needsSharedRender = true;
    this.atlasHandle.updateSize(width, height);
  }

  private applyAtlasLayout(layout: Live2DAtlasLayout): void {
    if (this.disposed) return;

    this.currentAtlasLayout = layout;
    const nextSharedTexture = this.atlasHandle.getSharedTexture();
    if (this.sharedTexture !== nextSharedTexture) {
      this.sharedTexture = nextSharedTexture;
      this.planeMaterial.uniforms.map.value = nextSharedTexture;
      this.planeMaterial.needsUpdate = true;
    }
    this.needsSharedRender = true;

    const planeHeight = this.getPlaneHeight();
    const planeWidth = planeHeight * (layout.width / layout.height);
    this.planeMesh.geometry.dispose();
    this.planeMesh.geometry = this.createPlaneGeometry(
      planeWidth,
      planeHeight,
      layout
    );
    this.planeMesh.position.y = planeHeight / 2;
  }

  private getPlaneHeight(): number {
    return BASE_PLANE_HEIGHT * this.planeScale;
  }

  private createPlaneGeometry(
    planeWidth: number,
    planeHeight: number,
    layout: Live2DAtlasLayout
  ): THREE.PlaneGeometry {
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const uv = geometry.getAttribute("uv");

    const u0 = layout.x / layout.atlasWidth;
    const u1 = (layout.x + layout.width) / layout.atlasWidth;
    const v0 = 1 - (layout.y + layout.height) / layout.atlasHeight;
    const v1 = 1 - layout.y / layout.atlasHeight;

    uv.setXY(0, u0, v1);
    uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u1, v0);
    uv.needsUpdate = true;

    return geometry;
  }

  private createExpressionMappingWithSemanticKeys(): MutableExpressionMapping {
    return new MutableExpressionMapping(this.semanticProfile.initialMapping, this.semanticProfile.options);
  }

  private applySemanticParameters(): void {
    const additiveOverrides = new Map<string, number>();

    for (const key of SEMANTIC_EXPRESSION_KEYS) {
      const w = this.expressionWeights.get(key) ?? 0;
      if (w <= 0) continue;

      const params = resolveLive2dSemanticOption(
        this.semanticProfile,
        key,
        this.expressionMapping[key]
      );

      for (const param of params) {
        if (param.mode === "lerp") {
          this.applyLerpSemanticTarget(param, w);
          continue;
        }

        additiveOverrides.set(
          param.id,
          (additiveOverrides.get(param.id) ?? 0) + param.valueAtOne * w
        );
      }
    }

    for (const [id, delta] of additiveOverrides) {
      try {
        const base = this.instance.getParameterValue(id);
        const next = this.clampParameterValue(id, base + delta);
        this.instance.setParameterValue(id, next);
      } catch {
        // そのパラメータを持たないモデルは無視
      }
    }
  }

  private applyLerpSemanticTarget(target: Live2dSemanticTarget, weight: number): void {
    try {
      const base = this.instance.getParameterValue(target.id);
      const next = this.clampParameterValue(
        target.id,
        base + (target.valueAtOne - base) * weight
      );
      this.instance.setParameterValue(target.id, next);
    } catch {
      // そのパラメータを持たないモデルは無視
    }
  }

  private clampParameterValue(id: string, value: number): number {
    const range = this.instance.getParameterRange(id);
    if (!range) return value;
    return THREE.MathUtils.clamp(value, range.min, range.max);
  }

  // ──────────────────────────────────────────────
  // Animation
  // ──────────────────────────────────────────────

  private buildMotionInfo(
    handle: MotionHandle,
    ref: Live2dMotionRef,
    embedded: boolean,
    name: string
  ): MotionInfo {
    const duration = this.instance.getMotionDuration(ref.group, ref.index);
    return {
      id: handle.id,
      name,
      // Cubism は loop 中を duration=-1 で示す。未ロードなら null
      durationSec:
        duration === null || duration < 0 ? null : duration,
      loopable: true,
      source: "motion3",
      embedded,
      sortIndex: null,
    };
  }

  private buildEmbeddedEntry(
    group: string,
    index: number
  ): Live2dMotionEntry {
    const id = `motion3:embedded:${group}:${index}`;
    const handle: MotionHandle = { id, source: "motion3" };
    const ref: Live2dMotionRef = { group, index };
    const name = `${group}[${index}]`;
    return {
      handle,
      info: this.buildMotionInfo(handle, ref, true, name),
      ref,
      embedded: true,
      disposed: false,
    };
  }

  private ensureEmbeddedEntry(
    group: string,
    index: number
  ): Live2dMotionEntry {
    const id = `motion3:embedded:${group}:${index}`;
    const cached = this.motionEntries.get(id);
    if (cached && !cached.disposed) return cached;
    const entry = this.buildEmbeddedEntry(group, index);
    this.motionEntries.set(id, entry);
    return entry;
  }

  private createMotionLibrary(): MotionLibrary {
    return {
      load: async () => {
        // Live2D は model3.json 同梱モーションのみをサポートする (初版)。
        // 外部 motion3.json を CubismInstance に動的登録する仕組みは
        // 将来実装予定。呼び出し側は listEmbedded() を使うこと。
        throw new Error(
          "Live2D の外部モーション load は未対応です。library.listEmbedded() を使用してください"
        );
      },
      listEmbedded: () => {
        const out: MotionHandle[] = [];
        for (const group of this.instance.listMotionGroups()) {
          for (let i = 0; i < group.motionCount; i++) {
            const entry = this.ensureEmbeddedEntry(group.groupName, i);
            out.push(entry.handle);
          }
        }
        return out;
      },
      list: () => {
        // Live2D は埋め込み = 全 (外部 load 未対応)
        const out: MotionHandle[] = [];
        for (const group of this.instance.listMotionGroups()) {
          for (let i = 0; i < group.motionCount; i++) {
            const entry = this.ensureEmbeddedEntry(group.groupName, i);
            out.push(entry.handle);
          }
        }
        return out;
      },
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
          if (this.layerStates[layer] === entry) {
            this.layerStates[layer] = null;
          }
        }
        this.motionEntries.delete(handle.id);
      },
    };
  }

  private playEntry(
    entry: Live2dMotionEntry,
    layer: MotionLayer,
    opts: PlayOptions | undefined
  ): void {
    const loop = opts?.loop ?? layer === "base";
    const fadeInSec = opts?.fadeInSec ?? DEFAULT_FADE_SEC;
    const fadeOutSec = opts?.fadeOutSec ?? DEFAULT_FADE_SEC;
    const priority = layer === "overlay" ? PRIORITY_FORCE : PRIORITY_NORMAL;

    // Cubism のモーションマネージャは 1 スロット。overlay は Force priority で
    // 割り込ませ、終了時に base を remember しておけば復帰できる。
    const rememberedBase =
      layer === "overlay" ? this.layerStates.base : null;

    const ok = this.instance.startMotion(entry.ref.group, entry.ref.index, {
      priority,
      loop,
      fadeInSec,
      fadeOutSec,
      onFinished: () => {
        // この handler は motion が finish したタイミングで呼ばれる。
        // loop=true の場合、Cubism は内部で finish を発火しないので onEnd は
        // 実質ワンショット向け通知となる。
        const current = this.layerStates[layer];
        if (current !== entry) return;
        this.animationEvents.emit({
          type: "end",
          layer,
          handle: entry.handle,
        });
        this.layerStates[layer] = null;

        // overlay が終わったら base を自動復帰
        if (layer === "overlay" && rememberedBase && !rememberedBase.disposed) {
          this.playEntry(rememberedBase, "base", {
            loop: true,
            fadeInSec,
          });
        }
      },
    });
    if (!ok) {
      console.warn(
        `[Live2D] startMotion 失敗: ${entry.ref.group}[${entry.ref.index}]`
      );
      return;
    }

    this.layerStates[layer] = entry;
    if (layer === "base") {
      this.hasStartedMotion = true;
    }
    this.needsSharedRender = true;
    this.animationEvents.emit({
      type: "start",
      layer,
      handle: entry.handle,
    });
  }

  private pickDefaultBaseEntry(): Live2dMotionEntry | null {
    const groups = this.instance.listMotionGroups();
    if (groups.length === 0) return null;
    const idleGroup =
      groups.find((g) => /idle/i.test(g.groupName)) ?? groups[0];
    if (idleGroup.motionCount === 0) return null;
    return this.ensureEmbeddedEntry(idleGroup.groupName, 0);
  }

  private createAnimationController(): AnimationController {
    const library = this.createMotionLibrary();
    return {
      getCurrentClip: () => null,
      isLoaded: () => this.hasStartedMotion,
      loadAndPlay: async (urls) => {
        // 既存挙動維持: URL は無視し、idle 埋め込みモーションを base で再生
        void urls;
        const entry = this.pickDefaultBaseEntry();
        if (!entry) return;
        this.playEntry(entry, "base", { loop: true, fadeInSec: 0 });
      },
      stop: () => {
        this.instance.stopMotions();
        this.layerStates.base = null;
        this.layerStates.overlay = null;
        this.hasStartedMotion = false;
      },
      setPaused: (paused) => {
        this.paused = paused;
      },
      setTime: () => {
        // Live2D のモーション再生位置 seek は本ライブラリの安定公開 API が無いので no-op
      },

      library,
      capabilities: LIVE2D_CAPABILITY,
      play: async (handle, layer, opts) => {
        const entry = this.motionEntries.get(handle.id);
        if (!entry || entry.disposed) {
          throw new MotionHandleDisposedError(handle.id);
        }
        this.playEntry(entry, layer, opts);
      },
      stopLayer: (layer) => {
        const state = this.layerStates[layer];
        if (!state) return;
        // Cubism はレイヤー別停止を持たないため、overlay 停止時は
        // stopAllMotions → base を再開、base 停止時は全停止する。
        if (layer === "overlay") {
          this.instance.stopMotions();
          this.layerStates.overlay = null;
          const base = this.layerStates.base;
          if (base && !base.disposed) {
            this.playEntry(base, "base", { loop: true });
          }
        } else {
          this.instance.stopMotions();
          this.layerStates.base = null;
          this.layerStates.overlay = null;
          this.hasStartedMotion = false;
        }
      },
      setLayerSpeed: (layer, timeScale) => {
        // Cubism は個別モーションの時間スケールを外部から変更する安定 API を
        // 持たないため現状は no-op。将来 updateModel の dt スケールで
        // レイヤー別対応を検討。
        void layer;
        void timeScale;
      },
      getActive: (layer) => this.layerStates[layer]?.info ?? null,
      on: (event, cb) => this.animationEvents.on(event, cb),
    };
  }

  // ──────────────────────────────────────────────
  // Physics
  // ──────────────────────────────────────────────

  private createPhysicsController(): PhysicsController {
    return {
      capability: "spring-bone",
      isEnabled: () => this.physicsEnabled,
      setEnabled: async (enabled) => {
        this.physicsEnabled = enabled;
        // Cubism 側の物理 on/off は updateModel 内で分岐する必要があるが、
        // 現状はフラグのみ保持し、将来的に updateModel で参照する。
      },
      setGravity: () => {
        // Live2D .physics3 はカスタム重力を公開していないため no-op
      },
    };
  }
}
