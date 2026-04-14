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
}

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

  const width = Math.ceil(live2dModel.internalModel.width);
  const height = Math.ceil(live2dModel.internalModel.height);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(width, 512);
  canvas.height = Math.max(height, 512);

  const pixiApp = new PIXIMod.Application<HTMLCanvasElement>({
    view: canvas,
    width: canvas.width,
    height: canvas.height,
    backgroundAlpha: 0,
    autoStart: false,
    antialias: true,
    preserveDrawingBuffer: false,
    sharedTicker: false,
  });

  live2dModel.anchor.set(0.5, 0.5);
  live2dModel.position.set(canvas.width / 2, canvas.height / 2);
  const modelW = live2dModel.internalModel.width;
  const modelH = live2dModel.internalModel.height;
  const scale = Math.min(canvas.width / modelW, canvas.height / modelH);
  live2dModel.scale.set(scale);

  pixiApp.stage.addChild(live2dModel);

  return { pixiApp, live2dModel, canvas };
}
