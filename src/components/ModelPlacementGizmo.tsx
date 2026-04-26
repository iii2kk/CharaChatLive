"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  refreshModelInteractionMetrics,
  setModelWorldPosition,
  type ModelInteractionMetrics,
} from "@/lib/character/modelTransform";

export interface PlacementGizmoTarget {
  id: string;
  object: THREE.Object3D;
}

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

type VerticalDragState = {
  kind: "vertical";
  pointerId: number;
  plane: THREE.Plane;
  startHitPoint: THREE.Vector3;
  startPosition: THREE.Vector3;
};

type DragState = MoveDragState | RotateDragState | VerticalDragState;

interface ModelPlacementGizmoProps {
  model: PlacementGizmoTarget | null;
  onDraggingChange?: (dragging: boolean) => void;
  /**
   * 選択中ターゲットの object.scale が変わった際にメトリクスを再計算するための
   * 識別子。値が変わると refreshModelInteractionMetrics を再実行する。
   */
  scaleVersion?: number;
  /**
   * 縦軸 (Y) 方向の移動ハンドルを表示するか。プロップ用。
   */
  enableVerticalMove?: boolean;
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
  model: PlacementGizmoTarget | null,
  metrics: ModelInteractionMetrics | null,
  groupRef: RefObject<THREE.Group | null>,
  movePadRef: RefObject<THREE.Mesh | null>,
  rotateRingRef: RefObject<THREE.Mesh | null>,
  verticalHandleRef: RefObject<THREE.Group | null>
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
  if (verticalHandleRef.current) {
    verticalHandleRef.current.scale.setScalar(
      Math.max(1.0, metrics.radius * 0.4)
    );
  }
}

export default function ModelPlacementGizmo({
  model,
  onDraggingChange,
  scaleVersion,
  enableVerticalMove,
}: ModelPlacementGizmoProps) {
  const { camera } = useThree();
  const modelObjectRef = useRef<THREE.Object3D | null>(null);
  const interactionMetricsRef = useRef<ModelInteractionMetrics | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const movePadRef = useRef<THREE.Mesh | null>(null);
  const rotateRingRef = useRef<THREE.Mesh | null>(null);
  const verticalHandleRef = useRef<THREE.Group | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const planeHitPoint = useMemo(() => new THREE.Vector3(), []);
  const planeNormal = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(() => {
    updateGizmoFromModel(
      model,
      interactionMetricsRef.current,
      groupRef,
      movePadRef,
      rotateRingRef,
      verticalHandleRef
    );
  });

  useEffect(() => {
    modelObjectRef.current = model?.object ?? null;
    interactionMetricsRef.current = model
      ? refreshModelInteractionMetrics(model.object)
      : null;
  }, [model, scaleVersion]);

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

  const beginVerticalDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!model || !groupRef.current) {
      return;
    }
    if (event.nativeEvent.altKey) {
      return;
    }

    // Y 軸を含み、カメラに対しなるべく正対する垂直平面を作る。
    const center = groupRef.current.position.clone();
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    // 水平方向の法線 (Y 成分は 0 に潰す)
    const normal = new THREE.Vector3(camDir.x, 0, camDir.z);
    if (normal.lengthSq() < 1e-6) {
      normal.set(0, 0, 1);
    }
    normal.normalize();

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      center
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
      kind: "vertical",
      pointerId: event.pointerId,
      plane,
      startHitPoint: planeHitPoint.clone(),
      startPosition: model.object.position.clone(),
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
      setModelWorldPosition(modelObject, nextPosition);
      return;
    }

    if (dragState.kind === "vertical") {
      const dy = planeHitPoint.y - dragState.startHitPoint.y;
      const nextPosition = dragState.startPosition.clone();
      nextPosition.y = dragState.startPosition.y + dy;
      setModelWorldPosition(modelObject, nextPosition);
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

      {enableVerticalMove && (
        <group
          ref={verticalHandleRef}
          onPointerDown={beginVerticalDrag}
          onPointerMove={updateDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {/* shaft */}
          <mesh position-y={1.5} renderOrder={14}>
            <cylinderGeometry args={[0.08, 0.08, 3, 16]} />
            <meshBasicMaterial
              color="#34d399"
              transparent
              opacity={0.9}
              depthWrite={false}
            />
          </mesh>
          {/* arrow head */}
          <mesh position-y={3.2} renderOrder={14}>
            <coneGeometry args={[0.25, 0.5, 16]} />
            <meshBasicMaterial
              color="#34d399"
              transparent
              opacity={0.9}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}
