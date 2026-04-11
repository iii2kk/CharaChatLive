"use client";

import { useFrame } from "@react-three/fiber";
import type { AnimationMixer, Object3D } from "three";
import type { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper";
import type { VRM } from "@pixiv/three-vrm";

interface MMDModelProps {
  object: Object3D | null;
  helper: MMDAnimationHelper | null;
  animationMixer: AnimationMixer | null;
  vrm: VRM | null;
}

export default function MMDModel({
  object,
  helper,
  animationMixer,
  vrm,
}: MMDModelProps) {
  useFrame((_, delta) => {
    helper?.update(delta);
    animationMixer?.update(delta);
    vrm?.update(delta);
  });

  if (!object) return null;

  return <primitive object={object} />;
}
