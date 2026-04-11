"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { SkinnedMesh } from "three";
import type { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper";

interface MMDModelProps {
  mesh: SkinnedMesh | null;
  helper: MMDAnimationHelper | null;
}

export default function MMDModel({ mesh, helper }: MMDModelProps) {
  const helperRef = useRef(helper);
  helperRef.current = helper;

  useFrame((_, delta) => {
    helperRef.current?.update(delta);
  });

  if (!mesh) return null;

  return <primitive object={mesh} />;
}
