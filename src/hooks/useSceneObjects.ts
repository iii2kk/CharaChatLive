"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadSceneObject } from "@/lib/sceneObject/loadSceneObject";
import type {
  SceneObject,
  SceneObjectScaleInput,
} from "@/types/sceneObjects";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラー";
}

export function useSceneObjects() {
  const [sceneObjects, setSceneObjects] = useState<SceneObject[]>([]);
  const [activeSceneObjectId, setActiveSceneObjectId] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // object.scale を直接読むだけだと React 再レンダーが起きないため、
  // スケール変更を反映するためのバージョン番号を保持する
  const [scaleVersion, setScaleVersion] = useState(0);

  const sceneObjectsRef = useRef<SceneObject[]>([]);

  const commit = useCallback((next: SceneObject[]) => {
    sceneObjectsRef.current = next;
    setSceneObjects(next);
  }, []);

  const findById = useCallback(
    (id: string | null): SceneObject | null => {
      if (!id) return null;
      return sceneObjectsRef.current.find((o) => o.id === id) ?? null;
    },
    []
  );

  const addSceneObjectFromPath = useCallback(
    async (path: string, displayName: string): Promise<SceneObject | null> => {
      setLoading(true);
      setError(null);
      try {
        const obj = await loadSceneObject(path, displayName);
        const next = [...sceneObjectsRef.current, obj];
        commit(next);
        setActiveSceneObjectId(obj.id);
        setLoading(false);
        return obj;
      } catch (err) {
        console.error("scene object load error:", err);
        setError(
          `オブジェクトの読み込みに失敗しました: ${getErrorMessage(err)}`
        );
        setLoading(false);
        return null;
      }
    },
    [commit]
  );

  const removeSceneObject = useCallback(
    (id: string) => {
      const target = findById(id);
      if (target) {
        target.dispose();
      }
      const remaining = sceneObjectsRef.current.filter((o) => o.id !== id);
      commit(remaining);
      setActiveSceneObjectId((prev) =>
        prev === id ? remaining.at(-1)?.id ?? null : prev
      );
    },
    [commit, findById]
  );

  const setSceneObjectScale = useCallback(
    (id: string, scale: SceneObjectScaleInput) => {
      const target = findById(id);
      if (!target) return;
      if (typeof scale === "number") {
        target.object.scale.setScalar(scale);
      } else {
        target.object.scale.set(scale.x, scale.y, scale.z);
      }
      setScaleVersion((v) => v + 1);
    },
    [findById]
  );

  useEffect(
    () => () => {
      for (const obj of sceneObjectsRef.current) {
        obj.dispose();
      }
      sceneObjectsRef.current = [];
    },
    []
  );

  return {
    sceneObjects,
    activeSceneObjectId,
    setActiveSceneObjectId,
    addSceneObjectFromPath,
    removeSceneObject,
    setSceneObjectScale,
    loading,
    error,
    scaleVersion,
  };
}
