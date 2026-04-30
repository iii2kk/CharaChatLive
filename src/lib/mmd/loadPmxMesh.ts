import * as THREE from "three";
import { MMDLoader } from "three/examples/jsm/loaders/MMDLoader";
import type {
  PmxRawData,
  PmxRawGroupMorph,
  PmxRawMaterialMorph,
  PmxRawMorph,
} from "./types";

interface MmdMeshBuilder {
  setCrossOrigin(crossOrigin: string): MmdMeshBuilder;
  build(
    data: PmxRawData,
    resourcePath: string,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (event: ErrorEvent | Error) => void
  ): THREE.SkinnedMesh;
}

interface MmdLoaderInternal {
  meshBuilder: MmdMeshBuilder;
  crossOrigin: string;
  loadPMX(
    url: string,
    onLoad: (data: PmxRawData) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (event: ErrorEvent) => void
  ): void;
  loadPMD(
    url: string,
    onLoad: (data: PmxRawData) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (event: ErrorEvent) => void
  ): void;
}

export interface LoadedPmxMesh {
  mesh: THREE.SkinnedMesh;
  format: "pmx" | "pmd";
  /** All material (type === 8) morphs, in original index order */
  materialMorphs: PmxRawMaterialMorph[];
  /** All group (type === 0) morphs whose children include at least one material morph */
  groupMorphs: PmxRawGroupMorph[];
  /** Full raw morph list, used to resolve group morph children */
  allMorphs: PmxRawMorph[];
}

function extractUrlBase(url: string): string {
  const i = url.lastIndexOf("/");
  if (i === -1) return "./";
  return url.slice(0, i + 1);
}

function detectExtension(url: string): "pmx" | "pmd" | null {
  const m = url.toLowerCase().match(/\.(pmx|pmd)(?:\?|#|$)/);
  if (!m) return null;
  return m[1] as "pmx" | "pmd";
}

function collectMaterialAndGroupMorphs(data: PmxRawData): {
  materialMorphs: PmxRawMaterialMorph[];
  groupMorphs: PmxRawGroupMorph[];
} {
  const materialMorphs: PmxRawMaterialMorph[] = [];
  const groupMorphs: PmxRawGroupMorph[] = [];
  if (!Array.isArray(data.morphs)) {
    return { materialMorphs, groupMorphs };
  }

  for (const morph of data.morphs) {
    if (morph.type === 8) {
      materialMorphs.push(morph);
    }
  }

  for (const morph of data.morphs) {
    if (morph.type !== 0) continue;
    const includesMaterial = morph.elements.some((e) => {
      const child = data.morphs[e.index];
      return child?.type === 8;
    });
    if (includesMaterial) {
      groupMorphs.push(morph);
    }
  }

  return { materialMorphs, groupMorphs };
}

export function loadPmxMesh(
  url: string,
  manager?: THREE.LoadingManager
): Promise<LoadedPmxMesh> {
  return new Promise((resolve, reject) => {
    const ext = detectExtension(url);
    if (!ext) {
      reject(new Error(`PMX/PMD ではないファイルです: ${url}`));
      return;
    }

    const loader = new MMDLoader(manager) as unknown as MmdLoaderInternal;
    const builder = loader.meshBuilder.setCrossOrigin(loader.crossOrigin);
    const resourcePath = extractUrlBase(url);

    const onParsed = (data: PmxRawData) => {
      try {
        const mesh = builder.build(data, resourcePath, undefined, (err) => {
          // texture load errors come through here; just log
          console.warn("[loadPmxMesh] texture build error:", err);
        });
        const { materialMorphs, groupMorphs } =
          ext === "pmx"
            ? collectMaterialAndGroupMorphs(data)
            : { materialMorphs: [], groupMorphs: [] };

        resolve({
          mesh,
          format: ext,
          materialMorphs,
          groupMorphs,
          allMorphs: data.morphs ?? [],
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };

    const onErr = (err: unknown) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    if (ext === "pmx") {
      loader.loadPMX(
        url,
        (data) => onParsed(data as PmxRawData),
        undefined,
        onErr as (e: ErrorEvent) => void
      );
    } else {
      loader.loadPMD(
        url,
        (data) => onParsed(data as PmxRawData),
        undefined,
        onErr as (e: ErrorEvent) => void
      );
    }
  });
}
