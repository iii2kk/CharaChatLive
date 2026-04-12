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
  id: string;
  name: string;
  kind: ModelKind;
  object: THREE.Object3D;
  mmdMesh?: THREE.SkinnedMesh;
  vrm?: VRM;
  helper: MMDAnimationHelper | null;
  animationMixer: THREE.AnimationMixer | null;
  animationLoaded: boolean;
}

interface LoadModelOptions {
  name?: string;
  onLoaded?: (modelId: string) => void;
}

type ModelRuntime = {
  fileMap: FileMap | null;
  animationClip: THREE.AnimationClip | null;
};

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

function getNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
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

/**
 * VRM は 1 unit = 1m、MMD は 1 unit ≈ 0.08m (8cm)。
 * 両方のモデルをシーンに並べたとき同じ縮尺にするための変換係数。
 */
const VRM_TO_MMD_SCALE = 12.7;

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

function generateModelId() {
  return `model-${crypto.randomUUID()}`;
}

export function useModelLoader(viewerSettings: ViewerSettings) {
  const [models, setModels] = useState<LoadedModel[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modelsRef = useRef<LoadedModel[]>([]);
  const runtimesRef = useRef<Map<string, ModelRuntime>>(new Map());
  const configureRequestRef = useRef(0);
  const physicsSettingsRef = useRef({
    physicsEnabled: viewerSettings.physicsEnabled,
    gravityX: viewerSettings.gravityX,
    gravityY: viewerSettings.gravityY,
    gravityZ: viewerSettings.gravityZ,
  });

  const syncModels = useCallback((updater: (prev: LoadedModel[]) => LoadedModel[]) => {
    setModels((prev) => {
      const next = updater(prev);
      modelsRef.current = next;
      return next;
    });
  }, []);

  const getModelById = useCallback((modelId: string | null) => {
    if (!modelId) return null;
    return modelsRef.current.find((model) => model.id === modelId) ?? null;
  }, []);

  const updateModel = useCallback(
    (modelId: string, updater: (model: LoadedModel) => LoadedModel) => {
      syncModels((prev) =>
        prev.map((model) => (model.id === modelId ? updater(model) : model))
      );
    },
    [syncModels]
  );

  const clearHelper = useCallback(
    (modelId: string) => {
      const model = getModelById(modelId);
      const meshToRemove = model?.mmdMesh ?? null;

      if (meshToRemove && model?.helper) {
        try {
          model.helper.remove(meshToRemove);
        } catch {
          // ignore
        }
      }

      updateModel(modelId, (current) => ({
        ...current,
        helper: null,
      }));
    },
    [getModelById, updateModel]
  );

  const clearAnimationMixer = useCallback(
    (modelId: string) => {
      const model = getModelById(modelId);
      if (model?.animationMixer) {
        model.animationMixer.stopAllAction();
        model.animationMixer.uncacheRoot(model.object);
      }

      updateModel(modelId, (current) => ({
        ...current,
        animationMixer: null,
      }));
    },
    [getModelById, updateModel]
  );

  const revokeRuntime = useCallback((modelId: string) => {
    const runtime = runtimesRef.current.get(modelId);
    if (!runtime) return;

    if (runtime.fileMap) {
      const revoked = new Set<string>();
      for (const url of runtime.fileMap.values()) {
        if (!revoked.has(url)) {
          URL.revokeObjectURL(url);
          revoked.add(url);
        }
      }
      runtime.fileMap.clear();
    }

    runtimesRef.current.delete(modelId);
  }, []);

  const disposeModel = useCallback(
    (modelId: string) => {
      const model = getModelById(modelId);
      if (!model) return;

      if (model.kind === "vrm") {
        VRMUtils.deepDispose(model.object);
      } else {
        disposeObject3D(model.object);
      }

      revokeRuntime(modelId);
    },
    [getModelById, revokeRuntime]
  );

  const removeModel = useCallback(
    (modelId: string) => {
      const remainingModels = modelsRef.current.filter(
        (model) => model.id !== modelId
      );

      configureRequestRef.current += 1;
      clearHelper(modelId);
      clearAnimationMixer(modelId);
      disposeModel(modelId);

      syncModels((prev) => prev.filter((model) => model.id !== modelId));

      setActiveModelId((prev) =>
        prev === modelId ? remainingModels.at(-1)?.id ?? null : prev
      );
    },
    [clearAnimationMixer, clearHelper, disposeModel, syncModels]
  );

  const rebuildActiveMmdHelper = useCallback(async () => {
    const activeModel = getModelById(activeModelId);
    if (!activeModel?.mmdMesh || activeModel.kind !== "mmd") {
      return;
    }

    const requestId = ++configureRequestRef.current;
    const { physicsEnabled, gravityX, gravityY, gravityZ } =
      physicsSettingsRef.current;
    const runtime = runtimesRef.current.get(activeModel.id);
    const clip = runtime?.animationClip ?? null;

    clearHelper(activeModel.id);

    if (!clip && !physicsEnabled) {
      return;
    }

    if (physicsEnabled) {
      await ensureAmmo();
    }

    const latestModel = getModelById(activeModel.id);
    if (
      configureRequestRef.current !== requestId ||
      latestModel?.mmdMesh !== activeModel.mmdMesh
    ) {
      return;
    }

    const nextHelper = new MMDAnimationHelper({
      afterglow: 2.0,
      resetPhysicsOnLoop: true,
    });

    nextHelper.add(activeModel.mmdMesh, {
      animation: clip ?? undefined,
      physics: physicsEnabled,
      gravity: new THREE.Vector3(gravityX, gravityY, gravityZ),
    });

    if (!physicsEnabled) {
      nextHelper.enable("physics", false);
    }

    updateModel(activeModel.id, (current) => ({
      ...current,
      helper: nextHelper,
    }));
  }, [activeModelId, clearHelper, getModelById, updateModel]);

  const loadMmdModel = useCallback(
    (
      modelId: string,
      modelUrl: string,
      manager: THREE.LoadingManager | undefined,
      name: string,
      onLoaded?: (modelId: string) => void
    ) => {
      const loader = new MMDLoader(manager);

      loader.load(
        modelUrl,
        (loadedMesh) => {
          loadedMesh.castShadow = true;
          loadedMesh.receiveShadow = true;

          const nextModel: LoadedModel = {
            id: modelId,
            name,
            kind: "mmd",
            object: loadedMesh,
            mmdMesh: loadedMesh,
            helper: null,
            animationMixer: null,
            animationLoaded: false,
          };

          syncModels((prev) => [...prev, nextModel]);
          setActiveModelId(modelId);
          setLoading(false);
          onLoaded?.(modelId);
        },
        undefined,
        (err) => {
          console.error("MMDLoader error:", err);
          setError(`モデルの読み込みに失敗しました: ${getErrorMessage(err)}`);
          revokeRuntime(modelId);
          setLoading(false);
        }
      );
    },
    [revokeRuntime, syncModels]
  );

  const loadVrmModel = useCallback(
    (
      modelId: string,
      modelUrl: string,
      manager: THREE.LoadingManager | undefined,
      name: string,
      onLoaded?: (modelId: string) => void
    ) => {
      const loader = createVRMLoader(manager);

      loader.load(
        modelUrl,
        (gltf) => {
          try {
            const vrm = (gltf as VRMGLTF).userData.vrm;
            if (!vrm) {
              throw new Error("VRM データを取得できませんでした");
            }

            VRMUtils.rotateVRM0(vrm);
            vrm.scene.scale.multiplyScalar(VRM_TO_MMD_SCALE);

            // スプリングボーンの stiffness / gravityPower はワールド空間の
            // 単位ベクトルに掛けられるため、スケール変更分を補正しないと
            // 物理演算がスローモーションになる
            if (vrm.springBoneManager) {
              for (const joint of vrm.springBoneManager.joints) {
                joint.settings.stiffness *= VRM_TO_MMD_SCALE;
                joint.settings.gravityPower *= VRM_TO_MMD_SCALE;
              }
            }

            vrm.scene.traverse((child) => {
              if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });

            const nextModel: LoadedModel = {
              id: modelId,
              name,
              kind: "vrm",
              object: vrm.scene,
              vrm,
              helper: null,
              animationMixer: null,
              animationLoaded: false,
            };

            syncModels((prev) => [...prev, nextModel]);
            setActiveModelId(modelId);
            setLoading(false);
            onLoaded?.(modelId);
          } catch (err) {
            console.error("VRMLoader error:", err);
            setError(`モデルの読み込みに失敗しました: ${getErrorMessage(err)}`);
            revokeRuntime(modelId);
            setLoading(false);
          }
        },
        undefined,
        (err) => {
          console.error("VRMLoader error:", err);
          setError(`モデルの読み込みに失敗しました: ${getErrorMessage(err)}`);
          revokeRuntime(modelId);
          setLoading(false);
        }
      );
    },
    [revokeRuntime, syncModels]
  );

  const loadModel = useCallback(
    (
      kind: ModelKind,
      modelBlobUrl: string,
      fileMap: FileMap,
      options?: LoadModelOptions
    ) => {
      const modelId = generateModelId();
      const name = options?.name ?? getNameFromPath(modelBlobUrl);

      setLoading(true);
      setError(null);

      runtimesRef.current.set(modelId, {
        fileMap,
        animationClip: null,
      });

      const manager = new THREE.LoadingManager();
      manager.setURLModifier(createURLModifier(fileMap));

      if (kind === "vrm") {
        loadVrmModel(modelId, modelBlobUrl, manager, name, options?.onLoaded);
        return;
      }

      loadMmdModel(modelId, modelBlobUrl, manager, name, options?.onLoaded);
    },
    [loadMmdModel, loadVrmModel]
  );

  const loadModelFromPath = useCallback(
    (modelPath: string, options?: LoadModelOptions) => {
      const kind = getModelKind(modelPath);

      if (!kind) {
        setError("未対応のモデル形式です");
        return;
      }

      const modelId = generateModelId();
      const name = options?.name ?? getNameFromPath(modelPath);

      setLoading(true);
      setError(null);

      runtimesRef.current.set(modelId, {
        fileMap: null,
        animationClip: null,
      });

      if (kind === "vrm") {
        loadVrmModel(modelId, modelPath, undefined, name, options?.onLoaded);
        return;
      }

      loadMmdModel(modelId, modelPath, undefined, name, options?.onLoaded);
    },
    [loadMmdModel, loadVrmModel]
  );

  const loadMmdAnimation = useCallback(
    (modelId: string, vmdUrls: string[]) => {
      const currentModel = getModelById(modelId);
      const currentMesh = currentModel?.mmdMesh ?? null;

      if (!currentMesh || currentModel?.kind !== "mmd") {
        setError("VMD は MMD モデルにのみ適用できます");
        return;
      }

      setLoading(true);
      setError(null);
      clearAnimationMixer(modelId);

      const runtime = runtimesRef.current.get(modelId);
      const manager = new THREE.LoadingManager();
      if (runtime?.fileMap) {
        manager.setURLModifier(createURLModifier(runtime.fileMap));
      }

      const loader = new MMDLoader(manager);
      loader.loadAnimation(
        vmdUrls.length === 1 ? vmdUrls[0] : vmdUrls,
        currentMesh,
        (clip) => {
          const nextAnimationClip = Array.isArray(clip) ? clip[0] : clip;
          const currentRuntime = runtimesRef.current.get(modelId);
          if (currentRuntime) {
            currentRuntime.animationClip = nextAnimationClip;
          }

          updateModel(modelId, (current) => ({
            ...current,
            animationLoaded: true,
          }));
          setLoading(false);

          if (activeModelId === modelId) {
            void rebuildActiveMmdHelper().catch((err) => {
              console.error("MMD helper setup error:", err);
              setError(
                `物理演算の初期化に失敗しました: ${getErrorMessage(err)}`
              );
            });
          }
        },
        undefined,
        (err) => {
          console.error("VMD load error:", err);
          setError(`モーションの読み込みに失敗しました: ${getErrorMessage(err)}`);
          setLoading(false);
        }
      );
    },
    [
      activeModelId,
      clearAnimationMixer,
      getModelById,
      rebuildActiveMmdHelper,
      updateModel,
    ]
  );

  const loadVrmAnimation = useCallback(
    (modelId: string, vrmaUrls: string[]) => {
      const currentModel = getModelById(modelId);
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
      clearHelper(modelId);
      clearAnimationMixer(modelId);

      const runtime = runtimesRef.current.get(modelId);
      const manager = new THREE.LoadingManager();
      if (runtime?.fileMap) {
        manager.setURLModifier(createURLModifier(runtime.fileMap));
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

            const currentRuntime = runtimesRef.current.get(modelId);
            if (currentRuntime) {
              currentRuntime.animationClip = clip;
            }

            updateModel(modelId, (current) => ({
              ...current,
              animationMixer: mixer,
              animationLoaded: true,
            }));
            setLoading(false);
          } catch (err) {
            console.error("VRMA load error:", err);
            setError(`モーションの読み込みに失敗しました: ${getErrorMessage(err)}`);
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
    [clearAnimationMixer, clearHelper, getModelById, updateModel]
  );

  const loadAnimation = useCallback(
    (kind: AnimationKind, animationUrls: string[], targetModelId?: string) => {
      const activeModel = getModelById(targetModelId ?? activeModelId);

      if (!activeModel) {
        setError("先にモデルを読み込んでください");
        return;
      }

      if (kind === "vmd") {
        loadMmdAnimation(activeModel.id, animationUrls);
        return;
      }

      loadVrmAnimation(activeModel.id, animationUrls);
    },
    [activeModelId, getModelById, loadMmdAnimation, loadVrmAnimation]
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
    const activeModel = getModelById(activeModelId);
    const currentMesh = activeModel?.mmdMesh ?? null;

    if (activeModel?.kind !== "mmd" || !currentMesh) {
      return;
    }

    const currentHelper = activeModel.helper;
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
      void rebuildActiveMmdHelper().catch((err) => {
        console.error("MMD physics reconfigure error:", err);
        setError(`物理演算の更新に失敗しました: ${getErrorMessage(err)}`);
      });
    }
  }, [
    activeModelId,
    getModelById,
    rebuildActiveMmdHelper,
    viewerSettings.gravityX,
    viewerSettings.gravityY,
    viewerSettings.gravityZ,
    viewerSettings.physicsEnabled,
  ]);

  useEffect(
    () => () => {
      const currentModels = modelsRef.current;
      currentModels.forEach((model) => {
        if (model.helper && model.mmdMesh) {
          try {
            model.helper.remove(model.mmdMesh);
          } catch {
            // ignore
          }
        }
        if (model.animationMixer) {
          model.animationMixer.stopAllAction();
          model.animationMixer.uncacheRoot(model.object);
        }
        if (model.kind === "vrm") {
          VRMUtils.deepDispose(model.object);
        } else {
          disposeObject3D(model.object);
        }
      });

      for (const [modelId, runtime] of runtimesRef.current.entries()) {
        if (runtime.fileMap) {
          const revoked = new Set<string>();
          for (const url of runtime.fileMap.values()) {
            if (!revoked.has(url)) {
              URL.revokeObjectURL(url);
              revoked.add(url);
            }
          }
          runtime.fileMap.clear();
        }
        runtimesRef.current.delete(modelId);
      }
    },
    []
  );

  const activeModel = getModelById(activeModelId);

  return {
    models,
    activeModel,
    activeModelId,
    setActiveModelId,
    removeModel,
    loading,
    error,
    loadModel,
    loadModelFromPath,
    loadAnimation,
  };
}
