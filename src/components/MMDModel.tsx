"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { LoadedModel } from "@/hooks/useModelLoader";

interface MMDModelProps {
  models: LoadedModel[];
  activeModelId: string | null;
  onActiveModelChange: (modelId: string) => void;
  onDraggingChange: (dragging: boolean) => void;
  onHoveredModelChange: (modelId: string | null) => void;
}

const MODEL_GAP = 2;
const SELECTION_HIGHLIGHT_DURATION_MS = 2000;
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
  onHoveredModelChange,
}: MMDModelProps) {
  const { scene } = useThree();
  const dragStateRef = useRef<DragState | null>(null);
  const selectionRingRef = useRef<THREE.Mesh | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planeHitPoint = useMemo(() => new THREE.Vector3(), []);
  const [highlightedModelId, setHighlightedModelId] = useState<string | null>(
    activeModelId
  );

  const showSelectionHighlight = (modelId: string | null) => {
    setHighlightedModelId(modelId);
  };

  useFrame((_, delta) => {
    for (const model of models) {
      model.helper?.update(delta);
      model.animationMixer?.update(delta);
      model.vrm?.update(delta);
    }

    const highlightedModel =
      models.find((model) => model.id === highlightedModelId) ?? null;
    const selectionRing = selectionRingRef.current;

    if (!highlightedModel || !selectionRing) {
      return;
    }

    highlightedModel.object.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(highlightedModel.object);
    if (box.isEmpty()) {
      selectionRing.visible = false;
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.35 + 0.8;

    selectionRing.visible = true;
    selectionRing.position.set(center.x, box.min.y + 0.05, center.z);
    selectionRing.scale.setScalar(radius);
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
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }

    if (!highlightedModelId) {
      highlightTimeoutRef.current = null;
      return;
    }

    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedModelId((current) =>
        current === highlightedModelId ? null : current
      );
      highlightTimeoutRef.current = null;
    }, SELECTION_HIGHLIGHT_DURATION_MS);

    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = null;
      }
    };
  }, [highlightedModelId]);

  useEffect(() => {
    const activeModel =
      models.find((model) => model.id === highlightedModelId) ?? null;

    selectionRingRef.current?.removeFromParent();
    selectionRingRef.current?.geometry.dispose();
    (
      selectionRingRef.current?.material instanceof THREE.Material
        ? selectionRingRef.current.material
        : null
    )?.dispose();
    selectionRingRef.current = null;

    if (!activeModel) {
      return;
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64),
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 10;
    selectionRingRef.current = ring;
    scene.add(ring);

    return () => {
      ring.removeFromParent();
      ring.geometry.dispose();
      if (ring.material instanceof THREE.Material) {
        ring.material.dispose();
      }
      if (selectionRingRef.current === ring) {
        selectionRingRef.current = null;
      }
    };
  }, [highlightedModelId, models, scene]);

  useEffect(
    () => () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
      onDraggingChange(false);
      onHoveredModelChange(null);
    },
    [onDraggingChange, onHoveredModelChange]
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
    showSelectionHighlight(model.id);
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
            showSelectionHighlight(model.id);
          }}
          onPointerDown={(event) => beginDrag(event, model)}
          onPointerOver={() => {
            onHoveredModelChange(model.id);
          }}
          onPointerMove={(event) => {
            onHoveredModelChange(model.id);
            updateDrag(event, model);
          }}
          onPointerUp={endDrag}
          onPointerMissed={() => {
            onDraggingChange(false);
            onHoveredModelChange(null);
          }}
          onPointerCancel={endDrag}
          onPointerOut={() => {
            if (dragStateRef.current?.modelId !== model.id) {
              onHoveredModelChange(null);
            }
          }}
        />
      ))}
    </>
  );
}
