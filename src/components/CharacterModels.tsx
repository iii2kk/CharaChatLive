"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { CharacterModel } from "@/hooks/useModelLoader";
import {
  ensureModelTransformState,
  getModelBasePosition,
  getModelManualOffset,
  refreshModelInteractionMetrics,
  setModelLayoutOffset,
  type ModelInteractionMetrics,
} from "@/lib/character/modelTransform";
import {
  renderSharedLive2DAtlas,
  setLive2DResolutionConfig,
} from "@/lib/character/live2dThree/sharedAtlasRenderer";
import { setThreeRendererRef } from "@/lib/character/live2dThree/threeRendererRef";
import {
  beginLive2DProfile,
  endLive2DProfile,
  markLive2DFrame,
} from "@/lib/character/live2dProfile";
import type { ViewerSettings } from "@/lib/viewer-settings";

interface CharacterModelsProps {
  models: CharacterModel[];
  activeModelId: string | null;
  onActiveModelChange: (modelId: string) => void;
  selectionEnabled: boolean;
  viewerSettings: ViewerSettings;
}

const MODEL_GAP = 2;
const SELECTION_HIGHLIGHT_DURATION_MS = 2000;

export default function CharacterModels({
  models,
  activeModelId,
  onActiveModelChange,
  selectionEnabled,
  viewerSettings,
}: CharacterModelsProps) {
  const { camera, scene, gl } = useThree();
  const selectionRingRef = useRef<THREE.Mesh | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightedMetricsRef = useRef<ModelInteractionMetrics | null>(null);
  const live2dRenderAccumulatorMsRef = useRef(0);
  const [highlightedModelId, setHighlightedModelId] = useState<string | null>(
    activeModelId
  );

  const showSelectionHighlight = (modelId: string | null) => {
    setHighlightedModelId(modelId);
  };

  useFrame((_, delta) => {
    const frameStart = beginLive2DProfile();
    const deltaMs = delta * 1000;
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

    const hasLive2DModel = models.some((model) => model.kind === "live2d");
    const live2dRenderFps = THREE.MathUtils.clamp(
      viewerSettings.live2dRenderFps,
      1,
      60
    );
    if (!hasLive2DModel) {
      live2dRenderAccumulatorMsRef.current = 0;
    } else {
      live2dRenderAccumulatorMsRef.current += deltaMs;
      const renderIntervalMs = 1000 / live2dRenderFps;
      const shouldForceSharedRender = models.some((model) =>
        model.consumeSharedRenderRequest?.()
      );
      if (
        shouldForceSharedRender ||
        live2dRenderAccumulatorMsRef.current >= renderIntervalMs
      ) {
        live2dRenderAccumulatorMsRef.current = shouldForceSharedRender
          ? 0
          : live2dRenderAccumulatorMsRef.current % renderIntervalMs;

        const sharedRenderStart = beginLive2DProfile();
        renderSharedLive2DAtlas(gl);
        endLive2DProfile("live2d.frame.sharedRender", sharedRenderStart);

        for (const model of models) {
          model.afterSharedRender?.();
        }
      }
    }

    endLive2DProfile("live2d.frame.total", frameStart);
    markLive2DFrame(models.length);

    const highlightedModel =
      models.find((model) => model.id === highlightedModelId) ?? null;
    const selectionRing = selectionRingRef.current;

    if (!highlightedModel || !selectionRing) {
      return;
    }

    const metrics = highlightedMetricsRef.current;
    if (!metrics) {
      selectionRing.visible = false;
      return;
    }

    selectionRing.visible = true;
    selectionRing.position.set(
      highlightedModel.object.position.x,
      highlightedModel.object.position.y + metrics.footOffsetY + 0.05,
      highlightedModel.object.position.z
    );
    selectionRing.scale.setScalar(metrics.radius);
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

    if (activeModel) {
      highlightedMetricsRef.current = refreshModelInteractionMetrics(
        activeModel.object
      );
    } else {
      highlightedMetricsRef.current = null;
    }

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

  // Live2D (Cubism direct renderer) が Canvas 外から WebGLRenderer を取得できるよう登録
  useEffect(() => {
    setThreeRendererRef(gl);
    return () => {
      setThreeRendererRef(null);
    };
  }, [gl]);

  // Live2D グローバル品質設定を sharedAtlasRenderer に反映し、既存モデルを refresh
  useEffect(() => {
    setLive2DResolutionConfig({
      qualityMultiplier: viewerSettings.live2dQualityMultiplier,
      viewportHeightUsage: viewerSettings.live2dViewportHeightUsage,
      maxEdge: viewerSettings.live2dMaxEdge,
    });
    for (const model of models) {
      if (model.kind === "live2d") {
        model.refreshAtlasSize?.();
      }
    }
  }, [
    models,
    viewerSettings.live2dQualityMultiplier,
    viewerSettings.live2dViewportHeightUsage,
    viewerSettings.live2dMaxEdge,
  ]);

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
