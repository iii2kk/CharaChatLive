"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FloatingWindowOverlay from "@/components/FloatingWindowOverlay";
import ChatInputBar from "@/components/ChatInputBar";
import type { ModelEntry, ModelFile } from "@/types/models";
import type { PresetMotion } from "@/types/motions";
import type { TexturePresets } from "@/types/textures";
import { useModelLoader } from "@/hooks/useModelLoader";
import { useSceneObjects } from "@/hooks/useSceneObjects";
import { useCharacterMovement } from "@/hooks/useCharacterMovement";
import { useLipSync } from "@/hooks/useLipSync";
import type { PlacementGizmoTarget } from "@/components/ModelPlacementGizmo";
import type { InteractionMode } from "@/lib/interaction-mode";
import {
  defaultViewerSettings,
  type ViewerSettings,
} from "@/lib/viewer-settings";
import {
  buildFileMap,
  findAnimationFiles,
  findModelFileEntry,
  getAnimationKind,
  revokeFileMap,
  type AnimationKind,
} from "@/lib/file-map";
import {
  createDirectionalLight,
  type SceneLight,
} from "@/lib/scene-lights";
import { streamChatResponse } from "@/lib/chat-stream";
import { synthesizeSpeechUrl } from "@/lib/tts";
import type {
  ChatMessage,
  ChatSendPayload,
  ChatTargetMode,
  ChatTargetsSnapshot,
  ChatTargetSnapshot,
  SpeechBubble,
} from "@/types/chat";
import type { VoiceProfile } from "@/types/tts";

const CharacterViewer = dynamic(() => import("@/components/CharacterViewer"), {
  ssr: false,
});

const EMPTY_CHAT_TARGETS: ChatTargetsSnapshot = {
  front: null,
  nearby: [],
};

const SPEECH_BUBBLE_DONE_DURATION_MS = 6000;
const SPEECH_BUBBLE_THROTTLE_MS = 140;

function createMessageId() {
  return `message-${crypto.randomUUID()}`;
}

function createBubbleId(modelId: string) {
  return `speech-bubble-${modelId}`;
}

function shouldRespond(): boolean {
  return true;
}

export default function Home() {
  const [viewerSettings, setViewerSettings] =
    useState<ViewerSettings>(defaultViewerSettings);
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("orbit");
  const [focusRequest, setFocusRequest] = useState<{
    modelId: string;
    nonce: number;
  } | null>(null);
  const [lights, setLights] = useState<SceneLight[]>(() => [
    createDirectionalLight({ name: "Directional Light 1" }),
  ]);
  const [activeLightId, setActiveLightId] = useState<string | null>(() =>
    lights[0]?.id ?? null
  );
  const {
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
  } = useModelLoader(viewerSettings);
  const { getController: getMovementController } = useCharacterMovement(models);
  const {
    getController: getLipSyncController,
    playAudio: playLipSyncAudio,
    stop: stopLipSyncAudio,
  } = useLipSync(models, {
    spatialAudioEnabled: viewerSettings.spatialAudioEnabled,
    spatialAudioMode: viewerSettings.spatialAudioMode,
  });
  const {
    sceneObjects,
    activeSceneObjectId,
    setActiveSceneObjectId,
    addSceneObjectFromPath,
    removeSceneObject,
    setSceneObjectScale,
    setSceneObjectMorph,
    resetSceneObjectMorphs,
    scaleVersion: sceneObjectScaleVersion,
    morphVersion: sceneObjectMorphVersion,
  } = useSceneObjects();
  const [lastSelectedKind, setLastSelectedKind] = useState<"model" | "prop">(
    "model"
  );
  const [animationUrlState, setAnimationUrlState] = useState<string[]>([]);
  const [presetModels, setPresetModels] = useState<ModelEntry[]>([]);
  const [presetObjects, setPresetObjects] = useState<ModelEntry[]>([]);
  const [presetMotions, setPresetMotions] = useState<PresetMotion[]>([]);
  const [texturePresets, setTexturePresets] = useState<TexturePresets>({
    ground: [],
    background: [],
  });
  const [chatTargetMode, setChatTargetMode] =
    useState<ChatTargetMode>("front");
  const [chatTargets, setChatTargets] =
    useState<ChatTargetsSnapshot>(EMPTY_CHAT_TARGETS);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [speechBubbles, setSpeechBubbles] = useState<SpeechBubble[]>([]);
  const [chatSending, setChatSending] = useState(false);
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([]);
  const [voiceProfilesLoading, setVoiceProfilesLoading] = useState(false);
  const [voiceProfilesError, setVoiceProfilesError] = useState<string | null>(
    null
  );
  const [selectedVoiceProfileIds, setSelectedVoiceProfileIds] = useState<
    Record<string, string | null>
  >({});
  const bubbleUpdateTimesRef = useRef<Map<string, number>>(new Map());
  const ttsAudioUrlsRef = useRef<Map<string, () => void>>(new Map());

  const activeChatTargets = useMemo(() => {
    if (chatTargetMode === "front") {
      return chatTargets.front ? [chatTargets.front] : [];
    }
    return chatTargets.nearby;
  }, [chatTargetMode, chatTargets.front, chatTargets.nearby]);

  const clearAnimationUrls = useCallback(() => {
    setAnimationUrlState((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return [];
    });
  }, []);

  const reloadVoiceProfiles = useCallback(async () => {
    setVoiceProfilesLoading(true);
    setVoiceProfilesError(null);
    try {
      const response = await fetch("/api/tts/voice-profiles", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const profiles = (await response.json()) as VoiceProfile[];
      setVoiceProfiles(profiles);
    } catch (error) {
      setVoiceProfilesError(
        error instanceof Error
          ? error.message
          : "音声プロファイルの取得に失敗しました"
      );
      setVoiceProfiles([]);
    } finally {
      setVoiceProfilesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data: ModelEntry[]) => setPresetModels(data))
      .catch(() => {});
    fetch("/api/objects")
      .then((res) => res.json())
      .then((data: ModelEntry[]) => setPresetObjects(data))
      .catch(() => {});
    fetch("/api/textures")
      .then((res) => res.json())
      .then((data: TexturePresets) => setTexturePresets(data))
      .catch(() => {});
    fetch("/api/motions")
      .then((res) => res.json())
      .then((data: PresetMotion[]) => setPresetMotions(data))
      .catch(() => {});
    void reloadVoiceProfiles();
  }, [reloadVoiceProfiles]);

  const presetMotionsByKindRef = useCallback(
    (modelKind: "mmd" | "vrm" | "live2d"): PresetMotion[] => {
      const kind: AnimationKind | null =
        modelKind === "mmd"
          ? "vmd"
          : modelKind === "vrm"
          ? "vrma"
          : null;
      if (!kind) return [];
      return presetMotions.filter((m) => m.kind === kind);
    },
    [presetMotions]
  );

  const attachPresetMotions = useCallback(
    (modelId: string, modelKind: "mmd" | "vrm" | "live2d") => {
      const items = presetMotionsByKindRef(modelKind).map((m, index) => ({
        url: m.path,
        name: m.name,
        sortIndex: index,
      }));
      void registerPresetMotions(modelId, items);
    },
    [presetMotionsByKindRef, registerPresetMotions]
  );

  useEffect(() => {
    return () => {
      animationUrlState.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [animationUrlState]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setSpeechBubbles((prev) =>
        prev.filter((bubble) => !bubble.expiresAt || bubble.expiresAt > now)
      );
    }, 500);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      for (const revoke of ttsAudioUrlsRef.current.values()) {
        revoke();
      }
      ttsAudioUrlsRef.current.clear();
    },
    []
  );

  useEffect(() => {
    if (interactionMode !== "placement") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInteractionMode("orbit");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [interactionMode]);

  const handlePresetSelected = useCallback(
    (
      file: ModelFile,
      options?: { tPoseCorrection?: { enabled: boolean; armAngleDeg?: number } }
    ) => {
      clearAnimationUrls();
      loadModelFromPath(file.path, {
        name: file.name,
        tPoseCorrection: options?.tPoseCorrection,
        onLoaded: (modelId, modelKind) => {
          attachPresetMotions(modelId, modelKind);
        },
      });
      setLastSelectedKind("model");
    },
    [attachPresetMotions, clearAnimationUrls, loadModelFromPath]
  );

  const handlePresetPropSelected = useCallback(
    (file: ModelFile) => {
      void addSceneObjectFromPath(file.path, file.name);
      setLastSelectedKind("prop");
    },
    [addSceneObjectFromPath]
  );

  const handleActiveModelChange = useCallback(
    (modelId: string) => {
      setActiveModelId(modelId);
      setLastSelectedKind("model");
    },
    [setActiveModelId]
  );

  const handleActiveSceneObjectChange = useCallback(
    (id: string) => {
      setActiveSceneObjectId(id);
      setLastSelectedKind("prop");
    },
    [setActiveSceneObjectId]
  );

  const placementGizmoTarget: PlacementGizmoTarget | null = (() => {
    if (lastSelectedKind === "prop") {
      const obj = sceneObjects.find((o) => o.id === activeSceneObjectId);
      if (obj) return { id: obj.id, object: obj.object };
    }
    if (activeModel) {
      return { id: activeModel.id, object: activeModel.object };
    }
    const obj = sceneObjects.find((o) => o.id === activeSceneObjectId);
    if (obj) return { id: obj.id, object: obj.object };
    return null;
  })();

  const handleModelFolderSelected = useCallback(
    (files: FileList) => {
      clearAnimationUrls();

      const fileMap = buildFileMap(files);
      const modelEntry = findModelFileEntry(fileMap);

      if (!modelEntry) {
        revokeFileMap(fileMap);
        return;
      }

      const animationKind: AnimationKind = (() => {
        switch (modelEntry.kind) {
          case "vrm":
            return "vrma";
          case "live2d":
            return "motion3";
          case "mmd":
          default:
            return "vmd";
        }
      })();
      const animationUrls = findAnimationFiles(fileMap, animationKind);

      loadModel(modelEntry.kind, modelEntry.url, fileMap, {
        name: modelEntry.name,
        onLoaded: (modelId, modelKind) => {
          attachPresetMotions(modelId, modelKind);
          if (animationUrls.length > 0) {
            loadAnimation(animationKind, animationUrls, modelId);
          }
        },
      });
    },
    [attachPresetMotions, clearAnimationUrls, loadAnimation, loadModel]
  );

  const handleAnimationFilesSelected = useCallback(
    (files: FileList) => {
      clearAnimationUrls();

      const filesArray = Array.from(files);
      const detectedKind = filesArray.find((file) => getAnimationKind(file.name))
        ?.name;

      if (!detectedKind) {
        return;
      }

      const animationKind = getAnimationKind(detectedKind);
      if (!animationKind) {
        return;
      }

      const urls = filesArray
        .filter((file) => getAnimationKind(file.name) === animationKind)
        .map((file) => URL.createObjectURL(file));

      if (urls.length > 0) {
        setAnimationUrlState(urls);
        loadAnimation(animationKind, urls);
      }
    },
    [clearAnimationUrls, loadAnimation]
  );

  const handleFocusModel = useCallback((modelId: string) => {
    setActiveModelId(modelId);
    setLastSelectedKind("model");
    setFocusRequest({
      modelId,
      nonce: performance.now(),
    });
  }, [setActiveModelId]);

  const upsertSpeechBubble = useCallback(
    (
      modelId: string,
      text: string,
      status: SpeechBubble["status"],
      options?: { durationMs?: number; force?: boolean }
    ) => {
      const now = Date.now();
      const last = bubbleUpdateTimesRef.current.get(modelId) ?? 0;
      if (!options?.force && status === "streaming" && now - last < SPEECH_BUBBLE_THROTTLE_MS) {
        return;
      }
      bubbleUpdateTimesRef.current.set(modelId, now);

      setSpeechBubbles((prev) => {
        const nextBubble: SpeechBubble = {
          id: createBubbleId(modelId),
          modelId,
          text,
          createdAt: now,
          expiresAt:
            options?.durationMs !== undefined ? now + options.durationMs : null,
          status,
        };
        const rest = prev.filter((bubble) => bubble.modelId !== modelId);
        return [...rest, nextBubble];
      });
    },
    []
  );

  const clearSpeechBubble = useCallback((modelId: string | null) => {
    setSpeechBubbles((prev) =>
      modelId ? prev.filter((bubble) => bubble.modelId !== modelId) : []
    );
  }, []);

  const updateAssistantMessage = useCallback(
    (
      messageId: string,
      updater: (message: ChatMessage) => ChatMessage
    ) => {
      setChatMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? updater(message) : message
        )
      );
    },
    []
  );

  const playTtsForModel = useCallback(
    async (target: ChatTargetSnapshot, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const previousRevoke = ttsAudioUrlsRef.current.get(target.id);
      previousRevoke?.();
      ttsAudioUrlsRef.current.delete(target.id);

      const audioUrl = await synthesizeSpeechUrl(target, trimmed, {
        voiceProfileId: selectedVoiceProfileIds[target.id] ?? null,
      });
      ttsAudioUrlsRef.current.set(target.id, audioUrl.revoke);

      const audio = await playLipSyncAudio(target.id, audioUrl.url);
      if (!audio) {
        audioUrl.revoke();
        ttsAudioUrlsRef.current.delete(target.id);
        return;
      }

      const cleanup = () => {
        audio.removeEventListener("ended", cleanup);
        audio.removeEventListener("error", cleanup);
        const revoke = ttsAudioUrlsRef.current.get(target.id);
        if (revoke === audioUrl.revoke) {
          revoke();
          ttsAudioUrlsRef.current.delete(target.id);
        }
      };
      audio.addEventListener("ended", cleanup);
      audio.addEventListener("error", cleanup);
    },
    [playLipSyncAudio, selectedVoiceProfileIds]
  );

  const runModelChatStream = useCallback(
    async (
      target: ChatTargetSnapshot,
      payload: ChatSendPayload,
      history: ChatMessage[]
    ) => {
      const assistantMessageId = createMessageId();
      const startedAt = Date.now();
      let streamedText = "";

      setChatMessages((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          createdAt: startedAt,
          targetMode: chatTargetMode,
          modelId: target.id,
          modelName: target.name,
          modelKind: target.kind,
          status: "streaming",
        },
      ]);
      upsertSpeechBubble(target.id, "...", "streaming", { force: true });

      try {
        await streamChatResponse(
          {
            targetMode: chatTargetMode,
            model: target,
            userMessage: payload.text,
            attachments: payload.attachments,
            history,
          },
          (delta) => {
            streamedText += delta;
            updateAssistantMessage(assistantMessageId, (message) => ({
              ...message,
              content: message.content + delta,
            }));
            upsertSpeechBubble(target.id, streamedText, "streaming");
          }
        );

        updateAssistantMessage(assistantMessageId, (message) => ({
          ...message,
          content: message.content || streamedText,
          status: "done",
        }));
        upsertSpeechBubble(
          target.id,
          streamedText || "応答が空でした",
          "done",
          {
            durationMs: SPEECH_BUBBLE_DONE_DURATION_MS,
            force: true,
          }
        );
        void playTtsForModel(target, streamedText).catch((error) => {
          console.error("TTS playback failed:", error);
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "チャット応答に失敗しました";
        updateAssistantMessage(assistantMessageId, (current) => ({
          ...current,
          content: streamedText || message,
          status: "error",
        }));
        upsertSpeechBubble(target.id, streamedText || message, "error", {
          durationMs: SPEECH_BUBBLE_DONE_DURATION_MS,
          force: true,
        });
      }
    },
    [
      chatTargetMode,
      playTtsForModel,
      updateAssistantMessage,
      upsertSpeechBubble,
    ]
  );

  const handleChatSend = useCallback(
    async (payload: ChatSendPayload) => {
      const targets = activeChatTargets.filter(shouldRespond);
      if (targets.length === 0 || chatSending) return;

      const now = Date.now();
      const userMessage: ChatMessage = {
        id: createMessageId(),
        role: "user",
        content: payload.text,
        createdAt: now,
        targetMode: chatTargetMode,
        attachments: payload.attachments,
      };
      const history = chatMessages.slice(-24);

      setChatMessages((prev) => [...prev, userMessage]);
      setChatSending(true);

      try {
        for (const target of targets) {
          await runModelChatStream(target, payload, history);
        }
      } finally {
        setChatSending(false);
      }
    },
    [
      activeChatTargets,
      chatMessages,
      chatSending,
      chatTargetMode,
      runModelChatStream,
    ]
  );

  const handleSpeechBubbleDebugShow = useCallback(
    (modelId: string, text: string, durationMs: number) => {
      upsertSpeechBubble(modelId, text, "done", {
        durationMs,
        force: true,
      });
    },
    [upsertSpeechBubble]
  );

  const handleVoiceProfileChange = useCallback(
    (modelId: string, profileId: string | null) => {
      setSelectedVoiceProfileIds((prev) => ({
        ...prev,
        [modelId]: profileId,
      }));
    },
    []
  );

  return (
    <div className="h-full w-full relative">
      <div className="h-full w-full">
        <CharacterViewer
          models={models}
          activeModel={activeModel}
          activeModelId={activeModelId}
          onActiveModelChange={handleActiveModelChange}
          focusRequest={focusRequest}
          lights={lights}
          activeLightId={activeLightId}
          onActiveLightChange={setActiveLightId}
          onLightsChange={setLights}
          interactionMode={interactionMode}
          viewerSettings={viewerSettings}
          getMovementController={getMovementController}
          getLipSyncController={getLipSyncController}
          sceneObjects={sceneObjects}
          activeSceneObjectId={activeSceneObjectId}
          onActiveSceneObjectChange={handleActiveSceneObjectChange}
          placementGizmoTarget={placementGizmoTarget}
          sceneObjectScaleVersion={sceneObjectScaleVersion}
          speechBubbles={speechBubbles}
          onChatTargetsChange={setChatTargets}
        />
      </div>
      <FloatingWindowOverlay
        presetModels={presetModels}
        presetObjects={presetObjects}
        texturePresets={texturePresets}
        onPresetSelected={handlePresetSelected}
        onPresetPropSelected={handlePresetPropSelected}
        sceneObjects={sceneObjects}
        activeSceneObjectId={activeSceneObjectId}
        onActiveSceneObjectChange={handleActiveSceneObjectChange}
        onRemoveSceneObject={removeSceneObject}
        onSceneObjectScaleChange={setSceneObjectScale}
        sceneObjectScaleVersion={sceneObjectScaleVersion}
        onSceneObjectMorphChange={setSceneObjectMorph}
        onSceneObjectMorphReset={resetSceneObjectMorphs}
        sceneObjectMorphVersion={sceneObjectMorphVersion}
        onModelFolderSelected={handleModelFolderSelected}
        onAnimationFilesSelected={handleAnimationFilesSelected}
        loadedModels={models}
        activeModel={activeModel}
        activeModelId={activeModelId}
        onActiveModelChange={handleActiveModelChange}
        onFocusModel={handleFocusModel}
        onRemoveModel={removeModel}
        loading={loading}
        error={error}
        modelName={activeModel?.name ?? null}
        animationLoaded={activeModel?.animation.isLoaded() ?? false}
        lights={lights}
        activeLightId={activeLightId}
        onActiveLightChange={setActiveLightId}
        onLightsChange={setLights}
        interactionMode={interactionMode}
        onInteractionModeChange={setInteractionMode}
        viewerSettings={viewerSettings}
        onViewerSettingsChange={setViewerSettings}
        onRenderScaleChange={setModelRenderScale}
        onDisplayScaleChange={setModelDisplayScale}
        getMovementController={getMovementController}
        onLipSyncPlay={playLipSyncAudio}
        onLipSyncStop={stopLipSyncAudio}
        chatMessages={chatMessages}
        onSpeechBubbleDebugShow={handleSpeechBubbleDebugShow}
        onSpeechBubbleDebugClear={clearSpeechBubble}
        voiceProfiles={voiceProfiles}
        voiceProfilesLoading={voiceProfilesLoading}
        voiceProfilesError={voiceProfilesError}
        selectedVoiceProfileId={
          activeModelId ? selectedVoiceProfileIds[activeModelId] ?? null : null
        }
        onVoiceProfileChange={handleVoiceProfileChange}
        onVoiceProfilesReload={reloadVoiceProfiles}
      />
      <ChatInputBar
        targetMode={chatTargetMode}
        onTargetModeChange={setChatTargetMode}
        targets={chatTargets}
        sending={chatSending}
        onSend={handleChatSend}
      />
    </div>
  );
}
