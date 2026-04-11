"use client";

import { OrbitControls, Grid } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { SkinnedMesh } from "three";
import type { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper";
import type { ViewerSettings } from "@/lib/viewer-settings";
import MMDModel from "./MMDModel";

interface MMDSceneProps {
  mesh: SkinnedMesh | null;
  helper: MMDAnimationHelper | null;
  viewerSettings: ViewerSettings;
}

export default function MMDScene({
  mesh,
  helper,
  viewerSettings,
}: MMDSceneProps) {
  const directionalLightRef = useRef<THREE.DirectionalLight>(null);
  const directionalLightTarget = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    directionalLightTarget.position.set(0, 10, 0);

    if (directionalLightRef.current) {
      directionalLightRef.current.target = directionalLightTarget;
    }
  }, [directionalLightTarget]);

  return (
    <>
      <ambientLight intensity={viewerSettings.ambientLightIntensity} />
      <directionalLight
        ref={directionalLightRef}
        position={[
          viewerSettings.directionalLightX,
          viewerSettings.directionalLightY,
          viewerSettings.directionalLightZ,
        ]}
        intensity={viewerSettings.directionalLightIntensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <primitive object={directionalLightTarget} />
      <hemisphereLight
        args={[0xffffff, 0x444444, viewerSettings.hemisphereLightIntensity]}
      />

      <Grid
        args={[50, 50]}
        position={[0, 0, 0]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#6f6f6f"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#9d4b4b"
        fadeDistance={50}
        infiniteGrid
      />

      <MMDModel mesh={mesh} helper={helper} />

      <OrbitControls
        target={[0, 10, 0]}
        minDistance={5}
        maxDistance={100}
        makeDefault
      />
    </>
  );
}
