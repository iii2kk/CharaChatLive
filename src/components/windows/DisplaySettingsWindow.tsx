"use client";

import { useCallback } from "react";
import {
  defaultViewerSettings,
  type ViewerSettings,
} from "@/lib/viewer-settings";
import type { ModelKind } from "@/lib/file-map";

type NumericViewerSettingKey = Exclude<
  keyof ViewerSettings,
  "physicsEnabled" | "hemisphereLightSkyColor" | "hemisphereLightGroundColor"
>;

interface DisplaySettingsWindowProps {
  viewerSettings: ViewerSettings;
  onViewerSettingsChange: React.Dispatch<React.SetStateAction<ViewerSettings>>;
  modelKind: ModelKind | null;
}

export default function DisplaySettingsWindow({
  viewerSettings,
  onViewerSettingsChange,
  modelKind,
}: DisplaySettingsWindowProps) {
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

  return (
    <div>
      <div className="flex items-center justify-end mb-3">
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
  );
}
