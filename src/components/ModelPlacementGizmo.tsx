"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { CharacterModel } from "@/hooks/useModelLoader";
import {
  refreshModelInteractionMetrics,
  setModelManualWorldPosition,
  type ModelInteractionMetrics,
} from "@/lib/character/modelTransform";

type PointerCaptureTarget = EventTarget & {
  setPointerCapture: (pointerId: number) => void;
  releasePointerCapture: (pointerId: number) => void;
};

type MoveDragState = {
  kind: "move";
  pointerId: number;
  plane: THREE.Plane;
  startHitPoint: THREE.Vector3;
  startPosition: THREE.Vector3;
};

type RotateDragState = {
  kind: "rotate";
  pointerId: number;
  plane: THREE.Plane;
  center: THREE.Vector3;
  startAngle: number;
  startRotationY: number;
};

type DragState = MoveDragState | RotateDragState;

interface ModelPlacementGizmoProps {
  model: CharacterModel | null;
  onDraggingChange?: (dragging: boolean) => void;
}

function getPointerCaptureTarget(
  event: ThreeEvent<PointerEvent>
): PointerCaptureTarget | null {
  return event.target as PointerCaptureTarget | null;
}

function intersectPlane(
  event: ThreeEvent<PointerEvent>,
  plane: THREE.Plane,
  target: THREE.Vector3
) {
  return event.ray.intersectPlane(plane, target) !== null;
}

function updateGizmoFromModel(
  model: CharacterModel | null,
  metrics: ModelInteractionMetrics | null,
  groupRef: RefObject<THREE.Group | null>,
  movePadRef: RefObject<THREE.Mesh | null>,
  rotateRingRef: RefObject<THREE.Mesh | null>
) {
  if (
    !model ||
    !metrics ||
    !groupRef.current ||
    !movePadRef.current ||
    !rotateRingRef.current
  ) {
    if (groupRef.current) {
      groupRef.current.visible = false;
    }
    return;
  }

  const movePadScale = Math.max(0.85, metrics.radius * 0.32);

  groupRef.current.visible = true;
  groupRef.current.position.set(
    model.object.position.x,
    model.object.position.y + metrics.footOffsetY + 0.08,
    model.object.position.z
  );
  movePadRef.current.scale.setScalar(movePadScale);
  rotateRingRef.current.scale.setScalar(metrics.radius);
}

export default function ModelPlacementGizmo({
  model,
  onDraggingChange,
}: ModelPlacementGizmoProps) {
  const modelObjectRef = useRef<THREE.Object3D | null>(null);
  const interactionMetricsRef = useRef<ModelInteractionMetrics | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const movePadRef = useRef<THREE.Mesh | null>(null);
  const rotateRingRef = useRef<THREE.Mesh | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const planeHitPoint = useMemo(() => new THREE.Vector3(), []);
  const planeNormal = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(() => {
    updateGizmoFromModel(
      model,
      interactionMetricsRef.current,
      groupRef,
      movePadRef,
      rotateRingRef
    );
  });

  useEffect(() => {
    modelObjectRef.current = model?.object ?? null;
    interactionMetricsRef.current = model
      ? refreshModelInteractionMetrics(model.object)
      : null;
  }, [model]);

  useEffect(() => {
    dragStateRef.current = null;
    onDraggingChange?.(false);
  }, [model, onDraggingChange]);

  useEffect(
    () => () => {
      onDraggingChange?.(false);
    },
    [onDraggingChange]
  );

  const beginMoveDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!model || !groupRef.current) {
      return;
    }

    if (event.nativeEvent.altKey) {
      return;
    }

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      planeNormal,
      groupRef.current.position
    );

    if (!intersectPlane(event, plane, planeHitPoint)) {
      return;
    }

    const target = getPointerCaptureTarget(event);
    if (!target) {
      return;
    }

    event.stopPropagation();
    target.setPointerCapture(event.pointerId);
    onDraggingChange?.(true);

    dragStateRef.current = {
      kind: "move",
      pointerId: event.pointerId,
      plane,
      startHitPoint: planeHitPoint.clone(),
      startPosition: model.object.position.clone(),
    };
  };

  const beginRotateDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!model || !groupRef.current) {
      return;
    }

    if (event.nativeEvent.altKey) {
      return;
    }

    const centerPoint = groupRef.current.position.clone();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      planeNormal,
      centerPoint
    );

    if (!intersectPlane(event, plane, planeHitPoint)) {
      return;
    }

    const target = getPointerCaptureTarget(event);
    if (!target) {
      return;
    }

    const startAngle = Math.atan2(
      planeHitPoint.z - centerPoint.z,
      planeHitPoint.x - centerPoint.x
    );

    event.stopPropagation();
    target.setPointerCapture(event.pointerId);
    onDraggingChange?.(true);

    dragStateRef.current = {
      kind: "rotate",
      pointerId: event.pointerId,
      plane,
      center: centerPoint,
      startAngle,
      startRotationY: model.object.rotation.y,
    };
  };

  const updateDrag = (event: ThreeEvent<PointerEvent>) => {
    const modelObject = modelObjectRef.current;
    if (!model || !modelObject) {
      return;
    }

    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (!intersectPlane(event, dragState.plane, planeHitPoint)) {
      return;
    }

    event.stopPropagation();

    if (dragState.kind === "move") {
      const delta = planeHitPoint.clone().sub(dragState.startHitPoint);
      const nextPosition = dragState.startPosition.clone().add(delta);
      nextPosition.y = dragState.startPosition.y;
      setModelManualWorldPosition(modelObject, nextPosition);
      return;
    }

    const currentAngle = Math.atan2(
      planeHitPoint.z - dragState.center.z,
      planeHitPoint.x - dragState.center.x
    );
    modelObject.rotation.y =
      dragState.startRotationY - (currentAngle - dragState.startAngle);
  };

  const endDrag = (event: ThreeEvent<PointerEvent>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    const target = getPointerCaptureTarget(event);
    if (target) {
      target.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    onDraggingChange?.(false);
  };

  if (!model) {
    return null;
  }

  return (
    <group ref={groupRef} visible={false}>
      <mesh
        ref={movePadRef}
        rotation-x={-Math.PI / 2}
        renderOrder={12}
        onPointerDown={beginMoveDrag}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh
        ref={rotateRingRef}
        rotation-x={-Math.PI / 2}
        position-y={0.02}
        renderOrder={13}
        onPointerDown={beginRotateDrag}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <ringGeometry args={[1.15, 1.35, 64]} />
        <meshBasicMaterial
          color="#f59e0b"
          transparent
          opacity={0.85}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
