"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import type { SkinnedMesh } from "three";
import type { MMDAnimationHelper } from "three/examples/jsm/animation/MMDAnimationHelper";
import MMDScene from "./MMDScene";

interface MMDViewerProps {
  mesh: SkinnedMesh | null;
  helper: MMDAnimationHelper | null;
}

export default function MMDViewer({ mesh, helper }: MMDViewerProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 15, 25], fov: 45, near: 0.1, far: 1000 }}
      style={{ background: "#1a1a2e" }}
    >
      <Suspense fallback={null}>
        <MMDScene mesh={mesh} helper={helper} />
      </Suspense>
    </Canvas>
  );
}
