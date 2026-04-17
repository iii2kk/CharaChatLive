"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { CharacterModel } from "@/hooks/useModelLoader";
import {
  ensureModelTransformState,
  getModelBasePosition,
  getModelManualOffset,
  setModelLayoutOffset,
} from "@/lib/character/modelTransform";
import { renderSharedLive2DAtlas } from "@/lib/character/live2dPixi";
import {
  beginLive2DProfile,
  endLive2DProfile,
  markLive2DFrame,
} from "@/lib/character/live2dProfile";

interface CharacterModelsProps {
  models: CharacterModel[];
  activeModelId: string | null;
  onActiveModelChange: (modelId: string) => void;
  selectionEnabled: boolean;
}

const MODEL_GAP = 2;
const SELECTION_HIGHLIGHT_DURATION_MS = 2000;

export default function CharacterModels({
  models,
  activeModelId,
  onActiveModelChange,
  selectionEnabled,
}: CharacterModelsProps) {
  const { camera, scene } = useThree();
  const selectionRingRef = useRef<THREE.Mesh | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedModelId, setHighlightedModelId] = useState<string | null>(
    activeModelId
  );

  const showSelectionHighlight = (modelId: string | null) => {
    setHighlightedModelId(modelId);
  };

  useFrame((_, delta) => {
    const frameStart = beginLive2DProfile();
    for (const model of models) {
      model.update(delta);
    }

    // カメラ距離に応じて Live2D 解像度を自動調整
    for (const model of models) {
      if (!model.setDistanceScale) continue;
      // モデルの視覚中心 (足元 + 板ポリ高さの半分) を推定
      const distance = camera.position.distanceTo(model.object.position);
      // 基準距離 30 で factor=1.0。近いほど高解像度、遠いほど低解像度
      //const factor = distance > 0 ? 30 / distance : 2.0;
      const factor = distance > 0 ? 70.0 / (distance + 20.0) : 2.0;
      //console.log("distanceScale::", factor, distance)
      model.setDistanceScale(factor);
    }

    const sharedRenderStart = beginLive2DProfile();
    renderSharedLive2DAtlas();
    endLive2DProfile("live2d.frame.sharedRender", sharedRenderStart);

    for (const model of models) {
      model.afterSharedRender?.();
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
      ensureModelTransformState(model.object);

      model.object.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(model.object);
      const size = box.getSize(new THREE.Vector3());
      const width = Math.max(size.x, size.z, 1);

      return {
        model,
        basePosition: getModelBasePosition(model.object),
        width,
      };
    });

    const totalWidth =
      footprints.reduce((sum, { width }) => sum + width, 0) +
      MODEL_GAP * Math.max(footprints.length - 1, 0);

    let cursorX = -totalWidth / 2;

    for (const { model, basePosition, width } of footprints) {
      const centerX = cursorX + width / 2;
      const manualOffset = getModelManualOffset(model.object);
      setModelLayoutOffset(model.object, centerX);
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
    },
    []
  );

  return (
    <>
      {models.map((model) => (
        <primitive
          key={model.id}
          object={model.object}
          onClick={(event: ThreeEvent<MouseEvent>) => {
            if (!selectionEnabled) {
              return;
            }
            event.stopPropagation();
            onActiveModelChange(model.id);
            showSelectionHighlight(model.id);
          }}
        />
      ))}
    </>
  );
}
