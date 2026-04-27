"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ScrollArea from "@/components/ScrollArea";
import type { CharacterModel } from "@/hooks/useModelLoader";
import type { ViewerSettings } from "@/lib/viewer-settings";

interface SoundEntry {
  name: string;
  path: string;
}

interface LipSyncWindowProps {
  activeModel: CharacterModel | null;
  /** /api/sounds が返す path を渡して再生開始。返り値の <audio> で進捗等を取れる */
  onPlayAudio: (
    modelId: string,
    url: string
  ) => Promise<HTMLAudioElement | null>;
  onStop: (modelId: string) => void;
  viewerSettings: ViewerSettings;
  onViewerSettingsChange: React.Dispatch<React.SetStateAction<ViewerSettings>>;
}

export default function LipSyncWindow({
  activeModel,
  onPlayAudio,
  onStop,
  viewerSettings,
  onViewerSettingsChange,
}: LipSyncWindowProps) {
  const [sounds, setSounds] = useState<SoundEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sounds", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = (await res.json()) as SoundEntry[];
      setSounds(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "音声リストの取得に失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 再生中の <audio> が終了したら状態をリセット
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handleEnded = () => setPlayingPath(null);
    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
  }, [playingPath]);

  const handlePlay = useCallback(
    async (entry: SoundEntry) => {
      if (!activeModel) return;
      const audio = await onPlayAudio(activeModel.id, entry.path);
      audioRef.current = audio;
      setPlayingPath(entry.path);
    },
    [activeModel, onPlayAudio]
  );

  const handleStop = useCallback(() => {
    if (!activeModel) return;
    onStop(activeModel.id);
    audioRef.current = null;
    setPlayingPath(null);
  }, [activeModel, onStop]);

  if (!activeModel) {
    return (
      <p className="text-xs text-gray-500">モデルが選択されていません</p>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500">
          モデル:{" "}
          <span className="text-gray-200">{activeModel.name}</span>
        </span>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="rounded bg-gray-800 px-2 py-0.5 text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? "読込中..." : "更新"}
        </button>
      </div>

      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : null}

      <div className="flex flex-col gap-1 rounded border border-gray-700 px-2 py-1.5 text-xs">
        <label className="flex items-center gap-1.5 text-gray-200">
          <input
            type="checkbox"
            checked={viewerSettings.spatialAudioEnabled}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              onViewerSettingsChange((prev) => ({
                ...prev,
                spatialAudioEnabled: checked,
              }));
            }}
          />
          立体音響（カメラ位置を基準に左右へ振る・ヘッドホン推奨）
        </label>
        {viewerSettings.spatialAudioEnabled ? (
          <label className="flex items-center gap-1.5 text-gray-400">
            モード:
            <select
              value={viewerSettings.spatialAudioMode}
              onChange={(e) => {
                const mode = e.currentTarget.value as
                  | "simple"
                  | "builtin-hrtf";
                onViewerSettingsChange((prev) => ({
                  ...prev,
                  spatialAudioMode: mode,
                }));
              }}
              className="rounded bg-gray-800 px-1 py-0.5 text-gray-200"
            >
              <option value="builtin-hrtf">Built-in HRTF（高品質）</option>
              <option value="simple">Simple（軽量）</option>
            </select>
          </label>
        ) : null}
        <p className="text-[10px] text-gray-500">
          ON/OFF・モード変更は次回の再生から反映されます
        </p>
      </div>


      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleStop}
          disabled={!playingPath}
          className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          停止
        </button>
        {playingPath ? (
          <span className="truncate text-[10px] text-gray-500" title={playingPath}>
            再生中: {playingPath}
          </span>
        ) : null}
      </div>

      {sounds.length === 0 && !loading && !error ? (
        <p className="text-xs text-gray-500">
          public/sounds/ に音声ファイルがありません
        </p>
      ) : null}

      <ScrollArea
        className="flex flex-col gap-1 overflow-y-auto pr-1"
        style={{ maxHeight: "55vh" }}
      >
        {sounds.map((entry) => {
          const isPlaying = playingPath === entry.path;
          return (
            <button
              key={entry.path}
              type="button"
              onClick={() => handlePlay(entry)}
              className={`w-full truncate rounded px-2 py-1 text-left text-xs transition-colors ${
                isPlaying
                  ? "bg-blue-500 text-white"
                  : "bg-gray-800 text-gray-200 hover:bg-gray-700"
              }`}
              title={entry.name}
            >
              {entry.name}
            </button>
          );
        })}
      </ScrollArea>
    </div>
  );
}
