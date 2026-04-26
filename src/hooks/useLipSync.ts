"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  createAudioSourceFromStream,
  createAudioSourceFromUrl,
  type AudioSourceOptions,
} from "@/lib/character/lipSync/audioSource";
import { LipSyncController } from "@/lib/character/lipSyncController";
import type { CharacterModel } from "@/lib/character/types";
import type { VowelDetectorFactory } from "@/lib/character/lipSync/types";

export interface UseLipSyncOptions {
  detectorFactory?: VowelDetectorFactory;
}

export interface LipSyncApi {
  /** モデルごとの controller を取得 (未存在なら null) */
  getController: (modelId: string | null) => LipSyncController | null;
  /** useFrame から毎フレーム呼ぶ */
  update: (delta: number) => void;
  /** 指定モデルに音声ファイル URL を割当てて再生開始する */
  playAudio: (
    modelId: string,
    url: string,
    options?: AudioSourceOptions
  ) => Promise<HTMLAudioElement | null>;
  /** 指定モデルに MediaStream を割当てる */
  attachStream: (
    modelId: string,
    stream: MediaStream,
    options?: AudioSourceOptions
  ) => Promise<void>;
  /** 指定モデルの音声接続を解除 */
  stop: (modelId: string) => void;
  setEnabled: (modelId: string, enabled: boolean) => void;
}

/**
 * モデル一覧と同期して LipSyncController を生成・破棄する。
 */
export function useLipSync(
  models: CharacterModel[],
  options?: UseLipSyncOptions
): LipSyncApi {
  const controllersRef = useRef<Map<string, LipSyncController>>(new Map());
  const detectorFactoryRef = useRef(options?.detectorFactory);
  detectorFactoryRef.current = options?.detectorFactory;

  useEffect(() => {
    const map = controllersRef.current;
    const currentIds = new Set(models.map((m) => m.id));

    for (const [id, ctrl] of map) {
      if (!currentIds.has(id)) {
        ctrl.dispose();
        map.delete(id);
      }
    }

    for (const model of models) {
      if (!map.has(model.id)) {
        map.set(
          model.id,
          new LipSyncController(model, {
            detectorFactory: detectorFactoryRef.current,
          })
        );
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
    (modelId: string | null): LipSyncController | null => {
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

  const playAudio = useCallback(
    async (
      modelId: string,
      url: string,
      audioOptions?: AudioSourceOptions
    ): Promise<HTMLAudioElement | null> => {
      const ctrl = controllersRef.current.get(modelId);
      if (!ctrl) return null;
      const source = await createAudioSourceFromUrl(url, audioOptions);
      ctrl.attach(source);
      const audio = source.audio;
      if (audio) {
        try {
          await audio.play();
        } catch {
          // 自動再生制限などで失敗した場合、呼び出し側で audio.play() を再試行可能
        }
      }
      return audio;
    },
    []
  );

  const attachStream = useCallback(
    async (
      modelId: string,
      stream: MediaStream,
      audioOptions?: AudioSourceOptions
    ): Promise<void> => {
      const ctrl = controllersRef.current.get(modelId);
      if (!ctrl) return;
      const source = await createAudioSourceFromStream(stream, audioOptions);
      ctrl.attach(source);
    },
    []
  );

  const stop = useCallback((modelId: string) => {
    const ctrl = controllersRef.current.get(modelId);
    if (!ctrl) return;
    ctrl.detach();
  }, []);

  const setEnabled = useCallback((modelId: string, enabled: boolean) => {
    const ctrl = controllersRef.current.get(modelId);
    if (!ctrl) return;
    ctrl.setEnabled(enabled);
  }, []);

  return { getController, update, playAudio, attachStream, stop, setEnabled };
}
