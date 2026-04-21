"use client";

import { useEffect, useMemo, useState } from "react";
import ScrollArea from "@/components/ScrollArea";
import type { CharacterModel } from "@/hooks/useModelLoader";
import {
  SEMANTIC_EXPRESSION_KEYS,
  type ExpressionCategory,
  type SemanticExpressionKey,
} from "@/lib/character/types";

interface ExpressionControlWindowProps {
  activeModel: CharacterModel | null;
}

const CATEGORY_LABEL: Record<ExpressionCategory, string> = {
  eye: "目",
  lip: "口",
  brow: "眉",
  other: "その他",
};

const CATEGORY_ORDER: readonly ExpressionCategory[] = [
  "eye",
  "lip",
  "brow",
  "other",
];

const SEMANTIC_LABEL: Record<SemanticExpressionKey, string> = {
  blink: "blink (両目)",
  blinkLeft: "blink L",
  blinkRight: "blink R",
  aa: "あ (aa)",
  ih: "い (ih)",
  ou: "う (ou)",
  ee: "え (ee)",
  oh: "お (oh)",
};

export default function ExpressionControlWindow({
  activeModel,
}: ExpressionControlWindowProps) {
  const [, setTick] = useState(0);
  const forceUpdate = () => setTick((t) => t + 1);

  // expressionMapping の更新を購読
  useEffect(() => {
    if (!activeModel) return;
    return activeModel.expressionMapping.subscribe(forceUpdate);
  }, [activeModel]);

  const grouped = useMemo(() => {
    if (!activeModel) return null;
    const list = activeModel.expressions.list();
    const map = new Map<ExpressionCategory, typeof list>();
    for (const cat of CATEGORY_ORDER) {
      map.set(cat, []);
    }
    for (const info of list) {
      const arr = map.get(info.category)!;
      (arr as typeof list[number][]).push(info);
    }
    return map;
  }, [activeModel]);

  const isLive2d = activeModel?.kind === "live2d";
  const presetExpressions = activeModel?.presetExpressions?.list() ?? [];

  if (!activeModel) {
    return (
      <p className="text-xs text-gray-500">モデルが選択されていません</p>
    );
  }

  if (
    !grouped ||
    (activeModel.expressions.list().length === 0 && presetExpressions.length === 0)
  ) {
    return (
      <p className="text-xs text-gray-500">
        このモデルには表情データがありません
      </p>
    );
  }

  // 現在マップで使われている (key→name) を逆引きできるように
  const nameToSemantic = new Map<string, SemanticExpressionKey>();
  for (const key of SEMANTIC_EXPRESSION_KEYS) {
    const name = activeModel.expressionMapping[key];
    if (name) nameToSemantic.set(name, key);
  }

  return (
    <div className="text-sm">
      <div className="mb-2 text-xs text-gray-500">
        モデル: <span className="text-gray-200">{activeModel.name}</span>
      </div>
      <ScrollArea
        className="flex flex-col gap-3 overflow-y-auto pr-1"
        style={{ maxHeight: "55vh" }}
      >
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={cat} className="flex flex-col gap-2">
              <div className="text-xs font-semibold text-gray-400">
                {CATEGORY_LABEL[cat]} ({items.length})
              </div>
              <div className="flex flex-col gap-2">
                {items.map((info) => {
                  const value = activeModel.expressions.get(info.name);
                  const semanticKey = info.name as SemanticExpressionKey;
                  const assignedKey = isLive2d
                    ? activeModel.expressionMapping[semanticKey] ?? ""
                    : nameToSemantic.get(info.name) ?? "";
                  const mappingOptions = isLive2d
                    ? activeModel.expressionMapping.getOptions?.(semanticKey) ?? []
                    : [];
                  return (
                    <div
                      key={info.name}
                      className="rounded bg-gray-800/40 px-2 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="flex-1 truncate text-xs text-gray-200"
                          title={info.name}
                        >
                          {info.name}
                        </span>
                        <span className="w-10 text-right text-[10px] text-gray-500">
                          {value.toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={value}
                        onChange={(e) => {
                          activeModel.expressions.set(
                            info.name,
                            Number(e.currentTarget.value)
                          );
                          forceUpdate();
                        }}
                        className="mt-1 w-full accent-blue-400"
                      />
                      <div className="mt-1 flex items-center gap-1 text-[10px]">
                        <span className="text-gray-500">割当:</span>
                        {isLive2d ? (
                          <select
                            value={assignedKey}
                            onChange={(e) => {
                              const next = e.currentTarget.value || null;
                              activeModel.expressionMapping.set(semanticKey, next);
                              forceUpdate();
                            }}
                            className="rounded bg-gray-900 px-1 py-0.5 text-gray-200"
                          >
                            <option value="">--</option>
                            {mappingOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <select
                            value={assignedKey}
                            onChange={(e) => {
                              const next = e.currentTarget.value as
                                | SemanticExpressionKey
                                | "";
                              if (next) {
                                activeModel.expressionMapping.set(
                                  next,
                                  info.name
                                );
                                // 同じ表情が他キーに割当されていれば解除
                                for (const k of SEMANTIC_EXPRESSION_KEYS) {
                                  if (
                                    k !== next &&
                                    activeModel.expressionMapping[k] ===
                                      info.name
                                  ) {
                                    activeModel.expressionMapping.set(k, null);
                                  }
                                }
                              } else if (assignedKey) {
                                activeModel.expressionMapping.set(
                                  assignedKey as SemanticExpressionKey,
                                  null
                                );
                              }
                            }}
                            className="rounded bg-gray-900 px-1 py-0.5 text-gray-200"
                          >
                            <option value="">--</option>
                            {SEMANTIC_EXPRESSION_KEYS.map((key) => (
                              <option key={key} value={key}>
                                {SEMANTIC_LABEL[key]}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </ScrollArea>
      {isLive2d && presetExpressions.length > 0 ? (
        <div className="mt-3 rounded bg-gray-900/50 p-2">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-gray-300">
              Live2D プリセット ({presetExpressions.length})
            </span>
            <span className="text-gray-500">
              現在: {activeModel.presetExpressions?.getActive() ?? "--"}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {presetExpressions.map((preset) => {
              const isActive =
                activeModel.presetExpressions?.getActive() === preset.name;
              return (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => {
                    if (isActive) {
                      activeModel.presetExpressions?.clear();
                    } else {
                      activeModel.presetExpressions?.apply(preset.name);
                    }
                    forceUpdate();
                  }}
                  className={`w-full rounded px-2 py-1 text-left text-xs transition-colors ${
                    isActive
                      ? "bg-blue-500 text-white"
                      : "bg-gray-800 text-gray-200 hover:bg-gray-700"
                  }`}
                >
                  {preset.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => {
          activeModel.expressions.reset();
          forceUpdate();
        }}
        className="mt-3 w-full rounded bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors"
      >
        全てリセット
      </button>
    </div>
  );
}
