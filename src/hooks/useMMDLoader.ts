"use client";

import { useCallback, useRef, useState } from "react";
import * as THREE from "three";
import type { FileMap } from "@/lib/file-map";
import { MMDLoader } from "three/examples/jsm/loaders/MMDLoader";
import { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper";

function createURLModifier(fileMap: FileMap) {
  return (url: string): string => {
    // Normalize path separators
    const normalized = url.replace(/\\/g, "/");

    // Try exact match
    if (fileMap.has(normalized)) return fileMap.get(normalized)!;

    // Try filename only
    const filename = normalized.split("/").pop() || "";
    if (fileMap.has(filename)) return fileMap.get(filename)!;

    // Try suffix matching against all keys
    for (const [key, blobUrl] of fileMap.entries()) {
      const normalizedKey = key.replace(/\\/g, "/");
      if (
        normalized.endsWith(normalizedKey) ||
        normalizedKey.endsWith(normalized)
      ) {
        return blobUrl;
      }
    }

    // Try swapping tex <-> textures folder names
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

    // Try decoding URL-encoded paths
    try {
      const decoded = decodeURIComponent(normalized);
      if (fileMap.has(decoded)) return fileMap.get(decoded)!;
      const decodedFilename = decoded.split("/").pop() || "";
      if (fileMap.has(decodedFilename)) return fileMap.get(decodedFilename)!;
    } catch {
      // ignore decode errors
    }

    // Return original (will likely 404 but prevents crash)
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

export function useMMDLoader() {
  const [mesh, setMesh] = useState<THREE.SkinnedMesh | null>(null);
  const [helper, setHelper] = useState<MMDAnimationHelper | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meshRef = useRef<THREE.SkinnedMesh | null>(null);
  const helperRef = useRef<MMDAnimationHelper | null>(null);
  const loaderRef = useRef<MMDLoader | null>(null);
  const fileMapRef = useRef<FileMap | null>(null);

  const cleanup = useCallback(() => {
    if (meshRef.current) {
      if (helperRef.current) {
        try {
          helperRef.current.remove(meshRef.current);
        } catch {
          // ignore
        }
      }
      disposeMesh(meshRef.current);
      meshRef.current = null;
      helperRef.current = null;
      setMesh(null);
      setHelper(null);
    }
  }, []);

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

    if (helperRef.current) {
      try {
        helperRef.current.remove(currentMesh);
      } catch {
        // ignore
      }
      helperRef.current = null;
      setHelper(null);
    }

    const manager = new THREE.LoadingManager();
    if (fileMapRef.current) {
      manager.setURLModifier(createURLModifier(fileMapRef.current));
    }

    const loader = new MMDLoader(manager);

    loader.loadAnimation(
      vmdUrls.length === 1 ? vmdUrls[0] : vmdUrls,
      currentMesh,
      (clip) => {
        const animationClip = Array.isArray(clip) ? clip[0] : clip;

        const newHelper = new MMDAnimationHelper({
          afterglow: 2.0,
          resetPhysicsOnLoop: true,
        });

        newHelper.add(currentMesh, {
          animation: animationClip,
          physics: false,
        });

        helperRef.current = newHelper;
        setHelper(newHelper);
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
