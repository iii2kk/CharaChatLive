"use client";

import { OrbitControls, Grid } from "@react-three/drei";
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
  return (
    <>
      <ambientLight intensity={viewerSettings.ambientLightIntensity} />
      <directionalLight
        position={[5, 20, 10]}
        intensity={viewerSettings.directionalLightIntensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
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
