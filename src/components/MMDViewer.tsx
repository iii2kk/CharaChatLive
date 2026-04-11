"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import * as THREE from "three";
import type { AnimationMixer, Object3D } from "three";
import type { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper";
import type { VRM } from "@pixiv/three-vrm";
import type { ViewerSettings } from "@/lib/viewer-settings";
import MMDScene from "./MMDScene";

interface MMDViewerProps {
  object: Object3D | null;
  helper: MMDAnimationHelper | null;
  animationMixer: AnimationMixer | null;
  vrm: VRM | null;
  viewerSettings: ViewerSettings;
}

const baseColors = new WeakMap<THREE.Material, THREE.Color>();
const baseEmissives = new WeakMap<THREE.Material, THREE.Color>();

function MaterialTuner({
  object,
  viewerSettings,
}: Pick<MMDViewerProps, "object" | "viewerSettings">) {
  useEffect(() => {
    if (!object) return;

    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh)) {
        return;
      }

      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];

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
    });
  }, [object, viewerSettings]);

  return null;
}

export default function MMDViewer({
  object,
  helper,
  animationMixer,
  vrm,
  viewerSettings,
}: MMDViewerProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 15, 25], fov: 45, near: 0.1, far: 1000 }}
      style={{ background: "#1a1a2e" }}
    >
      <MaterialTuner object={object} viewerSettings={viewerSettings} />
      <Suspense fallback={null}>
        <MMDScene
          object={object}
          helper={helper}
          animationMixer={animationMixer}
          vrm={vrm}
          viewerSettings={viewerSettings}
        />
      </Suspense>
    </Canvas>
  );
}
