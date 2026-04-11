export type FileMap = Map<string, string>;

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

export function findModelFile(map: FileMap): string | null {
  for (const [path, url] of map.entries()) {
    if (/\.(pmx|pmd)$/i.test(path)) return url;
  }
  return null;
}

export function findModelFileName(map: FileMap): string | null {
  for (const path of map.keys()) {
    if (/\.(pmx|pmd)$/i.test(path)) {
      const parts = path.split("/");
      return parts[parts.length - 1];
    }
  }
  return null;
}

export function findVmdFiles(map: FileMap): string[] {
  const vmds: string[] = [];
  const seen = new Set<string>();

  for (const [path, url] of map.entries()) {
    if (/\.vmd$/i.test(path) && !seen.has(url)) {
      seen.add(url);
      vmds.push(url);
    }
  }

  return vmds;
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
