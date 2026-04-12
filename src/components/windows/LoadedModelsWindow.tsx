"use client";

import type { LoadedModel } from "@/hooks/useModelLoader";

interface LoadedModelsWindowProps {
  loadedModels: LoadedModel[];
  activeModelId: string | null;
  onActiveModelChange: (modelId: string) => void;
  onRemoveModel: (modelId: string) => void;
  modelName: string | null;
  animationLoaded: boolean;
}

export default function LoadedModelsWindow({
  loadedModels,
  activeModelId,
  onActiveModelChange,
  onRemoveModel,
  modelName,
  animationLoaded,
}: LoadedModelsWindowProps) {
  if (loadedModels.length === 0) {
    return (
      <p className="text-xs text-gray-500">モデルが読み込まれていません</p>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500">{loadedModels.length}</span>
      </div>
      {modelName && (
        <div className="mb-3 rounded bg-gray-800/40 px-3 py-2 text-xs">
          <div>
            <span className="text-gray-400">現在選択中: </span>
            <span className="text-green-400">{modelName}</span>
          </div>
          <div className="mt-1">
            <span className="text-gray-400">アニメーション: </span>
            <span className="text-green-400">
              {animationLoaded ? "再生中" : "なし"}
            </span>
          </div>
          <p className="mt-2 text-gray-500">
            アニメーションは現在選択中のモデルに適用されます
          </p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {loadedModels.map((loadedModel) => {
          const isActive = loadedModel.id === activeModelId;

          return (
            <div
              key={loadedModel.id}
              onClick={() => onActiveModelChange(loadedModel.id)}
              className={`rounded border px-3 py-2 transition-colors ${
                isActive
                  ? "border-blue-500 bg-blue-950/40"
                  : "border-gray-700 bg-gray-800/40"
              } cursor-pointer`}
            >
              <div className="w-full text-left">
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
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveModel(loadedModel.id);
                }}
                className="mt-2 text-xs text-red-300 hover:text-red-200"
              >
                削除
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
