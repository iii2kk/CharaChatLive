"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CharacterModel,
  MmdBodyInfo,
  MmdBodyParams,
} from "@/lib/character/types";

interface Props {
  activeModel: CharacterModel | null;
}

export default function MmdPhysicsBodiesPanel({ activeModel }: Props) {
  const [bodies, setBodies] = useState<MmdBodyInfo[]>([]);
  const [bulkMass, setBulkMass] = useState(0.1);
  const [bulkFriction, setBulkFriction] = useState(0.5);
  const [bulkRestitution, setBulkRestitution] = useState(0);

  const refresh = useCallback(() => {
    const list = activeModel?.physics.listBodies?.() ?? [];
    setBodies(list.filter((b) => b.type !== 0));
  }, [activeModel]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (activeModel?.physics.capability !== "full") return null;

  const handleBulk = (params: MmdBodyParams) => {
    activeModel.physics.setAllBodies?.(params);
    refresh();
  };

  const handleReset = () => {
    activeModel.physics.resetAllBodies?.();
    refresh();
  };

  const handleResetPositions = () => {
    activeModel.physics.resetBodyPositions?.();
  };

  const handleBodyChange = (id: number, params: MmdBodyParams) => {
    activeModel.physics.setBody?.(id, params);
    setBodies((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...params } : b))
    );
  };

  return (
    <div className="flex flex-col gap-2 mt-3 border-t border-gray-700 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">
          MMD 剛体リスト ({bodies.length} 個 / type=0 のキネマティック追従剛体は除外)
        </span>
        <button
          type="button"
          onClick={handleResetPositions}
          title="揺れもの剛体の位置・速度をボーン位置に戻し、60 ステップ warmup で静定させます。スカートのめくれ等のリカバリ用。"
          className="text-[11px] px-2 py-1 rounded bg-blue-700/70 hover:bg-blue-600 text-white whitespace-nowrap"
        >
          剛体位置リセット
        </button>
      </div>

      {/* 一括編集 */}
      <div className="rounded bg-gray-800/40 p-2 flex flex-col gap-2">
        <div className="text-[11px] text-gray-400">
          一括編集（揺らしもの剛体すべてに適用）
        </div>
        <BulkRow
          label="質量 (mass)"
          value={bulkMass}
          setValue={setBulkMass}
          min={0.001}
          max={5}
          step={0.005}
          onCommit={(v) => handleBulk({ mass: v })}
        />
        <BulkRow
          label="摩擦 (friction)"
          value={bulkFriction}
          setValue={setBulkFriction}
          min={0}
          max={2}
          step={0.01}
          onCommit={(v) => handleBulk({ friction: v })}
        />
        <BulkRow
          label="反発 (restitution)"
          value={bulkRestitution}
          setValue={setBulkRestitution}
          min={0}
          max={1}
          step={0.01}
          onCommit={(v) => handleBulk({ restitution: v })}
        />
        <button
          type="button"
          onClick={handleReset}
          className="text-[11px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 self-end"
        >
          PMX 値に戻す
        </button>
      </div>

      {/* 個別リスト */}
      <div className="rounded bg-gray-900/40 max-h-[40vh] overflow-y-auto">
        <div
          className="grid gap-1 px-2 py-1 sticky top-0 bg-gray-900/95 border-b border-gray-700 text-[10px] text-gray-500"
          style={{ gridTemplateColumns: "1fr 64px 64px 64px" }}
        >
          <span>名前</span>
          <span className="text-right pr-1">mass</span>
          <span className="text-right pr-1">friction</span>
          <span className="text-right pr-1">restitution</span>
        </div>
        {bodies.map((b) => (
          <BodyRow
            key={b.id}
            body={b}
            onChange={(p) => handleBodyChange(b.id, p)}
          />
        ))}
      </div>
    </div>
  );
}

function BulkRow({
  label,
  value,
  setValue,
  min,
  max,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  setValue: (v: number) => void;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-gray-300">{label}</span>
        <span className="text-gray-500">{value.toFixed(3)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.currentTarget.value);
          setValue(v);
          onCommit(v);
        }}
        className="accent-blue-400"
      />
    </label>
  );
}

function BodyRow({
  body,
  onChange,
}: {
  body: MmdBodyInfo;
  onChange: (p: MmdBodyParams) => void;
}) {
  const [mass, setMass] = useState(body.mass);
  const [friction, setFriction] = useState(body.friction);
  const [restitution, setRestitution] = useState(body.restitution);

  // 親側からの更新（PMX 値リセット等）を反映
  useEffect(() => setMass(body.mass), [body.mass]);
  useEffect(() => setFriction(body.friction), [body.friction]);
  useEffect(() => setRestitution(body.restitution), [body.restitution]);

  return (
    <div
      className="grid gap-1 px-2 py-0.5 text-[10px] items-center hover:bg-gray-800/50 border-b border-gray-800/40"
      style={{ gridTemplateColumns: "1fr 64px 64px 64px" }}
      title={body.name}
    >
      <span className="truncate text-gray-300">{body.name}</span>
      <NumberCell
        value={mass}
        step={0.005}
        min={0.001}
        onChange={(v) => {
          setMass(v);
          onChange({ mass: v });
        }}
      />
      <NumberCell
        value={friction}
        step={0.01}
        min={0}
        onChange={(v) => {
          setFriction(v);
          onChange({ friction: v });
        }}
      />
      <NumberCell
        value={restitution}
        step={0.01}
        min={0}
        max={1}
        onChange={(v) => {
          setRestitution(v);
          onChange({ restitution: v });
        }}
      />
    </div>
  );
}

function NumberCell({
  value,
  step,
  min,
  max,
  onChange,
}: {
  value: number;
  step: number;
  min: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      value={Number.isFinite(value) ? value.toFixed(3) : ""}
      onChange={(e) => {
        const v = Number(e.currentTarget.value);
        if (Number.isFinite(v)) onChange(v);
      }}
      className="w-full bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-right text-gray-200"
    />
  );
}
