"use client";

import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { CharacterModel } from "@/hooks/useModelLoader";
import type { InteractionMode } from "@/lib/interaction-mode";
import {
  syncLive2dRenderer,
  syncLive2dViewerSettings,
} from "@/lib/character/Live2dCharacterModel";
import {
  refreshModelInteractionMetrics,
  setModelWorldPosition,
  type ModelInteractionMetrics,
} from "@/lib/character/modelTransform";
import type { SceneLight } from "@/lib/scene-lights";
import type { ViewerSettings } from "@/lib/viewer-settings";
import FreeCameraControls from "./FreeCameraControls";
import CharacterModels from "./CharacterModels";
import ModelPlacementGizmo from "./ModelPlacementGizmo";
import SceneLights from "./SceneLights";
import SceneEnvironment from "./SceneEnvironment";

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
  interactionMode: InteractionMode;
  viewerSettings: ViewerSettings;
}

const FLOOR_Y = 0;
const FALLBACK_PLACEMENT_DISTANCE = 12;
const MIN_RAY_PLACEMENT_DISTANCE = 2;
const MAX_RAY_PLACEMENT_DISTANCE = 80;
const COLLISION_PADDING = 0.5;
const SEARCH_SEGMENTS = 16;
const MAX_SEARCH_RINGS = 6;

interface PlacementFootprint {
  position: THREE.Vector3;
  radius: number;
}

function getHorizontalForward(
  camera: THREE.Camera,
  controlsTarget: THREE.Vector3 | null
): THREE.Vector3 {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;

  if (forward.lengthSq() > 1e-6) {
    return forward.normalize();
  }

  if (controlsTarget) {
    forward.copy(controlsTarget).sub(camera.position);
    forward.y = 0;
    if (forward.lengthSq() > 1e-6) {
      return forward.normalize();
    }
  }

  return new THREE.Vector3(0, 0, -1);
}

function getPreferredFloorPoint(
  camera: THREE.Camera,
  controlsTarget: THREE.Vector3 | null
): THREE.Vector3 {
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  if (Math.abs(direction.y) > 1e-6) {
    const distance = (FLOOR_Y - camera.position.y) / direction.y;
    if (
      Number.isFinite(distance) &&
      distance >= MIN_RAY_PLACEMENT_DISTANCE &&
      distance <= MAX_RAY_PLACEMENT_DISTANCE
    ) {
      return camera.position.clone().add(direction.multiplyScalar(distance));
    }
  }

  const horizontalForward = getHorizontalForward(camera, controlsTarget);
  return camera.position
    .clone()
    .add(horizontalForward.multiplyScalar(FALLBACK_PLACEMENT_DISTANCE))
    .setY(FLOOR_Y);
}

function getFootprint(
  model: CharacterModel,
  metrics: ModelInteractionMetrics | null
): PlacementFootprint | null {
  if (!metrics) return null;
  return {
    position: model.object.position.clone(),
    radius: metrics.radius,
  };
}

function getCollisionScore(
  position: THREE.Vector3,
  radius: number,
  footprints: PlacementFootprint[]
): number {
  let score = 0;

  for (const footprint of footprints) {
    const dx = position.x - footprint.position.x;
    const dz = position.z - footprint.position.z;
    const distance = Math.hypot(dx, dz);
    const requiredDistance = radius + footprint.radius + COLLISION_PADDING;
    const overlap = requiredDistance - distance;
    if (overlap > 0) {
      score += overlap;
    }
  }

  return score;
}

function getAngleOffsets(segmentCount: number): number[] {
  const offsets = [0];
  const half = segmentCount / 2;

  for (let i = 1; i < half; i += 1) {
    offsets.push(i, -i);
  }

  offsets.push(half);
  return offsets;
}

function findNonCollidingPosition(
  preferredPosition: THREE.Vector3,
  radius: number,
  footprints: PlacementFootprint[],
  searchDirection: THREE.Vector3
): THREE.Vector3 {
  let bestPosition = preferredPosition.clone();
  let bestScore = getCollisionScore(bestPosition, radius, footprints);

  if (bestScore <= 0) {
    return bestPosition;
  }

  const step = radius * 2 + COLLISION_PADDING;
  const baseAngle = Math.atan2(searchDirection.z, searchDirection.x);
  const angleStep = (Math.PI * 2) / SEARCH_SEGMENTS;
  const angleOffsets = getAngleOffsets(SEARCH_SEGMENTS);

  for (let ring = 1; ring <= MAX_SEARCH_RINGS; ring += 1) {
    const searchRadius = step * ring;

    for (const offset of angleOffsets) {
      const angle = baseAngle + offset * angleStep;
      const candidate = preferredPosition
        .clone()
        .add(
          new THREE.Vector3(
            Math.cos(angle) * searchRadius,
            0,
            Math.sin(angle) * searchRadius
          )
        );
      const score = getCollisionScore(candidate, radius, footprints);

      if (score <= 0) {
        return candidate;
      }

      if (score < bestScore) {
        bestScore = score;
        bestPosition = candidate;
      }
    }
  }

  return bestPosition;
}

function placeNewModels(
  newModels: CharacterModel[],
  existingModels: CharacterModel[],
  camera: THREE.Camera,
  controlsTarget: THREE.Vector3 | null
): void {
  const footprints: PlacementFootprint[] = existingModels
    .map((model) => getFootprint(model, refreshModelInteractionMetrics(model.object)))
    .filter((footprint): footprint is PlacementFootprint => footprint !== null);
  const preferredFloorPoint = getPreferredFloorPoint(camera, controlsTarget);
  const searchDirection = getHorizontalForward(camera, controlsTarget);

  for (const model of newModels) {
    const metrics = refreshModelInteractionMetrics(model.object);
    if (!metrics) {
      continue;
    }

    const preferredPosition = preferredFloorPoint
      .clone()
      .setY(FLOOR_Y - metrics.footOffsetY);
    const nextPosition = findNonCollidingPosition(
      preferredPosition,
      metrics.radius,
      footprints,
      searchDirection
    );

    setModelWorldPosition(model.object, nextPosition);
    model.object.updateMatrixWorld(true);

    const placedMetrics = refreshModelInteractionMetrics(model.object);
    const footprint = getFootprint(model, placedMetrics);
    if (footprint) {
      footprints.push(footprint);
    }
  }
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
  interactionMode,
  viewerSettings,
}: CharacterSceneProps) {
  const defaultTarget = useMemo(() => new THREE.Vector3(0, 10, 0), []);
  const {
    live2dQualityMultiplier,
    live2dViewportHeightUsage,
    live2dMaxEdge,
  } = viewerSettings;
  const orbitMouseButtons = useMemo(
    () => ({
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    }),
    []
  );
  const { camera, gl, invalidate } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [isAltPressed, setIsAltPressed] = useState(false);
  const [isDraggingPlacementGizmo, setIsDraggingPlacementGizmo] = useState(false);
  const [isDraggingLight, setIsDraggingLight] = useState(false);
  const [isHoveringLightHandle, setIsHoveringLightHandle] = useState(false);
  const previousModelCountRef = useRef(models.length);
  const previousModelIdsRef = useRef<Set<string>>(
    new Set(models.map((model) => model.id))
  );
  const previousInteractionModeRef = useRef(interactionMode);
  const freeCameraLookTargetRef = useRef<THREE.Vector3 | null>(null);
  const placementCameraControlsEnabled =
    interactionMode === "placement" &&
    isAltPressed &&
    !isDraggingPlacementGizmo &&
    !isDraggingLight;
  const orbitEnabled =
    (interactionMode === "orbit" &&
      !isDraggingLight &&
      !isHoveringLightHandle) ||
    placementCameraControlsEnabled;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey) {
        setIsAltPressed(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!event.altKey) {
        setIsAltPressed(false);
      }
    };

    const handleWindowBlur = () => {
      setIsAltPressed(false);
      setIsDraggingPlacementGizmo(false);
      setIsDraggingLight(false);
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
    if (
      interactionMode === "freeCamera" &&
      previousInteractionModeRef.current !== "freeCamera"
    ) {
      const currentTarget = controlsRef.current?.target.clone();
      if (currentTarget) {
        freeCameraLookTargetRef.current = currentTarget;
      }
    }

    previousInteractionModeRef.current = interactionMode;
  }, [interactionMode]);

  useEffect(() => {
    if (interactionMode === "orbit") {
      return;
    }

    const resetId = window.setTimeout(() => {
      setIsAltPressed(false);
      setIsDraggingPlacementGizmo(false);
      setIsDraggingLight(false);
      setIsHoveringLightHandle(false);
    }, 0);

    return () => {
      window.clearTimeout(resetId);
    };
  }, [interactionMode]);

  const getInitialFreeCameraLookTarget = useCallback(
    () => freeCameraLookTargetRef.current,
    []
  );

  useEffect(() => {
    syncLive2dRenderer(gl);
    return () => {
      syncLive2dRenderer(null);
    };
  }, [gl]);

  useEffect(() => {
    syncLive2dViewerSettings({
      live2dQualityMultiplier,
      live2dViewportHeightUsage,
      live2dMaxEdge,
    });
  }, [
    live2dMaxEdge,
    live2dQualityMultiplier,
    live2dViewportHeightUsage,
  ]);

  useEffect(() => {
    const previousModelIds = previousModelIdsRef.current;
    const currentModelIds = new Set(models.map((model) => model.id));
    const newModels = models.filter((model) => !previousModelIds.has(model.id));

    if (newModels.length > 0 && camera instanceof THREE.PerspectiveCamera) {
      const newModelIds = new Set(newModels.map((model) => model.id));
      const existingModels = models.filter((model) => !newModelIds.has(model.id));
      placeNewModels(
        newModels,
        existingModels,
        camera,
        controlsRef.current?.target.clone() ?? defaultTarget
      );
      invalidate();
    }

    previousModelIdsRef.current = currentModelIds;
  }, [camera, defaultTarget, invalidate, models]);

  useEffect(() => {
    if (
      interactionMode === "freeCamera" ||
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
    interactionMode,
    invalidate,
    models.length,
  ]);

  useEffect(() => {
    if (
      interactionMode === "freeCamera" ||
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
  }, [camera, defaultTarget, focusRequest, interactionMode, invalidate, models]);

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

      <SceneEnvironment viewerSettings={viewerSettings} />

      <CharacterModels
        models={models}
        activeModelId={activeModelId}
        onActiveModelChange={onActiveModelChange}
        selectionEnabled={interactionMode !== "freeCamera"}
        viewerSettings={viewerSettings}
      />

      <ModelPlacementGizmo
        model={interactionMode === "placement" ? activeModel : null}
        onDraggingChange={setIsDraggingPlacementGizmo}
      />

      <SceneLights
        lights={lights}
        activeLightId={activeLightId}
        onActiveLightChange={onActiveLightChange}
        onLightsChange={onLightsChange}
        gizmoVisible={interactionMode === "placement"}
        interactionEnabled={interactionMode === "placement"}
        onDraggingChange={setIsDraggingLight}
        onHoveredHandleChange={setIsHoveringLightHandle}
      />

      <FreeCameraControls
        enabled={interactionMode === "freeCamera"}
        getInitialLookTarget={getInitialFreeCameraLookTarget}
      />

      <OrbitControls
        ref={controlsRef}
        enabled={orbitEnabled}
        target={[0, 10, 0]}
        minDistance={0}
        maxDistance={Infinity}
        mouseButtons={orbitMouseButtons}
        makeDefault
      />
    </>
  );
}
