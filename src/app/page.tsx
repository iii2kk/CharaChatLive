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
  type FileMap,
} from "@/lib/file-map";

const MMDViewer = dynamic(() => import("@/components/MMDViewer"), {
  ssr: false,
});

export default function Home() {
  const [viewerSettings, setViewerSettings] =
    useState<ViewerSettings>(defaultViewerSettings);
  const {
    model,
    helper,
    animationMixer,
    loading,
    error,
    loadModel,
    loadModelFromPath,
    loadAnimation,
  } = useModelLoader(viewerSettings);
  const [modelName, setModelName] = useState<string | null>(null);
  const [animationLoaded, setAnimationLoaded] = useState(false);
  const [fileMapState, setFileMapState] = useState<FileMap | null>(null);
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
      if (fileMapState) {
        revokeFileMap(fileMapState);
      }
      animationUrlState.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [animationUrlState, fileMapState]);

  const handlePresetSelected = useCallback(
    (file: ModelFile) => {
      if (fileMapState) {
        revokeFileMap(fileMapState);
        setFileMapState(null);
      }
      clearAnimationUrls();
      setModelName(file.name);
      setAnimationLoaded(false);
      loadModelFromPath(file.path);
    },
    [clearAnimationUrls, fileMapState, loadModelFromPath]
  );

  const handleModelFolderSelected = useCallback(
    (files: FileList) => {
      if (fileMapState) {
        revokeFileMap(fileMapState);
      }
      clearAnimationUrls();

      const fileMap = buildFileMap(files);
      setFileMapState(fileMap);

      const modelEntry = findModelFileEntry(fileMap);

      if (!modelEntry) {
        return;
      }

      setModelName(modelEntry.name);
      setAnimationLoaded(false);

      const animationKind: AnimationKind =
        modelEntry.kind === "vrm" ? "vrma" : "vmd";
      const animationUrls = findAnimationFiles(fileMap, animationKind);

      loadModel(modelEntry.kind, modelEntry.url, fileMap, () => {
        if (animationUrls.length > 0) {
          loadAnimation(animationKind, animationUrls);
          setAnimationLoaded(true);
        }
      });
    },
    [clearAnimationUrls, fileMapState, loadAnimation, loadModel]
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
        setAnimationLoaded(true);
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
        loading={loading}
        error={error}
        modelName={modelName}
        modelKind={model?.kind ?? null}
        animationLoaded={animationLoaded}
        viewerSettings={viewerSettings}
        onViewerSettingsChange={setViewerSettings}
      />
      <div className="flex-1 h-full">
        <MMDViewer
          object={model?.object ?? null}
          helper={helper}
          animationMixer={animationMixer}
          vrm={model?.vrm ?? null}
          viewerSettings={viewerSettings}
        />
      </div>
    </div>
  );
}
