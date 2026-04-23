"use client";

import { useEffect, useState } from "react";
import ScrollArea from "@/components/ScrollArea";
import type { CharacterModel } from "@/hooks/useModelLoader";
import type {
  MotionHandle,
  MotionInfo,
  MotionMappingKey,
} from "@/lib/character/types";

interface MotionControlWindowProps {
  activeModel: CharacterModel | null;
}

const MOTION_MAPPING_KEYS: readonly MotionMappingKey[] = ["idle", "walk", "run"];

const MOTION_MAPPING_LABEL: Record<MotionMappingKey, string> = {
  idle: "idle",
  walk: "walk",
  run: "run",
};

function formatDuration(sec: number | null): string {
  if (sec === null) return "--";
  return `${sec.toFixed(2)}s`;
}

export default function MotionControlWindow({
  activeModel,
}: MotionControlWindowProps) {
  const [, setTick] = useState(0);
  const forceUpdate = () => setTick((t) => t + 1);

  // motionMapping の更新を購読
  useEffect(() => {
    if (!activeModel) return;
    return activeModel.motionMapping.subscribe(forceUpdate);
  }, [activeModel]);

  useEffect(() => {
    if (!activeModel) return;
    const unsubscribers = [
      activeModel.animation.on("start", forceUpdate),
      activeModel.animation.on("end", forceUpdate),
      activeModel.animation.on("loop", forceUpdate),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [activeModel]);

  const entries: Array<{ handle: MotionHandle; info: MotionInfo }> =
    activeModel
      ? activeModel.animation.library.list().map((handle) => ({
          handle,
          info: activeModel.animation.library.getInfo(handle),
        }))
      : [];
  const sortedEntries =
    activeModel?.kind === "live2d"
      ? entries
      : [...entries].sort((a, b) => {
          const aIndex = a.info.sortIndex ?? Number.MAX_SAFE_INTEGER;
          const bIndex = b.info.sortIndex ?? Number.MAX_SAFE_INTEGER;
          if (aIndex !== bIndex) return aIndex - bIndex;
          return a.info.name.localeCompare(b.info.name);
        });

  const capabilities = activeModel?.animation.capabilities;
  const activeBase = activeModel?.animation.getActive("base") ?? null;
  const activeOverlay = activeModel?.animation.getActive("overlay") ?? null;

  if (!activeModel) {
    return (
      <p className="text-xs text-gray-500">モデルが選択されていません</p>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-xs text-gray-500">
        <p className="mb-1">利用可能なモーションがありません。</p>
        {activeModel.kind !== "live2d" ? (
          <p>ファイル読み込みからモーションファイルを追加してください。</p>
        ) : null}
      </div>
    );
  }

  const supportsOverlay = capabilities?.layers.includes("overlay") ?? false;

  return (
    <div className="text-sm">
      <div className="mb-2 text-xs text-gray-500">
        モデル: <span className="text-gray-200">{activeModel.name}</span>
      </div>

      <div className="mb-2 rounded bg-gray-900/50 p-2 text-[10px] text-gray-400">
        <div>
          base:{" "}
          <span className="text-gray-200">
            {activeBase ? activeBase.name : "--"}
          </span>
        </div>
        {supportsOverlay ? (
          <div>
            overlay:{" "}
            <span className="text-gray-200">
              {activeOverlay ? activeOverlay.name : "--"}
            </span>
          </div>
        ) : null}
      </div>

      <ScrollArea
        className="flex flex-col gap-2 overflow-y-auto pr-1"
        style={{ maxHeight: "55vh" }}
      >
        {sortedEntries.map(({ handle, info }) => {
          const isActiveBase = activeBase?.id === handle.id;
          const isActiveOverlay = activeOverlay?.id === handle.id;
          const assignedKey =
            MOTION_MAPPING_KEYS.find(
              (key) => activeModel.motionMapping[key] === handle.id
            ) ?? "";
          return (
            <div
              key={handle.id}
              className="rounded bg-gray-800/40 px-2 py-1.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className="flex-1 truncate text-xs text-gray-200"
                  title={info.name}
                >
                  {info.name}
                </span>
                <span className="w-14 text-right text-[10px] text-gray-500">
                  {formatDuration(info.durationSec)}
                </span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    if (isActiveBase) {
                      activeModel.animation.stopLayer("base");
                      forceUpdate();
                      return;
                    }
                    void activeModel.animation
                      .play(handle, "base", { loop: true })
                      .then(forceUpdate);
                  }}
                  className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                    isActiveBase
                      ? "bg-blue-500 text-white"
                      : "bg-gray-800 text-gray-200 hover:bg-gray-700"
                  }`}
                >
                  ▶ base
                </button>
                {supportsOverlay ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (isActiveOverlay) {
                        activeModel.animation.stopLayer("overlay");
                        forceUpdate();
                        return;
                      }
                      void activeModel.animation
                        .play(handle, "overlay", { loop: false })
                        .then(forceUpdate);
                    }}
                    className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                      isActiveOverlay
                        ? "bg-purple-500 text-white"
                        : "bg-gray-800 text-gray-200 hover:bg-gray-700"
                    }`}
                  >
                    ▶ overlay
                  </button>
                ) : null}
                <div className="ml-auto flex items-center gap-1 text-[10px]">
                  <span className="text-gray-500">割当:</span>
                  <select
                    value={assignedKey}
                    onChange={(e) => {
                      const next = e.currentTarget.value as MotionMappingKey | "";
                      if (next) {
                        activeModel.motionMapping.set(next, handle.id);
                        for (const key of MOTION_MAPPING_KEYS) {
                          if (
                            key !== next &&
                            activeModel.motionMapping[key] === handle.id
                          ) {
                            activeModel.motionMapping.set(key, null);
                          }
                        }
                      } else if (assignedKey) {
                        activeModel.motionMapping.set(
                          assignedKey as MotionMappingKey,
                          null
                        );
                      }
                      forceUpdate();
                    }}
                    className="rounded bg-gray-900 px-1 py-0.5 text-gray-200"
                  >
                    <option value="">--</option>
                    {MOTION_MAPPING_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {MOTION_MAPPING_LABEL[key]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          );
        })}
      </ScrollArea>

      {capabilities ? (
        <div className="mt-3 rounded bg-gray-900/40 p-2 text-[10px] text-gray-500">
          <div>
            レイヤー: {capabilities.layers.join(", ")}{" "}
            {capabilities.crossfade ? "· crossfade" : ""}{" "}
            {capabilities.seek ? "· seek" : ""}
          </div>
        </div>
      ) : null}
    </div>
  );
}
