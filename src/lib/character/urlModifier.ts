import * as THREE from "three";
import type { FileMap } from "@/lib/file-map";

/**
 * MMD/VRM のテクスチャ参照を blob URL に解決する LoadingManager 用 URLModifier。
 */
export function createURLModifier(fileMap: FileMap) {
  return (url: string): string => {
    const normalized = url.replace(/\\/g, "/");

    if (fileMap.has(normalized)) return fileMap.get(normalized)!;

    const filename = normalized.split("/").pop() || "";
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

    const altPath = normalized.includes("/tex/")
      ? normalized.replace("/tex/", "/textures/")
      : normalized.includes("/textures/")
        ? normalized.replace("/textures/", "/tex/")
        : null;

    if (altPath) {
      if (fileMap.has(altPath)) return fileMap.get(altPath)!;

      const altFilename = altPath.split("/").pop() || "";
      if (fileMap.has(altFilename)) return fileMap.get(altFilename)!;

      for (const [key, blobUrl] of fileMap.entries()) {
        const normalizedKey = key.replace(/\\/g, "/");
        if (altPath.endsWith(normalizedKey) || normalizedKey.endsWith(altPath)) {
          return blobUrl;
        }
      }
    }

    try {
      const decoded = decodeURIComponent(normalized);
      if (fileMap.has(decoded)) return fileMap.get(decoded)!;

      const decodedFilename = decoded.split("/").pop() || "";
      if (fileMap.has(decodedFilename)) return fileMap.get(decodedFilename)!;
    } catch {
      // ignore decode errors
    }

    return url;
  };
}

export function buildLoadingManager(
  fileMap: FileMap | null
): THREE.LoadingManager | undefined {
  if (!fileMap) return undefined;
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(createURLModifier(fileMap));
  return manager;
}

export function revokeFileMapUrls(fileMap: FileMap): void {
  const revoked = new Set<string>();
  for (const url of fileMap.values()) {
    if (!revoked.has(url)) {
      URL.revokeObjectURL(url);
      revoked.add(url);
    }
  }
  fileMap.clear();
}
