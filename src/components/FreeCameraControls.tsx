"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

interface FreeCameraControlsProps {
  enabled: boolean;
}

const LOOK_SENSITIVITY = 0.005;
const BASE_MOVE_SPEED = 18;
const BOOST_MULTIPLIER = 2.5;
const MAX_PITCH = Math.PI / 2 - 0.05;

type KeyState = {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  boost: boolean;
};

export default function FreeCameraControls({
  enabled,
}: FreeCameraControlsProps) {
  const { camera, gl } = useThree();
  const keyStateRef = useRef<KeyState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
    boost: false,
  });
  const dragStateRef = useRef({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
  });
  const yawRef = useRef(0);
  const pitchRef = useRef(0);

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) {
      return;
    }

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    yawRef.current = Math.atan2(direction.x, direction.z);
    pitchRef.current = Math.asin(
      THREE.MathUtils.clamp(direction.y, -1, 1)
    );
  }, [camera, enabled]);

  useEffect(() => {
    if (!enabled) {
      dragStateRef.current.active = false;
      keyStateRef.current = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        up: false,
        down: false,
        boost: false,
      };
      return;
    }

    const domElement = gl.domElement;

    const setKeyState = (event: KeyboardEvent, pressed: boolean) => {
      switch (event.code) {
        case "KeyW":
          keyStateRef.current.forward = pressed;
          break;
        case "KeyS":
          keyStateRef.current.backward = pressed;
          break;
        case "KeyA":
          keyStateRef.current.left = pressed;
          break;
        case "KeyD":
          keyStateRef.current.right = pressed;
          break;
        case "KeyQ":
          keyStateRef.current.down = pressed;
          break;
        case "KeyE":
          keyStateRef.current.up = pressed;
          break;
        case "ShiftLeft":
        case "ShiftRight":
          keyStateRef.current.boost = pressed;
          break;
        default:
          break;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      setKeyState(event, true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      setKeyState(event, false);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      dragStateRef.current = {
        active: true,
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };

      domElement.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState.active || dragState.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - dragState.lastX;
      const deltaY = event.clientY - dragState.lastY;

      dragState.lastX = event.clientX;
      dragState.lastY = event.clientY;

      yawRef.current -= deltaX * LOOK_SENSITIVITY;
      pitchRef.current = THREE.MathUtils.clamp(
        pitchRef.current - deltaY * LOOK_SENSITIVITY,
        -MAX_PITCH,
        MAX_PITCH
      );
    };

    const endDrag = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState.active || dragState.pointerId !== event.pointerId) {
        return;
      }

      dragStateRef.current.active = false;
      domElement.releasePointerCapture(event.pointerId);
    };

    const handleWindowBlur = () => {
      dragStateRef.current.active = false;
      keyStateRef.current = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        up: false,
        down: false,
        boost: false,
      };
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    domElement.addEventListener("pointerdown", handlePointerDown);
    domElement.addEventListener("pointermove", handlePointerMove);
    domElement.addEventListener("pointerup", endDrag);
    domElement.addEventListener("pointercancel", endDrag);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
      domElement.removeEventListener("pointerdown", handlePointerDown);
      domElement.removeEventListener("pointermove", handlePointerMove);
      domElement.removeEventListener("pointerup", endDrag);
      domElement.removeEventListener("pointercancel", endDrag);
    };
  }, [enabled, gl.domElement]);

  useFrame((_, delta) => {
    if (!enabled || !(camera instanceof THREE.PerspectiveCamera)) {
      return;
    }

    camera.rotation.set(pitchRef.current, yawRef.current, 0, "YXZ");

    const keyState = keyStateRef.current;
    const moveSpeed =
      BASE_MOVE_SPEED * (keyState.boost ? BOOST_MULTIPLIER : 1) * delta;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;

    if (forward.lengthSq() > 0) {
      forward.normalize();
    }

    const right = new THREE.Vector3()
      .crossVectors(forward, camera.up)
      .normalize();

    if (keyState.forward) {
      camera.position.addScaledVector(forward, moveSpeed);
    }
    if (keyState.backward) {
      camera.position.addScaledVector(forward, -moveSpeed);
    }
    if (keyState.left) {
      camera.position.addScaledVector(right, -moveSpeed);
    }
    if (keyState.right) {
      camera.position.addScaledVector(right, moveSpeed);
    }
    if (keyState.up) {
      camera.position.addScaledVector(camera.up, moveSpeed);
    }
    if (keyState.down) {
      camera.position.addScaledVector(camera.up, -moveSpeed);
    }
  });

  return null;
}
