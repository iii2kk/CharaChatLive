"use client";

import { useCallback } from "react";
import type { ViewerSettings } from "@/lib/viewer-settings";

interface EnvironmentLightWindowProps {
  viewerSettings: ViewerSettings;
  onViewerSettingsChange: React.Dispatch<React.SetStateAction<ViewerSettings>>;
}

export default function EnvironmentLightWindow({
  viewerSettings,
  onViewerSettingsChange,
}: EnvironmentLightWindowProps) {
  const handleChange = useCallback(
    (key: keyof ViewerSettings, value: number | string) => {
      onViewerSettingsChange((prev) => ({
        ...prev,
        [key]: value,
      }));
    },
    [onViewerSettingsChange]
  );

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-300">Ambient Intensity</span>
          <span className="text-gray-500">
            {viewerSettings.ambientLightIntensity.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={viewerSettings.ambientLightIntensity}
          onChange={(e) =>
            handleChange("ambientLightIntensity", Number(e.currentTarget.value))
          }
          className="accent-blue-400"
        />
      </label>
      <label className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-300">Hemisphere Intensity</span>
          <span className="text-gray-500">
            {viewerSettings.hemisphereLightIntensity.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={viewerSettings.hemisphereLightIntensity}
          onChange={(e) =>
            handleChange(
              "hemisphereLightIntensity",
              Number(e.currentTarget.value)
            )
          }
          className="accent-blue-400"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-300">Hemisphere Sky</span>
        <input
          type="color"
          value={viewerSettings.hemisphereLightSkyColor}
          onChange={(e) =>
            handleChange("hemisphereLightSkyColor", e.currentTarget.value)
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
            handleChange("hemisphereLightGroundColor", e.currentTarget.value)
          }
          className="h-10 w-full rounded bg-gray-800"
        />
      </label>
    </div>
  );
}
