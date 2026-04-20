"use client";

import * as THREE from "three";

/**
 * Three の state cache と Cubism renderer の GL 直接操作を分離するためのガード。
 *
 * 使い方:
 *   runIsolated(threeRenderer, (gl) => {
 *     // Cubism の描画を呼ぶ
 *   });
 *
 * Three の内部 state cache は `resetState()` で invalidate される。これにより
 * 次回 Three が描画を行う際に全 state を再設定してくれるので、Cubism が gl の
 * blend/depth/program/buffer 等を変更しても Three 側の描画は正しく行える。
 */
export function runIsolated(
  threeRenderer: THREE.WebGLRenderer,
  fn: (gl: WebGL2RenderingContext | WebGLRenderingContext) => void
): void {
  const gl = threeRenderer.getContext() as
    | WebGL2RenderingContext
    | WebGLRenderingContext;

  // 呼び出し前に Three の状態を確定させる（保留されている state 変更を flush）
  threeRenderer.resetState();

  try {
    fn(gl);
  } finally {
    // Cubism が汚した状態を Three に再取得させる
    threeRenderer.resetState();
  }
}
