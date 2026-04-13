"use client";

import { Line } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { SceneLight } from "@/lib/scene-lights";

interface SceneLightsProps {
  lights: SceneLight[];
  activeLightId: string | null;
  onActiveLightChange: (lightId: string | null) => void;
  onLightsChange: React.Dispatch<React.SetStateAction<SceneLight[]>>;
  interactionEnabled: boolean;
  onDraggingChange: (dragging: boolean) => void;
  onHoveredHandleChange: (hovered: boolean) => void;
}

type DragTarget = "position" | "target";

type DragState = {
  lightId: string;
  pointerId: number;
  target: DragTarget;
  plane: THREE.Plane;
  offset: THREE.Vector3;
};

type PointerCaptureTarget = EventTarget & {
  setPointerCapture: (pointerId: number) => void;
  releasePointerCapture: (pointerId: number) => void;
};

function toVector3(value: [number, number, number]) {
  return new THREE.Vector3(value[0], value[1], value[2]);
}

function toTuple(value: THREE.Vector3): [number, number, number] {
  return [value.x, value.y, value.z];
}

function DirectionalLightInstance({ light }: { light: SceneLight }) {
  const targetObject = useMemo(() => new THREE.Object3D(), []);
  const lightRef = useRef<THREE.DirectionalLight>(null);

  useEffect(() => {
    targetObject.position.set(...light.target);
    if (lightRef.current) {
      lightRef.current.target = targetObject;
    }
  }, [light.target, targetObject]);

  useFrame(() => {
    if (lightRef.current) {
      lightRef.current.target.updateMatrixWorld();
    }
  });

  return (
    <>
      <directionalLight
        ref={lightRef}
        color={light.color}
        intensity={light.visible ? light.intensity : 0}
        position={light.position}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <primitive object={targetObject} />
    </>
  );
}

export default function SceneLights({
  lights,
  activeLightId,
  onActiveLightChange,
  onLightsChange,
  interactionEnabled,
  onDraggingChange,
  onHoveredHandleChange,
}: SceneLightsProps) {
  const { camera } = useThree();
  const dragStateRef = useRef<DragState | null>(null);
  const planeHitPoint = useMemo(() => new THREE.Vector3(), []);
  const planeNormal = useMemo(() => new THREE.Vector3(), []);

  useEffect(
    () => () => {
      onDraggingChange(false);
      onHoveredHandleChange(false);
    },
    [onDraggingChange, onHoveredHandleChange]
  );

  const beginDrag = (
    event: ThreeEvent<PointerEvent>,
    light: SceneLight,
    target: DragTarget
  ) => {
    if (!interactionEnabled) {
      return;
    }

    const anchor =
      target === "position" ? toVector3(light.position) : toVector3(light.target);

    camera.getWorldDirection(planeNormal);

    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      planeNormal,
      anchor
    );

    if (!event.ray.intersectPlane(dragPlane, planeHitPoint)) {
      return;
    }

    event.stopPropagation();
    const pointerTarget = event.target as PointerCaptureTarget | null;
    if (!pointerTarget) {
      return;
    }
    pointerTarget.setPointerCapture(event.pointerId);
    onActiveLightChange(light.id);
    onDraggingChange(true);
    onHoveredHandleChange(true);

    dragStateRef.current = {
      lightId: light.id,
      pointerId: event.pointerId,
      target,
      plane: dragPlane,
      offset: anchor.sub(planeHitPoint.clone()),
    };
  };

  const updateDrag = (event: ThreeEvent<PointerEvent>) => {
    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }

    if (!event.ray.intersectPlane(dragState.plane, planeHitPoint)) {
      return;
    }

    event.stopPropagation();

    const nextPosition = planeHitPoint.clone().add(dragState.offset);

    onLightsChange((prev) =>
      prev.map((light) => {
        if (light.id !== dragState.lightId) {
          return light;
        }

        return dragState.target === "position"
          ? { ...light, position: toTuple(nextPosition) }
          : { ...light, target: toTuple(nextPosition) };
      })
    );
  };

  const endDrag = (event: ThreeEvent<PointerEvent>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    const pointerTarget = event.target as PointerCaptureTarget | null;
    if (!pointerTarget) {
      dragStateRef.current = null;
      onDraggingChange(false);
      onHoveredHandleChange(false);
      return;
    }
    pointerTarget.releasePointerCapture(event.pointerId);
    dragStateRef.current = null;
    onDraggingChange(false);
    onHoveredHandleChange(false);
  };

  return (
    <>
      {lights.map((light) => {
        const isActive = light.id === activeLightId;
        const bodyPosition = light.position;
        const targetPosition = light.target;

        return (
          <group key={light.id}>
            <DirectionalLightInstance light={light} />

            {light.objectVisible && (
              <>
                <Line
                  points={[bodyPosition, targetPosition]}
                  color={isActive ? "#fbbf24" : "#94a3b8"}
                  lineWidth={1.5}
                  transparent
                  opacity={0.8}
                />

                <mesh
                  position={bodyPosition}
                  onClick={(event: ThreeEvent<MouseEvent>) => {
                    if (!interactionEnabled) {
                      return;
                    }
                    event.stopPropagation();
                    onActiveLightChange(light.id);
                  }}
                  onPointerDown={(event: ThreeEvent<PointerEvent>) =>
                    beginDrag(event, light, "position")
                  }
                  onPointerMove={(event: ThreeEvent<PointerEvent>) =>
                    updateDrag(event)
                  }
                  onPointerUp={(event: ThreeEvent<PointerEvent>) => endDrag(event)}
                  onPointerCancel={(event: ThreeEvent<PointerEvent>) =>
                    endDrag(event)
                  }
                  onPointerOver={() => {
                    if (interactionEnabled) {
                      onHoveredHandleChange(true);
                    }
                  }}
                  onPointerOut={() => {
                    if (!dragStateRef.current) {
                      onHoveredHandleChange(false);
                    }
                  }}
                >
                  <sphereGeometry args={[isActive ? 0.6 : 0.45, 16, 16]} />
                  <meshBasicMaterial color={isActive ? "#f59e0b" : "#fde68a"} />
                </mesh>

                <mesh
                  position={targetPosition}
                  onClick={(event: ThreeEvent<MouseEvent>) => {
                    if (!interactionEnabled) {
                      return;
                    }
                    event.stopPropagation();
                    onActiveLightChange(light.id);
                  }}
                  onPointerDown={(event: ThreeEvent<PointerEvent>) =>
                    beginDrag(event, light, "target")
                  }
                  onPointerMove={(event: ThreeEvent<PointerEvent>) =>
                    updateDrag(event)
                  }
                  onPointerUp={(event: ThreeEvent<PointerEvent>) => endDrag(event)}
                  onPointerCancel={(event: ThreeEvent<PointerEvent>) =>
                    endDrag(event)
                  }
                  onPointerOver={() => {
                    if (interactionEnabled) {
                      onHoveredHandleChange(true);
                    }
                  }}
                  onPointerOut={() => {
                    if (!dragStateRef.current) {
                      onHoveredHandleChange(false);
                    }
                  }}
                >
                  <sphereGeometry args={[isActive ? 0.38 : 0.3, 16, 16]} />
                  <meshBasicMaterial color={isActive ? "#22d3ee" : "#67e8f9"} />
                </mesh>
              </>
            )}
          </group>
        );
      })}
    </>
  );
}
