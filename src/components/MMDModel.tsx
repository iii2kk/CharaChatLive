"use client";

import { useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AnimationMixer, Object3D } from "three";
import type { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper";
import type { VRM } from "@pixiv/three-vrm";

interface MMDModelProps {
  object: Object3D | null;
  helper: MMDAnimationHelper | null;
  animationMixer: AnimationMixer | null;
  vrm: VRM | null;
}

const vrmBaseScales = new WeakMap<Object3D, THREE.Vector3>();
const vrmBasePositions = new WeakMap<Object3D, THREE.Vector3>();

export default function MMDModel({
  object,
  helper,
  animationMixer,
  vrm,
}: MMDModelProps) {
  useEffect(() => {
    if (!object || !vrm) {
      return;
    }

    if (!vrmBaseScales.has(object)) {
      vrmBaseScales.set(object, object.scale.clone());
    }

    if (!vrmBasePositions.has(object)) {
      vrmBasePositions.set(object, object.position.clone());
    }

    const baseScale = vrmBaseScales.get(object);
    const basePosition = vrmBasePositions.get(object);
    if (!baseScale || !basePosition) {
      return;
    }

    object.scale.copy(baseScale);
    object.position.copy(basePosition);
    object.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());

    if (size.y > 0) {
      const targetHeight = 21;
      const scaleFactor = targetHeight / size.y;
      object.scale.copy(baseScale).multiplyScalar(scaleFactor);
      object.updateMatrixWorld(true);
      box.setFromObject(object);
    }

    const center = box.getCenter(new THREE.Vector3());
    object.position.copy(basePosition).add(
      new THREE.Vector3(-center.x, -box.min.y, -center.z)
    );
    object.updateMatrixWorld(true);
  }, [object, vrm]);

  useFrame((_, delta) => {
    helper?.update(delta);
    animationMixer?.update(delta);
    vrm?.update(delta);
  });

  if (!object) return null;

  return <primitive object={object} />;
}
