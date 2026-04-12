"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import FileUploadPanel from "@/components/FileUploadPanel";
import type { ModelEntry, ModelFile } from "@/components/FileUploadPanel";
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

const MMDViewer = dynamic(() => import("@/components/MMDViewer"), {
  ssr: false,
});

export default function Home() {
  const [viewerSettings, setViewerSettings] =
    useState<ViewerSettings>(defaultViewerSettings);
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

      const animationKind: AnimationKind =
        modelEntry.kind === "vrm" ? "vrma" : "vmd";
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

  return (
    <div className="flex h-full w-full">
      <FileUploadPanel
        presetModels={presetModels}
        onPresetSelected={handlePresetSelected}
        onModelFolderSelected={handleModelFolderSelected}
        onAnimationFilesSelected={handleAnimationFilesSelected}
        loadedModels={models}
        activeModelId={activeModelId}
        onActiveModelChange={setActiveModelId}
        onRemoveModel={removeModel}
        loading={loading}
        error={error}
        modelName={activeModel?.name ?? null}
        modelKind={activeModel?.kind ?? null}
        animationLoaded={activeModel?.animationLoaded ?? false}
        viewerSettings={viewerSettings}
        onViewerSettingsChange={setViewerSettings}
      />
      <div className="flex-1 h-full">
        <MMDViewer
          models={models}
          activeModel={activeModel}
          activeModelId={activeModelId}
          onActiveModelChange={setActiveModelId}
          viewerSettings={viewerSettings}
        />
      </div>
    </div>
  );
}
