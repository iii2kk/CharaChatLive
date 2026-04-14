import type * as PIXI from "pixi.js";
import type {
  Cubism4ModelSettings,
  Live2DModel,
} from "pixi-live2d-display-lipsyncpatch/cubism4";
import type { FileMap } from "@/lib/file-map";

/**
 * PIXI Application + Live2DModel のセットアップ。
 * - 専用 off-screen canvas を作り、Live2D モデルを PIXI で WebGL 描画する
 * - Three.js 側はこの canvas を CanvasTexture として板に貼る
 *
 * 手動 render（autoStart: false, sharedTicker: false）にして、
 * Three.js の useFrame からタイミングを駆動する
 *
 * 注意: pixi.js / pixi-live2d-display は Node.js 実行時に window を参照するので、
 * すべての value 参照は関数内で dynamic import で行う。
 */
export interface Live2DRenderContext {
  pixiApp: PIXI.Application<HTMLCanvasElement>;
  live2dModel: Live2DModel;
  canvas: HTMLCanvasElement;
  atlasHandle: Live2DAtlasHandle;
}

export interface Live2DAtlasLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  atlasWidth: number;
  atlasHeight: number;
}

export interface Live2DAtlasHandle {
  getLayout(): Live2DAtlasLayout;
  setOnLayoutChange(
    callback: ((layout: Live2DAtlasLayout) => void) | null
  ): void;
  updateSize(width: number, height: number): void;
  dispose(): void;
}

const LIVE2D_CANVAS_RENDER_SCALE = 0.75;
const LIVE2D_CANVAS_MIN_EDGE = 256;
const LIVE2D_CANVAS_MAX_EDGE = 2048;
const LIVE2D_VIEWPORT_HEIGHT_USAGE = 0.7;

declare global {
  interface Window {
    Live2DCubismCore?: {
      Model?: {
        fromMoc?: (...args: unknown[]) => {
          drawables?: Record<string, unknown>;
          getRenderOrders?: () => Int32Array;
        } | null;
      };
    };
  }
}

function applyCubismCoreCompatibilityPatch(): void {
  const modelApi = window.Live2DCubismCore?.Model;
  if (!modelApi?.fromMoc) {
    return;
  }

  const patchedFromMoc = modelApi.fromMoc as typeof modelApi.fromMoc & {
    __live2dCompatPatched?: boolean;
  };

  if (patchedFromMoc.__live2dCompatPatched) {
    return;
  }

  modelApi.fromMoc = ((...args: unknown[]) => {
    const model = patchedFromMoc(...args);

    if (
      model?.drawables &&
      typeof model.getRenderOrders === "function" &&
      model.drawables.renderOrders === undefined
    ) {
      model.drawables.renderOrders = model.getRenderOrders();
    }

    return model;
  }) as typeof modelApi.fromMoc;

  (modelApi.fromMoc as typeof patchedFromMoc).__live2dCompatPatched = true;
}

interface SharedAtlasEntry {
  live2dModel: Live2DModel;
  width: number;
  height: number;
  layout: Live2DAtlasLayout;
  onLayoutChange: ((layout: Live2DAtlasLayout) => void) | null;
}

class SharedLive2DAtlasHandle implements Live2DAtlasHandle {
  constructor(
    private atlas: SharedLive2DAtlas,
    private entry: SharedAtlasEntry
  ) {}

  getLayout(): Live2DAtlasLayout {
    return { ...this.entry.layout };
  }

  setOnLayoutChange(
    callback: ((layout: Live2DAtlasLayout) => void) | null
  ): void {
    this.entry.onLayoutChange = callback;
    if (callback) {
      callback(this.getLayout());
    }
  }

  updateSize(width: number, height: number): void {
    this.entry.width = width;
    this.entry.height = height;
    this.atlas.relayout();
  }

  dispose(): void {
    this.atlas.unregister(this.entry);
  }
}

class SharedLive2DAtlas {
  readonly pixiApp: PIXI.Application<HTMLCanvasElement>;
  readonly canvas: HTMLCanvasElement;
  private readonly entries: SharedAtlasEntry[] = [];
  private readonly slotPadding = 8;

  constructor(pixiApp: PIXI.Application<HTMLCanvasElement>, canvas: HTMLCanvasElement) {
    this.pixiApp = pixiApp;
    this.canvas = canvas;
  }

  register(
    live2dModel: Live2DModel,
    width: number,
    height: number
  ): Live2DAtlasHandle {
    const entry: SharedAtlasEntry = {
      live2dModel,
      width,
      height,
      layout: {
        x: 0,
        y: 0,
        width,
        height,
        atlasWidth: width,
        atlasHeight: height,
      },
      onLayoutChange: null,
    };

    this.entries.push(entry);
    this.pixiApp.stage.addChild(live2dModel);
    this.relayout();

    return new SharedLive2DAtlasHandle(this, entry);
  }

  unregister(entry: SharedAtlasEntry): void {
    const index = this.entries.indexOf(entry);
    if (index === -1) {
      return;
    }

    entry.onLayoutChange = null;
    this.pixiApp.stage.removeChild(entry.live2dModel);
    this.entries.splice(index, 1);

    if (this.entries.length === 0) {
      this.pixiApp.destroy(true, {
        children: false,
        texture: false,
        baseTexture: false,
      });
      sharedLive2DAtlas = null;
      return;
    }

    this.relayout();
  }

  relayout(): void {
    if (this.entries.length === 0) {
      return;
    }

    const atlasHeight = Math.max(...this.entries.map((entry) => entry.height));
    let cursorX = 0;

    for (const entry of this.entries) {
      entry.layout = {
        x: cursorX,
        y: 0,
        width: entry.width,
        height: entry.height,
        atlasWidth: 0,
        atlasHeight,
      };
      cursorX += entry.width + this.slotPadding;
    }

    const atlasWidth = Math.max(1, cursorX - this.slotPadding);
    this.pixiApp.renderer.resize(atlasWidth, atlasHeight);

    for (const entry of this.entries) {
      entry.layout = {
        ...entry.layout,
        atlasWidth,
      };

      entry.live2dModel.position.set(
        entry.layout.x + entry.layout.width / 2,
        entry.layout.y + entry.layout.height / 2
      );

      const modelWidth = entry.live2dModel.internalModel.width;
      const modelHeight = entry.live2dModel.internalModel.height;
      const scale = Math.min(
        entry.layout.width / modelWidth,
        entry.layout.height / modelHeight
      );
      entry.live2dModel.scale.set(scale);

      entry.onLayoutChange?.({ ...entry.layout });
    }
  }
}

let sharedLive2DAtlas: SharedLive2DAtlas | null = null;

function getSharedLive2DAtlas(
  PIXIMod: typeof import("pixi.js")
): SharedLive2DAtlas {
  if (sharedLive2DAtlas) {
    return sharedLive2DAtlas;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;

  const pixiApp = new PIXIMod.Application<HTMLCanvasElement>({
    view: canvas,
    width: 1,
    height: 1,
    backgroundAlpha: 0,
    autoStart: false,
    antialias: true,
    preserveDrawingBuffer: false,
    sharedTicker: false,
  });

  sharedLive2DAtlas = new SharedLive2DAtlas(pixiApp, canvas);
  return sharedLive2DAtlas;
}

export function computeLive2DCanvasSize(
  modelWidth: number,
  modelHeight: number,
  renderScale = LIVE2D_CANVAS_RENDER_SCALE
): { width: number; height: number } {
  const safeWidth = Math.max(1, modelWidth);
  const safeHeight = Math.max(1, modelHeight);
  const aspect = safeWidth / safeHeight;

  const viewportWidth = window.innerWidth || 1280;
  const viewportHeight = window.innerHeight || 720;
  const viewportScale = Math.min(window.devicePixelRatio || 1, 2);

  const maxTargetWidth =
    viewportWidth * viewportScale * renderScale;
  const maxTargetHeight =
    viewportHeight *
    viewportScale *
    LIVE2D_VIEWPORT_HEIGHT_USAGE *
    renderScale;

  let width = safeWidth;
  let height = safeHeight;
  let scale = 1;

  if (width > maxTargetWidth || height > maxTargetHeight) {
    scale = Math.min(maxTargetWidth / width, maxTargetHeight / height);
  }

  width *= scale;
  height *= scale;

  // 極端に小さいモデルでもテクスチャが潰れすぎないよう最低辺を確保する。
  if (Math.max(width, height) < LIVE2D_CANVAS_MIN_EDGE) {
    const minScale = LIVE2D_CANVAS_MIN_EDGE / Math.max(width, height);
    width *= minScale;
    height *= minScale;
  }

  // 上限を超える場合はアスペクトを維持したまま再度縮小する。
  if (Math.max(width, height) > LIVE2D_CANVAS_MAX_EDGE) {
    const maxScale = LIVE2D_CANVAS_MAX_EDGE / Math.max(width, height);
    width *= maxScale;
    height *= maxScale;
  }

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/**
 * Cubism Core ランタイム (window.Live2DCubismCore) が読み込み済みか確認。
 * layout.tsx で <Script strategy="beforeInteractive"> 経由で読んでいるため、
 * クライアントコンポーネントのロード時点で通常は解決済み。念のため短時間だけ待つ。
 */
export async function ensureCubismCoreReady(
  timeoutMs = 3000
): Promise<void> {
  const start = performance.now();
  while (
    typeof window !== "undefined" &&
    !(window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore
  ) {
    if (performance.now() - start > timeoutMs) {
      throw new Error(
        "Live2D Cubism Core が読み込まれていません。/live2dcubismcore.min.js の配置を確認してください"
      );
    }
    await new Promise((r) => setTimeout(r, 16));
  }

  applyCubismCoreCompatibilityPatch();
}

/**
 * FileMap の既存のマルチキー仕様（フルパス / ルート除去 / ファイル名のみ）に沿って
 * 相対パスを blob URL に解決する。ヒットしなければ null。
 */
function resolveInFileMap(relPath: string, fileMap: FileMap): string | null {
  const normalized = relPath.replace(/\\/g, "/");
  if (fileMap.has(normalized)) return fileMap.get(normalized)!;

  const filename = normalized.split("/").pop() ?? "";
  if (fileMap.has(filename)) return fileMap.get(filename)!;

  for (const [key, blobUrl] of fileMap.entries()) {
    const normalizedKey = key.replace(/\\/g, "/");
    if (
      normalized.endsWith(normalizedKey) ||
      normalizedKey.endsWith(normalized)
    ) {
      return blobUrl;
    }
  }
  return null;
}

/**
 * fileMap 有り（フォルダドロップ）で ModelSettings を作る。
 * model3.json 本体を blob URL から fetch し、参照ファイル群を blob URL に書き換える。
 */
async function buildSettingsFromFileMap(
  modelBlobUrl: string,
  fileMap: FileMap,
  Cubism4ModelSettingsCtor: typeof Cubism4ModelSettings
): Promise<Cubism4ModelSettings> {
  const res = await fetch(modelBlobUrl);
  if (!res.ok) {
    throw new Error(`model3.json の取得に失敗: ${res.status}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const settings = new Cubism4ModelSettingsCtor({
    ...(json as object),
    url: modelBlobUrl,
  } as ConstructorParameters<typeof Cubism4ModelSettings>[0]);
  settings.replaceFiles((file) => resolveInFileMap(file, fileMap) ?? file);
  return settings;
}

/**
 * Live2DModel と PIXI Application をセットアップして返す。
 * fileMap がある場合は ModelSettings を組み立ててから from() に渡す。
 * fileMap が無い場合 (プリセット経由) は URL 直渡しで pixi-live2d-display に fetch させる。
 */
export async function createLive2DContext(opts: {
  modelUrl: string;
  fileMap: FileMap | null;
  renderScale?: number;
}): Promise<Live2DRenderContext> {
  await ensureCubismCoreReady();

  // pixi.js / pixi-live2d-display は window 参照を含むため dynamic import。
  // `/cubism4` エントリを使うことで Cubism 2 ランタイム (live2d.min.js) への
  // 要求を回避する（index 全体を import すると Cubism2/4 両方のランタイムが
  // 必須チェックされる）。
  const [PIXIMod, Live2DMod] = await Promise.all([
    import("pixi.js"),
    import("pixi-live2d-display-lipsyncpatch/cubism4"),
  ]);

  const source: string | Cubism4ModelSettings = opts.fileMap
    ? await buildSettingsFromFileMap(
        opts.modelUrl,
        opts.fileMap,
        Live2DMod.Cubism4ModelSettings
      )
    : opts.modelUrl;

  const live2dModel = await Live2DMod.Live2DModel.from(source, {
    autoInteract: false,
    autoUpdate: false,
  });

  const { width, height } = computeLive2DCanvasSize(
    live2dModel.internalModel.width,
    live2dModel.internalModel.height,
    opts.renderScale
  );
  live2dModel.anchor.set(0.5, 0.5);

  const atlas = getSharedLive2DAtlas(PIXIMod);
  const atlasHandle = atlas.register(live2dModel, width, height);

  return {
    pixiApp: atlas.pixiApp,
    live2dModel,
    canvas: atlas.canvas,
    atlasHandle,
  };
}
