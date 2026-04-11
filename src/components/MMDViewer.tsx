"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import * as THREE from "three";
import type { SkinnedMesh } from "three";
import type { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper";
import type { ViewerSettings } from "@/lib/viewer-settings";
import MMDScene from "./MMDScene";

interface MMDViewerProps {
  mesh: SkinnedMesh | null;
  helper: MMDAnimationHelper | null;
  viewerSettings: ViewerSettings;
}

const baseColors = new WeakMap<THREE.Material, THREE.Color>();
const baseEmissives = new WeakMap<THREE.Material, THREE.Color>();

function MaterialTuner({
  mesh,
  viewerSettings,
}: Pick<MMDViewerProps, "mesh" | "viewerSettings">) {
  useEffect(() => {
    if (!mesh) return;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    for (const material of materials) {
      if (!(material instanceof THREE.Material)) continue;

      const colorMaterial = material as THREE.Material & {
        color?: THREE.Color;
        emissive?: THREE.Color;
      };

      if (colorMaterial.color instanceof THREE.Color) {
        if (!baseColors.has(material)) {
          baseColors.set(material, colorMaterial.color.clone());
        }

        colorMaterial.color
          .copy(baseColors.get(material)!)
          .multiplyScalar(viewerSettings.diffuseMultiplier);
      }

      if (colorMaterial.emissive instanceof THREE.Color) {
        if (!baseEmissives.has(material)) {
          baseEmissives.set(material, colorMaterial.emissive.clone());
        }

        colorMaterial.emissive
          .copy(baseEmissives.get(material)!)
          .multiplyScalar(viewerSettings.emissiveMultiplier);
      }
    }
  }, [mesh, viewerSettings]);

  return null;
}

export default function MMDViewer({
  mesh,
  helper,
  viewerSettings,
}: MMDViewerProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 15, 25], fov: 45, near: 0.1, far: 1000 }}
      style={{ background: "#1a1a2e" }}
    >
      <MaterialTuner mesh={mesh} viewerSettings={viewerSettings} />
      <Suspense fallback={null}>
        <MMDScene
          mesh={mesh}
          helper={helper}
          viewerSettings={viewerSettings}
        />
      </Suspense>
    </Canvas>
  );
}
