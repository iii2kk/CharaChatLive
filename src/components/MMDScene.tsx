"use client";

import { OrbitControls, Grid } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { ViewerSettings } from "@/lib/viewer-settings";
import type { LoadedModel } from "@/hooks/useModelLoader";
import MMDModel from "./MMDModel";

interface MMDSceneProps {
  models: LoadedModel[];
  activeModel: LoadedModel | null;
  activeModelId: string | null;
  onActiveModelChange: (modelId: string) => void;
  viewerSettings: ViewerSettings;
}

export default function MMDScene({
  models,
  activeModel,
  activeModelId,
  onActiveModelChange,
  viewerSettings,
}: MMDSceneProps) {
  const defaultTarget = useMemo(() => new THREE.Vector3(0, 10, 0), []);
  const { camera, invalidate } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const directionalLightRef = useRef<THREE.DirectionalLight>(null);
  const directionalLightTarget = useMemo(() => new THREE.Object3D(), []);
  const [orbitEnabled, setOrbitEnabled] = useState(true);

  useEffect(() => {
    directionalLightTarget.position.set(0, 10, 0);

    if (directionalLightRef.current) {
      directionalLightRef.current.target = directionalLightTarget;
    }
  }, [directionalLightTarget]);

  useEffect(() => {
    if (!activeModel || !(camera instanceof THREE.PerspectiveCamera)) {
      return;
    }

    activeModel.object.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(activeModel.object);
    if (box.isEmpty()) {
      return;
    }

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const verticalSize = size.y;
    const horizontalSize = Math.max(size.x, size.z);

    if (verticalSize <= 0 && horizontalSize <= 0) {
      return;
    }

    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov =
      2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const fitHeightDistance =
      verticalSize / (2 * Math.tan(verticalFov / 2));
    const fitWidthDistance =
      horizontalSize / (2 * Math.tan(horizontalFov / 2));

    // Prefer a closer framing than "whole body fully fits" so VRM doesn't look tiny.
    const distance = Math.max(fitHeightDistance * 0.78, fitWidthDistance * 0.92);

    const currentTarget = controlsRef.current?.target ?? defaultTarget;
    const direction = camera.position
      .clone()
      .sub(currentTarget)
      .normalize();

    if (direction.lengthSq() === 0) {
      direction.set(0, 0.2, 1).normalize();
    }

    const nextTarget = center.clone().add(new THREE.Vector3(0, size.y * 0.15, 0));
    const nextPosition = nextTarget.clone().add(direction.multiplyScalar(distance));

    camera.position.copy(nextPosition);
    controlsRef.current?.target.copy(nextTarget);
    controlsRef.current?.update();
    invalidate();
  }, [activeModel, camera, defaultTarget, invalidate]);

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

      <MMDModel
        models={models}
        activeModelId={activeModelId}
        onActiveModelChange={onActiveModelChange}
        onDraggingChange={(dragging) => setOrbitEnabled(!dragging)}
      />

      <OrbitControls
        ref={controlsRef}
        enabled={orbitEnabled}
        target={[0, 10, 0]}
        minDistance={1}
        maxDistance={200}
        makeDefault
      />
    </>
  );
}
