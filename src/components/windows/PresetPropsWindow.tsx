"use client";

import { useCallback, useMemo, useState } from "react";
import ScrollArea from "@/components/ScrollArea";
import type { ModelEntry, ModelFile } from "@/types/models";
import type { SceneObject, SceneObjectScaleInput } from "@/types/sceneObjects";

interface PresetPropsWindowProps {
  presetObjects: ModelEntry[];
  onPresetSelected: (file: ModelFile) => void;
  loading: boolean;
  sceneObjects: SceneObject[];
  activeSceneObjectId: string | null;
  onActiveSceneObjectChange: (id: string) => void;
  onRemoveSceneObject: (id: string) => void;
  onScaleChange: (id: string, scale: SceneObjectScaleInput) => void;
  scaleVersion: number;
  onMorphChange: (id: string, morphName: string, weight: number) => void;
  onMorphReset: (id: string) => void;
  morphVersion: number;
}

const SCALE_MIN = 0.1;
const SCALE_MAX = 10.0;
const SCALE_STEP = 0.05;

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
}

interface ScalePanelProps {
  obj: SceneObject;
  onScaleChange: (id: string, scale: SceneObjectScaleInput) => void;
  scaleVersion: number;
}

function ScalePanel({ obj, onScaleChange, scaleVersion }: ScalePanelProps) {
  const [perAxis, setPerAxis] = useState(false);

  const current = useMemo(() => {
    void scaleVersion;
    return {
      x: obj.object.scale.x,
      y: obj.object.scale.y,
      z: obj.object.scale.z,
    };
    // scaleVersion 変更時に再評価
  }, [obj, scaleVersion]);

  const uniform = useMemo(() => {
    // 三軸が一致していない場合は平均を表示
    return (current.x + current.y + current.z) / 3;
  }, [current]);

  const reset = useCallback(() => {
    onScaleChange(obj.id, 1);
  }, [obj.id, onScaleChange]);

  const handleUniformChange = (raw: string) => {
    const value = clampScale(parseFloat(raw));
    onScaleChange(obj.id, value);
  };

  const handleAxisChange = (axis: "x" | "y" | "z", raw: string) => {
    const value = clampScale(parseFloat(raw));
    onScaleChange(obj.id, {
      x: axis === "x" ? value : current.x,
      y: axis === "y" ? value : current.y,
      z: axis === "z" ? value : current.z,
    });
  };

  return (
    <div className="mt-2 p-2 rounded bg-gray-900/60 border border-gray-700 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-300">スケール</span>
        <label className="flex items-center gap-1 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={perAxis}
            onChange={(e) => setPerAxis(e.target.checked)}
          />
          軸別
        </label>
      </div>

      {!perAxis ? (
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            value={uniform}
            onChange={(e) => handleUniformChange(e.target.value)}
            className="flex-1"
          />
          <input
            type="number"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            value={Number(uniform.toFixed(3))}
            onChange={(e) => handleUniformChange(e.target.value)}
            className="w-16 px-1 py-0.5 text-xs bg-gray-800 border border-gray-700 rounded"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {(["x", "y", "z"] as const).map((axis) => (
            <div key={axis} className="flex items-center gap-2">
              <span className="w-4 text-xs text-gray-400 uppercase">
                {axis}
              </span>
              <input
                type="range"
                min={SCALE_MIN}
                max={SCALE_MAX}
                step={SCALE_STEP}
                value={current[axis]}
                onChange={(e) => handleAxisChange(axis, e.target.value)}
                className="flex-1"
              />
              <input
                type="number"
                min={SCALE_MIN}
                max={SCALE_MAX}
                step={SCALE_STEP}
                value={Number(current[axis].toFixed(3))}
                onChange={(e) => handleAxisChange(axis, e.target.value)}
                className="w-16 px-1 py-0.5 text-xs bg-gray-800 border border-gray-700 rounded"
              />
            </div>
          ))}
        </div>
      )}

      <button
        onClick={reset}
        className="self-end px-2 py-0.5 text-xs rounded bg-gray-700 hover:bg-gray-600"
      >
        リセット
      </button>
    </div>
  );
}

interface MorphPanelProps {
  obj: SceneObject;
  morphVersion: number;
  onMorphChange: (id: string, morphName: string, weight: number) => void;
  onMorphReset: (id: string) => void;
}

function MorphPanel({
  obj,
  morphVersion,
  onMorphChange,
  onMorphReset,
}: MorphPanelProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const morphs = obj.morphs;
  const list = useMemo(() => {
    if (!morphs) return [];
    return morphs.list();
  }, [morphs]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => m.name.toLowerCase().includes(q));
  }, [list, filter]);

  if (!morphs || list.length === 0) return null;

  return (
    <div className="mt-2 p-2 rounded bg-gray-900/60 border border-gray-700 flex flex-col gap-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs text-gray-300"
      >
        <span className="text-gray-400">{open ? "▼" : "▶"}</span>
        <span>モーフ ({list.length})</span>
      </button>
      {open && (
        <>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="フィルタ"
            className="w-full px-1.5 py-0.5 text-xs bg-gray-800 border border-gray-700 rounded"
          />
          <ScrollArea className="flex max-h-[20vh] flex-col gap-1.5 overflow-y-auto pr-1">
            {filtered.map((info) => {
              void morphVersion;
              const value = morphs.get(info.name);
              return (
                <div
                  key={info.name}
                  className="rounded bg-gray-800/40 px-2 py-1"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="flex-1 truncate text-[11px] text-gray-200"
                      title={info.name}
                    >
                      {info.name}
                    </span>
                    <span className="w-9 text-right text-[10px] text-gray-500">
                      {value.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={value}
                    onChange={(e) =>
                      onMorphChange(
                        obj.id,
                        info.name,
                        Number(e.currentTarget.value)
                      )
                    }
                    className="mt-0.5 w-full accent-emerald-400"
                  />
                </div>
              );
            })}
          </ScrollArea>
          <button
            onClick={() => onMorphReset(obj.id)}
            className="self-end px-2 py-0.5 text-xs rounded bg-gray-700 hover:bg-gray-600"
          >
            全てリセット
          </button>
        </>
      )}
    </div>
  );
}

export default function PresetPropsWindow({
  presetObjects,
  onPresetSelected,
  loading,
  sceneObjects,
  activeSceneObjectId,
  onActiveSceneObjectChange,
  onRemoveSceneObject,
  onScaleChange,
  scaleVersion,
  onMorphChange,
  onMorphReset,
  morphVersion,
}: PresetPropsWindowProps) {
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

  const activeObject = sceneObjects.find((o) => o.id === activeSceneObjectId);

  return (
    <div className="flex flex-col gap-2 max-h-[70vh]">
      <div className="text-xs text-gray-400">プリセット</div>
      {presetObjects.length === 0 ? (
        <div className="text-xs text-gray-500 px-2 py-1">
          public/objects/ にデータがありません
        </div>
      ) : (
        <ScrollArea className="flex max-h-[28vh] flex-col gap-1 overflow-y-auto">
          {presetObjects.map((entry) => (
            <div key={entry.folder}>
              {entry.files.length === 1 ? (
                <button
                  onClick={() => onPresetSelected(entry.files[0])}
                  disabled={loading}
                  className="w-full text-left px-3 py-2 rounded bg-emerald-900/40 hover:bg-emerald-800/60 text-sm transition-colors disabled:opacity-50"
                >
                  {entry.folder}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => toggleFolder(entry.folder)}
                    className="w-full text-left px-3 py-2 rounded bg-emerald-900/40 hover:bg-emerald-800/60 text-sm transition-colors flex items-center gap-2"
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
                          className="w-full text-left px-3 py-1.5 rounded bg-emerald-900/30 hover:bg-emerald-800/50 text-xs transition-colors disabled:opacity-50 truncate"
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
      )}

      <div className="text-xs text-gray-400 mt-1">配置済みプロップ</div>
      {sceneObjects.length === 0 ? (
        <div className="text-xs text-gray-500 px-2 py-1">なし</div>
      ) : (
        <ScrollArea className="flex max-h-[28vh] flex-col gap-1 overflow-y-auto">
          {sceneObjects.map((obj) => {
            const isActive = obj.id === activeSceneObjectId;
            return (
              <div
                key={obj.id}
                className={`rounded border ${
                  isActive
                    ? "border-emerald-500 bg-emerald-900/20"
                    : "border-gray-700 bg-gray-800/40"
                }`}
              >
                <div className="flex items-center gap-2 p-1.5">
                  <button
                    onClick={() => onActiveSceneObjectChange(obj.id)}
                    className="flex-1 text-left text-xs truncate"
                    title={obj.name}
                  >
                    {obj.name}
                  </button>
                  <button
                    onClick={() => onRemoveSceneObject(obj.id)}
                    className="px-2 py-0.5 text-xs rounded bg-red-900/60 hover:bg-red-800"
                  >
                    削除
                  </button>
                </div>
                {isActive && activeObject && (
                  <div className="px-1.5 pb-1.5">
                    <ScalePanel
                      obj={activeObject}
                      onScaleChange={onScaleChange}
                      scaleVersion={scaleVersion}
                    />
                    <MorphPanel
                      obj={activeObject}
                      morphVersion={morphVersion}
                      onMorphChange={onMorphChange}
                      onMorphReset={onMorphReset}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </ScrollArea>
      )}
    </div>
  );
}
