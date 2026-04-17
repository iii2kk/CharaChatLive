"use client";

import {
  INTERACTION_MODE_LABELS,
  type InteractionMode,
} from "@/lib/interaction-mode";

interface InteractionModeWindowProps {
  interactionMode: InteractionMode;
  onInteractionModeChange: (mode: InteractionMode) => void;
  hasActiveModel: boolean;
}

const MODE_BUTTONS: InteractionMode[] = ["orbit", "freeCamera", "placement"];

export default function InteractionModeWindow({
  interactionMode,
  onInteractionModeChange,
  hasActiveModel,
}: InteractionModeWindowProps) {
  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-1 rounded bg-gray-900/70 p-1">
        {MODE_BUTTONS.map((mode) => {
          const active = interactionMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onInteractionModeChange(mode)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                active
                  ? "bg-cyan-700 text-white"
                  : "bg-gray-800 text-gray-200 hover:bg-gray-700"
              }`}
            >
              {INTERACTION_MODE_LABELS[mode]}
            </button>
          );
        })}
      </div>

      <div className="text-xs text-gray-500">
        <p>クリック: モデル選択</p>
        {interactionMode === "freeCamera" ? (
          <>
            <p className="mt-1">W/A/S/D: 前後左右移動</p>
            <p className="mt-1">Q / E: 上下移動</p>
            <p className="mt-1">左ドラッグ: 視線移動</p>
            <p className="mt-1">Shift: 加速</p>
          </>
        ) : interactionMode === "placement" ? (
          <>
            <p className="mt-1">中央ハンドルをドラッグ: 移動</p>
            <p className="mt-1">外周リングをドラッグ: 回転</p>
            <p className="mt-1">Alt + 左ドラッグ: カメラ回転</p>
            <p className="mt-1">Alt + 中ドラッグ: パン</p>
            <p className="mt-1">Alt + ホイール: ズーム</p>
            <p className="mt-1">Esc: 通常カメラに戻る</p>
            {!hasActiveModel ? (
              <p className="mt-2 text-amber-300">
                モデルをクリックして選択してください
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="mt-1">ドラッグ: 視点移動</p>
          </>
        )}
      </div>
    </div>
  );
}
