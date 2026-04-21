"use client";

import { useEffect, useMemo, useState } from "react";
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
  const { gl, invalidate } = useThree();
  const [backgroundTexture, setBackgroundTexture] = useState<{
    texture: THREE.Texture;
    url: string;
  } | null>(null);

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
    tex.repeat.set(groundTextureRepeat, groundTextureRepeat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = gl.capabilities.getMaxAnisotropy();
    return tex;
  }, [groundTextureUrl, groundTextureRepeat, gl, invalidate]);

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
      invalidate();
      return () => {};
    }

    const applyTexture = (
      tex: THREE.Texture,
      configure?: (texture: THREE.Texture) => void,
    ) => {
      configure?.(tex);
      if (disposed) {
        tex.dispose();
        return;
      }
      createdTexture = tex;
      setBackgroundTexture({ texture: tex, url: backgroundTextureUrl });
    };

    if (isHdr(backgroundTextureUrl)) {
      const loader = new RGBELoader();
      loader.load(backgroundTextureUrl, (tex) => {
        applyTexture(tex, (loadedTexture) => {
          loadedTexture.mapping = backgroundIsEquirect
            ? THREE.EquirectangularReflectionMapping
            : THREE.UVMapping;
        });
        invalidate();
      });
    } else {
      const loader = new THREE.TextureLoader();
      loader.load(backgroundTextureUrl, (tex) => {
        applyTexture(tex, (loadedTexture) => {
          if (backgroundIsEquirect) {
            loadedTexture.mapping = THREE.EquirectangularReflectionMapping;
          }
          loadedTexture.colorSpace = THREE.SRGBColorSpace;
        });
        invalidate();
      });
    }

    return () => {
      disposed = true;
      createdTexture?.dispose();
    };
  }, [
    backgroundTextureUrl,
    backgroundIsEquirect,
    invalidate,
  ]);

  return (
    <>
      {backgroundTextureUrl ? (
        backgroundTexture?.url === backgroundTextureUrl && (
          <primitive attach="background" object={backgroundTexture.texture} />
        )
      ) : (
        <color attach="background" args={[backgroundColor]} />
      )}

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
