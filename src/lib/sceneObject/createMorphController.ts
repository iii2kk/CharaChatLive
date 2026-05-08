import * as THREE from "three";
import type {
  SceneObjectMorphController,
  SceneObjectMorphInfo,
} from "@/types/sceneObjects";
import type { LoadedPmxMesh } from "@/lib/mmd/loadPmxMesh";
import { PmxMaterialMorphController } from "@/lib/mmd/PmxMaterialMorphController";

interface MorphTarget {
  mesh: THREE.Mesh | THREE.SkinnedMesh;
  index: number;
  meshName: string;
  rawName: string;
}

function hasMorphs(
  obj: THREE.Object3D
): obj is (THREE.Mesh | THREE.SkinnedMesh) & {
  morphTargetDictionary: { [key: string]: number };
  morphTargetInfluences: number[];
} {
  if (!(obj instanceof THREE.Mesh) && !(obj instanceof THREE.SkinnedMesh)) {
    return false;
  }
  const dict = obj.morphTargetDictionary;
  const inf = obj.morphTargetInfluences;
  if (!dict || !inf) return false;
  return Object.keys(dict).length > 0;
}

function findFirstMeshMaterial(
  root: THREE.Object3D
): THREE.Material | THREE.Material[] | null {
  let found: THREE.Material | THREE.Material[] | null = null;
  root.traverse((child) => {
    if (found) return;
    if (
      (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) &&
      child.material
    ) {
      found = child.material;
    }
  });
  return found;
}

export interface SceneObjectControllers {
  morphs?: SceneObjectMorphController;
  materialController?: PmxMaterialMorphController;
}

function createMaterialMorphController(
  root: THREE.Object3D,
  pmx?: LoadedPmxMesh | null
): PmxMaterialMorphController | undefined {
  if (!pmx || pmx.materialMorphs.length === 0) return undefined;
  const material = findFirstMeshMaterial(root);
  if (!material) return undefined;
  return new PmxMaterialMorphController(
    material,
    pmx.materialMorphs,
    pmx.groupMorphs,
    pmx.allMorphs
  );
}

export function createSceneObjectControllers(
  root: THREE.Object3D,
  pmx?: LoadedPmxMesh | null
): SceneObjectControllers {
  const targets = new Map<string, MorphTarget>();
  const collisions = new Map<string, number>();

  const collected: MorphTarget[] = [];
  root.traverse((child) => {
    if (!hasMorphs(child)) return;
    const meshName = child.name || "mesh";
    for (const [rawName, index] of Object.entries(child.morphTargetDictionary)) {
      collected.push({ mesh: child, index, meshName, rawName });
      collisions.set(rawName, (collisions.get(rawName) ?? 0) + 1);
    }
  });

  const materialController = createMaterialMorphController(root, pmx);

  if (collected.length === 0 && !materialController) return {};

  for (const t of collected) {
    const displayName =
      (collisions.get(t.rawName) ?? 0) > 1
        ? `${t.meshName}.${t.rawName}`
        : t.rawName;
    targets.set(displayName, t);
  }

  const list: SceneObjectMorphInfo[] = Array.from(targets.entries()).map(
    ([name, t]) => ({ name, meshName: t.meshName })
  );
  if (materialController) {
    for (const name of materialController.listNames()) {
      if (!targets.has(name)) {
        list.push({ name, meshName: "material" });
      }
    }
  }

  const morphs: SceneObjectMorphController = {
    list: () => list,
    get: (name) => {
      const t = targets.get(name);
      if (!t) return materialController?.getWeight(name) ?? 0;
      return t.mesh.morphTargetInfluences?.[t.index] ?? 0;
    },
    set: (name, weight) => {
      const t = targets.get(name);
      const clamped = Math.min(1, Math.max(0, weight));
      if (t && t.mesh.morphTargetInfluences) {
        t.mesh.morphTargetInfluences[t.index] = clamped;
      }
      materialController?.setWeight(name, clamped);
    },
    reset: () => {
      for (const t of targets.values()) {
        if (!t.mesh.morphTargetInfluences) continue;
        t.mesh.morphTargetInfluences[t.index] = 0;
      }
      materialController?.reset();
    },
  };

  return { morphs, materialController };
}

export function createMorphController(
  root: THREE.Object3D,
  pmx?: LoadedPmxMesh | null
): SceneObjectMorphController | undefined {
  return createSceneObjectControllers(root, pmx).morphs;
}
