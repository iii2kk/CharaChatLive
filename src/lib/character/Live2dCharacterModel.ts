import * as THREE from "three";
import type { FileMap } from "@/lib/file-map";
import {
  MutableExpressionMapping,
} from "./ExpressionMapping";
import type {
  AnimationController,
  BoneController,
  CharacterModel,
  ExpressionController,
  ExpressionInfo,
  PhysicsController,
  SemanticExpressionKey,
} from "./types";
import { SEMANTIC_EXPRESSION_KEYS } from "./types";
import { revokeFileMapUrls } from "./urlModifier";
// CubismInstance / loadModelSetting は Cubism Framework 経由で
// top-level に Live2DCubismCore を参照する enum を間接的に持ち込むため、
// Next.js の SSR/プリレンダリングでエラーになる。型のみ静的に import し、
// 実装は load() 内で dynamic import する。
import type { CubismInstance } from "./live2dThree/cubismInstance";
import {
  computeLive2DCanvasSize,
  registerInstance,
  resetSharedAtlasIfEmpty,
  type Live2DAtlasHandle,
  type Live2DAtlasLayout,
} from "./live2dThree/sharedAtlasRenderer";
import { waitForThreeRenderer } from "./live2dThree/threeRendererRef";
import {
  beginLive2DProfile,
  endLive2DProfile,
} from "./live2dProfile";

/**
 * 板ポリの高さ。MMD/VRM と並べたときの身長を合わせる目安値。
 * MMD は 1 unit ≈ 8cm なので 20 unit ≈ 160cm。
 */
const BASE_PLANE_HEIGHT = 20;

/**
 * セマンティック表情キー → Live2D パラメータ ID マッピング。
 * 値は「キーを 1 に振ったときに各パラメータをどうするか」。
 */
const SEMANTIC_PARAM_MAP: Record<
  SemanticExpressionKey,
  Array<{ id: string; valueAtOne: number }>
> = {
  blink: [
    { id: "ParamEyeLOpen", valueAtOne: 0 },
    { id: "ParamEyeROpen", valueAtOne: 0 },
  ],
  blinkLeft: [{ id: "ParamEyeLOpen", valueAtOne: 0 }],
  blinkRight: [{ id: "ParamEyeROpen", valueAtOne: 0 }],
  aa: [
    { id: "ParamMouthOpenY", valueAtOne: 1 },
    { id: "ParamMouthForm", valueAtOne: 0 },
  ],
  ih: [
    { id: "ParamMouthOpenY", valueAtOne: 0.3 },
    { id: "ParamMouthForm", valueAtOne: 1 },
  ],
  ou: [
    { id: "ParamMouthOpenY", valueAtOne: 0.6 },
    { id: "ParamMouthForm", valueAtOne: -1 },
  ],
  ee: [
    { id: "ParamMouthOpenY", valueAtOne: 0.4 },
    { id: "ParamMouthForm", valueAtOne: 0.5 },
  ],
  oh: [
    { id: "ParamMouthOpenY", valueAtOne: 0.7 },
    { id: "ParamMouthForm", valueAtOne: -0.5 },
  ],
};

interface Live2dConstructorOptions {
  id: string;
  name: string;
  instance: CubismInstance;
  atlasHandle: Live2DAtlasHandle;
  fileMap: FileMap | null;
  renderScale: number;
  planeScale: number;
}

export class Live2dCharacterModel implements CharacterModel {
  readonly id: string;
  readonly name: string;
  readonly kind = "live2d" as const;
  readonly object: THREE.Object3D;

  readonly expressions: ExpressionController;
  readonly expressionMapping: MutableExpressionMapping;
  readonly bones: BoneController;
  readonly animation: AnimationController;
  readonly physics: PhysicsController;

  private instance: CubismInstance;
  private sharedTexture: THREE.Texture;
  private atlasHandle: Live2DAtlasHandle;
  private currentAtlasLayout: Live2DAtlasLayout | null = null;
  private planeMaterial: THREE.ShaderMaterial;
  private planeMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private group: THREE.Group;
  private fileMap: FileMap | null;
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
  private hasStartedMotion = false;
  private physicsEnabled = true;
  private paused = false;
  private disposed = false;
  private needsSharedRender = true;

  constructor(opts: Live2dConstructorOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.instance = opts.instance;
    this.sharedTexture = opts.atlasHandle.getSharedTexture();
    this.atlasHandle = opts.atlasHandle;
    this.fileMap = opts.fileMap;
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

    this.expressionNames = this.instance
      .listExpressions()
      .map((e) => e.name);

    this.atlasHandle.setOnLayoutChange((layout) => {
      this.applyAtlasLayout(layout);
    });

    this.expressions = this.createExpressionController();
    this.expressionMapping = this.createExpressionMappingWithSemanticKeys();
    this.bones = { list: () => [], find: () => null };
    this.animation = this.createAnimationController();
    this.physics = this.createPhysicsController();
  }

  static async load(opts: {
    id: string;
    name: string;
    url: string;
    fileMap: FileMap | null;
    renderScale: number;
    planeScale: number;
  }): Promise<Live2dCharacterModel> {
    const [{ CubismInstance: CubismInstanceCtor }, { loadModelSetting }] =
      await Promise.all([
        import("./live2dThree/cubismInstance"),
        import("./live2dThree/cubismSetting"),
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
    });
  }

  update(delta: number): void {
    if (this.disposed) return;
    if (this.paused) return;

    const dtMs = delta * 1000;
    const updateStart = beginLive2DProfile();

    const expressionStart = beginLive2DProfile();
    this.applySemanticParameters();
    endLive2DProfile("live2d.update.expressions", expressionStart);

    const cubismUpdateStart = beginLive2DProfile();
    this.instance.updateModel(dtMs);
    endLive2DProfile("live2d.update.cubism", cubismUpdateStart);

    endLive2DProfile("live2d.update.total", updateStart);
  }

  afterSharedRender(): void {
    if (this.disposed) return;
    this.needsSharedRender = false;
  }

  consumeSharedRenderRequest(): boolean {
    return this.needsSharedRender;
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

  setDistanceScale(factor: number): void {
    const clamped = THREE.MathUtils.clamp(factor, 0.2, 2.0);
    if (Math.abs(this._distanceScale - clamped) < 0.01) return;
    this._distanceScale = clamped;
    this.resizeCanvasForCurrentViewport();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

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

    if (this.fileMap) {
      revokeFileMapUrls(this.fileMap);
      this.fileMap = null;
    }
  }

  // ──────────────────────────────────────────────
  // Expression
  // ──────────────────────────────────────────────

  private createExpressionController(): ExpressionController {
    const expressionInfos: ExpressionInfo[] = this.expressionNames.map((n) => ({
      name: n,
      category: "other" as const,
    }));

    const semanticInfos: ExpressionInfo[] = SEMANTIC_EXPRESSION_KEYS.map(
      (key) => ({
        name: key,
        category:
          key === "blink" || key === "blinkLeft" || key === "blinkRight"
            ? ("eye" as const)
            : ("lip" as const),
      })
    );

    const allInfos = [...semanticInfos, ...expressionInfos];

    const isSemantic = (name: string): name is SemanticExpressionKey =>
      (SEMANTIC_EXPRESSION_KEYS as readonly string[]).includes(name);

    const expDefinitionSet = new Set(this.expressionNames);

    return {
      list: () => allInfos,
      has: (name) => isSemantic(name) || expDefinitionSet.has(name),
      get: (name) => this.expressionWeights.get(name) ?? 0,
      set: (name, weight) => {
        const clamped = THREE.MathUtils.clamp(weight, 0, 1);
        this.expressionWeights.set(name, clamped);
        if (isSemantic(name)) {
          return; // 毎フレーム update() で反映
        }
        if (!expDefinitionSet.has(name)) return;
        if (clamped > 0) {
          this.instance.setExpression(name);
        } else {
          this.instance.resetExpression();
        }
      },
      setMany: (values) => {
        for (const [name, weight] of Object.entries(values)) {
          this.expressions.set(name, weight);
        }
      },
      reset: () => {
        for (const info of allInfos) {
          this.expressionWeights.set(info.name, 0);
        }
        this.instance.resetExpression();
      },
    };
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

    const layoutStart = beginLive2DProfile();

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
    const geometryStart = beginLive2DProfile();
    this.planeMesh.geometry.dispose();
    this.planeMesh.geometry = this.createPlaneGeometry(
      planeWidth,
      planeHeight,
      layout
    );
    this.planeMesh.position.y = planeHeight / 2;
    endLive2DProfile("live2d.layout.geometry", geometryStart);
    endLive2DProfile("live2d.layout.total", layoutStart);
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
    return new MutableExpressionMapping({
      blink: "blink",
      blinkLeft: "blinkLeft",
      blinkRight: "blinkRight",
      aa: "aa",
      ih: "ih",
      ou: "ou",
      ee: "ee",
      oh: "oh",
    });
  }

  private applySemanticParameters(): void {
    for (const key of SEMANTIC_EXPRESSION_KEYS) {
      const w = this.expressionWeights.get(key) ?? 0;
      if (w <= 0) continue;
      const params = SEMANTIC_PARAM_MAP[key];
      for (const { id, valueAtOne } of params) {
        try {
          const base = this.instance.getParameterValue(id);
          const target = base + (valueAtOne - base) * w;
          this.instance.setParameterValue(id, target);
        } catch {
          // そのパラメータを持たないモデルは無視
        }
      }
    }
  }

  // ──────────────────────────────────────────────
  // Animation
  // ──────────────────────────────────────────────

  private createAnimationController(): AnimationController {
    return {
      getCurrentClip: () => null,
      isLoaded: () => this.hasStartedMotion,
      loadAndPlay: async (urls) => {
        const groups = this.instance.listMotionGroups();
        if (groups.length === 0) return;
        const idleGroup =
          groups.find((g) => /idle/i.test(g.groupName)) ?? groups[0];
        const ok = this.instance.startMotion(idleGroup.groupName, 0);
        if (ok) this.hasStartedMotion = true;
        void urls; // 追加 urls のハンドリングは将来対応
      },
      stop: () => {
        this.instance.stopMotions();
        this.hasStartedMotion = false;
      },
      setPaused: (paused) => {
        this.paused = paused;
      },
      setTime: () => {
        // Live2D のモーション再生位置 seek は本ライブラリの安定公開 API が無いので no-op
      },
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
