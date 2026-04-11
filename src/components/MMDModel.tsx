"use client";

import { useFrame } from "@react-three/fiber";
import type { LoadedModel } from "@/hooks/useModelLoader";

interface MMDModelProps {
  models: LoadedModel[];
}

export default function MMDModel({ models }: MMDModelProps) {
  useFrame((_, delta) => {
    for (const model of models) {
      model.helper?.update(delta);
      model.animationMixer?.update(delta);
      model.vrm?.update(delta);
    }
  });

  return (
    <>
      {models.map((model) => (
        <primitive key={model.id} object={model.object} />
      ))}
    </>
  );
}
