"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  createCharacterModel,
  type CharacterModel,
} from "@/lib/character/createCharacterModel";
import type { AnimationKind, FileMap, ModelKind } from "@/lib/file-map";
import { getModelKind } from "@/lib/file-map";
import type { ViewerSettings } from "@/lib/viewer-settings";

interface LoadModelOptions {
  name?: string;
  onLoaded?: (modelId: string, modelKind: ModelKind) => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラー";
}

function getNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function deriveMotionName(url: string): string {
  try {
    const path = new URL(url, "http://local/").pathname;
    const base = path.split("/").pop() ?? "motion";
    return decodeURIComponent(base);
  } catch {
    return url;
  }
}

function generateModelId() {
  return `model-${crypto.randomUUID()}`;
}

export type { CharacterModel } from "@/lib/character/createCharacterModel";

export function useModelLoader(viewerSettings: ViewerSettings) {
  const [models, setModels] = useState<CharacterModel[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modelsRef = useRef<CharacterModel[]>([]);
  const physicsSettingsRef = useRef({
    physicsEnabled: viewerSettings.physicsEnabled,
    gravityX: viewerSettings.gravityX,
    gravityY: viewerSettings.gravityY,
    gravityZ: viewerSettings.gravityZ,
  });

  const syncModels = useCallback(
    (updater: (prev: CharacterModel[]) => CharacterModel[]) => {
      setModels((prev) => {
        const next = updater(prev);
        modelsRef.current = next;
        return next;
      });
    },
    []
  );

  const commitModels = useCallback((next: CharacterModel[]) => {
    modelsRef.current = next;
    setModels(next);
  }, []);

  const getModelById = useCallback((modelId: string | null) => {
    if (!modelId) return null;
    return modelsRef.current.find((model) => model.id === modelId) ?? null;
  }, []);

  const removeModel = useCallback(
    (modelId: string) => {
      const target = getModelById(modelId);
      if (target) {
        target.dispose();
      }
      const remainingModels = modelsRef.current.filter(
        (model) => model.id !== modelId
      );
      commitModels(remainingModels);
      setActiveModelId((prev) =>
        prev === modelId ? remainingModels.at(-1)?.id ?? null : prev
      );
    },
    [commitModels, getModelById]
  );

  const loadModel = useCallback(
    (
      kind: ModelKind,
      modelBlobUrl: string,
      fileMap: FileMap,
      options?: LoadModelOptions
    ) => {
      const modelId = generateModelId();
      const name = options?.name ?? getNameFromPath(modelBlobUrl);

      setLoading(true);
      setError(null);

      const physics = physicsSettingsRef.current;

      createCharacterModel(kind, modelBlobUrl, fileMap, {
        id: modelId,
        name,
        live2dCanvasScale: viewerSettings.live2dCanvasScale,
        live2dPlaneScale: viewerSettings.live2dPlaneScale,
        initialPhysics: {
          enabled: physics.physicsEnabled,
          gravity: new THREE.Vector3(
            physics.gravityX,
            physics.gravityY,
            physics.gravityZ
          ),
        },
      })
        .then(async (model) => {
          // PMX で物理が初期 ON の場合、helper を初期構築する
          if (model.physics.capability === "full" && model.physics.isEnabled()) {
            await model.physics.setEnabled(true).catch(() => {});
          }
          const nextModels = [...modelsRef.current, model];
          commitModels(nextModels);
          setActiveModelId(modelId);
          setLoading(false);
          options?.onLoaded?.(modelId, model.kind);
        })
        .catch((err) => {
          console.error("model load error:", err);
          setError(`モデルの読み込みに失敗しました: ${getErrorMessage(err)}`);
          setLoading(false);
        });
    },
    [
      commitModels,
      viewerSettings.live2dCanvasScale,
      viewerSettings.live2dPlaneScale,
    ]
  );

  const loadModelFromPath = useCallback(
    (modelPath: string, options?: LoadModelOptions) => {
      const kind = getModelKind(modelPath);

      if (!kind) {
        setError("未対応のモデル形式です");
        return;
      }

      const modelId = generateModelId();
      const name = options?.name ?? getNameFromPath(modelPath);

      setLoading(true);
      setError(null);

      const physics = physicsSettingsRef.current;

      createCharacterModel(kind, modelPath, null, {
        id: modelId,
        name,
        live2dCanvasScale: viewerSettings.live2dCanvasScale,
        live2dPlaneScale: viewerSettings.live2dPlaneScale,
        initialPhysics: {
          enabled: physics.physicsEnabled,
          gravity: new THREE.Vector3(
            physics.gravityX,
            physics.gravityY,
            physics.gravityZ
          ),
        },
      })
        .then(async (model) => {
          if (model.physics.capability === "full" && model.physics.isEnabled()) {
            await model.physics.setEnabled(true).catch(() => {});
          }
          const nextModels = [...modelsRef.current, model];
          commitModels(nextModels);
          setActiveModelId(modelId);
          setLoading(false);
          options?.onLoaded?.(modelId, model.kind);
        })
        .catch((err) => {
          console.error("model load error:", err);
          setError(`モデルの読み込みに失敗しました: ${getErrorMessage(err)}`);
          setLoading(false);
        });
    },
    [
      commitModels,
      viewerSettings.live2dCanvasScale,
      viewerSettings.live2dPlaneScale,
    ]
  );

  const loadAnimation = useCallback(
    (kind: AnimationKind, animationUrls: string[], targetModelId?: string) => {
      const targetModel = getModelById(targetModelId ?? activeModelId);

      if (!targetModel) {
        setError("先にモデルを読み込んでください");
        return;
      }

      // kind とモデル種別の整合チェック
      if (kind === "vmd" && targetModel.kind !== "mmd") {
        setError("VMD は MMD モデルにのみ適用できます");
        return;
      }
      if (kind === "vrma" && targetModel.kind !== "vrm") {
        setError("VRMA は VRM モデルにのみ適用できます");
        return;
      }
      if (kind === "motion3" && targetModel.kind !== "live2d") {
        setError("motion3.json は Live2D モデルにのみ適用できます");
        return;
      }

      setLoading(true);
      setError(null);

      const run = async () => {
        if (!targetModel.animation.capabilities.externalLoad) {
          // Live2D 等: 外部ロード非対応は従来の loadAndPlay に委譲
          await targetModel.animation.loadAndPlay(animationUrls, null);
          return;
        }

        // MMD/VRM: 各 URL を個別ハンドルとして登録し、最初の 1 つを再生
        const loaded = [];
        for (const url of animationUrls) {
          try {
            const handle = await targetModel.animation.library.load(
              [url],
              null,
              { name: deriveMotionName(url) }
            );
            loaded.push(handle);
          } catch (err) {
            console.error(`animation load failed: ${url}`, err);
          }
        }
        if (loaded.length === 0) {
          throw new Error("すべてのモーション読み込みに失敗しました");
        }
        // 既存挙動維持: 最初のモーションを base で再生
        await targetModel.animation.play(loaded[0], "base", { loop: true });
      };

      run()
        .then(() => {
          // animation.isLoaded / library の変化を UI に反映
          syncModels((prev) => [...prev]);
          setLoading(false);
        })
        .catch((err) => {
          console.error("animation load error:", err);
          setError(
            `モーションの読み込みに失敗しました: ${getErrorMessage(err)}`
          );
          setLoading(false);
        });
    },
    [activeModelId, getModelById, syncModels]
  );

  const registerPresetMotions = useCallback(
    (
      modelId: string,
      items: Array<{ url: string; name: string }>
    ): Promise<void> => {
      const targetModel = getModelById(modelId);
      if (!targetModel) return Promise.resolve();
      if (!targetModel.animation.capabilities.externalLoad) {
        return Promise.resolve();
      }
      if (items.length === 0) return Promise.resolve();

      return Promise.all(
        items.map((item) =>
          targetModel.animation.library
            .load([item.url], null, { name: item.name })
            .then(() => item)
            .catch((err) => {
              console.error(
                `[presetMotions] FAIL: ${item.name} (${item.url})`,
                err
              );
              return null;
            })
        )
      ).then((results) => {
        const ok = results.filter((r) => r !== null).length;
        console.log(
          `[presetMotions] 完了: ${ok}/${items.length} 成功`
        );
        syncModels((prev) => [...prev]);
      });
    },
    [getModelById, syncModels]
  );

  const setModelRenderScale = useCallback(
    (modelId: string, scale: number) => {
      const model = getModelById(modelId);
      if (model?.setRenderScale) {
        model.setRenderScale(scale);
        syncModels((prev) => [...prev]);
      }
    },
    [getModelById, syncModels]
  );

  const setModelDisplayScale = useCallback(
    (modelId: string, scale: number) => {
      const model = getModelById(modelId);
      if (model?.setDisplayScale) {
        model.setDisplayScale(scale);
        syncModels((prev) => [...prev]);
      }
    },
    [getModelById, syncModels]
  );

  // viewer settings -> モデル物理状態の同期
  useEffect(() => {
    physicsSettingsRef.current = {
      physicsEnabled: viewerSettings.physicsEnabled,
      gravityX: viewerSettings.gravityX,
      gravityY: viewerSettings.gravityY,
      gravityZ: viewerSettings.gravityZ,
    };

    const gravity = new THREE.Vector3(
      viewerSettings.gravityX,
      viewerSettings.gravityY,
      viewerSettings.gravityZ
    );

    for (const model of modelsRef.current) {
      void model.physics.setEnabled(viewerSettings.physicsEnabled).catch(
        (err) => {
          console.error("physics enable error:", err);
        }
      );
      model.physics.setGravity(gravity);
    }

    syncModels((prev) => [...prev]);
  }, [
    viewerSettings.gravityX,
    viewerSettings.gravityY,
    viewerSettings.gravityZ,
    viewerSettings.physicsEnabled,
    syncModels,
  ]);

  // unmount 時にモデルを破棄
  useEffect(
    () => () => {
      for (const model of modelsRef.current) {
        model.dispose();
      }
      modelsRef.current = [];
    },
    []
  );

  const activeModel =
    activeModelId !== null
      ? models.find((model) => model.id === activeModelId) ?? null
      : null;

  return {
    models,
    activeModel,
    activeModelId,
    setActiveModelId,
    removeModel,
    loading,
    error,
    loadModel,
    loadModelFromPath,
    loadAnimation,
    registerPresetMotions,
    setModelRenderScale,
    setModelDisplayScale,
  };
}
