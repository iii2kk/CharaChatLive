"use client";

import { useCallback, useEffect, useRef } from "react";
import { MovementController } from "@/lib/character/movementController";
import type { CharacterModel } from "@/lib/character/types";

export interface CharacterMovementApi {
  /** モデルごとの controller を取得 (未存在なら null) */
  getController: (modelId: string | null) => MovementController | null;
  /** useFrame から毎フレーム呼ぶ。models 全員の update を実行 */
  update: (delta: number) => void;
}

/**
 * モデル一覧と同期して MovementController を生成・破棄する。
 * useFrame からの per-frame 駆動と UI からのアクセスを橋渡しする。
 */
export function useCharacterMovement(
  models: CharacterModel[]
): CharacterMovementApi {
  const controllersRef = useRef<Map<string, MovementController>>(new Map());

  useEffect(() => {
    const map = controllersRef.current;
    const currentIds = new Set(models.map((m) => m.id));

    for (const [id, ctrl] of map) {
      if (!currentIds.has(id)) {
        ctrl.dispose();
        map.delete(id);
      }
    }

    const byId = new Map(models.map((m) => [m.id, m] as const));
    for (const [id, model] of byId) {
      if (!map.has(id)) {
        map.set(id, new MovementController(model));
      }
    }
  }, [models]);

  useEffect(() => {
    const map = controllersRef.current;
    return () => {
      for (const ctrl of map.values()) ctrl.dispose();
      map.clear();
    };
  }, []);

  const getController = useCallback(
    (modelId: string | null): MovementController | null => {
      if (!modelId) return null;
      return controllersRef.current.get(modelId) ?? null;
    },
    []
  );

  const update = useCallback((delta: number) => {
    for (const ctrl of controllersRef.current.values()) {
      ctrl.update(delta);
    }
  }, []);

  return { getController, update };
}
