"use client";

import * as THREE from "three";
import type { CubismInstance } from "./cubismInstance";
import { runIsolated } from "./glStateGuard";

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
  getSharedTexture(): THREE.Texture;
  setOnLayoutChange(
    callback: ((layout: Live2DAtlasLayout) => void) | null
  ): void;
  updateSize(width: number, height: number): void;
  dispose(): void;
}

interface Entry {
  instance: CubismInstance;
  width: number;
  height: number;
  layout: Live2DAtlasLayout;
  onLayoutChange: ((layout: Live2DAtlasLayout) => void) | null;
}

/**
 * 解像度計算に使うグローバル設定。viewerSettings から UI 経由で更新される。
 * setLive2DResolutionConfig で差し替えると、以降 computeLive2DCanvasSize が
 * 新しい値を使う。既存モデルに反映させるには各モデルの refreshAtlasSize() を
 * 呼ぶ必要がある (CharacterModels.tsx 側で実施)。
 */
export interface Live2DResolutionConfig {
  qualityMultiplier: number;
  viewportHeightUsage: number;
  maxEdge: number;
  minEdge: number;
}

const LIVE2D_CANVAS_MIN_EDGE_DEFAULT = 256;

let resolutionConfig: Live2DResolutionConfig = {
  qualityMultiplier: 1.25,
  viewportHeightUsage: 1.0,
  maxEdge: 4096,
  minEdge: LIVE2D_CANVAS_MIN_EDGE_DEFAULT,
};

export function setLive2DResolutionConfig(
  patch: Partial<Live2DResolutionConfig>
): void {
  resolutionConfig = { ...resolutionConfig, ...patch };
}

export function getLive2DResolutionConfig(): Readonly<Live2DResolutionConfig> {
  return resolutionConfig;
}

/**
 * Cubism の getCanvasWidth/Height はピクセル単位ではなく「モデル空間の単位」
 * (多くは 1.0 前後の小さい値) を返す。なので元モデルのピクセル寸法を知ることは
 * できない。代わりに
 *   - モデル側からはアスペクト比 (modelWidth / modelHeight) だけ取る
 *   - ピクセル解像度はビューポートと設定 (renderScale × QUALITY_MULTIPLIER) から決める
 * という方針で、スロット高さを基準にアスペクト比で幅を計算する。
 */
export function computeLive2DCanvasSize(
  modelWidth: number,
  modelHeight: number,
  renderScale: number
): { width: number; height: number } {
  const cfg = resolutionConfig;
  const aspect =
    Math.max(1e-6, modelWidth) / Math.max(1e-6, modelHeight);

  const viewportHeight = window.innerHeight || 720;
  const viewportScale = Math.min(window.devicePixelRatio || 1, 2);
  const effective = renderScale * cfg.qualityMultiplier;

  // 目標の描画高さ（ピクセル）。ビューポート高さ × 使用率 × 効きかけたスケール
  let height =
    viewportHeight * viewportScale * cfg.viewportHeightUsage * effective;
  let width = height * aspect;

  // 上限クランプ
  const maxEdge = Math.max(width, height);
  if (maxEdge > cfg.maxEdge) {
    const s = cfg.maxEdge / maxEdge;
    width *= s;
    height *= s;
  }

  // 下限クランプ
  const minEdge = Math.max(width, height);
  if (minEdge < cfg.minEdge) {
    const s = cfg.minEdge / minEdge;
    width *= s;
    height *= s;
  }

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

class SharedLive2DAtlasHandle implements Live2DAtlasHandle {
  constructor(
    private atlas: SharedLive2DAtlas,
    private entry: Entry
  ) {}

  getLayout(): Live2DAtlasLayout {
    return { ...this.entry.layout };
  }
  getSharedTexture(): THREE.Texture {
    return this.atlas.getRenderTarget().texture;
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

/**
 * 複数の Live2D モデルを 1 枚の Three WebGLRenderTarget に水平パックして描画する
 * 共有アトラス。
 */
class SharedLive2DAtlas {
  private renderTarget: THREE.WebGLRenderTarget;
  private entries: Entry[] = [];
  private readonly slotPadding = 8;

  constructor() {
    this.renderTarget = this.createRenderTarget(1, 1);
  }

  private createRenderTarget(w: number, h: number): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      // Cubism のフラグメントシェーダは最終的な sRGB 値を gl_FragColor に直接書き出す。
      // RT を SRGBColorSpace にすると GPU が「書き込み時に linear→sRGB 変換」を適用して
      // Cubism の値を二重エンコード（白っぽく）してしまう。
      // 対策:
      //   - 内部フォーマットを RGBA8 に固定 → GPU 書き込み時変換を無効化。
      //   - texture.colorSpace は NoColorSpace に → Three もサンプル時に触らない。
      //   - 板ポリは独自 ShaderMaterial で "texel をそのまま出力" し、Three の
      //     outputColorSpace による linear→sRGB もスキップする（本ファイル外）。
      //   これで Cubism の sRGB 値が canvas にそのまま届く。
      colorSpace: THREE.NoColorSpace,
    });
    rt.texture.internalFormat = "RGBA8";
    // Three はデフォルトで render target のテクスチャは flipY = false
    return rt;
  }

  getRenderTarget(): THREE.WebGLRenderTarget {
    return this.renderTarget;
  }

  register(
    instance: CubismInstance,
    width: number,
    height: number
  ): Live2DAtlasHandle {
    const entry: Entry = {
      instance,
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
    this.relayout();
    return new SharedLive2DAtlasHandle(this, entry);
  }

  unregister(entry: Entry): void {
    const idx = this.entries.indexOf(entry);
    if (idx === -1) return;
    entry.onLayoutChange = null;
    this.entries.splice(idx, 1);

    if (this.entries.length === 0) {
      // 最後のエントリが消えたらアトラスを最小化
      this.renderTarget.setSize(1, 1);
      return;
    }
    this.relayout();
  }

  relayout(): void {
    if (this.entries.length === 0) return;

    const atlasHeight = Math.max(...this.entries.map((e) => e.height));
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

    const prevWidth = this.renderTarget.width;
    const prevHeight = this.renderTarget.height;
    if (prevWidth !== atlasWidth || prevHeight !== atlasHeight) {
      this.renderTarget.setSize(atlasWidth, atlasHeight);
    }

    for (const entry of this.entries) {
      entry.layout = { ...entry.layout, atlasWidth };
      if (entry.onLayoutChange) {
        entry.onLayoutChange({ ...entry.layout });
      }
    }
  }

  /**
   * 全エントリを RenderTarget に描画する。useFrame 内から 1 フレームに 1 回呼ぶ。
   */
  render(threeRenderer: THREE.WebGLRenderer): void {
    if (this.entries.length === 0) return;

    const prevTarget = threeRenderer.getRenderTarget();
    const prevAutoClear = threeRenderer.autoClear;
    const prevClearColor = new THREE.Color();
    threeRenderer.getClearColor(prevClearColor);
    const prevClearAlpha = threeRenderer.getClearAlpha();

    threeRenderer.autoClear = false;
    threeRenderer.setRenderTarget(this.renderTarget);
    threeRenderer.setClearColor(0x000000, 0);
    threeRenderer.clear(true, false, false);

    // RenderTarget の GL FBO を取得（setRenderTarget で lazy init 済みのはず）
    const rtProps = threeRenderer.properties.get(this.renderTarget) as {
      __webglFramebuffer?: WebGLFramebuffer;
    };
    const fbo = rtProps.__webglFramebuffer ?? null;

    const atlasHeight = this.renderTarget.height;

    runIsolated(threeRenderer, () => {
      for (const entry of this.entries) {
        const vp: [number, number, number, number] = [
          entry.layout.x,
          // GL viewport は bottom-left 原点。layout は top-left 原点なので Y 反転
          atlasHeight - entry.layout.y - entry.layout.height,
          entry.layout.width,
          entry.layout.height,
        ];
        entry.instance.drawInto(fbo, vp);
      }
    });

    threeRenderer.setRenderTarget(prevTarget);
    threeRenderer.setClearColor(prevClearColor, prevClearAlpha);
    threeRenderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.entries.length = 0;
  }
}

let sharedAtlas: SharedLive2DAtlas | null = null;

export function getSharedAtlas(): SharedLive2DAtlas {
  if (!sharedAtlas) {
    sharedAtlas = new SharedLive2DAtlas();
  }
  return sharedAtlas;
}

export function renderSharedLive2DAtlas(
  threeRenderer: THREE.WebGLRenderer
): void {
  if (!sharedAtlas) return;
  sharedAtlas.render(threeRenderer);
}

export function registerInstance(
  instance: CubismInstance,
  width: number,
  height: number
): Live2DAtlasHandle {
  return getSharedAtlas().register(instance, width, height);
}

/** 全インスタンスが解除されたときに呼ぶ。singleton をリセットする */
export function resetSharedAtlasIfEmpty(): void {
  if (sharedAtlas && sharedAtlas["entries"].length === 0) {
    sharedAtlas.dispose();
    sharedAtlas = null;
  }
}
