"use client";

import {
  CubismFramework,
  LogLevel,
  Option,
} from "@/vendor/cubism-framework/live2dcubismframework";

let frameworkReady = false;

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
}

export async function ensureCubismFrameworkReady(): Promise<void> {
  if (frameworkReady) {
    return;
  }

  await ensureCubismCoreReady();

  const option = new Option();
  option.logFunction = (msg: string) => {
    // Core 側のログはコンソール直送
    console.log(msg);
  };
  option.loggingLevel = LogLevel.LogLevel_Warning;

  CubismFramework.startUp(option);
  CubismFramework.initialize();
  frameworkReady = true;
}
