"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import * as THREE from "three";
import type { ViewerSettings } from "@/lib/viewer-settings";
import type { LoadedModel } from "@/hooks/useModelLoader";
import MMDScene from "./MMDScene";

interface MMDViewerProps {
  models: LoadedModel[];
  activeModel: LoadedModel | null;
  activeModelId: string | null;
  onActiveModelChange: (modelId: string) => void;
  viewerSettings: ViewerSettings;
}

const baseColors = new WeakMap<THREE.Material, THREE.Color>();
const baseEmissives = new WeakMap<THREE.Material, THREE.Color>();

function MaterialTuner({
  models,
  viewerSettings,
}: Pick<MMDViewerProps, "models" | "viewerSettings">) {
  useEffect(() => {
    if (models.length === 0) return;

    for (const model of models) {
      model.object.traverse((child) => {
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
    }
  }, [models, viewerSettings]);

  return null;
}

export default function MMDViewer({
  models,
  activeModel,
  activeModelId,
  onActiveModelChange,
  viewerSettings,
}: MMDViewerProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 15, 25], fov: 45, near: 0.1, far: 1000 }}
      style={{ background: "#1a1a2e" }}
    >
      <MaterialTuner models={models} viewerSettings={viewerSettings} />
      <Suspense fallback={null}>
        <MMDScene
          models={models}
          activeModel={activeModel}
          activeModelId={activeModelId}
          onActiveModelChange={onActiveModelChange}
          viewerSettings={viewerSettings}
        />
      </Suspense>
    </Canvas>
  );
}
