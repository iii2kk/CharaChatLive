"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { MMDLoader } from "three/examples/jsm/loaders/MMDLoader";
import { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  VRMAnimation,
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import { ensureAmmo } from "@/lib/ammo";
import type { AnimationKind, FileMap, ModelKind } from "@/lib/file-map";
import { getModelKind } from "@/lib/file-map";
import type { ViewerSettings } from "@/lib/viewer-settings";

interface VRMGLTF extends GLTF {
  userData: GLTF["userData"] & {
    vrm?: VRM;
    vrmAnimations?: VRMAnimation[];
  };
}

export interface LoadedModel {
  kind: ModelKind;
  object: THREE.Object3D;
  mmdMesh?: THREE.SkinnedMesh;
  vrm?: VRM;
}

function createURLModifier(fileMap: FileMap) {
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラー";
}

function disposeMaterial(material: THREE.Material) {
  for (const key of Object.keys(material)) {
    const value = (material as unknown as Record<string, unknown>)[key];
    if (value instanceof THREE.Texture) {
      value.dispose();
    }
  }

  material.dispose();
}

function disposeMesh(mesh: THREE.Mesh | THREE.SkinnedMesh) {
  mesh.geometry.dispose();

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  for (const material of materials) {
    if (material instanceof THREE.Material) {
      disposeMaterial(material);
    }
  }
}

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
      disposeMesh(child);
    }
  });
}

interface PhysicsController {
  setGravity(gravity: THREE.Vector3): void;
}

type HelperMeshState = {
  physics?: PhysicsController;
};

type HelperWithInternals = MMDAnimationHelper & {
  objects?: WeakMap<THREE.SkinnedMesh, HelperMeshState>;
};

function getPhysicsController(
  helper: MMDAnimationHelper | null,
  mesh: THREE.SkinnedMesh | null
) {
  if (!helper || !mesh) return null;

  return (helper as HelperWithInternals).objects?.get(mesh)?.physics ?? null;
}

function createVRMLoader(manager?: THREE.LoadingManager) {
  const loader = new GLTFLoader(manager);
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return loader;
}

function createVRMAnimationLoader(manager?: THREE.LoadingManager) {
  const loader = new GLTFLoader(manager);
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  return loader;
}

export function useModelLoader(viewerSettings: ViewerSettings) {
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [helper, setHelper] = useState<MMDAnimationHelper | null>(null);
  const [animationMixer, setAnimationMixer] = useState<THREE.AnimationMixer | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [animationClip, setAnimationClip] = useState<THREE.AnimationClip | null>(
    null
  );

  const modelRef = useRef<LoadedModel | null>(null);
  const helperRef = useRef<MMDAnimationHelper | null>(null);
  const animationMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const fileMapRef = useRef<FileMap | null>(null);
  const animationClipRef = useRef<THREE.AnimationClip | null>(null);
  const configureRequestRef = useRef(0);
  const physicsSettingsRef = useRef({
    physicsEnabled: viewerSettings.physicsEnabled,
    gravityX: viewerSettings.gravityX,
    gravityY: viewerSettings.gravityY,
    gravityZ: viewerSettings.gravityZ,
  });

  const clearHelper = useCallback((targetMesh?: THREE.SkinnedMesh | null) => {
    const meshToRemove = targetMesh ?? modelRef.current?.mmdMesh ?? null;

    if (meshToRemove && helperRef.current) {
      try {
        helperRef.current.remove(meshToRemove);
      } catch {
        // ignore
      }
    }

    helperRef.current = null;
    setHelper(null);
  }, []);

  const clearAnimationMixer = useCallback(() => {
    const currentMixer = animationMixerRef.current;
    const currentObject = modelRef.current?.object;

    if (currentMixer && currentObject) {
      currentMixer.stopAllAction();
      currentMixer.uncacheRoot(currentObject);
    }

    animationMixerRef.current = null;
    setAnimationMixer(null);
  }, []);

  const rebuildHelper = useCallback(
    async (targetMesh: THREE.SkinnedMesh, clip: THREE.AnimationClip | null) => {
      const requestId = ++configureRequestRef.current;
      const { physicsEnabled, gravityX, gravityY, gravityZ } =
        physicsSettingsRef.current;

      clearHelper(targetMesh);

      if (!clip && !physicsEnabled) {
        return;
      }

      if (physicsEnabled) {
        await ensureAmmo();
      }

      if (
        configureRequestRef.current !== requestId ||
        modelRef.current?.mmdMesh !== targetMesh
      ) {
        return;
      }

      const nextHelper = new MMDAnimationHelper({
        afterglow: 2.0,
        resetPhysicsOnLoop: true,
      });

      nextHelper.add(targetMesh, {
        animation: clip ?? undefined,
        physics: physicsEnabled,
        gravity: new THREE.Vector3(gravityX, gravityY, gravityZ),
      });

      if (!physicsEnabled) {
        nextHelper.enable("physics", false);
      }

      helperRef.current = nextHelper;
      setHelper(nextHelper);
    },
    [clearHelper]
  );

  const cleanup = useCallback(() => {
    configureRequestRef.current += 1;

    clearHelper();
    clearAnimationMixer();

    const currentModel = modelRef.current;
    if (currentModel) {
      if (currentModel.kind === "vrm") {
        VRMUtils.deepDispose(currentModel.object);
      } else {
        disposeObject3D(currentModel.object);
      }

      modelRef.current = null;
      setModel(null);
    }

    animationClipRef.current = null;
    setAnimationClip(null);
  }, [clearAnimationMixer, clearHelper]);

  const handleLoadedMmdModel = useCallback(
    (loadedMesh: THREE.SkinnedMesh, onLoaded?: () => void) => {
      loadedMesh.castShadow = true;
      loadedMesh.receiveShadow = true;

      const nextModel: LoadedModel = {
        kind: "mmd",
        object: loadedMesh,
        mmdMesh: loadedMesh,
      };

      animationClipRef.current = null;
      setAnimationClip(null);
      modelRef.current = nextModel;
      setModel(nextModel);
      setLoading(false);
      onLoaded?.();
    },
    []
  );

  const handleLoadedVRMModel = useCallback((gltf: VRMGLTF, onLoaded?: () => void) => {
    const vrm = gltf.userData.vrm;

    if (!vrm) {
      throw new Error("VRM データを取得できませんでした");
    }

    VRMUtils.rotateVRM0(vrm);

    vrm.scene.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const nextModel: LoadedModel = {
      kind: "vrm",
      object: vrm.scene,
      vrm,
    };

    animationClipRef.current = null;
    setAnimationClip(null);
    modelRef.current = nextModel;
    setModel(nextModel);
    setLoading(false);
    onLoaded?.();
  }, []);

  const loadMmdModel = useCallback(
    (
      modelUrl: string,
      manager: THREE.LoadingManager | undefined,
      onLoaded?: () => void
    ) => {
      const loader = new MMDLoader(manager);

      loader.load(
        modelUrl,
        (loadedMesh) => {
          handleLoadedMmdModel(loadedMesh, onLoaded);
        },
        undefined,
        (err) => {
          console.error("MMDLoader error:", err);
          setError(`モデルの読み込みに失敗しました: ${getErrorMessage(err)}`);
          setLoading(false);
        }
      );
    },
    [handleLoadedMmdModel]
  );

  const loadVrmModel = useCallback(
    (
      modelUrl: string,
      manager: THREE.LoadingManager | undefined,
      onLoaded?: () => void
    ) => {
      const loader = createVRMLoader(manager);

      loader.load(
        modelUrl,
        (gltf) => {
          try {
            handleLoadedVRMModel(gltf as VRMGLTF, onLoaded);
          } catch (err) {
          console.error("VRMLoader error:", err);
          setError(
            `モデルの読み込みに失敗しました: ${
                getErrorMessage(err)
              }`
          );
          setLoading(false);
          }
        },
        undefined,
        (err) => {
          console.error("VRMLoader error:", err);
          setError(`モデルの読み込みに失敗しました: ${getErrorMessage(err)}`);
          setLoading(false);
        }
      );
    },
    [handleLoadedVRMModel]
  );

  const loadModel = useCallback(
    (
      kind: ModelKind,
      modelBlobUrl: string,
      fileMap: FileMap,
      onLoaded?: () => void
    ) => {
      setLoading(true);
      setError(null);
      cleanup();

      fileMapRef.current = fileMap;

      const manager = new THREE.LoadingManager();
      manager.setURLModifier(createURLModifier(fileMap));

      if (kind === "vrm") {
        loadVrmModel(modelBlobUrl, manager, onLoaded);
        return;
      }

      loadMmdModel(modelBlobUrl, manager, onLoaded);
    },
    [cleanup, loadMmdModel, loadVrmModel]
  );

  const loadModelFromPath = useCallback(
    (modelPath: string, onLoaded?: () => void) => {
      const kind = getModelKind(modelPath);

      if (!kind) {
        setError("未対応のモデル形式です");
        return;
      }

      setLoading(true);
      setError(null);
      cleanup();
      fileMapRef.current = null;

      if (kind === "vrm") {
        loadVrmModel(modelPath, undefined, onLoaded);
        return;
      }

      loadMmdModel(modelPath, undefined, onLoaded);
    },
    [cleanup, loadMmdModel, loadVrmModel]
  );

  const loadMmdAnimation = useCallback((vmdUrls: string[]) => {
    const currentModel = modelRef.current;
    const currentMesh = currentModel?.mmdMesh ?? null;

    if (!currentMesh || currentModel?.kind !== "mmd") {
      setError("VMD は MMD モデルにのみ適用できます");
      return;
    }

    setLoading(true);
    setError(null);
    clearAnimationMixer();

    const manager = new THREE.LoadingManager();
    if (fileMapRef.current) {
      manager.setURLModifier(createURLModifier(fileMapRef.current));
    }

    const loader = new MMDLoader(manager);
    loader.loadAnimation(
      vmdUrls.length === 1 ? vmdUrls[0] : vmdUrls,
      currentMesh,
      (clip) => {
        const nextAnimationClip = Array.isArray(clip) ? clip[0] : clip;
        animationClipRef.current = nextAnimationClip;
        setAnimationClip(nextAnimationClip);
        setLoading(false);
      },
      undefined,
      (err) => {
        console.error("VMD load error:", err);
        setError(`モーションの読み込みに失敗しました: ${getErrorMessage(err)}`);
        setLoading(false);
      }
    );
  }, [clearAnimationMixer]);

  const loadVrmAnimation = useCallback(
    (vrmaUrls: string[]) => {
      const currentModel = modelRef.current;
      const currentVrm = currentModel?.vrm;

      if (!currentVrm || currentModel.kind !== "vrm") {
        setError("VRMA は VRM モデルにのみ適用できます");
        return;
      }

      const vrmaUrl = vrmaUrls[0];
      if (!vrmaUrl) {
        return;
      }

      setLoading(true);
      setError(null);
      clearHelper();
      clearAnimationMixer();

      const manager = new THREE.LoadingManager();
      if (fileMapRef.current) {
        manager.setURLModifier(createURLModifier(fileMapRef.current));
      }

      const loader = createVRMAnimationLoader(manager);
      loader.load(
        vrmaUrl,
        (gltf) => {
          try {
            const vrmAnimation = (gltf as VRMGLTF).userData.vrmAnimations?.[0];

            if (!vrmAnimation) {
              throw new Error("VRMA データを取得できませんでした");
            }

            const clip = createVRMAnimationClip(vrmAnimation, currentVrm);
            const mixer = new THREE.AnimationMixer(currentModel.object);
            const action = mixer.clipAction(clip);

            action.reset();
            action.play();

            animationClipRef.current = clip;
            setAnimationClip(clip);
            animationMixerRef.current = mixer;
            setAnimationMixer(mixer);
            setLoading(false);
          } catch (err) {
            console.error("VRMA load error:", err);
            setError(
              `モーションの読み込みに失敗しました: ${
                getErrorMessage(err)
              }`
            );
            setLoading(false);
          }
        },
        undefined,
        (err) => {
          console.error("VRMA load error:", err);
          setError(`モーションの読み込みに失敗しました: ${getErrorMessage(err)}`);
          setLoading(false);
        }
      );
    },
    [clearAnimationMixer, clearHelper]
  );

  const loadAnimation = useCallback(
    (kind: AnimationKind, animationUrls: string[]) => {
      const currentModel = modelRef.current;

      if (!currentModel) {
        setError("先にモデルを読み込んでください");
        return;
      }

      if (kind === "vmd") {
        loadMmdAnimation(animationUrls);
        return;
      }

      loadVrmAnimation(animationUrls);
    },
    [loadMmdAnimation, loadVrmAnimation]
  );

  useEffect(() => {
    physicsSettingsRef.current = {
      physicsEnabled: viewerSettings.physicsEnabled,
      gravityX: viewerSettings.gravityX,
      gravityY: viewerSettings.gravityY,
      gravityZ: viewerSettings.gravityZ,
    };
  }, [
    viewerSettings.gravityX,
    viewerSettings.gravityY,
    viewerSettings.gravityZ,
    viewerSettings.physicsEnabled,
  ]);

  useEffect(() => {
    const currentModel = modelRef.current;
    const currentMesh = currentModel?.mmdMesh ?? null;

    if (currentModel?.kind !== "mmd" || !currentMesh) {
      return;
    }

    void rebuildHelper(currentMesh, animationClipRef.current).catch((err) => {
      console.error("MMD helper setup error:", err);
      setError(
        `物理演算の初期化に失敗しました: ${
          getErrorMessage(err)
        }`
      );
    });
  }, [animationClip, model, rebuildHelper]);

  useEffect(() => {
    const currentModel = modelRef.current;
    const currentMesh = currentModel?.mmdMesh ?? null;

    if (currentModel?.kind !== "mmd" || !currentMesh) {
      return;
    }

    const currentHelper = helperRef.current;
    const physics = getPhysicsController(currentHelper, currentMesh);
    const gravity = new THREE.Vector3(
      viewerSettings.gravityX,
      viewerSettings.gravityY,
      viewerSettings.gravityZ
    );

    if (physics) {
      currentHelper?.enable("physics", viewerSettings.physicsEnabled);
      physics.setGravity(gravity);
      return;
    }

    if (viewerSettings.physicsEnabled) {
      void rebuildHelper(currentMesh, animationClipRef.current).catch((err) => {
        console.error("MMD physics reconfigure error:", err);
        setError(
          `物理演算の更新に失敗しました: ${
            getErrorMessage(err)
          }`
        );
      });
    }
  }, [
    rebuildHelper,
    viewerSettings.gravityX,
    viewerSettings.gravityY,
    viewerSettings.gravityZ,
    viewerSettings.physicsEnabled,
  ]);

  useEffect(() => cleanup, [cleanup]);

  return {
    model,
    helper,
    animationMixer,
    loading,
    error,
    loadModel,
    loadModelFromPath,
    loadAnimation,
  };
}
