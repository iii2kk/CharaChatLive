"use client";

import { CubismModelSettingJson } from "@/vendor/cubism-framework/cubismmodelsettingjson";
import type { ICubismModelSetting } from "@/vendor/cubism-framework/icubismmodelsetting";
import type { FileMap } from "@/lib/file-map";

export interface LoadedSetting {
  setting: ICubismModelSetting;
  /** モデルディレクトリ（参照ファイル名解決のための基準） */
  resolveAsset: (relPath: string) => string | null;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function resolveInFileMap(relPath: string, fileMap: FileMap): string | null {
  const normalized = normalizePath(relPath);
  if (fileMap.has(normalized)) return fileMap.get(normalized)!;

  const filename = normalized.split("/").pop() ?? "";
  if (fileMap.has(filename)) return fileMap.get(filename)!;

  for (const [key, blobUrl] of fileMap.entries()) {
    const normalizedKey = normalizePath(key);
    if (normalized.endsWith(normalizedKey) || normalizedKey.endsWith(normalized)) {
      return blobUrl;
    }
  }
  return null;
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return await res.arrayBuffer();
}

/**
 * model3.json をロードして ICubismModelSetting を構築する。
 * FileMap 指定時は blob URL へ解決、無指定時は model3.json の URL を基準に相対解決する。
 */
export async function loadModelSetting(
  modelUrl: string,
  fileMap: FileMap | null
): Promise<LoadedSetting> {
  const buffer = await fetchArrayBuffer(modelUrl);
  const setting = new CubismModelSettingJson(buffer, buffer.byteLength);

  let resolveAsset: (rel: string) => string | null;

  if (fileMap) {
    resolveAsset = (rel) => resolveInFileMap(rel, fileMap);
  } else {
    // preset URL: model3.json の URL からディレクトリを基準に連結
    const base = modelUrl.substring(0, modelUrl.lastIndexOf("/") + 1);
    resolveAsset = (rel) => base + normalizePath(rel);
  }

  return { setting, resolveAsset };
}

export { fetchArrayBuffer };
