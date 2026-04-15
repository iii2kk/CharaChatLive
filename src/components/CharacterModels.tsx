"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { CharacterModel } from "@/hooks/useModelLoader";
import {
  beginLive2DProfile,
  endLive2DProfile,
  markLive2DFrame,
} from "@/lib/character/live2dProfile";

interface CharacterModelsProps {
  models: CharacterModel[];
  activeModelId: string | null;
  onActiveModelChange: (modelId: string) => void;
  onDraggingChange: (dragging: boolean) => void;
  onHoveredModelChange: (modelId: string | null) => void;
  interactionEnabled: boolean;
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
  startHitPoint: THREE.Vector3;
  startPosition: THREE.Vector3;
  pointerAnchorOffset: THREE.Vector2;
  y: number;
};

type PointerCaptureTarget = EventTarget & {
  setPointerCapture: (pointerId: number) => void;
  releasePointerCapture: (pointerId: number) => void;
};

export default function CharacterModels({
  models,
  activeModelId,
  onActiveModelChange,
  onDraggingChange,
  onHoveredModelChange,
  interactionEnabled,
}: CharacterModelsProps) {
  const { camera, gl, scene } = useThree();
  const dragStateRef = useRef<DragState | null>(null);
  const selectionRingRef = useRef<THREE.Mesh | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planeHitPoint = useMemo(() => new THREE.Vector3(), []);
  const footAnchor = useMemo(() => new THREE.Vector3(), []);
  const projectedAnchor = useMemo(() => new THREE.Vector3(), []);
  const pointerNdc = useMemo(() => new THREE.Vector2(), []);
  const pointerAnchorOffset = useMemo(() => new THREE.Vector2(), []);
  const dragRaycaster = useMemo(() => new THREE.Raycaster(), []);
  const [highlightedModelId, setHighlightedModelId] = useState<string | null>(
    activeModelId
  );

  const intersectDragPlaneFromClientPoint = (
    clientX: number,
    clientY: number,
    plane: THREE.Plane
  ) => {
    const rect = gl.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    dragRaycaster.setFromCamera(pointerNdc, camera);
    return dragRaycaster.ray.intersectPlane(plane, planeHitPoint) !== null;
  };

  const getFootAnchorScreenPoint = (model: CharacterModel) => {
    model.object.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(model.object);
    if (box.isEmpty()) {
      return null;
    }

    footAnchor.set(
      (box.min.x + box.max.x) / 2,
      box.min.y,
      (box.min.z + box.max.z) / 2
    );

    const rect = gl.domElement.getBoundingClientRect();
    projectedAnchor.copy(footAnchor).project(camera);

    return {
      x: ((projectedAnchor.x + 1) * 0.5) * rect.width + rect.left,
      y: ((1 - projectedAnchor.y) * 0.5) * rect.height + rect.top,
    };
  };

  const showSelectionHighlight = (modelId: string | null) => {
    setHighlightedModelId(modelId);
  };

  useFrame((_, delta) => {
    const frameStart = beginLive2DProfile();
    for (const model of models) {
      model.update(delta);
    }
    endLive2DProfile("live2d.frame.total", frameStart);
    markLive2DFrame(models.length);

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

  const beginDrag = (event: ThreeEvent<PointerEvent>, model: CharacterModel) => {
    if (!interactionEnabled) {
      return;
    }

    if (!event.nativeEvent.shiftKey) {
      return;
    }

    const planeY = model.object.position.y;
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const footAnchorScreenPoint = getFootAnchorScreenPoint(model);
    if (!footAnchorScreenPoint) {
      return;
    }

    pointerAnchorOffset.set(
      event.nativeEvent.clientX - footAnchorScreenPoint.x,
      event.nativeEvent.clientY - footAnchorScreenPoint.y
    );

    if (
      !intersectDragPlaneFromClientPoint(
        event.nativeEvent.clientX - pointerAnchorOffset.x,
        event.nativeEvent.clientY - pointerAnchorOffset.y,
        dragPlane
      )
    ) {
      return;
    }

    event.stopPropagation();
    const target = event.target as PointerCaptureTarget | null;
    if (!target) {
      return;
    }
    target.setPointerCapture(event.pointerId);
    onActiveModelChange(model.id);
    showSelectionHighlight(model.id);
    onDraggingChange(true);

    dragStateRef.current = {
      modelId: model.id,
      pointerId: event.pointerId,
      plane: dragPlane,
      startHitPoint: planeHitPoint.clone(),
      startPosition: model.object.position.clone(),
      pointerAnchorOffset: pointerAnchorOffset.clone(),
      y: planeY,
    };
  };

  const updateDrag = (event: ThreeEvent<PointerEvent>, model: CharacterModel) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.modelId !== model.id) {
      return;
    }

    if (
      !intersectDragPlaneFromClientPoint(
        event.nativeEvent.clientX - dragState.pointerAnchorOffset.x,
        event.nativeEvent.clientY - dragState.pointerAnchorOffset.y,
        dragState.plane
      )
    ) {
      return;
    }

    event.stopPropagation();

    const delta = planeHitPoint.clone().sub(dragState.startHitPoint);
    model.object.position.set(
      dragState.startPosition.x + delta.x,
      dragState.y,
      dragState.startPosition.z + delta.z
    );

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
    const target = event.target as PointerCaptureTarget | null;
    if (!target) {
      dragStateRef.current = null;
      onDraggingChange(false);
      return;
    }
    target.releasePointerCapture(event.pointerId);
    dragStateRef.current = null;
    onDraggingChange(false);
  };

  return (
    <>
      {models.map((model) => (
        <primitive
          key={model.id}
          object={model.object}
          onClick={(event: ThreeEvent<MouseEvent>) => {
            if (!interactionEnabled) {
              return;
            }
            event.stopPropagation();
            onActiveModelChange(model.id);
            showSelectionHighlight(model.id);
          }}
          onPointerDown={(event: ThreeEvent<PointerEvent>) =>
            beginDrag(event, model)
          }
          onPointerOver={() => {
            if (interactionEnabled) {
              onHoveredModelChange(model.id);
            }
          }}
          onPointerMove={(event: ThreeEvent<PointerEvent>) => {
            if (interactionEnabled) {
              onHoveredModelChange(model.id);
            }
            updateDrag(event, model);
          }}
          onPointerUp={(event: ThreeEvent<PointerEvent>) => endDrag(event)}
          onPointerMissed={() => {
            onDraggingChange(false);
            onHoveredModelChange(null);
          }}
          onPointerCancel={(event: ThreeEvent<PointerEvent>) => endDrag(event)}
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
