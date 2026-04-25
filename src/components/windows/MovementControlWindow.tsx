"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import type { CharacterModel } from "@/hooks/useModelLoader";
import type {
  MovementController,
  MovementOptions,
} from "@/lib/character/movementController";

interface MovementControlWindowProps {
  activeModel: CharacterModel | null;
  controller: MovementController | null;
}

export default function MovementControlWindow({
  activeModel,
  controller,
}: MovementControlWindowProps) {
  const [, setTick] = useState(0);
  const forceUpdate = () => setTick((t) => t + 1);

  const [targetX, setTargetX] = useState("0");
  const [targetZ, setTargetZ] = useState("0");

  useEffect(() => {
    if (!controller) return;
    return controller.subscribe(() => forceUpdate());
  }, [controller]);

  // motionMapping の変更で「割当無し警告」を再評価
  useEffect(() => {
    if (!activeModel) return;
    return activeModel.motionMapping.subscribe(forceUpdate);
  }, [activeModel]);

  const isMoving = controller?.getState().kind === "moving";
  // 移動中だけ rAF で現在位置表示を更新
  useEffect(() => {
    if (!isMoving) return;
    let raf = 0;
    const tick = () => {
      forceUpdate();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isMoving]);

  if (!activeModel) {
    return (
      <p className="text-xs text-gray-500">モデルが選択されていません</p>
    );
  }
  if (!controller) {
    return (
      <p className="text-xs text-gray-500">移動コントローラー初期化中...</p>
    );
  }

  const state = controller.getState();
  const opts = controller.getOptions();
  const pos = activeModel.object.position;
  const walkAssigned = activeModel.motionMapping.walk !== null;
  const runAssigned = activeModel.motionMapping.run !== null;

  const handleMove = () => {
    const x = Number(targetX);
    const z = Number(targetZ);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    controller.setTarget(new THREE.Vector3(x, pos.y, z));
  };

  const updateOption = <K extends keyof MovementOptions>(
    key: K,
    value: MovementOptions[K]
  ) => {
    controller.setOptions({ [key]: value } as Partial<MovementOptions>);
    forceUpdate();
  };

  return (
    <div className="text-sm">
      <div className="mb-2 text-xs text-gray-500">
        モデル: <span className="text-gray-200">{activeModel.name}</span>
      </div>

      <div className="mb-2 rounded bg-gray-900/50 p-2 text-[10px] text-gray-400">
        <div>
          現在位置:{" "}
          <span className="text-gray-200">
            x={pos.x.toFixed(2)}, z={pos.z.toFixed(2)}
          </span>
        </div>
        <div>
          状態:{" "}
          <span className="text-gray-200">
            {state.kind === "idle"
              ? "停止中"
              : `移動中 (${state.mode}) → x=${state.target.x.toFixed(
                  2
                )}, z=${state.target.z.toFixed(2)}`}
          </span>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="text-[10px] text-gray-400">
          目標 X
          <input
            type="number"
            step="0.1"
            value={targetX}
            onChange={(e) => setTargetX(e.currentTarget.value)}
            className="mt-0.5 w-full rounded bg-gray-900 px-1 py-0.5 text-gray-200"
          />
        </label>
        <label className="text-[10px] text-gray-400">
          目標 Z
          <input
            type="number"
            step="0.1"
            value={targetZ}
            onChange={(e) => setTargetZ(e.currentTarget.value)}
            className="mt-0.5 w-full rounded bg-gray-900 px-1 py-0.5 text-gray-200"
          />
        </label>
      </div>

      <div className="mb-3 flex gap-1">
        <button
          type="button"
          onClick={handleMove}
          className="flex-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500"
        >
          移動
        </button>
        <button
          type="button"
          onClick={() => controller.cancel()}
          disabled={state.kind === "idle"}
          className="flex-1 rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          停止
        </button>
      </div>

      {!walkAssigned || !runAssigned ? (
        <div className="mb-2 rounded bg-amber-900/30 p-2 text-[10px] text-amber-300">
          {!walkAssigned ? <div>walk が未割当: 短距離移動でモーション無し</div> : null}
          {!runAssigned ? <div>run が未割当: 長距離移動でモーション無し</div> : null}
        </div>
      ) : null}

      <div className="rounded bg-gray-900/40 p-2 text-[10px] text-gray-400">
        <div className="mb-1 text-gray-500">速度設定</div>
        <label className="mb-1 flex items-center gap-2">
          <span className="w-24">walk (m/s)</span>
          <input
            type="number"
            step="0.1"
            min="0"
            value={opts.walkSpeed}
            onChange={(e) =>
              updateOption("walkSpeed", Number(e.currentTarget.value))
            }
            className="flex-1 rounded bg-gray-900 px-1 py-0.5 text-gray-200"
          />
        </label>
        <label className="mb-1 flex items-center gap-2">
          <span className="w-24">run (m/s)</span>
          <input
            type="number"
            step="0.1"
            min="0"
            value={opts.runSpeed}
            onChange={(e) =>
              updateOption("runSpeed", Number(e.currentTarget.value))
            }
            className="flex-1 rounded bg-gray-900 px-1 py-0.5 text-gray-200"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-24">run 閾値 (m)</span>
          <input
            type="number"
            step="0.5"
            min="0"
            value={opts.runDistanceThreshold}
            onChange={(e) =>
              updateOption(
                "runDistanceThreshold",
                Number(e.currentTarget.value)
              )
            }
            className="flex-1 rounded bg-gray-900 px-1 py-0.5 text-gray-200"
          />
        </label>
        <label className="mt-1 flex items-center gap-2">
          <span className="w-24">回転速度 (deg/s)</span>
          <input
            type="number"
            step="30"
            min="0"
            value={opts.rotationSpeedDegPerSec}
            onChange={(e) =>
              updateOption(
                "rotationSpeedDegPerSec",
                Number(e.currentTarget.value)
              )
            }
            className="flex-1 rounded bg-gray-900 px-1 py-0.5 text-gray-200"
          />
        </label>
      </div>
    </div>
  );
}
