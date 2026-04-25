"use client";

import { useCallback, useEffect, useRef } from "react";
import { AutoMotionController } from "@/lib/character/autoMotionController";
import { MovementController } from "@/lib/character/movementController";
import type { CharacterModel } from "@/lib/character/types";

export interface CharacterMovementApi {
  /** モデルごとの movement controller を取得 (未存在なら null) */
  getController: (modelId: string | null) => MovementController | null;
  /** useFrame から毎フレーム呼ぶ。models 全員の update を実行 */
  update: (delta: number) => void;
}

/**
 * モデル一覧と同期して AutoMotionController と MovementController を生成・破棄する。
 * Auto を先に作ってから Movement を作ることで、Movement の onManualOverrideChange
 * 購読が確実に Auto の "start" 検知より後に動作するよう順序を保証する。
 */
export function useCharacterMovement(
  models: CharacterModel[]
): CharacterMovementApi {
  const autoControllersRef = useRef<Map<string, AutoMotionController>>(
    new Map()
  );
  const movementControllersRef = useRef<Map<string, MovementController>>(
    new Map()
  );

  useEffect(() => {
    const autoMap = autoControllersRef.current;
    const moveMap = movementControllersRef.current;
    const currentIds = new Set(models.map((m) => m.id));

    // Movement を先に dispose (auto を参照しているため)
    for (const [id, ctrl] of moveMap) {
      if (!currentIds.has(id)) {
        ctrl.dispose();
        moveMap.delete(id);
      }
    }
    for (const [id, ctrl] of autoMap) {
      if (!currentIds.has(id)) {
        ctrl.dispose();
        autoMap.delete(id);
      }
    }

    // Auto を先に作ってから Movement
    for (const model of models) {
      if (!autoMap.has(model.id)) {
        autoMap.set(model.id, new AutoMotionController(model));
      }
      if (!moveMap.has(model.id)) {
        const auto = autoMap.get(model.id);
        if (auto) {
          moveMap.set(model.id, new MovementController(model, auto));
        }
      }
    }
  }, [models]);

  useEffect(() => {
    const autoMap = autoControllersRef.current;
    const moveMap = movementControllersRef.current;
    return () => {
      for (const ctrl of moveMap.values()) ctrl.dispose();
      moveMap.clear();
      for (const ctrl of autoMap.values()) ctrl.dispose();
      autoMap.clear();
    };
  }, []);

  const getController = useCallback(
    (modelId: string | null): MovementController | null => {
      if (!modelId) return null;
      return movementControllersRef.current.get(modelId) ?? null;
    },
    []
  );

  const update = useCallback((delta: number) => {
    for (const ctrl of movementControllersRef.current.values()) {
      ctrl.update(delta);
    }
  }, []);

  return { getController, update };
}
