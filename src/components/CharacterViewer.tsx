"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import * as THREE from "three";
import type { ViewerSettings } from "@/lib/viewer-settings";
import type { CharacterModel } from "@/hooks/useModelLoader";
import type { MovementController } from "@/lib/character/movementController";
import type { InteractionMode } from "@/lib/interaction-mode";
import type { SceneLight } from "@/lib/scene-lights";
import type { SceneObject } from "@/types/sceneObjects";
import type { PlacementGizmoTarget } from "./ModelPlacementGizmo";
import CharacterScene from "./CharacterScene";

interface CharacterViewerProps {
  models: CharacterModel[];
  activeModel: CharacterModel | null;
  activeModelId: string | null;
  onActiveModelChange: (modelId: string) => void;
  focusRequest: { modelId: string; nonce: number } | null;
  lights: SceneLight[];
  activeLightId: string | null;
  onActiveLightChange: (lightId: string | null) => void;
  onLightsChange: React.Dispatch<React.SetStateAction<SceneLight[]>>;
  interactionMode: InteractionMode;
  viewerSettings: ViewerSettings;
  getMovementController?: (modelId: string) => MovementController | null;
  sceneObjects: SceneObject[];
  activeSceneObjectId: string | null;
  onActiveSceneObjectChange: (id: string) => void;
  placementGizmoTarget: PlacementGizmoTarget | null;
  sceneObjectScaleVersion: number;
}

const baseColors = new WeakMap<THREE.Material, THREE.Color>();
const baseEmissives = new WeakMap<THREE.Material, THREE.Color>();

function MaterialTuner({
  models,
  viewerSettings,
}: Pick<CharacterViewerProps, "models" | "viewerSettings">) {
  useEffect(() => {
    if (models.length === 0) return;

    for (const model of models) {
      // Live2D は板ポリ + CanvasTexture なので、MMD/VRM 向けのマテリアル調整を
      // 適用すると表示色が壊れるためスキップする。
      if (model.kind === "live2d") continue;

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

export default function CharacterViewer({
  models,
  activeModel,
  activeModelId,
  onActiveModelChange,
  focusRequest,
  lights,
  activeLightId,
  onActiveLightChange,
  onLightsChange,
  interactionMode,
  viewerSettings,
  getMovementController,
  sceneObjects,
  activeSceneObjectId,
  onActiveSceneObjectChange,
  placementGizmoTarget,
  sceneObjectScaleVersion,
}: CharacterViewerProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 15, 25], fov: 45, near: 0.1, far: 1000 }}
      style={{ background: "#1a1a2e" }}
    >
      <MaterialTuner models={models} viewerSettings={viewerSettings} />
      <Suspense fallback={null}>
        <CharacterScene
          models={models}
          activeModel={activeModel}
          activeModelId={activeModelId}
          onActiveModelChange={onActiveModelChange}
          focusRequest={focusRequest}
          lights={lights}
          activeLightId={activeLightId}
          onActiveLightChange={onActiveLightChange}
          onLightsChange={onLightsChange}
          interactionMode={interactionMode}
          viewerSettings={viewerSettings}
          getMovementController={getMovementController}
          sceneObjects={sceneObjects}
          activeSceneObjectId={activeSceneObjectId}
          onActiveSceneObjectChange={onActiveSceneObjectChange}
          placementGizmoTarget={placementGizmoTarget}
          sceneObjectScaleVersion={sceneObjectScaleVersion}
        />
      </Suspense>
    </Canvas>
  );
}
