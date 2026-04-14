import * as THREE from "three";
import type { Application as PixiApplication } from "pixi.js";
import type {
  Cubism4InternalModel,
  Live2DModel,
} from "pixi-live2d-display-lipsyncpatch/cubism4";
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
import { createLive2DContext } from "./live2dPixi";

/**
 * 板ポリの高さ。MMD/VRM と並べたときの身長を合わせる目安値。
 * MMD は 1 unit ≈ 8cm なので 20 unit ≈ 160cm。
 */
const PLANE_HEIGHT = 20;

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

type AnyCubismModel = Cubism4InternalModel["coreModel"];

interface Live2dConstructorOptions {
  id: string;
  name: string;
  pixiApp: PixiApplication<HTMLCanvasElement>;
  live2dModel: Live2DModel;
  canvas: HTMLCanvasElement;
  fileMap: FileMap | null;
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

  private pixiApp: PixiApplication<HTMLCanvasElement>;
  private live2dModel: Live2DModel;
  private canvasTexture: THREE.CanvasTexture;
  private planeMesh: THREE.Mesh;
  private group: THREE.Group;
  private fileMap: FileMap | null;

  /** 表情コントローラの最後の set 値。Live2D 側は重みを直接持たないため自前で記録 */
  private expressionWeights = new Map<string, number>();
  /** 現在再生中のモーション（簡易 isLoaded 判定用） */
  private hasStartedMotion = false;
  private physicsEnabled = true;
  private paused = false;

  constructor(opts: Live2dConstructorOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.pixiApp = opts.pixiApp;
    this.live2dModel = opts.live2dModel;
    this.fileMap = opts.fileMap;

    // 初回描画（テクスチャ生成前に 1 フレーム描いておく）
    this.pixiApp.renderer.render(this.pixiApp.stage);

    this.canvasTexture = new THREE.CanvasTexture(opts.canvas);
    this.canvasTexture.colorSpace = THREE.SRGBColorSpace;
    this.canvasTexture.minFilter = THREE.LinearFilter;
    this.canvasTexture.magFilter = THREE.LinearFilter;
    this.canvasTexture.generateMipmaps = false;

    const planeWidth =
      PLANE_HEIGHT * (opts.canvas.width / opts.canvas.height);
    this.planeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(planeWidth, PLANE_HEIGHT),
      new THREE.MeshBasicMaterial({
        map: this.canvasTexture,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.planeMesh.position.y = PLANE_HEIGHT / 2; // 足元を原点に

    this.group = new THREE.Group();
    this.group.name = `live2d:${opts.id}`;
    this.group.add(this.planeMesh);
    this.object = this.group;

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
  }): Promise<Live2dCharacterModel> {
    const ctx = await createLive2DContext({
      modelUrl: opts.url,
      fileMap: opts.fileMap,
    });

    // if (!isCubism4(ctx.live2dModel)) {
    //   ctx.live2dModel.destroy({ children: true, texture: true, baseTexture: true });
    //   ctx.pixiApp.destroy(true, { children: true, texture: true, baseTexture: true });
    //   throw new Error(
    //     "このモデルは Cubism 2 系です。現在は Cubism 3/4/5 のみ対応しています"
    //   );
    // }

    return new Live2dCharacterModel({
      id: opts.id,
      name: opts.name,
      pixiApp: ctx.pixiApp,
      live2dModel: ctx.live2dModel,
      canvas: ctx.canvas,
      fileMap: opts.fileMap,
    });
  }

  update(delta: number): void {
    if (this.paused) {
      // paused 時は PIXI ステージを再描画しない（最後のフレームを維持）
      return;
    }

    // Cubism は ms 単位。Three.js の delta は秒
    const dtMs = delta * 1000;

    // ExpressionMapping で指定されている仮想表情を毎フレーム反映
    // （Live2D のパラメータは毎フレーム上書きされるため）
    this.applySemanticParameters();

    this.live2dModel.update(dtMs);

    // 物理は InternalModel.update の中で動くため、無効化時は
    // update を呼ばずに expressionManager のみ反映する必要があるが
    // pixi-live2d-display では一体化しているため、現状は physicsEnabled が
    // true/false に関わらず update を呼ぶ（setEnabled は将来対応）

    this.pixiApp.renderer.render(this.pixiApp.stage);
    this.canvasTexture.needsUpdate = true;
  }

  dispose(): void {
    try {
      this.live2dModel.destroy({
        children: true,
        texture: true,
        baseTexture: true,
      });
    } catch {
      /* ignore */
    }
    try {
      this.pixiApp.destroy(true, {
        children: true,
        texture: true,
        baseTexture: true,
      });
    } catch {
      /* ignore */
    }

    this.planeMesh.geometry.dispose();
    const material = this.planeMesh.material;
    if (material instanceof THREE.Material) {
      material.dispose();
    }
    this.canvasTexture.dispose();

    if (this.fileMap) {
      revokeFileMapUrls(this.fileMap);
      this.fileMap = null;
    }
  }

  // ──────────────────────────────────────────────
  // Expression
  // ──────────────────────────────────────────────

  private createExpressionController(): ExpressionController {
    // .exp3.json 由来の表情
    const expressionManager =
      this.live2dModel.internalModel.motionManager.expressionManager;
    const expDefinitions =
      (expressionManager?.definitions as Array<{ Name: string; File: string }> | undefined) ?? [];

    const expressionInfos: ExpressionInfo[] = expDefinitions.map((d) => ({
      name: d.Name,
      category: "other" as const,
    }));

    // セマンティック仮想表情も list に混ぜて返す
    const semanticInfos: ExpressionInfo[] = SEMANTIC_EXPRESSION_KEYS.map(
      (key) => ({
        name: key, // "blink" / "aa" / ...
        category:
          key === "blink" || key === "blinkLeft" || key === "blinkRight"
            ? ("eye" as const)
            : ("lip" as const),
      })
    );

    const allInfos = [...semanticInfos, ...expressionInfos];

    const isSemantic = (name: string): name is SemanticExpressionKey =>
      (SEMANTIC_EXPRESSION_KEYS as readonly string[]).includes(name);

    const expDefinitionSet = new Set(expDefinitions.map((d) => d.Name));

    return {
      list: () => allInfos,
      has: (name) => isSemantic(name) || expDefinitionSet.has(name),
      get: (name) => this.expressionWeights.get(name) ?? 0,
      set: (name, weight) => {
        const clamped = THREE.MathUtils.clamp(weight, 0, 1);
        this.expressionWeights.set(name, clamped);
        if (isSemantic(name)) {
          // 毎フレーム適用するので書き込みは update() 側で
          return;
        }
        if (!expDefinitionSet.has(name)) return;
        if (!expressionManager) return;
        if (clamped > 0) {
          void expressionManager.setExpression(name);
        } else {
          expressionManager.resetExpression();
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
        expressionManager?.resetExpression();
      },
    };
  }

  /**
   * セマンティックキー (`blink` 等) をそのままマッピング初期値に入れる。
   * `buildAutoMapping` を使わず、自分のコントローラが `has("blink")` を true で返す
   * 前提で直接登録する。
   */
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

  /**
   * update() の前に呼ぶ。expressionWeights に格納されたセマンティックキーの重みを
   * Live2D の coreModel パラメータに書き込む。
   */
  private applySemanticParameters(): void {
    const coreModel = (this.live2dModel.internalModel as Cubism4InternalModel)
      .coreModel as AnyCubismModel & {
      setParameterValueById(id: string, value: number, weight?: number): void;
      getParameterValueById?(id: string): number;
    };

    for (const key of SEMANTIC_EXPRESSION_KEYS) {
      const w = this.expressionWeights.get(key) ?? 0;
      if (w <= 0) continue;
      const params = SEMANTIC_PARAM_MAP[key];
      for (const { id, valueAtOne } of params) {
        try {
          // 現在値から valueAtOne へ w で補間
          const base =
            typeof coreModel.getParameterValueById === "function"
              ? coreModel.getParameterValueById(id)
              : 0;
          const target = base + (valueAtOne - base) * w;
          coreModel.setParameterValueById(id, target);
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
      getCurrentClip: () => null, // Live2D は THREE.AnimationClip に変換しない
      isLoaded: () => this.hasStartedMotion,
      loadAndPlay: async (urls) => {
        // Live2D ではフォルダ取り込み時に model3.json 内で参照されるモーションが
        // すべて既に MotionManager にロード済み。追加 URL 再生は未対応。
        // モデル側のデフォルトの Idle グループを再生する
        const manager = this.live2dModel.internalModel.motionManager;
        const groups = Object.keys(manager.definitions ?? {});
        if (groups.length === 0) return;

        // Idle 系を優先。なければ先頭グループ
        const idleGroup =
          groups.find((g) => /idle/i.test(g)) ?? groups[0];
        const ok = await this.live2dModel.motion(idleGroup, 0);
        if (ok) this.hasStartedMotion = true;
        // 追加 urls のハンドリングは将来対応
        void urls;
      },
      stop: () => {
        this.live2dModel.stopMotions();
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
        // pixi-live2d-display 側の物理 on/off は内部 API が fragile なので、
        // フラグだけ保持。update の呼び出しはいずれにせよ行う。
      },
      setGravity: () => {
        // Live2D .physics3 はカスタム重力パラメータを公開していないため no-op
      },
    };
  }
}
