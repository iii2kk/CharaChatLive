import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MMDLoader } from "three/examples/jsm/loaders/MMDLoader";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { VRM_TO_MMD_SCALE } from "@/lib/character/VrmCharacterModel";
import type { SceneObject, SceneObjectKind } from "@/types/sceneObjects";
import { createMorphController } from "./createMorphController";

interface VRMGLTF extends GLTF {
  userData: GLTF["userData"] & {
    vrm?: VRM;
  };
}

function detectKind(path: string): SceneObjectKind | null {
  if (/\.(pmx|pmd)$/i.test(path)) return "mmd";
  if (/\.vrm$/i.test(path)) return "vrm";
  if (/\.(glb|gltf)$/i.test(path)) return "gltf";
  return null;
}

function generateSceneObjectId(): string {
  return `sceneobj-${crypto.randomUUID()}`;
}

function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as Partial<THREE.Mesh & THREE.SkinnedMesh>;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = mesh.material;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const mat of materials) {
      if (!(mat instanceof THREE.Material)) continue;
      const matWithMaps = mat as THREE.Material & {
        map?: THREE.Texture | null;
        normalMap?: THREE.Texture | null;
        emissiveMap?: THREE.Texture | null;
        specularMap?: THREE.Texture | null;
        roughnessMap?: THREE.Texture | null;
        metalnessMap?: THREE.Texture | null;
        alphaMap?: THREE.Texture | null;
      };
      matWithMaps.map?.dispose();
      matWithMaps.normalMap?.dispose();
      matWithMaps.emissiveMap?.dispose();
      matWithMaps.specularMap?.dispose();
      matWithMaps.roughnessMap?.dispose();
      matWithMaps.metalnessMap?.dispose();
      matWithMaps.alphaMap?.dispose();
      mat.dispose();
    }
  });
}

function applyShadowFlags(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.SkinnedMesh
    ) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

async function loadVrmAsObject(url: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      url,
      (gltf) => {
        const vrm = (gltf as VRMGLTF).userData.vrm;
        if (!vrm) {
          reject(new Error("VRM データを取得できませんでした"));
          return;
        }
        VRMUtils.rotateVRM0(vrm);
        // VRM は 1unit = 1m。シーン共通スケール (MMD 基準) に合わせる
        vrm.scene.scale.multiplyScalar(VRM_TO_MMD_SCALE);
        applyShadowFlags(vrm.scene);
        resolve(vrm.scene);
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err)))
    );
  });
}

async function loadMmdAsObject(url: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    const loader = new MMDLoader();
    loader.load(
      url,
      (skinned) => {
        // プロップはアニメーションしないため、SkinnedMesh ではなく通常 Mesh
        // として扱う。ボーンが 0 個の PMX を SkinnedMesh のまま使うと
        // skinning シェーダが `boneMatrices[0]` のような不正 GLSL になって
        // 頂点シェーダのコンパイルに失敗するため。
        const geometry = skinned.geometry;

        // MMDLoader は morph が 0 個でも `morphAttributes.position = []`
        // (空配列) を必ずセットする。Three.js は `!== undefined` だけで
        // USE_MORPHTARGETS を有効化するが、count が 0 のときは
        // MORPHTARGETS_COUNT が定義されず、頂点シェーダ内の
        // `for (i = 0; i < MORPHTARGETS_COUNT; …)` が未定義シンボルに
        // なってコンパイル失敗する。空なら削除しておく。
        if (
          Array.isArray(geometry.morphAttributes.position) &&
          geometry.morphAttributes.position.length === 0
        ) {
          delete geometry.morphAttributes.position;
        }

        const mesh = new THREE.Mesh(geometry, skinned.material);
        mesh.position.copy(skinned.position);
        mesh.rotation.copy(skinned.rotation);
        mesh.scale.copy(skinned.scale);
        applyShadowFlags(mesh);
        resolve(mesh);
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err)))
    );
  });
}

async function loadGltfAsObject(url: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        applyShadowFlags(gltf.scene);
        resolve(gltf.scene);
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err)))
    );
  });
}

export async function loadSceneObject(
  sourcePath: string,
  displayName: string
): Promise<SceneObject> {
  const kind = detectKind(sourcePath);
  if (!kind) {
    throw new Error("未対応のオブジェクト形式です");
  }

  const object =
    kind === "vrm"
      ? await loadVrmAsObject(sourcePath)
      : kind === "mmd"
      ? await loadMmdAsObject(sourcePath)
      : await loadGltfAsObject(sourcePath);

  object.userData.sourcePath = sourcePath;

  const id = generateSceneObjectId();
  const morphs = createMorphController(object);
  let disposed = false;

  return {
    id,
    name: displayName,
    sourcePath,
    kind,
    object,
    morphs,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      disposeObject3D(object);
    },
  };
}
