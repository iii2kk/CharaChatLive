"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ensureAmmo } from "@/lib/ammo";
import type { FileMap } from "@/lib/file-map";
import type { ViewerSettings } from "@/lib/viewer-settings";
import { MMDLoader } from "three/examples/jsm/loaders/MMDLoader";
import { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper";

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
        if (
          altPath.endsWith(normalizedKey) ||
          normalizedKey.endsWith(altPath)
        ) {
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

function disposeMesh(mesh: THREE.SkinnedMesh) {
  mesh.geometry.dispose();

  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];

  for (const material of materials) {
    if (material instanceof THREE.Material) {
      for (const key of Object.keys(material)) {
        const value = (material as unknown as Record<string, unknown>)[key];
        if (value instanceof THREE.Texture) {
          value.dispose();
        }
      }
      material.dispose();
    }
  }
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

export function useMMDLoader(viewerSettings: ViewerSettings) {
  const [mesh, setMesh] = useState<THREE.SkinnedMesh | null>(null);
  const [helper, setHelper] = useState<MMDAnimationHelper | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [animationClip, setAnimationClip] = useState<THREE.AnimationClip | null>(
    null
  );

  const meshRef = useRef<THREE.SkinnedMesh | null>(null);
  const helperRef = useRef<MMDAnimationHelper | null>(null);
  const loaderRef = useRef<MMDLoader | null>(null);
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
    const meshToRemove = targetMesh ?? meshRef.current;

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

      if (configureRequestRef.current !== requestId || meshRef.current !== targetMesh) {
        return;
      }

      const newHelper = new MMDAnimationHelper({
        afterglow: 2.0,
        resetPhysicsOnLoop: true,
      });

      newHelper.add(targetMesh, {
        animation: clip ?? undefined,
        physics: physicsEnabled,
        gravity: new THREE.Vector3(gravityX, gravityY, gravityZ),
      });

      if (!physicsEnabled) {
        newHelper.enable("physics", false);
      }

      helperRef.current = newHelper;
      setHelper(newHelper);
    },
    [clearHelper]
  );

  const cleanup = useCallback(() => {
    configureRequestRef.current += 1;

    if (meshRef.current) {
      clearHelper(meshRef.current);
      disposeMesh(meshRef.current);
      meshRef.current = null;
      setMesh(null);
    }

    animationClipRef.current = null;
    setAnimationClip(null);
  }, [clearHelper]);

  const loadModel = useCallback(
    (modelBlobUrl: string, fileMap: FileMap, onLoaded?: () => void) => {
      setLoading(true);
      setError(null);
      cleanup();

      fileMapRef.current = fileMap;

      const manager = new THREE.LoadingManager();
      manager.setURLModifier(createURLModifier(fileMap));

      const loader = new MMDLoader(manager);
      loaderRef.current = loader;

      loader.load(
        modelBlobUrl,
        (loadedMesh) => {
          loadedMesh.castShadow = true;
          loadedMesh.receiveShadow = true;
          animationClipRef.current = null;
          setAnimationClip(null);
          meshRef.current = loadedMesh;
          setMesh(loadedMesh);
          setLoading(false);
          onLoaded?.();
        },
        undefined,
        (err) => {
          console.error("MMDLoader error:", err);
          setError(
            `モデルの読み込みに失敗しました: ${err.message || "不明なエラー"}`
          );
          setLoading(false);
        }
      );
    },
    [cleanup]
  );

  const loadModelFromPath = useCallback(
    (modelPath: string, onLoaded?: () => void) => {
      setLoading(true);
      setError(null);
      cleanup();

      const loader = new MMDLoader();
      loaderRef.current = loader;
      fileMapRef.current = null;

      loader.load(
        modelPath,
        (loadedMesh) => {
          loadedMesh.castShadow = true;
          loadedMesh.receiveShadow = true;
          animationClipRef.current = null;
          setAnimationClip(null);
          meshRef.current = loadedMesh;
          setMesh(loadedMesh);
          setLoading(false);
          onLoaded?.();
        },
        undefined,
        (err) => {
          console.error("MMDLoader error:", err);
          setError(
            `モデルの読み込みに失敗しました: ${err.message || "不明なエラー"}`
          );
          setLoading(false);
        }
      );
    },
    [cleanup]
  );

  const loadAnimation = useCallback((vmdUrls: string[]) => {
    const currentMesh = meshRef.current;
    if (!currentMesh) {
      setError("先にモデルを読み込んでください");
      return;
    }

    setLoading(true);
    setError(null);

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
        setError(
          `モーションの読み込みに失敗しました: ${err.message || "不明なエラー"}`
        );
        setLoading(false);
      }
    );
  }, []);

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
    const currentMesh = meshRef.current;

    if (!currentMesh) {
      return;
    }

    void rebuildHelper(currentMesh, animationClipRef.current).catch((err) => {
      console.error("MMD helper setup error:", err);
      setError(
        `物理演算の初期化に失敗しました: ${
          err instanceof Error ? err.message : "不明なエラー"
        }`
      );
    });
  }, [animationClip, mesh, rebuildHelper]);

  useEffect(() => {
    const currentMesh = meshRef.current;
    const currentHelper = helperRef.current;

    if (!currentMesh) {
      return;
    }

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
            err instanceof Error ? err.message : "不明なエラー"
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

  return {
    mesh,
    helper,
    loading,
    error,
    loadModel,
    loadModelFromPath,
    loadAnimation,
  };
}
