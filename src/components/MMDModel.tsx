"use client";

import { useFrame } from "@react-three/fiber";
import type { SkinnedMesh } from "three";
import type { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper";

interface MMDModelProps {
  mesh: SkinnedMesh | null;
  helper: MMDAnimationHelper | null;
}

export default function MMDModel({ mesh, helper }: MMDModelProps) {
  useFrame((_, delta) => {
    helper?.update(delta);
  });

  if (!mesh) return null;

  return <primitive object={mesh} />;
}
