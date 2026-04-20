"use client";

import * as THREE from "three";

/**
 * Canvas 内で useThree().gl から取得した WebGLRenderer を、
 * Canvas 外のコードパス (useModelLoader → createCharacterModel → Live2dCharacterModel.load)
 * に渡すための共有参照。
 *
 * Canvas マウント時に setThreeRendererRef で登録し、アンマウント時に null を渡す。
 */

let renderer: THREE.WebGLRenderer | null = null;
const waiters: Array<(r: THREE.WebGLRenderer) => void> = [];

export function setThreeRendererRef(r: THREE.WebGLRenderer | null): void {
  renderer = r;
  if (r) {
    const pending = waiters.splice(0, waiters.length);
    for (const resolve of pending) resolve(r);
  }
}

export async function waitForThreeRenderer(
  timeoutMs = 5000
): Promise<THREE.WebGLRenderer> {
  if (renderer) return renderer;
  return await new Promise<THREE.WebGLRenderer>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waiters.indexOf(onReady);
      if (idx !== -1) waiters.splice(idx, 1);
      reject(new Error("Three WebGLRenderer が初期化されていません"));
    }, timeoutMs);
    const onReady = (r: THREE.WebGLRenderer) => {
      clearTimeout(timer);
      resolve(r);
    };
    waiters.push(onReady);
  });
}
