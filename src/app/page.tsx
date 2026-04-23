"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import FloatingWindowOverlay from "@/components/FloatingWindowOverlay";
import type { ModelEntry, ModelFile } from "@/types/models";
import type { PresetMotion } from "@/types/motions";
import type { TexturePresets } from "@/types/textures";
import { useModelLoader } from "@/hooks/useModelLoader";
import type { InteractionMode } from "@/lib/interaction-mode";
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
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("orbit");
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
    registerPresetMotions,
    setModelRenderScale,
    setModelDisplayScale,
  } = useModelLoader(viewerSettings);
  const [animationUrlState, setAnimationUrlState] = useState<string[]>([]);
  const [presetModels, setPresetModels] = useState<ModelEntry[]>([]);
  const [presetMotions, setPresetMotions] = useState<PresetMotion[]>([]);
  const [texturePresets, setTexturePresets] = useState<TexturePresets>({
    ground: [],
    background: [],
  });

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
    fetch("/api/textures")
      .then((res) => res.json())
      .then((data: TexturePresets) => setTexturePresets(data))
      .catch(() => {});
    fetch("/api/motions")
      .then((res) => res.json())
      .then((data: PresetMotion[]) => setPresetMotions(data))
      .catch(() => {});
  }, []);

  const presetMotionsByKindRef = useCallback(
    (modelKind: "mmd" | "vrm" | "live2d"): PresetMotion[] => {
      const kind: AnimationKind | null =
        modelKind === "mmd"
          ? "vmd"
          : modelKind === "vrm"
          ? "vrma"
          : null;
      if (!kind) return [];
      return presetMotions.filter((m) => m.kind === kind);
    },
    [presetMotions]
  );

  const attachPresetMotions = useCallback(
    (modelId: string, modelKind: "mmd" | "vrm" | "live2d") => {
      const items = presetMotionsByKindRef(modelKind).map((m, index) => ({
        url: m.path,
        name: m.name,
        sortIndex: index,
      }));
      void registerPresetMotions(modelId, items);
    },
    [presetMotionsByKindRef, registerPresetMotions]
  );

  useEffect(() => {
    return () => {
      animationUrlState.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [animationUrlState]);

  useEffect(() => {
    if (interactionMode !== "placement") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInteractionMode("orbit");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [interactionMode]);

  const handlePresetSelected = useCallback(
    (file: ModelFile) => {
      clearAnimationUrls();
      loadModelFromPath(file.path, {
        name: file.name,
        onLoaded: (modelId, modelKind) => {
          attachPresetMotions(modelId, modelKind);
        },
      });
    },
    [attachPresetMotions, clearAnimationUrls, loadModelFromPath]
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
        onLoaded: (modelId, modelKind) => {
          attachPresetMotions(modelId, modelKind);
          if (animationUrls.length > 0) {
            loadAnimation(animationKind, animationUrls, modelId);
          }
        },
      });
    },
    [attachPresetMotions, clearAnimationUrls, loadAnimation, loadModel]
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
          interactionMode={interactionMode}
          viewerSettings={viewerSettings}
        />
      </div>
      <FloatingWindowOverlay
        presetModels={presetModels}
        texturePresets={texturePresets}
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
        interactionMode={interactionMode}
        onInteractionModeChange={setInteractionMode}
        viewerSettings={viewerSettings}
        onViewerSettingsChange={setViewerSettings}
        onRenderScaleChange={setModelRenderScale}
        onDisplayScaleChange={setModelDisplayScale}
      />
    </div>
  );
}
