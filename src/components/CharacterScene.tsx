"use client";

import { Html, OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { CharacterModel } from "@/hooks/useModelLoader";
import type { MovementController } from "@/lib/character/movementController";
import type { LipSyncController } from "@/lib/character/lipSyncController";
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
import type { SceneObject } from "@/types/sceneObjects";
import type {
  ChatTargetSnapshot,
  ChatTargetsSnapshot,
  SpeechBubble,
} from "@/types/chat";
import FreeCameraControls from "./FreeCameraControls";
import CharacterModels from "./CharacterModels";
import SceneObjects from "./SceneObjects";
import ModelPlacementGizmo, {
  type PlacementGizmoTarget,
} from "./ModelPlacementGizmo";
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
  getMovementController?: (modelId: string) => MovementController | null;
  getLipSyncController?: (modelId: string) => LipSyncController | null;
  sceneObjects: SceneObject[];
  activeSceneObjectId: string | null;
  onActiveSceneObjectChange: (id: string) => void;
  placementGizmoTarget: PlacementGizmoTarget | null;
  sceneObjectScaleVersion: number;
  speechBubbles: SpeechBubble[];
  onChatTargetsChange: (targets: ChatTargetsSnapshot) => void;
}

const FLOOR_Y = 0;
const FALLBACK_PLACEMENT_DISTANCE = 12;
const MIN_RAY_PLACEMENT_DISTANCE = 2;
const MAX_NATURAL_PLACEMENT_DISTANCE = 120;
const SHALLOW_VIEW_Y_THRESHOLD = 0.12;
const COLLISION_PADDING = 0.5;
const SEARCH_SEGMENTS = 16;
const MAX_SEARCH_RINGS = 6;
const CHAT_TARGET_UPDATE_INTERVAL_MS = 200;
const FRONT_TARGET_MAX_DISTANCE = 25;
const FRONT_TARGET_MAX_ANGLE_RAD = THREE.MathUtils.degToRad(20);
const NEARBY_TARGET_MAX_DISTANCE = 12;
const SPEECH_BUBBLE_VERTICAL_OFFSET = 0.45;
const tmpChatForward = new THREE.Vector3();
const tmpChatCenter = new THREE.Vector3();
const tmpChatDirection = new THREE.Vector3();
const tmpChatBox = new THREE.Box3();
const tmpBubbleBox = new THREE.Box3();

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

  if (direction.y < -1e-6) {
    const distance = (FLOOR_Y - camera.position.y) / direction.y;
    if (Number.isFinite(distance) && distance >= MIN_RAY_PLACEMENT_DISTANCE) {
      if (
        distance <= MAX_NATURAL_PLACEMENT_DISTANCE ||
        Math.abs(direction.y) >= SHALLOW_VIEW_Y_THRESHOLD
      ) {
        return camera.position.clone().add(direction.multiplyScalar(distance));
      }

      const horizontalForward = direction.clone().setY(0);
      if (horizontalForward.lengthSq() > 1e-6) {
        return camera.position
          .clone()
          .add(
            horizontalForward
              .normalize()
              .multiplyScalar(MAX_NATURAL_PLACEMENT_DISTANCE)
          )
          .setY(FLOOR_Y);
      }
    }
  }

  if (controlsTarget) {
    return controlsTarget.clone().setY(FLOOR_Y);
  }

  const horizontalForward = getHorizontalForward(camera, controlsTarget);
  return camera.position
    .clone()
    .add(horizontalForward.multiplyScalar(FALLBACK_PLACEMENT_DISTANCE))
    .setY(FLOOR_Y);
}

function getFootprint(
  target: { object: THREE.Object3D },
  metrics: ModelInteractionMetrics | null
): PlacementFootprint | null {
  if (!metrics) return null;
  return {
    position: target.object.position.clone(),
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

interface PlaceableTarget {
  object: THREE.Object3D;
}

function getModelCenter(model: CharacterModel, target: THREE.Vector3): boolean {
  model.object.updateMatrixWorld(true);
  tmpChatBox.setFromObject(model.object);
  if (tmpChatBox.isEmpty()) {
    target.copy(model.object.position);
    return true;
  }
  tmpChatBox.getCenter(target);
  return true;
}

function buildChatTargets(
  models: CharacterModel[],
  camera: THREE.Camera
): ChatTargetsSnapshot {
  camera.getWorldDirection(tmpChatForward).normalize();

  const nearby: ChatTargetSnapshot[] = [];
  let frontCandidate:
    | (ChatTargetSnapshot & { screenOffset: number; angle: number })
    | null = null;

  for (const model of models) {
    if (!getModelCenter(model, tmpChatCenter)) continue;

    const distance = camera.position.distanceTo(tmpChatCenter);
    const snapshot: ChatTargetSnapshot = {
      id: model.id,
      name: model.name,
      kind: model.kind,
      distance,
    };

    if (distance <= NEARBY_TARGET_MAX_DISTANCE) {
      nearby.push(snapshot);
    }

    if (distance <= FRONT_TARGET_MAX_DISTANCE) {
      tmpChatDirection.copy(tmpChatCenter).sub(camera.position);
      if (tmpChatDirection.lengthSq() > 1e-6) {
        tmpChatDirection.normalize();
        const angle = tmpChatForward.angleTo(tmpChatDirection);
        if (angle <= FRONT_TARGET_MAX_ANGLE_RAD) {
          const projected = tmpChatCenter.clone().project(camera);
          if (projected.z >= -1 && projected.z <= 1) {
            const screenOffset = Math.hypot(projected.x, projected.y);
            if (
              !frontCandidate ||
              screenOffset < frontCandidate.screenOffset ||
              (screenOffset === frontCandidate.screenOffset &&
                distance < frontCandidate.distance)
            ) {
              frontCandidate = { ...snapshot, screenOffset, angle };
            }
          }
        }
      }
    }
  }

  nearby.sort((a, b) => a.distance - b.distance);

  return {
    front: frontCandidate
      ? {
          id: frontCandidate.id,
          name: frontCandidate.name,
          kind: frontCandidate.kind,
          distance: frontCandidate.distance,
        }
      : null,
    nearby,
  };
}

function getChatTargetSignature(targets: ChatTargetsSnapshot): string {
  return `${targets.front?.id ?? ""}|${targets.nearby
    .map((target) => target.id)
    .join(",")}`;
}

function shortenBubbleText(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= 80) return normalized;
  return `...${normalized.slice(-77)}`;
}

function SpeechBubbleAnchor({
  model,
  bubble,
}: {
  model: CharacterModel;
  bubble: SpeechBubble;
}) {
  const groupRef = useRef<THREE.Group | null>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    model.object.updateMatrixWorld(true);
    tmpBubbleBox.setFromObject(model.object);
    if (tmpBubbleBox.isEmpty()) {
      group.position.set(
        model.object.position.x,
        model.object.position.y + 2,
        model.object.position.z
      );
      return;
    }

    const center = tmpBubbleBox.getCenter(new THREE.Vector3());
    group.position.set(
      center.x,
      tmpBubbleBox.max.y + SPEECH_BUBBLE_VERTICAL_OFFSET,
      center.z
    );
  });

  return (
    <group ref={groupRef}>
      <Html center distanceFactor={12} occlude={false} zIndexRange={[50, 0]}>
        <div className="max-w-64 rounded-lg border border-gray-200/80 bg-white/95 px-3 py-2 text-center text-xs leading-relaxed text-gray-950 shadow-xl">
          <div className="whitespace-pre-wrap break-words">
            {shortenBubbleText(bubble.text)}
            {bubble.status === "streaming" ? (
              <span className="ml-0.5 text-sky-500">▌</span>
            ) : null}
          </div>
        </div>
      </Html>
    </group>
  );
}

function placeNewTargets(
  newTargets: PlaceableTarget[],
  existingTargets: PlaceableTarget[],
  camera: THREE.Camera,
  controlsTarget: THREE.Vector3 | null
): void {
  const footprints: PlacementFootprint[] = existingTargets
    .map((target) =>
      getFootprint(target, refreshModelInteractionMetrics(target.object))
    )
    .filter((footprint): footprint is PlacementFootprint => footprint !== null);
  const preferredFloorPoint = getPreferredFloorPoint(camera, controlsTarget);
  const searchDirection = getHorizontalForward(camera, controlsTarget);

  for (const target of newTargets) {
    const metrics = refreshModelInteractionMetrics(target.object);
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

    setModelWorldPosition(target.object, nextPosition);
    target.object.updateMatrixWorld(true);

    const placedMetrics = refreshModelInteractionMetrics(target.object);
    const footprint = getFootprint(target, placedMetrics);
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
  getMovementController,
  getLipSyncController,
  sceneObjects,
  activeSceneObjectId,
  onActiveSceneObjectChange,
  placementGizmoTarget,
  sceneObjectScaleVersion,
  speechBubbles,
  onChatTargetsChange,
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
  const lastChatTargetUpdateRef = useRef(0);
  const lastChatTargetSignatureRef = useRef("");
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

  useFrame((state) => {
    const now = state.clock.elapsedTime * 1000;
    if (now - lastChatTargetUpdateRef.current < CHAT_TARGET_UPDATE_INTERVAL_MS) {
      return;
    }
    lastChatTargetUpdateRef.current = now;

    const targets = buildChatTargets(models, camera);
    const signature = getChatTargetSignature(targets);
    if (signature === lastChatTargetSignatureRef.current) {
      return;
    }

    lastChatTargetSignatureRef.current = signature;
    onChatTargetsChange(targets);
  });

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
      placeNewTargets(
        newModels,
        [...existingModels, ...sceneObjects],
        camera,
        controlsRef.current?.target.clone() ?? defaultTarget
      );
      invalidate();
    }

    previousModelIdsRef.current = currentModelIds;
  }, [camera, defaultTarget, invalidate, models, sceneObjects]);

  const previousSceneObjectIdsRef = useRef<Set<string>>(
    new Set(sceneObjects.map((o) => o.id))
  );
  useEffect(() => {
    const previous = previousSceneObjectIdsRef.current;
    const current = new Set(sceneObjects.map((o) => o.id));
    const newOnes = sceneObjects.filter((o) => !previous.has(o.id));

    if (newOnes.length > 0 && camera instanceof THREE.PerspectiveCamera) {
      const newIds = new Set(newOnes.map((o) => o.id));
      const existingObjects = sceneObjects.filter((o) => !newIds.has(o.id));
      placeNewTargets(
        newOnes,
        [...models, ...existingObjects],
        camera,
        controlsRef.current?.target.clone() ?? defaultTarget
      );
      invalidate();
    }

    previousSceneObjectIdsRef.current = current;
  }, [camera, defaultTarget, invalidate, models, sceneObjects]);

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
        getMovementController={getMovementController}
        getLipSyncController={getLipSyncController}
      />

      {speechBubbles.map((bubble) => {
        const model = models.find((item) => item.id === bubble.modelId);
        if (!model) return null;
        return (
          <SpeechBubbleAnchor
            key={bubble.id}
            model={model}
            bubble={bubble}
          />
        );
      })}

      <SceneObjects
        sceneObjects={sceneObjects}
        activeSceneObjectId={activeSceneObjectId}
        onActiveSceneObjectChange={onActiveSceneObjectChange}
        selectionEnabled={interactionMode !== "freeCamera"}
      />

      <ModelPlacementGizmo
        model={interactionMode === "placement" ? placementGizmoTarget : null}
        onDraggingChange={setIsDraggingPlacementGizmo}
        scaleVersion={sceneObjectScaleVersion}
        enableVerticalMove={
          placementGizmoTarget !== null &&
          sceneObjects.some((o) => o.id === placementGizmoTarget.id)
        }
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
