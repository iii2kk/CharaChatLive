"use client";

import { useCallback, useState } from "react";
import ScrollArea from "@/components/ScrollArea";
import type { TextureEntry, TextureFile, TexturePresets } from "@/types/textures";
import type { ViewerSettings } from "@/lib/viewer-settings";

interface PresetTexturesWindowProps {
  textures: TexturePresets;
  viewerSettings: ViewerSettings;
  onViewerSettingsChange: React.Dispatch<React.SetStateAction<ViewerSettings>>;
}

type Section = "ground" | "background";

export default function PresetTexturesWindow({
  textures,
  viewerSettings,
  onViewerSettingsChange,
}: PresetTexturesWindowProps) {
  const [section, setSection] = useState<Section>("ground");
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  const toggleFolder = useCallback((key: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const applyGround = useCallback(
    (file: TextureFile | null) => {
      onViewerSettingsChange((prev) => ({
        ...prev,
        groundTextureUrl: file?.path ?? null,
      }));
    },
    [onViewerSettingsChange]
  );

  const applyBackground = useCallback(
    (file: TextureFile | null) => {
      onViewerSettingsChange((prev) => ({
        ...prev,
        backgroundTextureUrl: file?.path ?? null,
        backgroundIsEquirect: file?.isEquirect ?? false,
      }));
    },
    [onViewerSettingsChange]
  );

  const entries: TextureEntry[] =
    section === "ground" ? textures.ground : textures.background;
  const selectedPath =
    section === "ground"
      ? viewerSettings.groundTextureUrl
      : viewerSettings.backgroundTextureUrl;

  const onSelect = (file: TextureFile) => {
    if (section === "ground") applyGround(file);
    else applyBackground(file);
  };

  const onClear = () => {
    if (section === "ground") applyGround(null);
    else applyBackground(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1">
        <button
          onClick={() => setSection("ground")}
          className={`flex-1 px-3 py-1.5 rounded text-xs transition-colors ${
            section === "ground"
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
        >
          地面
        </button>
        <button
          onClick={() => setSection("background")}
          className={`flex-1 px-3 py-1.5 rounded text-xs transition-colors ${
            section === "background"
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
        >
          背景
        </button>
      </div>

      {section === "ground" && (
        <div className="flex flex-col gap-2 border-b border-gray-700 pb-3">
          <label className="flex items-center justify-between text-xs text-gray-300">
            <span>グリッド表示</span>
            <input
              type="checkbox"
              checked={viewerSettings.showGrid}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                onViewerSettingsChange((prev) => ({ ...prev, showGrid: checked }));
              }}
              className="accent-blue-400"
            />
          </label>
          <label className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-300">タイル繰り返し</span>
              <span className="text-gray-500">
                {viewerSettings.groundTextureRepeat.toFixed(0)}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              step={1}
              value={viewerSettings.groundTextureRepeat}
              onChange={(e) => {
                const value = Number(e.currentTarget.value);
                onViewerSettingsChange((prev) => ({
                  ...prev,
                  groundTextureRepeat: value,
                }));
              }}
              className="accent-blue-400"
            />
          </label>
          <label className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-300">地面サイズ</span>
              <span className="text-gray-500">
                {viewerSettings.groundSize.toFixed(0)}
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={500}
              step={10}
              value={viewerSettings.groundSize}
              onChange={(e) => {
                const value = Number(e.currentTarget.value);
                onViewerSettingsChange((prev) => ({ ...prev, groundSize: value }));
              }}
              className="accent-blue-400"
            />
          </label>
        </div>
      )}

      {section === "background" && (
        <div className="flex flex-col gap-2 border-b border-gray-700 pb-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-300">背景色（テクスチャ未選択時）</span>
            <input
              type="color"
              value={viewerSettings.backgroundColor}
              onChange={(e) => {
                const value = e.currentTarget.value;
                onViewerSettingsChange((prev) => ({
                  ...prev,
                  backgroundColor: value,
                }));
              }}
              className="h-8 w-full rounded bg-gray-800"
            />
          </label>
          <label className="flex items-center justify-between text-xs text-gray-300">
            <span>360°パノラマとして表示</span>
            <input
              type="checkbox"
              checked={viewerSettings.backgroundIsEquirect}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                onViewerSettingsChange((prev) => ({
                  ...prev,
                  backgroundIsEquirect: checked,
                }));
              }}
              className="accent-blue-400"
            />
          </label>
        </div>
      )}

      <button
        onClick={onClear}
        className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
          selectedPath === null
            ? "bg-blue-600 text-white"
            : "bg-gray-800 text-gray-300 hover:bg-gray-700"
        }`}
      >
        （なし）
      </button>

      <ScrollArea className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="text-xs text-gray-500 px-2 py-4">
            public/textures/{section === "ground" ? "ground" : "backgrounds"} に
            画像を配置してください
          </div>
        ) : (
          entries.map((entry) => {
            const folderKey = `${section}:${entry.folder}`;
            const isOpen = openFolders.has(folderKey);
            if (entry.files.length === 1 && entry.folder === "(root)") {
              const file = entry.files[0];
              return (
                <button
                  key={file.path}
                  onClick={() => onSelect(file)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    selectedPath === file.path
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  }`}
                  title={file.name}
                >
                  {file.name}
                  {file.isEquirect && (
                    <span className="ml-2 text-xs text-gray-400">[360°]</span>
                  )}
                </button>
              );
            }
            return (
              <div key={folderKey}>
                <button
                  onClick={() => toggleFolder(folderKey)}
                  className="w-full text-left px-3 py-2 rounded bg-gray-800 hover:bg-gray-700 text-sm transition-colors flex items-center gap-2"
                >
                  <span className="text-xs text-gray-400">
                    {isOpen ? "▼" : "▶"}
                  </span>
                  {entry.folder}
                  <span className="text-xs text-gray-500 ml-auto">
                    {entry.files.length}
                  </span>
                </button>
                {isOpen && (
                  <div className="ml-4 mt-1 flex flex-col gap-1">
                    {entry.files.map((file) => (
                      <button
                        key={file.path}
                        onClick={() => onSelect(file)}
                        className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors truncate ${
                          selectedPath === file.path
                            ? "bg-blue-600 text-white"
                            : "bg-gray-800/60 text-gray-300 hover:bg-gray-700"
                        }`}
                        title={file.name}
                      >
                        {file.name}
                        {file.isEquirect && (
                          <span className="ml-2 text-[10px] text-gray-400">
                            [360°]
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </ScrollArea>
    </div>
  );
}
