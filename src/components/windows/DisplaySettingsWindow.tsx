"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultViewerSettings,
  type ViewerSettings,
} from "@/lib/viewer-settings";
import type { CharacterModel, PhysicsCapability } from "@/lib/character/types";

type NumericViewerSettingKey = Exclude<
  keyof ViewerSettings,
  | "physicsEnabled"
  | "hemisphereLightSkyColor"
  | "hemisphereLightGroundColor"
  | "live2dCanvasScale"
  | "live2dPlaneScale"
>;

interface DisplaySettingsWindowProps {
  viewerSettings: ViewerSettings;
  onViewerSettingsChange: React.Dispatch<React.SetStateAction<ViewerSettings>>;
  /** 現在アクティブなモデルの物理カテゴリ。null はモデル未選択 */
  physicsCapability: PhysicsCapability | null;
  /** 現在アクティブなモデル */
  activeModel: CharacterModel | null;
  onRenderScaleChange: (modelId: string, scale: number) => void;
  onDisplayScaleChange: (modelId: string, scale: number) => void;
}

/**
 * モデルの effectiveRenderScale をポーリングして返すフック。
 * useFrame は Canvas 内でしか使えないため、DOM 側では setInterval で監視する。
 */
function readEffectiveRenderScale(model: CharacterModel | null): number {
  if (!model || model.kind !== "live2d") {
    return 0;
  }

  return model.effectiveRenderScale ?? model.renderScale ?? 0;
}

function useEffectiveRenderScale(model: CharacterModel | null): number {
  const [value, setValue] = useState(() => readEffectiveRenderScale(model));
  const modelRef = useRef(model);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    const syncTimer = window.setTimeout(() => {
      setValue(readEffectiveRenderScale(model));
    }, 0);

    const id = setInterval(() => {
      const m = modelRef.current;
      const next = readEffectiveRenderScale(m);
      setValue((prev) => (Math.abs(prev - next) > 0.001 ? next : prev));
    }, 200);

    return () => {
      window.clearTimeout(syncTimer);
      clearInterval(id);
    };
  }, [model]);

  return value;
}

export default function DisplaySettingsWindow({
  viewerSettings,
  onViewerSettingsChange,
  physicsCapability,
  activeModel,
  onRenderScaleChange,
  onDisplayScaleChange,
}: DisplaySettingsWindowProps) {
  // 重力は両方のモデル種別で適用可能だが、無効時は常に disable
  const gravityDisabled = !viewerSettings.physicsEnabled;
  const physicsToggleDisabled = physicsCapability === null;
  const effectiveScale = useEffectiveRenderScale(activeModel);

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
      disabled: gravityDisabled,
    },
    {
      key: "gravityY",
      label: "Gravity Y",
      min: -200,
      max: 50,
      step: 1,
      disabled: gravityDisabled,
    },
    {
      key: "gravityZ",
      label: "Gravity Z",
      min: -100,
      max: 100,
      step: 1,
      disabled: gravityDisabled,
    },
  ];

  const isLive2d = activeModel?.kind === "live2d";

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
          <span className="text-gray-300">
            Physics
            {physicsCapability === "spring-bone" && (
              <span className="ml-1 text-[10px] text-gray-500">
                (VRM SpringBone)
              </span>
            )}
            {physicsCapability === "full" && (
              <span className="ml-1 text-[10px] text-gray-500">
                (MMD Rigid Body)
              </span>
            )}
          </span>
          <input
            type="checkbox"
            checked={viewerSettings.physicsEnabled}
            disabled={physicsToggleDisabled}
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

        {/* Per-model Live2D settings */}
        {isLive2d && activeModel && (
          <>
            <div className="mt-2 mb-1 text-xs text-gray-400 border-t border-gray-700 pt-3">
              Live2D — {activeModel.name}
            </div>
            <label className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300">Live2D 解像度 (ベース)</span>
                <span className="text-gray-500">
                  {(activeModel.renderScale ?? 0.75).toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.4}
                max={3.0}
                step={0.05}
                value={activeModel.renderScale ?? 0.75}
                onChange={(e) =>
                  onRenderScaleChange(
                    activeModel.id,
                    Number(e.currentTarget.value)
                  )
                }
                className="accent-blue-400"
              />
              <div className="flex items-center justify-between text-[10px] text-gray-500">
                <span>
                  カメラ距離で自動調整されます。
                </span>
                <span>
                  実効: {effectiveScale.toFixed(2)}
                </span>
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300">Live2D サイズ</span>
                <span className="text-gray-500">
                  {(activeModel.planeScale ?? 1.17).toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.4}
                max={2.5}
                step={0.01}
                value={activeModel.planeScale ?? 1.17}
                onChange={(e) =>
                  onDisplayScaleChange(
                    activeModel.id,
                    Number(e.currentTarget.value)
                  )
                }
                className="accent-blue-400"
              />
              <span className="text-[10px] text-gray-500">
                Live2D 板ポリの表示サイズ。VRM / PMX と見た目の大きさを合わせる調整です。
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300">Live2D 描画 FPS</span>
                <span className="text-gray-500">
                  {viewerSettings.live2dRenderFps.toFixed(0)}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={60}
                step={1}
                value={viewerSettings.live2dRenderFps}
                onChange={(e) =>
                  handleViewerSettingChange(
                    "live2dRenderFps",
                    Number(e.currentTarget.value)
                  )
                }
                className="accent-blue-400"
              />
              <span className="text-[10px] text-gray-500">
                Live2D atlas の再描画頻度。低いほど軽くなります。
              </span>
            </label>
          </>
        )}
      </div>
    </div>
  );
}
