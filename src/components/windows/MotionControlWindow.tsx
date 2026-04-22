"use client";

import { useEffect, useMemo, useState } from "react";
import ScrollArea from "@/components/ScrollArea";
import type { CharacterModel } from "@/hooks/useModelLoader";
import type { MotionHandle, MotionInfo } from "@/lib/character/types";

interface MotionControlWindowProps {
  activeModel: CharacterModel | null;
}

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

  const entries = useMemo<
    Array<{ handle: MotionHandle; info: MotionInfo }>
  >(() => {
    if (!activeModel) return [];
    const handles = activeModel.animation.library.list();
    return handles.map((handle) => ({
      handle,
      info: activeModel.animation.library.getInfo(handle),
    }));
  }, [activeModel]);

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

  const idleId = activeModel.motionMapping.idle;
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
        {entries.map(({ handle, info }) => {
          const isIdle = idleId === handle.id;
          const isActiveBase = activeBase?.id === handle.id;
          const isActiveOverlay = activeOverlay?.id === handle.id;
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
                <label className="ml-auto flex items-center gap-1 text-[10px] text-gray-400">
                  <input
                    type="radio"
                    name="idle-motion"
                    checked={isIdle}
                    onChange={() => {
                      activeModel.motionMapping.set("idle", handle.id);
                    }}
                    className="accent-blue-400"
                  />
                  idle 割当
                </label>
              </div>
            </div>
          );
        })}
      </ScrollArea>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            activeModel.motionMapping.set("idle", null);
          }}
          className="flex-1 rounded bg-gray-800 px-2 py-1 text-xs hover:bg-gray-700 transition-colors"
          disabled={idleId === null}
        >
          idle 解除
        </button>
        <button
          type="button"
          onClick={() => {
            activeModel.animation.stop();
            forceUpdate();
          }}
          className="flex-1 rounded bg-gray-800 px-2 py-1 text-xs hover:bg-gray-700 transition-colors"
        >
          全停止
        </button>
      </div>

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
