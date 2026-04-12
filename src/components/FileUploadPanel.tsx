"use client";

import { useCallback, useRef, useState } from "react";
import {
  defaultViewerSettings,
  type ViewerSettings,
} from "@/lib/viewer-settings";
import type { ModelKind } from "@/lib/file-map";
import type { LoadedModel } from "@/hooks/useModelLoader";
import {
  createDirectionalLight,
  type SceneLight,
} from "@/lib/scene-lights";

export interface ModelFile {
  name: string;
  path: string;
}

export interface ModelEntry {
  folder: string;
  files: ModelFile[];
}

type NumericViewerSettingKey = Exclude<keyof ViewerSettings, "physicsEnabled">;

interface FileUploadPanelProps {
  presetModels: ModelEntry[];
  onPresetSelected: (file: ModelFile) => void;
  onModelFolderSelected: (files: FileList) => void;
  onAnimationFilesSelected: (files: FileList) => void;
  loadedModels: LoadedModel[];
  activeModelId: string | null;
  onActiveModelChange: (modelId: string) => void;
  onRemoveModel: (modelId: string) => void;
  loading: boolean;
  error: string | null;
  modelName: string | null;
  modelKind: ModelKind | null;
  animationLoaded: boolean;
  lights: SceneLight[];
  activeLightId: string | null;
  onActiveLightChange: (lightId: string | null) => void;
  onLightsChange: React.Dispatch<React.SetStateAction<SceneLight[]>>;
  freeCameraEnabled: boolean;
  onFreeCameraEnabledChange: (enabled: boolean) => void;
  viewerSettings: ViewerSettings;
  onViewerSettingsChange: React.Dispatch<React.SetStateAction<ViewerSettings>>;
}

export default function FileUploadPanel({
  presetModels,
  onPresetSelected,
  onModelFolderSelected,
  onAnimationFilesSelected,
  loadedModels,
  activeModelId,
  onActiveModelChange,
  onRemoveModel,
  loading,
  error,
  modelName,
  modelKind,
  animationLoaded,
  lights,
  activeLightId,
  onActiveLightChange,
  onLightsChange,
  freeCameraEnabled,
  onFreeCameraEnabledChange,
  viewerSettings,
  onViewerSettingsChange,
}: FileUploadPanelProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const animationInputRef = useRef<HTMLInputElement>(null);
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

  const handleAnimationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        onAnimationFilesSelected(e.target.files);
      }
    },
    [onAnimationFilesSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const hasModel = Array.from(e.dataTransfer.files).some((f) =>
          /\.(pmx|pmd|vrm)$/i.test(f.name)
        );
        if (hasModel) {
          onModelFolderSelected(e.dataTransfer.files);
        } else {
          const hasAnimation = Array.from(e.dataTransfer.files).some((f) =>
            /\.(vmd|vrma)$/i.test(f.name)
          );
          if (hasAnimation) {
            onAnimationFilesSelected(e.dataTransfer.files);
          }
        }
      }
    },
    [onAnimationFilesSelected, onModelFolderSelected]
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
    key: NumericViewerSettingKey;
    label: string;
    min: number;
    max: number;
    step: number;
    disabled?: boolean;
  }> = [
    {
      key: "ambientLightIntensity",
      label: "Ambient Light",
      min: 0,
      max: 2.0,
      step: 0.05,
    },
    {
      key: "hemisphereLightIntensity",
      label: "Hemisphere Light",
      min: 0,
      max: 2.0,
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
    {
      key: "gravityX",
      label: "Gravity X",
      min: -100,
      max: 100,
      step: 1,
      disabled: modelKind !== "mmd" || !viewerSettings.physicsEnabled,
    },
    {
      key: "gravityY",
      label: "Gravity Y",
      min: -200,
      max: 50,
      step: 1,
      disabled: modelKind !== "mmd" || !viewerSettings.physicsEnabled,
    },
    {
      key: "gravityZ",
      label: "Gravity Z",
      min: -100,
      max: 100,
      step: 1,
      disabled: modelKind !== "mmd" || !viewerSettings.physicsEnabled,
    },
  ];
  const activeLight = lights.find((light) => light.id === activeLightId) ?? null;

  return (
    <div className="w-80 min-w-80 h-full bg-gray-900 text-gray-100 p-4 flex flex-col gap-4 overflow-y-auto border-r border-gray-700">
      <h1 className="text-lg font-bold">MMD / VRM Viewer</h1>

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

      {loadedModels.length > 0 && (
        <div className="border-t border-gray-700 pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-400">読み込み済みモデル</p>
            <span className="text-xs text-gray-500">{loadedModels.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {loadedModels.map((loadedModel) => {
              const isActive = loadedModel.id === activeModelId;

              return (
                <div
                  key={loadedModel.id}
                  className={`rounded border px-3 py-2 transition-colors ${
                    isActive
                      ? "border-blue-500 bg-blue-950/40"
                      : "border-gray-700 bg-gray-800/40"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onActiveModelChange(loadedModel.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-gray-100">
                        {loadedModel.name}
                      </span>
                      <span className="ml-auto text-[10px] uppercase text-gray-400">
                        {loadedModel.kind}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {loadedModel.animationLoaded
                        ? "アニメーションあり"
                        : "アニメーションなし"}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveModel(loadedModel.id)}
                    className="mt-2 text-xs text-red-300 hover:text-red-200"
                  >
                    削除
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-t border-gray-700 pt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-gray-400">配置済みライト</p>
          <span className="text-xs text-gray-500">{lights.length}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            const lightNumber = lights.length + 1;
            const nextLight = createDirectionalLight({
              name: `Directional Light ${lightNumber}`,
            });
            onLightsChange((prev) => [...prev, nextLight]);
            onActiveLightChange(nextLight.id);
          }}
          className="w-full rounded bg-amber-700/80 px-3 py-2 text-sm text-amber-50 hover:bg-amber-600 transition-colors"
        >
          方向ライトを追加
        </button>
        <div className="mt-2 flex flex-col gap-2">
          {lights.map((light) => {
            const isActive = light.id === activeLightId;

            return (
              <div
                key={light.id}
                className={`rounded border px-3 py-2 transition-colors ${
                  isActive
                    ? "border-amber-400 bg-amber-950/30"
                    : "border-gray-700 bg-gray-800/40"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onActiveLightChange(light.id)}
                  className="w-full text-left"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full border border-white/20"
                      style={{ backgroundColor: light.color }}
                    />
                    <span className="truncate text-sm text-gray-100">
                      {light.name}
                    </span>
                    <span className="ml-auto text-[10px] uppercase text-gray-400">
                      {light.type}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    intensity {light.intensity.toFixed(2)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const remainingLights = lights.filter(
                      (currentLight) => currentLight.id !== light.id
                    );
                    onLightsChange(remainingLights);
                    if (activeLightId === light.id) {
                      onActiveLightChange(remainingLights.at(-1)?.id ?? null);
                    }
                  }}
                  className="mt-2 text-xs text-red-300 hover:text-red-200"
                  disabled={lights.length === 1}
                >
                  削除
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {activeLight && (
        <div className="border-t border-gray-700 pt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-400">ライト設定</p>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-300">Color</span>
            <input
              type="color"
              value={activeLight.color}
              onChange={(e) => {
                const color = e.currentTarget.value;
                onLightsChange((prev) =>
                  prev.map((light) =>
                    light.id === activeLight.id ? { ...light, color } : light
                  )
                );
              }}
              className="h-10 w-full rounded bg-gray-800"
            />
          </label>
          <label className="mt-3 flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-300">Intensity</span>
              <span className="text-gray-500">
                {activeLight.intensity.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={4}
              step={0.05}
              value={activeLight.intensity}
              onChange={(e) => {
                const intensity = Number(e.currentTarget.value);
                onLightsChange((prev) =>
                  prev.map((light) =>
                    light.id === activeLight.id
                      ? { ...light, intensity }
                      : light
                  )
                );
              }}
              className="accent-amber-400"
            />
          </label>
          <label className="mt-3 flex items-center justify-between rounded bg-gray-800/50 px-3 py-2 text-sm">
            <span className="text-gray-300">Visible</span>
            <input
              type="checkbox"
              checked={activeLight.visible}
              onChange={(e) => {
                const visible = e.currentTarget.checked;
                onLightsChange((prev) =>
                  prev.map((light) =>
                    light.id === activeLight.id ? { ...light, visible } : light
                  )
                );
              }}
              className="h-4 w-4 accent-amber-400"
            />
          </label>
          <p className="mt-3 text-xs text-gray-500">
            通常カメラモードで、黄色の球をドラッグすると位置、青い球をドラッグすると向きが変わります
          </p>
        </div>
      )}

      <div className="border-t border-gray-700 pt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-gray-400">環境ライト</p>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-300">Hemisphere Sky</span>
            <input
              type="color"
              value={viewerSettings.hemisphereLightSkyColor}
              onChange={(e) =>
                onViewerSettingsChange((prev) => ({
                  ...prev,
                  hemisphereLightSkyColor: e.currentTarget.value,
                }))
              }
              className="h-10 w-full rounded bg-gray-800"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-300">Hemisphere Ground</span>
            <input
              type="color"
              value={viewerSettings.hemisphereLightGroundColor}
              onChange={(e) =>
                onViewerSettingsChange((prev) => ({
                  ...prev,
                  hemisphereLightGroundColor: e.currentTarget.value,
                }))
              }
              className="h-10 w-full rounded bg-gray-800"
            />
          </label>
        </div>
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
          .pmx / .pmd / .vrm + 関連ファイルを含むフォルダ
        </p>
      </div>

      {/* Animation Upload */}
      <div
        className="border-2 border-dashed border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:border-green-400 hover:bg-gray-800 transition-colors"
        onClick={() => animationInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <input
          ref={animationInputRef}
          type="file"
          className="hidden"
          accept=".vmd,.vrma"
          multiple
          onChange={handleAnimationChange}
        />
        <div className="text-3xl mb-2">🎬</div>
        <p className="text-sm font-medium">
          アニメーションファイルを選択
        </p>
        <p className="text-xs text-gray-400 mt-1">
          .vmd / .vrma ファイル
        </p>
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
            <span className="text-gray-400">アニメーション: </span>
            <span className="text-green-400">再生中</span>
          </div>
        )}

        {modelName && (
          <p className="text-xs text-gray-500">
            アニメーションは現在選択中のモデルに適用されます
          </p>
        )}

        {!modelName && !loading && (
          <p className="text-xs text-gray-500">
            PMX/PMD/VRM モデルを含むフォルダを選択してください
          </p>
        )}
      </div>

      <div className="border-t border-gray-700 pt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-gray-400">カメラ操作</p>
          <button
            type="button"
            onClick={() => onFreeCameraEnabledChange(!freeCameraEnabled)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              freeCameraEnabled
                ? "bg-cyan-700 hover:bg-cyan-600 text-white"
                : "bg-gray-800 hover:bg-gray-700 text-gray-200"
            }`}
          >
            {freeCameraEnabled ? "フリーカメラ ON" : "通常カメラ"}
          </button>
        </div>
        <div className="text-xs text-gray-500">
          {freeCameraEnabled ? (
            <>
              <p>W/A/S/D: 前後左右移動</p>
              <p className="mt-1">Q / E: 上下移動</p>
              <p className="mt-1">左ドラッグ: 視線移動</p>
              <p className="mt-1">Shift: 加速</p>
            </>
          ) : (
            <>
              <p>ドラッグ: 視点移動</p>
              <p className="mt-1">Shift + ドラッグ: 選択モデルを移動</p>
            </>
          )}
        </div>
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
          <label className="flex items-center justify-between rounded bg-gray-800/50 px-3 py-2 text-sm">
            <span className="text-gray-300">Physics (MMD)</span>
            <input
              type="checkbox"
              checked={viewerSettings.physicsEnabled}
              disabled={modelKind !== "mmd"}
              onChange={(e) => {
                const { checked } = e.currentTarget;
                onViewerSettingsChange((prev) => ({
                  ...prev,
                  physicsEnabled: checked,
                }));
              }}
              className="h-4 w-4 accent-blue-400 disabled:opacity-40"
            />
          </label>
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
                disabled={control.disabled}
                onChange={(e) =>
                  handleViewerSettingChange(
                    control.key,
                    Number(e.currentTarget.value)
                  )
                }
                className="accent-blue-400 disabled:opacity-40"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-700 pt-4 text-xs text-gray-500">
        <p>3Dビュー操作</p>
        <p className="mt-1">クリック: モデル選択</p>
        <p className="mt-1">通常カメラ: ドラッグで視点移動</p>
        <p className="mt-1">通常カメラ: Shift + ドラッグで選択モデル移動</p>
        <p className="mt-1">通常カメラ: ライト本体/target ハンドルをドラッグ</p>
        <p className="mt-1">フリーカメラ: W/A/S/D + 左ドラッグ</p>
      </div>
    </div>
  );
}
