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
  gizmoVisible: boolean;
  interactionEnabled: boolean;
  onDraggingChange: (dragging: boolean) => void;
  onHoveredHandleChange: (hovered: boolean) => void;
}

type DragTarget = "position" | "yaw" | "pitch";

type DragState = {
  lightId: string;
  pointerId: number;
  target: DragTarget;
  plane: THREE.Plane;
  offset?: THREE.Vector3;
  startAngle?: number;
  startYaw?: number;
  startPitch?: number;
  horizontalForward?: THREE.Vector3;
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

function getLightPosition(light: SceneLight) {
  return toVector3(light.position);
}

function getLightTarget(light: SceneLight) {
  return toVector3(light.target);
}

function getLightDirection(light: SceneLight) {
  const direction = getLightTarget(light).sub(getLightPosition(light));
  if (direction.lengthSq() === 0) {
    return new THREE.Vector3(0, -1, 0);
  }
  return direction.normalize();
}

function getLightDistance(light: SceneLight) {
  const distance = getLightTarget(light).distanceTo(getLightPosition(light));
  return distance > 0.001 ? distance : 10;
}

function getYawFromDirection(direction: THREE.Vector3) {
  return Math.atan2(direction.x, direction.z);
}

function getPitchFromDirection(direction: THREE.Vector3) {
  const horizontalLength = Math.hypot(direction.x, direction.z);
  return Math.atan2(direction.y, horizontalLength);
}

function directionFromYawPitch(yaw: number, pitch: number) {
  const cosPitch = Math.cos(pitch);
  return new THREE.Vector3(
    Math.sin(yaw) * cosPitch,
    Math.sin(pitch),
    Math.cos(yaw) * cosPitch
  ).normalize();
}

function forwardFromYaw(yaw: number) {
  return new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
}

function angleOnHorizontalPlane(point: THREE.Vector3, center: THREE.Vector3) {
  return Math.atan2(point.x - center.x, point.z - center.z);
}

function angleOnVerticalPlane(
  point: THREE.Vector3,
  center: THREE.Vector3,
  forward: THREE.Vector3
) {
  const relative = point.clone().sub(center);
  return Math.atan2(relative.y, relative.dot(forward));
}

function makeTargetFromYawPitch(light: SceneLight, yaw: number, pitch: number) {
  const position = getLightPosition(light);
  const distance = getLightDistance(light);
  const direction = directionFromYawPitch(yaw, pitch);
  return toTuple(position.add(direction.multiplyScalar(distance)));
}

function getPointerCaptureTarget(
  event: ThreeEvent<PointerEvent>
): PointerCaptureTarget | null {
  return event.target as PointerCaptureTarget | null;
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

  useEffect(() => {
    const directional = lightRef.current;
    if (!directional) {
      return;
    }
    const cam = directional.shadow.camera;
    cam.left = -light.shadowCameraSize;
    cam.right = light.shadowCameraSize;
    cam.top = light.shadowCameraSize;
    cam.bottom = -light.shadowCameraSize;
    cam.near = light.shadowCameraNear;
    cam.far = light.shadowCameraFar;
    cam.updateProjectionMatrix();
    directional.shadow.bias = light.shadowBias;
    directional.shadow.normalBias = light.shadowNormalBias;
    directional.shadow.needsUpdate = true;
  }, [
    light.shadowCameraSize,
    light.shadowCameraNear,
    light.shadowCameraFar,
    light.shadowBias,
    light.shadowNormalBias,
  ]);

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
  gizmoVisible,
  interactionEnabled,
  onDraggingChange,
  onHoveredHandleChange,
}: SceneLightsProps) {
  const { camera } = useThree();
  const dragStateRef = useRef<DragState | null>(null);
  const pendingDragPosition = useRef<{
    lightId: string;
    position?: [number, number, number];
    target?: [number, number, number];
  } | null>(null);
  const planeHitPoint = useMemo(() => new THREE.Vector3(), []);
  const planeNormal = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useEffect(
    () => () => {
      onDraggingChange(false);
      onHoveredHandleChange(false);
    },
    [onDraggingChange, onHoveredHandleChange]
  );

  useFrame(() => {
    const pending = pendingDragPosition.current;
    if (!pending) {
      return;
    }

    pendingDragPosition.current = null;

    onLightsChange((prev) =>
      prev.map((light) => {
        if (light.id !== pending.lightId) {
          return light;
        }

        return {
          ...light,
          position: pending.position ?? light.position,
          target: pending.target ?? light.target,
        };
      })
    );
  });

  const beginDrag = (
    event: ThreeEvent<PointerEvent>,
    light: SceneLight,
    target: DragTarget
  ) => {
    if (!interactionEnabled || event.nativeEvent.altKey) {
      return;
    }

    const anchor = getLightPosition(light);
    const direction = getLightDirection(light);
    const yaw = getYawFromDirection(direction);
    const pitch = getPitchFromDirection(direction);
    const horizontalForward = forwardFromYaw(yaw);

    let dragPlane: THREE.Plane;
    if (target === "position") {
      camera.getWorldDirection(planeNormal);
      dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        planeNormal,
        anchor
      );
    } else if (target === "yaw") {
      dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(up, anchor);
    } else {
      const right = new THREE.Vector3()
        .crossVectors(horizontalForward, up)
        .normalize();
      dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(right, anchor);
    }

    if (!event.ray.intersectPlane(dragPlane, planeHitPoint)) {
      return;
    }

    event.stopPropagation();
    const pointerTarget = getPointerCaptureTarget(event);
    if (!pointerTarget) {
      return;
    }

    pointerTarget.setPointerCapture(event.pointerId);
    onActiveLightChange(light.id);
    onDraggingChange(true);
    onHoveredHandleChange(true);

    if (target === "position") {
      dragStateRef.current = {
        lightId: light.id,
        pointerId: event.pointerId,
        target,
        plane: dragPlane,
        offset: anchor.sub(planeHitPoint.clone()),
      };
      return;
    }

    dragStateRef.current = {
      lightId: light.id,
      pointerId: event.pointerId,
      target,
      plane: dragPlane,
      startAngle:
        target === "yaw"
          ? angleOnHorizontalPlane(planeHitPoint, anchor)
          : angleOnVerticalPlane(planeHitPoint, anchor, horizontalForward),
      startYaw: yaw,
      startPitch: pitch,
      horizontalForward,
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

    const light = lights.find((entry) => entry.id === dragState.lightId);
    if (!light) {
      return;
    }

    event.stopPropagation();

    if (dragState.target === "position") {
      const currentPosition = planeHitPoint.clone().add(dragState.offset!);
      const delta = currentPosition.clone().sub(getLightPosition(light));
      pendingDragPosition.current = {
        lightId: light.id,
        position: toTuple(currentPosition),
        target: toTuple(getLightTarget(light).add(delta)),
      };
      return;
    }

    if (dragState.target === "yaw") {
      const currentAngle = angleOnHorizontalPlane(
        planeHitPoint,
        getLightPosition(light)
      );
      const nextYaw =
        (dragState.startYaw ?? 0) +
        (currentAngle - (dragState.startAngle ?? currentAngle));
      pendingDragPosition.current = {
        lightId: light.id,
        target: makeTargetFromYawPitch(
          light,
          nextYaw,
          dragState.startPitch ?? 0
        ),
      };
      return;
    }

    const currentAngle = angleOnVerticalPlane(
      planeHitPoint,
      getLightPosition(light),
      dragState.horizontalForward ?? forwardFromYaw(dragState.startYaw ?? 0)
    );
    const nextPitch = THREE.MathUtils.clamp(
      (dragState.startPitch ?? 0) +
        (currentAngle - (dragState.startAngle ?? currentAngle)),
      -Math.PI / 2 + 0.05,
      Math.PI / 2 - 0.05
    );
    pendingDragPosition.current = {
      lightId: light.id,
      target: makeTargetFromYawPitch(light, dragState.startYaw ?? 0, nextPitch),
    };
  };

  const endDrag = (event: ThreeEvent<PointerEvent>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    const pointerTarget = getPointerCaptureTarget(event);
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
        const yaw = getYawFromDirection(getLightDirection(light));

        return (
          <group key={light.id}>
            <DirectionalLightInstance light={light} />

            {gizmoVisible && light.objectVisible ? (
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

                {isActive ? (
                  <>
                    <mesh
                      position={bodyPosition}
                      rotation-x={-Math.PI / 2}
                      onClick={(event: ThreeEvent<MouseEvent>) => {
                        if (!interactionEnabled) {
                          return;
                        }
                        event.stopPropagation();
                        onActiveLightChange(light.id);
                      }}
                      onPointerDown={(event: ThreeEvent<PointerEvent>) =>
                        beginDrag(event, light, "yaw")
                      }
                      onPointerMove={(event: ThreeEvent<PointerEvent>) =>
                        updateDrag(event)
                      }
                      onPointerUp={(event: ThreeEvent<PointerEvent>) =>
                        endDrag(event)
                      }
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
                      <ringGeometry args={[1.1, 1.32, 64]} />
                      <meshBasicMaterial
                        color="#f59e0b"
                        transparent
                        opacity={0.85}
                        depthWrite={false}
                        side={THREE.DoubleSide}
                      />
                    </mesh>

                    <mesh
                      position={bodyPosition}
                      rotation-y={yaw + Math.PI / 2}
                      onClick={(event: ThreeEvent<MouseEvent>) => {
                        if (!interactionEnabled) {
                          return;
                        }
                        event.stopPropagation();
                        onActiveLightChange(light.id);
                      }}
                      onPointerDown={(event: ThreeEvent<PointerEvent>) =>
                        beginDrag(event, light, "pitch")
                      }
                      onPointerMove={(event: ThreeEvent<PointerEvent>) =>
                        updateDrag(event)
                      }
                      onPointerUp={(event: ThreeEvent<PointerEvent>) =>
                        endDrag(event)
                      }
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
                      <torusGeometry args={[1.55, 0.09, 12, 64]} />
                      <meshBasicMaterial
                        color="#22d3ee"
                        transparent
                        opacity={0.85}
                        depthWrite={false}
                      />
                    </mesh>
                  </>
                ) : null}
              </>
            ) : null}
          </group>
        );
      })}
    </>
  );
}
