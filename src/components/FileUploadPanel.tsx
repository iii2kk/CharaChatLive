"use client";

import { useCallback, useRef, useState } from "react";
import {
  defaultViewerSettings,
  type ViewerSettings,
} from "@/lib/viewer-settings";

export interface ModelFile {
  name: string;
  path: string;
}

export interface ModelEntry {
  folder: string;
  files: ModelFile[];
}

interface FileUploadPanelProps {
  presetModels: ModelEntry[];
  onPresetSelected: (file: ModelFile) => void;
  onModelFolderSelected: (files: FileList) => void;
  onVmdFilesSelected: (files: FileList) => void;
  loading: boolean;
  error: string | null;
  modelName: string | null;
  animationLoaded: boolean;
  viewerSettings: ViewerSettings;
  onViewerSettingsChange: React.Dispatch<React.SetStateAction<ViewerSettings>>;
}

export default function FileUploadPanel({
  presetModels,
  onPresetSelected,
  onModelFolderSelected,
  onVmdFilesSelected,
  loading,
  error,
  modelName,
  animationLoaded,
  viewerSettings,
  onViewerSettingsChange,
}: FileUploadPanelProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const vmdInputRef = useRef<HTMLInputElement>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  const toggleFolder = useCallback((folder: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  }, []);

  const handleFolderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        onModelFolderSelected(e.target.files);
      }
    },
    [onModelFolderSelected]
  );

  const handleVmdChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        onVmdFilesSelected(e.target.files);
      }
    },
    [onVmdFilesSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const hasModel = Array.from(e.dataTransfer.files).some((f) =>
          /\.(pmx|pmd)$/i.test(f.name)
        );
        if (hasModel) {
          onModelFolderSelected(e.dataTransfer.files);
        } else {
          const hasVmd = Array.from(e.dataTransfer.files).some((f) =>
            /\.vmd$/i.test(f.name)
          );
          if (hasVmd) {
            onVmdFilesSelected(e.dataTransfer.files);
          }
        }
      }
    },
    [onModelFolderSelected, onVmdFilesSelected]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleViewerSettingChange = useCallback(
    (key: keyof ViewerSettings, value: number) => {
      onViewerSettingsChange((prev) => ({
        ...prev,
        [key]: value,
      }));
    },
    [onViewerSettingsChange]
  );

  const viewerControls: Array<{
    key: keyof ViewerSettings;
    label: string;
    min: number;
    max: number;
    step: number;
  }> = [
    {
      key: "ambientLightIntensity",
      label: "Ambient Light",
      min: 0,
      max: 2.0,
      step: 0.05,
    },
    {
      key: "directionalLightIntensity",
      label: "Directional Light",
      min: 0,
      max: 2.0,
      step: 0.05,
    },
    {
      key: "hemisphereLightIntensity",
      label: "Hemisphere Light",
      min: 0,
      max: 2,
      step: 0.05,
    },
    {
      key: "diffuseMultiplier",
      label: "材質 Diffuse",
      min: 0.4,
      max: 2.0,
      step: 0.05,
    },
    {
      key: "emissiveMultiplier",
      label: "Ambient -> Emissive",
      min: 0,
      max: 2.0,
      step: 0.05,
    },
  ];

  return (
    <div className="w-80 min-w-80 h-full bg-gray-900 text-gray-100 p-4 flex flex-col gap-4 overflow-y-auto border-r border-gray-700">
      <h1 className="text-lg font-bold">MMD Viewer</h1>

      {/* Preset Models */}
      {presetModels.length > 0 && (
        <div>
          <p className="text-sm text-gray-400 mb-2">プリセットモデル</p>
          <div className="flex flex-col gap-1">
            {presetModels.map((entry) => (
              <div key={entry.folder}>
                {entry.files.length === 1 ? (
                  <button
                    onClick={() => onPresetSelected(entry.files[0])}
                    disabled={loading}
                    className="w-full text-left px-3 py-2 rounded bg-gray-800 hover:bg-gray-700 text-sm transition-colors disabled:opacity-50"
                  >
                    {entry.folder}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => toggleFolder(entry.folder)}
                      className="w-full text-left px-3 py-2 rounded bg-gray-800 hover:bg-gray-700 text-sm transition-colors flex items-center gap-2"
                    >
                      <span className="text-xs text-gray-400">
                        {openFolders.has(entry.folder) ? "▼" : "▶"}
                      </span>
                      {entry.folder}
                      <span className="text-xs text-gray-500 ml-auto">
                        {entry.files.length}
                      </span>
                    </button>
                    {openFolders.has(entry.folder) && (
                      <div className="ml-4 mt-1 flex flex-col gap-1">
                        {entry.files.map((file) => (
                          <button
                            key={file.path}
                            onClick={() => onPresetSelected(file)}
                            disabled={loading}
                            className="w-full text-left px-3 py-1.5 rounded bg-gray-800/60 hover:bg-gray-700 text-xs transition-colors disabled:opacity-50 truncate"
                            title={file.name}
                          >
                            {file.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-gray-700 pt-4">
        <p className="text-sm text-gray-400 mb-2">ファイルから読み込み</p>
      </div>

      {/* Model Folder Upload */}
      <div
        className="border-2 border-dashed border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-gray-800 transition-colors"
        onClick={() => folderInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <input
          ref={folderInputRef}
          type="file"
          className="hidden"
          onChange={handleFolderChange}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />
        <div className="text-3xl mb-2">📁</div>
        <p className="text-sm font-medium">
          モデルフォルダを選択
        </p>
        <p className="text-xs text-gray-400 mt-1">
          .pmx / .pmd + テクスチャを含むフォルダ
        </p>
      </div>

      {/* VMD Upload */}
      <div
        className="border-2 border-dashed border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:border-green-400 hover:bg-gray-800 transition-colors"
        onClick={() => vmdInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <input
          ref={vmdInputRef}
          type="file"
          className="hidden"
          accept=".vmd"
          multiple
          onChange={handleVmdChange}
        />
        <div className="text-3xl mb-2">🎬</div>
        <p className="text-sm font-medium">
          モーションファイルを選択
        </p>
        <p className="text-xs text-gray-400 mt-1">.vmd ファイル (複数可)</p>
      </div>

      {/* Status */}
      <div className="flex flex-col gap-2 mt-2">
        {loading && (
          <div className="flex items-center gap-2 text-blue-400 text-sm">
            <svg
              className="animate-spin h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            読み込み中...
          </div>
        )}

        {error && (
          <div className="text-red-400 text-sm bg-red-900/30 rounded p-2">
            {error}
          </div>
        )}

        {modelName && (
          <div className="text-sm">
            <span className="text-gray-400">モデル: </span>
            <span className="text-green-400">{modelName}</span>
          </div>
        )}

        {animationLoaded && (
          <div className="text-sm">
            <span className="text-gray-400">モーション: </span>
            <span className="text-green-400">再生中</span>
          </div>
        )}

        {!modelName && !loading && (
          <p className="text-xs text-gray-500">
            PMX/PMD モデルを含むフォルダを選択してください
          </p>
        )}
      </div>

      <div className="border-t border-gray-700 pt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-gray-400">表示調整</p>
          <button
            type="button"
            onClick={() => onViewerSettingsChange(defaultViewerSettings)}
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            リセット
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {viewerControls.map((control) => (
            <label key={control.key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300">{control.label}</span>
                <span className="text-gray-500">
                  {viewerSettings[control.key].toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={viewerSettings[control.key]}
                onChange={(e) =>
                  handleViewerSettingChange(
                    control.key,
                    Number(e.currentTarget.value)
                  )
                }
                className="accent-blue-400"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
