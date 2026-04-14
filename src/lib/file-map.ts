export type FileMap = Map<string, string>;
export type ModelKind = "mmd" | "vrm" | "live2d";
export type AnimationKind = "vmd" | "vrma" | "motion3";

export interface ModelFileMatch {
  kind: ModelKind;
  name: string;
  url: string;
}

const mmdModelPattern = /\.(pmx|pmd)$/i;
const vrmModelPattern = /\.vrm$/i;
const live2dModelPattern = /\.model3\.json$/i;
const vmdPattern = /\.vmd$/i;
const vrmaPattern = /\.vrma$/i;
const motion3Pattern = /\.motion3\.json$/i;

export function buildFileMap(files: FileList): FileMap {
  const map: FileMap = new Map();

  for (const file of Array.from(files)) {
    const blobUrl = URL.createObjectURL(file);
    const relativePath = file.webkitRelativePath || file.name;

    // Store with full webkitRelativePath
    map.set(relativePath, blobUrl);

    // Store without root folder (e.g., "ModelFolder/tex/body.png" -> "tex/body.png")
    const parts = relativePath.split("/");
    if (parts.length > 1) {
      const withoutRoot = parts.slice(1).join("/");
      map.set(withoutRoot, blobUrl);
    }

    // Store by filename only (fallback for flat texture references)
    map.set(file.name, blobUrl);
  }

  return map;
}

export function getModelKind(path: string): ModelKind | null {
  if (mmdModelPattern.test(path)) return "mmd";
  if (vrmModelPattern.test(path)) return "vrm";
  if (live2dModelPattern.test(path)) return "live2d";
  return null;
}

export function getAnimationKind(path: string): AnimationKind | null {
  if (vmdPattern.test(path)) return "vmd";
  if (vrmaPattern.test(path)) return "vrma";
  if (motion3Pattern.test(path)) return "motion3";
  return null;
}

export function findModelFile(map: FileMap): string | null {
  return findModelFileEntry(map)?.url ?? null;
}

export function findModelFileEntry(map: FileMap): ModelFileMatch | null {
  for (const [path, url] of map.entries()) {
    const kind = getModelKind(path);
    if (!kind) continue;

    const parts = path.split("/");

    return {
      kind,
      name: parts[parts.length - 1],
      url,
    };
  }

  return null;
}

export function findModelFileName(map: FileMap): string | null {
  return findModelFileEntry(map)?.name ?? null;
}

export function findAnimationFiles(
  map: FileMap,
  kind: AnimationKind | null
): string[] {
  if (!kind) {
    return [];
  }

  const animations: string[] = [];
  const seen = new Set<string>();

  for (const [path, url] of map.entries()) {
    if (getAnimationKind(path) !== kind || seen.has(url)) {
      continue;
    }

    if (!seen.has(url)) {
      seen.add(url);
      animations.push(url);
    }
  }

  return animations;
}

export function revokeFileMap(map: FileMap): void {
  const revoked = new Set<string>();
  for (const url of map.values()) {
    if (!revoked.has(url)) {
      URL.revokeObjectURL(url);
      revoked.add(url);
    }
  }
  map.clear();
}
