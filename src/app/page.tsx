"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import FileUploadPanel from "@/components/FileUploadPanel";
import type { ModelEntry, ModelFile } from "@/components/FileUploadPanel";
import { useMMDLoader } from "@/hooks/useMMDLoader";
import {
  defaultViewerSettings,
  type ViewerSettings,
} from "@/lib/viewer-settings";
import {
  buildFileMap,
  findModelFile,
  findModelFileName,
  findVmdFiles,
  revokeFileMap,
  type FileMap,
} from "@/lib/file-map";

const MMDViewer = dynamic(() => import("@/components/MMDViewer"), {
  ssr: false,
});

export default function Home() {
  const {
    mesh,
    helper,
    loading,
    error,
    loadModel,
    loadModelFromPath,
    loadAnimation,
  } = useMMDLoader();
  const [modelName, setModelName] = useState<string | null>(null);
  const [animationLoaded, setAnimationLoaded] = useState(false);
  const [fileMapState, setFileMapState] = useState<FileMap | null>(null);
  const [presetModels, setPresetModels] = useState<ModelEntry[]>([]);
  const [viewerSettings, setViewerSettings] =
    useState<ViewerSettings>(defaultViewerSettings);

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data: ModelEntry[]) => setPresetModels(data))
      .catch(() => {});
  }, []);

  const handlePresetSelected = useCallback(
    (file: ModelFile) => {
      if (fileMapState) {
        revokeFileMap(fileMapState);
        setFileMapState(null);
      }
      setModelName(file.name);
      setAnimationLoaded(false);
      loadModelFromPath(file.path);
    },
    [fileMapState, loadModelFromPath]
  );

  const handleModelFolderSelected = useCallback(
    (files: FileList) => {
      if (fileMapState) {
        revokeFileMap(fileMapState);
      }

      const fileMap = buildFileMap(files);
      setFileMapState(fileMap);

      const modelUrl = findModelFile(fileMap);
      const name = findModelFileName(fileMap);

      if (!modelUrl) {
        return;
      }

      setModelName(name);
      setAnimationLoaded(false);

      const vmdUrls = findVmdFiles(fileMap);

      loadModel(modelUrl, fileMap, () => {
        if (vmdUrls.length > 0) {
          loadAnimation(vmdUrls);
          setAnimationLoaded(true);
        }
      });
    },
    [fileMapState, loadModel, loadAnimation]
  );

  const handleVmdFilesSelected = useCallback(
    (files: FileList) => {
      const urls = Array.from(files).map((f) => URL.createObjectURL(f));
      if (urls.length > 0) {
        loadAnimation(urls);
        setAnimationLoaded(true);
      }
    },
    [loadAnimation]
  );

  return (
    <div className="flex h-full w-full">
      <FileUploadPanel
        presetModels={presetModels}
        onPresetSelected={handlePresetSelected}
        onModelFolderSelected={handleModelFolderSelected}
        onVmdFilesSelected={handleVmdFilesSelected}
        loading={loading}
        error={error}
        modelName={modelName}
        animationLoaded={animationLoaded}
        viewerSettings={viewerSettings}
        onViewerSettingsChange={setViewerSettings}
      />
      <div className="flex-1 h-full">
        <MMDViewer
          mesh={mesh}
          helper={helper}
          viewerSettings={viewerSettings}
        />
      </div>
    </div>
  );
}
