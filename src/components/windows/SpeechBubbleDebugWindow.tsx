"use client";

import { useState } from "react";
import type { CharacterModel } from "@/hooks/useModelLoader";

interface SpeechBubbleDebugWindowProps {
  models: CharacterModel[];
  onShow: (modelId: string, text: string, durationMs: number) => void;
  onClear: (modelId: string | null) => void;
}

export default function SpeechBubbleDebugWindow({
  models,
  onShow,
  onClear,
}: SpeechBubbleDebugWindowProps) {
  const [modelId, setModelId] = useState<string>("");
  const [text, setText] = useState("こんにちは。吹き出しの表示テストです。");
  const [durationSec, setDurationSec] = useState(6);
  const effectiveModelId =
    models.some((model) => model.id === modelId) ? modelId : models[0]?.id ?? "";

  if (models.length === 0) {
    return (
      <p className="text-xs text-gray-500">モデルが読み込まれていません</p>
    );
  }

  return (
    <div className="flex w-80 flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1 text-xs text-gray-400">
        モデル
        <select
          value={effectiveModelId}
          onChange={(e) => setModelId(e.currentTarget.value)}
          className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100"
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-gray-400">
        テキスト
        <textarea
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          rows={4}
          className="resize-none rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-gray-400">
        表示秒数
        <input
          type="number"
          min={1}
          max={60}
          value={durationSec}
          onChange={(e) => setDurationSec(Number(e.currentTarget.value))}
          className="w-20 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!effectiveModelId || text.trim().length === 0}
          onClick={() =>
            onShow(effectiveModelId, text.trim(), durationSec * 1000)
          }
          className="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-500 disabled:bg-gray-700 disabled:text-gray-400"
        >
          表示
        </button>
        <button
          type="button"
          disabled={!effectiveModelId}
          onClick={() => onClear(effectiveModelId)}
          className="rounded bg-gray-800 px-3 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          選択をクリア
        </button>
        <button
          type="button"
          onClick={() => onClear(null)}
          className="rounded bg-gray-800 px-3 py-1 text-xs text-gray-200 hover:bg-gray-700"
        >
          全てクリア
        </button>
      </div>
    </div>
  );
}
