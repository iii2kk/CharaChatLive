"use client";

import { useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LoadedModel } from "@/hooks/useModelLoader";

interface MMDModelProps {
  models: LoadedModel[];
}

const MODEL_GAP = 2;
const basePositions = new WeakMap<THREE.Object3D, THREE.Vector3>();

export default function MMDModel({ models }: MMDModelProps) {
  useFrame((_, delta) => {
    for (const model of models) {
      model.helper?.update(delta);
      model.animationMixer?.update(delta);
      model.vrm?.update(delta);
    }
  });

  useEffect(() => {
    if (models.length === 0) {
      return;
    }

    const footprints = models.map((model) => {
      if (!basePositions.has(model.object)) {
        basePositions.set(model.object, model.object.position.clone());
      }

      model.object.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(model.object);
      const size = box.getSize(new THREE.Vector3());
      const width = Math.max(size.x, size.z, 1);

      return {
        model,
        basePosition: basePositions.get(model.object)!,
        width,
      };
    });

    const totalWidth =
      footprints.reduce((sum, { width }) => sum + width, 0) +
      MODEL_GAP * Math.max(footprints.length - 1, 0);

    let cursorX = -totalWidth / 2;

    for (const { model, basePosition, width } of footprints) {
      const centerX = cursorX + width / 2;
      model.object.position.set(
        basePosition.x + centerX,
        basePosition.y,
        basePosition.z
      );
      cursorX += width + MODEL_GAP;
    }
  }, [models]);

  return (
    <>
      {models.map((model) => (
        <primitive key={model.id} object={model.object} />
      ))}
    </>
  );
}
