"use client";

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import * as THREE from "three";
import { RGBELoader } from "three-stdlib";
import type { ViewerSettings } from "@/lib/viewer-settings";

interface SceneEnvironmentProps {
  viewerSettings: ViewerSettings;
}

function isHdr(url: string): boolean {
  return /\.(hdr|exr)$/i.test(url);
}

export default function SceneEnvironment({
  viewerSettings,
}: SceneEnvironmentProps) {
  const { scene, gl, invalidate } = useThree();

  const {
    showGrid,
    groundTextureUrl,
    groundTextureRepeat,
    groundSize,
    backgroundTextureUrl,
    backgroundIsEquirect,
    backgroundColor,
  } = viewerSettings;

  // Ground texture
  const groundTexture = useMemo(() => {
    if (!groundTextureUrl) return null;
    const loader = new THREE.TextureLoader();
    const tex = loader.load(groundTextureUrl, () => invalidate());
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = gl.capabilities.getMaxAnisotropy();
    return tex;
  }, [groundTextureUrl, gl, invalidate]);

  useEffect(() => {
    if (!groundTexture) return;
    groundTexture.repeat.set(groundTextureRepeat, groundTextureRepeat);
    groundTexture.needsUpdate = true;
    invalidate();
  }, [groundTexture, groundTextureRepeat, invalidate]);

  useEffect(() => {
    return () => {
      groundTexture?.dispose();
    };
  }, [groundTexture]);

  // Background
  useEffect(() => {
    let disposed = false;
    let createdTexture: THREE.Texture | null = null;

    if (!backgroundTextureUrl) {
      scene.background = new THREE.Color(backgroundColor);
      invalidate();
      return () => {};
    }

    const applyTexture = (tex: THREE.Texture) => {
      if (disposed) {
        tex.dispose();
        return;
      }
      if (backgroundIsEquirect) {
        tex.mapping = THREE.EquirectangularReflectionMapping;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      scene.background = tex;
      createdTexture = tex;
      invalidate();
    };

    if (isHdr(backgroundTextureUrl)) {
      const loader = new RGBELoader();
      loader.load(backgroundTextureUrl, (tex) => {
        tex.mapping = backgroundIsEquirect
          ? THREE.EquirectangularReflectionMapping
          : THREE.UVMapping;
        if (disposed) {
          tex.dispose();
          return;
        }
        scene.background = tex;
        createdTexture = tex;
        invalidate();
      });
    } else {
      const loader = new THREE.TextureLoader();
      loader.load(backgroundTextureUrl, applyTexture);
    }

    return () => {
      disposed = true;
      createdTexture?.dispose();
    };
  }, [
    scene,
    backgroundTextureUrl,
    backgroundIsEquirect,
    backgroundColor,
    invalidate,
  ]);

  return (
    <>
      {showGrid && (
        <Grid
          args={[50, 50]}
          position={[0, 0.001, 0]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#6f6f6f"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#9d4b4b"
          fadeDistance={50}
          infiniteGrid
        />
      )}

      {groundTexture && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[groundSize, groundSize]} />
          <meshStandardMaterial map={groundTexture} />
        </mesh>
      )}
    </>
  );
}
