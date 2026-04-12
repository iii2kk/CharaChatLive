"use client";

import { useCallback, useState } from "react";
import type { ModelEntry, ModelFile } from "@/types/models";

interface PresetModelsWindowProps {
  presetModels: ModelEntry[];
  onPresetSelected: (file: ModelFile) => void;
  loading: boolean;
}

export default function PresetModelsWindow({
  presetModels,
  onPresetSelected,
  loading,
}: PresetModelsWindowProps) {
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

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

  if (presetModels.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {presetModels.map((entry) => (
        <div key={entry.folder}>
          {entry.files.length === 1 ? (
            <button
              onClick={() => onPresetSelected(entry.files[0])}
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
                      onClick={() => onPresetSelected(file)}
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
    </div>
  );
}
