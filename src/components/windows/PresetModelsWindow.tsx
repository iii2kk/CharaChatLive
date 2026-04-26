"use client";

import { useCallback, useState } from "react";
import ScrollArea from "@/components/ScrollArea";
import { getModelKind } from "@/lib/file-map";
import type { ModelEntry, ModelFile } from "@/types/models";

export interface PresetLoadOptions {
  tPoseCorrection?: {
    enabled: boolean;
    armAngleDeg?: number;
  };
}

interface PresetModelsWindowProps {
  presetModels: ModelEntry[];
  onPresetSelected: (file: ModelFile, options?: PresetLoadOptions) => void;
  loading: boolean;
}

export default function PresetModelsWindow({
  presetModels,
  onPresetSelected,
  loading,
}: PresetModelsWindowProps) {
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [tPoseEnabled, setTPoseEnabled] = useState(false);
  const [armAngleDeg, setArmAngleDeg] = useState(35);

  const toggleFolder = useCallback((folder: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (file: ModelFile) => {
      const isMmd = getModelKind(file.path) === "mmd";
      const options: PresetLoadOptions | undefined =
        isMmd && tPoseEnabled
          ? { tPoseCorrection: { enabled: true, armAngleDeg } }
          : undefined;
      onPresetSelected(file, options);
    },
    [onPresetSelected, tPoseEnabled, armAngleDeg]
  );

  if (presetModels.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1 rounded bg-gray-800/60 px-3 py-2 text-xs">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={tPoseEnabled}
            onChange={(e) => setTPoseEnabled(e.target.checked)}
            className="cursor-pointer"
          />
          <span>Tポーズ補正 (PMX)</span>
        </label>
        <div
          className={`flex items-center gap-2 pl-6 ${
            tPoseEnabled ? "" : "opacity-40"
          }`}
        >
          <span className="text-gray-400">腕の角度</span>
          <input
            type="number"
            min={0}
            max={90}
            step={1}
            value={armAngleDeg}
            disabled={!tPoseEnabled}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setArmAngleDeg(v);
            }}
            className="w-16 rounded bg-gray-900 px-2 py-0.5 text-right text-xs disabled:cursor-not-allowed"
          />
          <span className="text-gray-400">°</span>
        </div>
      </div>
      <ScrollArea className="flex max-h-[56vh] flex-col gap-1 overflow-y-auto">
        {presetModels.map((entry) => (
          <div key={entry.folder}>
            {entry.files.length === 1 ? (
              <button
                onClick={() => handleSelect(entry.files[0])}
                disabled={loading}
                className="w-full text-left px-3 py-2 rounded bg-gray-800 hover:bg-gray-700 text-sm transition-colors disabled:opacity-50"
              >
                {entry.folder}
              </button>
            ) : (
              <>
                <button
                  onClick={() => toggleFolder(entry.folder)}
                  className="w-full text-left px-3 py-2 rounded bg-gray-800 hover:bg-gray-700 text-sm transition-colors flex items-center gap-2"
                >
                  <span className="text-xs text-gray-400">
                    {openFolders.has(entry.folder) ? "▼" : "▶"}
                  </span>
                  {entry.folder}
                  <span className="text-xs text-gray-500 ml-auto">
                    {entry.files.length}
                  </span>
                </button>
                {openFolders.has(entry.folder) && (
                  <div className="ml-4 mt-1 flex flex-col gap-1">
                    {entry.files.map((file) => (
                      <button
                        key={file.path}
                        onClick={() => handleSelect(file)}
                        disabled={loading}
                        className="w-full text-left px-3 py-1.5 rounded bg-gray-800/60 hover:bg-gray-700 text-xs transition-colors disabled:opacity-50 truncate"
                        title={file.name}
                      >
                        {file.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </ScrollArea>
    </div>
  );
}
