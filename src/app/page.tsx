"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import FloatingWindowOverlay from "@/components/FloatingWindowOverlay";
import type { ModelEntry, ModelFile } from "@/types/models";
import { useModelLoader } from "@/hooks/useModelLoader";
import {
  defaultViewerSettings,
  type ViewerSettings,
} from "@/lib/viewer-settings";
import {
  buildFileMap,
  findAnimationFiles,
  findModelFileEntry,
  getAnimationKind,
  revokeFileMap,
  type AnimationKind,
} from "@/lib/file-map";
import {
  createDirectionalLight,
  type SceneLight,
} from "@/lib/scene-lights";

const CharacterViewer = dynamic(() => import("@/components/CharacterViewer"), {
  ssr: false,
});

export default function Home() {
  const [viewerSettings, setViewerSettings] =
    useState<ViewerSettings>(defaultViewerSettings);
  const [freeCameraEnabled, setFreeCameraEnabled] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{
    modelId: string;
    nonce: number;
  } | null>(null);
  const [lights, setLights] = useState<SceneLight[]>(() => [
    createDirectionalLight({ name: "Directional Light 1" }),
  ]);
  const [activeLightId, setActiveLightId] = useState<string | null>(() =>
    lights[0]?.id ?? null
  );
  const {
    models,
    activeModel,
    activeModelId,
    setActiveModelId,
    removeModel,
    loading,
    error,
    loadModel,
    loadModelFromPath,
    loadAnimation,
    setModelRenderScale,
    setModelDisplayScale,
  } = useModelLoader(viewerSettings);
  const [animationUrlState, setAnimationUrlState] = useState<string[]>([]);
  const [presetModels, setPresetModels] = useState<ModelEntry[]>([]);

  const clearAnimationUrls = useCallback(() => {
    setAnimationUrlState((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return [];
    });
  }, []);

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data: ModelEntry[]) => setPresetModels(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      animationUrlState.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [animationUrlState]);

  const handlePresetSelected = useCallback(
    (file: ModelFile) => {
      clearAnimationUrls();
      loadModelFromPath(file.path, { name: file.name });
    },
    [clearAnimationUrls, loadModelFromPath]
  );

  const handleModelFolderSelected = useCallback(
    (files: FileList) => {
      clearAnimationUrls();

      const fileMap = buildFileMap(files);
      const modelEntry = findModelFileEntry(fileMap);

      if (!modelEntry) {
        revokeFileMap(fileMap);
        return;
      }

      const animationKind: AnimationKind = (() => {
        switch (modelEntry.kind) {
          case "vrm":
            return "vrma";
          case "live2d":
            return "motion3";
          case "mmd":
          default:
            return "vmd";
        }
      })();
      const animationUrls = findAnimationFiles(fileMap, animationKind);

      loadModel(modelEntry.kind, modelEntry.url, fileMap, {
        name: modelEntry.name,
        onLoaded: (modelId) => {
        if (animationUrls.length > 0) {
          loadAnimation(animationKind, animationUrls, modelId);
        }
        },
      });
    },
    [clearAnimationUrls, loadAnimation, loadModel]
  );

  const handleAnimationFilesSelected = useCallback(
    (files: FileList) => {
      clearAnimationUrls();

      const filesArray = Array.from(files);
      const detectedKind = filesArray.find((file) => getAnimationKind(file.name))
        ?.name;

      if (!detectedKind) {
        return;
      }

      const animationKind = getAnimationKind(detectedKind);
      if (!animationKind) {
        return;
      }

      const urls = filesArray
        .filter((file) => getAnimationKind(file.name) === animationKind)
        .map((file) => URL.createObjectURL(file));

      if (urls.length > 0) {
        setAnimationUrlState(urls);
        loadAnimation(animationKind, urls);
      }
    },
    [clearAnimationUrls, loadAnimation]
  );

  const handleFocusModel = useCallback((modelId: string) => {
    setActiveModelId(modelId);
    setFocusRequest({
      modelId,
      nonce: performance.now(),
    });
  }, [setActiveModelId]);

  return (
    <div className="h-full w-full relative">
      <div className="h-full w-full">
        <CharacterViewer
          models={models}
          activeModel={activeModel}
          activeModelId={activeModelId}
          onActiveModelChange={setActiveModelId}
          focusRequest={focusRequest}
          lights={lights}
          activeLightId={activeLightId}
          onActiveLightChange={setActiveLightId}
          onLightsChange={setLights}
          freeCameraEnabled={freeCameraEnabled}
          viewerSettings={viewerSettings}
        />
      </div>
      <FloatingWindowOverlay
        presetModels={presetModels}
        onPresetSelected={handlePresetSelected}
        onModelFolderSelected={handleModelFolderSelected}
        onAnimationFilesSelected={handleAnimationFilesSelected}
        loadedModels={models}
        activeModel={activeModel}
        activeModelId={activeModelId}
        onActiveModelChange={setActiveModelId}
        onFocusModel={handleFocusModel}
        onRemoveModel={removeModel}
        loading={loading}
        error={error}
        modelName={activeModel?.name ?? null}
        animationLoaded={activeModel?.animation.isLoaded() ?? false}
        lights={lights}
        activeLightId={activeLightId}
        onActiveLightChange={setActiveLightId}
        onLightsChange={setLights}
        freeCameraEnabled={freeCameraEnabled}
        onFreeCameraEnabledChange={setFreeCameraEnabled}
        viewerSettings={viewerSettings}
        onViewerSettingsChange={setViewerSettings}
        onRenderScaleChange={setModelRenderScale}
        onDisplayScaleChange={setModelDisplayScale}
      />
    </div>
  );
}
