"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { LoadedModel } from "@/hooks/useModelLoader";

interface MMDModelProps {
  models: LoadedModel[];
  activeModelId: string | null;
  onActiveModelChange: (modelId: string) => void;
  onDraggingChange: (dragging: boolean) => void;
}

const MODEL_GAP = 2;
const basePositions = new WeakMap<THREE.Object3D, THREE.Vector3>();
const layoutOffsets = new WeakMap<THREE.Object3D, number>();
const manualOffsets = new WeakMap<THREE.Object3D, THREE.Vector3>();

type DragState = {
  modelId: string;
  pointerId: number;
  plane: THREE.Plane;
  grabOffset: THREE.Vector3;
  y: number;
};

export default function MMDModel({
  models,
  activeModelId,
  onActiveModelChange,
  onDraggingChange,
}: MMDModelProps) {
  const { scene } = useThree();
  const dragStateRef = useRef<DragState | null>(null);
  const selectionHelperRef = useRef<THREE.BoxHelper | null>(null);
  const planeHitPoint = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    for (const model of models) {
      model.helper?.update(delta);
      model.animationMixer?.update(delta);
      model.vrm?.update(delta);
    }

    selectionHelperRef.current?.update();
  });

  useEffect(() => {
    if (models.length === 0) {
      return;
    }

    const footprints = models.map((model) => {
      if (!basePositions.has(model.object)) {
        basePositions.set(model.object, model.object.position.clone());
      }
      if (!manualOffsets.has(model.object)) {
        manualOffsets.set(model.object, new THREE.Vector3());
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
      const manualOffset = manualOffsets.get(model.object)!;
      layoutOffsets.set(model.object, centerX);
      model.object.position.set(
        basePosition.x + centerX + manualOffset.x,
        basePosition.y + manualOffset.y,
        basePosition.z + manualOffset.z
      );
      cursorX += width + MODEL_GAP;
    }
  }, [models]);

  useEffect(() => {
    const activeModel =
      models.find((model) => model.id === activeModelId) ?? null;

    selectionHelperRef.current?.removeFromParent();
    selectionHelperRef.current = null;

    if (!activeModel) {
      return;
    }

    const helper = new THREE.BoxHelper(activeModel.object, 0x7dd3fc);
    selectionHelperRef.current = helper;
    scene.add(helper);

    return () => {
      helper.removeFromParent();
      if (selectionHelperRef.current === helper) {
        selectionHelperRef.current = null;
      }
    };
  }, [activeModelId, models, scene]);

  useEffect(
    () => () => {
      onDraggingChange(false);
    },
    [onDraggingChange]
  );

  const beginDrag = (event: ThreeEvent<PointerEvent>, model: LoadedModel) => {
    if (!event.nativeEvent.shiftKey) {
      return;
    }

    const planeY = model.object.position.y;
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);

    if (!event.ray.intersectPlane(dragPlane, planeHitPoint)) {
      return;
    }

    event.stopPropagation();
    event.target.setPointerCapture(event.pointerId);
    onActiveModelChange(model.id);
    onDraggingChange(true);

    dragStateRef.current = {
      modelId: model.id,
      pointerId: event.pointerId,
      plane: dragPlane,
      grabOffset: model.object.position.clone().sub(planeHitPoint),
      y: planeY,
    };
  };

  const updateDrag = (event: ThreeEvent<PointerEvent>, model: LoadedModel) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.modelId !== model.id) {
      return;
    }

    if (!event.ray.intersectPlane(dragState.plane, planeHitPoint)) {
      return;
    }

    event.stopPropagation();

    const nextPosition = planeHitPoint.clone().add(dragState.grabOffset);
    model.object.position.set(nextPosition.x, dragState.y, nextPosition.z);

    const basePosition = basePositions.get(model.object) ?? new THREE.Vector3();
    const layoutX = layoutOffsets.get(model.object) ?? 0;
    manualOffsets.set(
      model.object,
      new THREE.Vector3(
        model.object.position.x - (basePosition.x + layoutX),
        model.object.position.y - basePosition.y,
        model.object.position.z - basePosition.z
      )
    );
  };

  const endDrag = (event: ThreeEvent<PointerEvent>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    event.target.releasePointerCapture(event.pointerId);
    dragStateRef.current = null;
    onDraggingChange(false);
  };

  return (
    <>
      {models.map((model) => (
        <primitive
          key={model.id}
          object={model.object}
          onClick={(event) => {
            event.stopPropagation();
            onActiveModelChange(model.id);
          }}
          onPointerDown={(event) => beginDrag(event, model)}
          onPointerMove={(event) => updateDrag(event, model)}
          onPointerUp={endDrag}
          onPointerMissed={() => {
            onDraggingChange(false);
          }}
          onPointerCancel={endDrag}
        />
      ))}
    </>
  );
}
