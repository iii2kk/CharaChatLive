"use client";

import { OrbitControls, Grid } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { CharacterModel } from "@/hooks/useModelLoader";
import type { SceneLight } from "@/lib/scene-lights";
import type { ViewerSettings } from "@/lib/viewer-settings";
import FreeCameraControls from "./FreeCameraControls";
import CharacterModels from "./CharacterModels";
import SceneLights from "./SceneLights";

interface CharacterSceneProps {
  models: CharacterModel[];
  activeModel: CharacterModel | null;
  activeModelId: string | null;
  onActiveModelChange: (modelId: string) => void;
  focusRequest: { modelId: string; nonce: number } | null;
  lights: SceneLight[];
  activeLightId: string | null;
  onActiveLightChange: (lightId: string | null) => void;
  onLightsChange: React.Dispatch<React.SetStateAction<SceneLight[]>>;
  freeCameraEnabled: boolean;
  viewerSettings: ViewerSettings;
}

export default function CharacterScene({
  models,
  activeModel,
  activeModelId,
  onActiveModelChange,
  focusRequest,
  lights,
  activeLightId,
  onActiveLightChange,
  onLightsChange,
  freeCameraEnabled,
  viewerSettings,
}: CharacterSceneProps) {
  const defaultTarget = useMemo(() => new THREE.Vector3(0, 10, 0), []);
  const { camera, invalidate } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [isDraggingModel, setIsDraggingModel] = useState(false);
  const [isDraggingLight, setIsDraggingLight] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);
  const [isHoveringLightHandle, setIsHoveringLightHandle] = useState(false);
  const previousModelCountRef = useRef(models.length);
  const previousFreeCameraEnabledRef = useRef(freeCameraEnabled);
  const freeCameraLookTargetRef = useRef<THREE.Vector3 | null>(null);
  const orbitEnabled =
    !freeCameraEnabled &&
    !isDraggingModel &&
    !isDraggingLight &&
    !isHoveringLightHandle &&
    !(isShiftPressed && hoveredModelId !== null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey) {
        setIsShiftPressed(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!event.shiftKey) {
        setIsShiftPressed(false);
      }
    };

    const handleWindowBlur = () => {
      setIsShiftPressed(false);
      setIsDraggingModel(false);
      setIsDraggingLight(false);
      setHoveredModelId(null);
      setIsHoveringLightHandle(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (freeCameraEnabled && !previousFreeCameraEnabledRef.current) {
      const currentTarget = controlsRef.current?.target.clone();
      if (currentTarget) {
        freeCameraLookTargetRef.current = currentTarget;
      }
    }

    previousFreeCameraEnabledRef.current = freeCameraEnabled;
  }, [freeCameraEnabled]);

  const getInitialFreeCameraLookTarget = useCallback(
    () => freeCameraLookTargetRef.current,
    []
  );

  useEffect(() => {
    if (
      freeCameraEnabled ||
      !activeModel ||
      !(camera instanceof THREE.PerspectiveCamera)
    ) {
      previousModelCountRef.current = models.length;
      return;
    }

    const shouldRefocus =
      previousModelCountRef.current === 0 && models.length > 0;
    previousModelCountRef.current = models.length;

    if (!shouldRefocus) {
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
  }, [
    activeModel,
    camera,
    defaultTarget,
    freeCameraEnabled,
    invalidate,
    models.length,
  ]);

  useEffect(() => {
    if (
      freeCameraEnabled ||
      !focusRequest ||
      !(camera instanceof THREE.PerspectiveCamera)
    ) {
      return;
    }

    const targetModel =
      models.find((model) => model.id === focusRequest.modelId) ?? null;
    if (!targetModel) {
      return;
    }

    targetModel.object.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(targetModel.object);
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
  }, [camera, defaultTarget, focusRequest, freeCameraEnabled, invalidate, models]);

  return (
    <>
      <ambientLight intensity={viewerSettings.ambientLightIntensity} />
      <hemisphereLight
        args={[
          viewerSettings.hemisphereLightSkyColor,
          viewerSettings.hemisphereLightGroundColor,
          viewerSettings.hemisphereLightIntensity,
        ]}
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

      <CharacterModels
        models={models}
        activeModelId={activeModelId}
        onActiveModelChange={onActiveModelChange}
        onDraggingChange={setIsDraggingModel}
        onHoveredModelChange={setHoveredModelId}
        interactionEnabled={!freeCameraEnabled}
      />

      <SceneLights
        lights={lights}
        activeLightId={activeLightId}
        onActiveLightChange={onActiveLightChange}
        onLightsChange={onLightsChange}
        interactionEnabled={!freeCameraEnabled}
        onDraggingChange={setIsDraggingLight}
        onHoveredHandleChange={setIsHoveringLightHandle}
      />

      <FreeCameraControls
        enabled={freeCameraEnabled}
        getInitialLookTarget={getInitialFreeCameraLookTarget}
      />

      <OrbitControls
        ref={controlsRef}
        enabled={orbitEnabled}
        target={[0, 10, 0]}
        minDistance={0}
        maxDistance={Infinity}
        makeDefault
      />
    </>
  );
}
