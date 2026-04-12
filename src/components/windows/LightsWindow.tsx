"use client";

import ScrollArea from "@/components/ScrollArea";
import {
  createDirectionalLight,
  type SceneLight,
} from "@/lib/scene-lights";

interface LightsWindowProps {
  lights: SceneLight[];
  activeLightId: string | null;
  onActiveLightChange: (lightId: string | null) => void;
  onLightsChange: React.Dispatch<React.SetStateAction<SceneLight[]>>;
}

export default function LightsWindow({
  lights,
  activeLightId,
  onActiveLightChange,
  onLightsChange,
}: LightsWindowProps) {
  const activeLight = lights.find((light) => light.id === activeLightId) ?? null;

  return (
    <div className="flex flex-col">
      {/* Placed Lights */}
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
      <ScrollArea className="mt-2 flex max-h-[28vh] flex-col gap-2 overflow-y-auto">
        {lights.map((light) => {
          const isActive = light.id === activeLightId;

          return (
            <div
              key={light.id}
              onClick={() => onActiveLightChange(light.id)}
              className={`rounded border px-3 py-2 transition-colors ${
                isActive
                  ? "border-amber-400 bg-amber-950/30"
                  : "border-gray-700 bg-gray-800/40"
              } cursor-pointer`}
            >
              <div className="w-full text-left">
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
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
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
      </ScrollArea>

      {/* Light Settings */}
      {activeLight && (
        <div className="border-t border-gray-700 mt-3 pt-3">
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
          <label className="mt-3 flex items-center justify-between rounded bg-gray-800/50 px-3 py-2 text-sm">
            <span className="text-gray-300">Object Visible</span>
            <input
              type="checkbox"
              checked={activeLight.objectVisible}
              onChange={(e) => {
                const objectVisible = e.currentTarget.checked;
                onLightsChange((prev) =>
                  prev.map((light) =>
                    light.id === activeLight.id
                      ? { ...light, objectVisible }
                      : light
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
    </div>
  );
}
