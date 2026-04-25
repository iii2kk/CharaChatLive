"use client";

import { useCallback } from "react";
import FloatingWindow from "@/components/FloatingWindow";
import {
  useFloatingWindows,
  WINDOW_IDS,
  WINDOW_LABELS,
  type WindowId,
} from "@/hooks/useFloatingWindows";
import type { ModelEntry, ModelFile } from "@/types/models";
import type { TexturePresets } from "@/types/textures";
import type { CharacterModel } from "@/hooks/useModelLoader";
import type { MovementController } from "@/lib/character/movementController";
import type { InteractionMode } from "@/lib/interaction-mode";
import type { ViewerSettings } from "@/lib/viewer-settings";
import type { SceneLight } from "@/lib/scene-lights";

import PresetModelsWindow from "@/components/windows/PresetModelsWindow";
import PresetTexturesWindow from "@/components/windows/PresetTexturesWindow";
import FileUploadWindow from "@/components/windows/FileUploadWindow";
import LoadedModelsWindow from "@/components/windows/LoadedModelsWindow";
import LightsWindow from "@/components/windows/LightsWindow";
import EnvironmentLightWindow from "@/components/windows/EnvironmentLightWindow";
import InteractionModeWindow from "@/components/windows/InteractionModeWindow";
import DisplaySettingsWindow from "@/components/windows/DisplaySettingsWindow";
import ExpressionControlWindow from "@/components/windows/ExpressionControlWindow";
import MotionControlWindow from "@/components/windows/MotionControlWindow";
import MovementControlWindow from "@/components/windows/MovementControlWindow";
import MenuWindow from "@/components/windows/MenuWindow";

interface FloatingWindowOverlayProps {
  presetModels: ModelEntry[];
  texturePresets: TexturePresets;
  onPresetSelected: (file: ModelFile) => void;
  onModelFolderSelected: (files: FileList) => void;
  onAnimationFilesSelected: (files: FileList) => void;
  loadedModels: CharacterModel[];
  activeModel: CharacterModel | null;
  activeModelId: string | null;
  onActiveModelChange: (modelId: string) => void;
  onFocusModel: (modelId: string) => void;
  onRemoveModel: (modelId: string) => void;
  loading: boolean;
  error: string | null;
  modelName: string | null;
  animationLoaded: boolean;
  lights: SceneLight[];
  activeLightId: string | null;
  onActiveLightChange: (lightId: string | null) => void;
  onLightsChange: React.Dispatch<React.SetStateAction<SceneLight[]>>;
  interactionMode: InteractionMode;
  onInteractionModeChange: (mode: InteractionMode) => void;
  viewerSettings: ViewerSettings;
  onViewerSettingsChange: React.Dispatch<React.SetStateAction<ViewerSettings>>;
  onRenderScaleChange: (modelId: string, scale: number) => void;
  onDisplayScaleChange: (modelId: string, scale: number) => void;
  getMovementController: (modelId: string | null) => MovementController | null;
}

/** Content window IDs (all except menu) */
const CONTENT_WINDOW_IDS = WINDOW_IDS.filter(
  (id): id is Exclude<WindowId, "menu"> => id !== "menu"
);

export default function FloatingWindowOverlay({
  presetModels,
  texturePresets,
  onPresetSelected,
  onModelFolderSelected,
  onAnimationFilesSelected,
  loadedModels,
  activeModel,
  activeModelId,
  onActiveModelChange,
  onFocusModel,
  onRemoveModel,
  loading,
  error,
  modelName,
  animationLoaded,
  lights,
  activeLightId,
  onActiveLightChange,
  onLightsChange,
  interactionMode,
  onInteractionModeChange,
  viewerSettings,
  onViewerSettingsChange,
  onRenderScaleChange,
  onDisplayScaleChange,
  getMovementController,
}: FloatingWindowOverlayProps) {
  const {
    windowStates,
    menuMinimized,
    bringToFront,
    setPosition,
    closeWindow,
    toggleWindow,
    toggleMenuMinimized,
  } = useFloatingWindows();

  const handleMenuToggle = useCallback(
    (id: string) => {
      toggleWindow(id as WindowId);
    },
    [toggleWindow]
  );

  const menuItems = CONTENT_WINDOW_IDS.map((id) => ({
    id,
    label: WINDOW_LABELS[id],
    visible: windowStates[id].visible,
  }));

  return (
    <div className="fixed inset-0 pointer-events-none">
      {/* Menu Window */}
      <FloatingWindow
        title={WINDOW_LABELS.menu}
        visible={windowStates.menu.visible}
        zIndex={windowStates.menu.zIndex}
        position={windowStates.menu.position}
        onPositionChange={(pos) => setPosition("menu", pos)}
        onFocus={() => bringToFront("menu")}
        minimized={menuMinimized}
        onMinimizeToggle={toggleMenuMinimized}
      >
        <MenuWindow windows={menuItems} onToggle={handleMenuToggle} />
      </FloatingWindow>

      {/* Preset Models */}
      <FloatingWindow
        title={WINDOW_LABELS.presetModels}
        visible={windowStates.presetModels.visible}
        zIndex={windowStates.presetModels.zIndex}
        position={windowStates.presetModels.position}
        onPositionChange={(pos) => setPosition("presetModels", pos)}
        onFocus={() => bringToFront("presetModels")}
        onClose={() => closeWindow("presetModels")}
      >
        <PresetModelsWindow
          presetModels={presetModels}
          onPresetSelected={onPresetSelected}
          loading={loading}
        />
      </FloatingWindow>

      {/* Preset Textures */}
      <FloatingWindow
        title={WINDOW_LABELS.presetTextures}
        visible={windowStates.presetTextures.visible}
        zIndex={windowStates.presetTextures.zIndex}
        position={windowStates.presetTextures.position}
        onPositionChange={(pos) => setPosition("presetTextures", pos)}
        onFocus={() => bringToFront("presetTextures")}
        onClose={() => closeWindow("presetTextures")}
      >
        <PresetTexturesWindow
          textures={texturePresets}
          viewerSettings={viewerSettings}
          onViewerSettingsChange={onViewerSettingsChange}
        />
      </FloatingWindow>

      {/* File Upload */}
      <FloatingWindow
        title={WINDOW_LABELS.fileUpload}
        visible={windowStates.fileUpload.visible}
        zIndex={windowStates.fileUpload.zIndex}
        position={windowStates.fileUpload.position}
        onPositionChange={(pos) => setPosition("fileUpload", pos)}
        onFocus={() => bringToFront("fileUpload")}
        onClose={() => closeWindow("fileUpload")}
      >
        <FileUploadWindow
          onModelFolderSelected={onModelFolderSelected}
          onAnimationFilesSelected={onAnimationFilesSelected}
          loading={loading}
          error={error}
          modelName={modelName}
        />
      </FloatingWindow>

      {/* Loaded Models */}
      <FloatingWindow
        title={WINDOW_LABELS.loadedModels}
        visible={windowStates.loadedModels.visible}
        zIndex={windowStates.loadedModels.zIndex}
        position={windowStates.loadedModels.position}
        onPositionChange={(pos) => setPosition("loadedModels", pos)}
        onFocus={() => bringToFront("loadedModels")}
        onClose={() => closeWindow("loadedModels")}
      >
        <LoadedModelsWindow
          loadedModels={loadedModels}
          activeModelId={activeModelId}
          onActiveModelChange={onActiveModelChange}
          onModelFocus={onFocusModel}
          onRemoveModel={onRemoveModel}
          modelName={modelName}
          animationLoaded={animationLoaded}
        />
      </FloatingWindow>

      {/* Lights */}
      <FloatingWindow
        title={WINDOW_LABELS.lights}
        visible={windowStates.lights.visible}
        zIndex={windowStates.lights.zIndex}
        position={windowStates.lights.position}
        onPositionChange={(pos) => setPosition("lights", pos)}
        onFocus={() => bringToFront("lights")}
        onClose={() => closeWindow("lights")}
      >
        <LightsWindow
          lights={lights}
          activeLightId={activeLightId}
          onActiveLightChange={onActiveLightChange}
          onLightsChange={onLightsChange}
        />
      </FloatingWindow>

      {/* Environment Light */}
      <FloatingWindow
        title={WINDOW_LABELS.environmentLight}
        visible={windowStates.environmentLight.visible}
        zIndex={windowStates.environmentLight.zIndex}
        position={windowStates.environmentLight.position}
        onPositionChange={(pos) => setPosition("environmentLight", pos)}
        onFocus={() => bringToFront("environmentLight")}
        onClose={() => closeWindow("environmentLight")}
      >
        <EnvironmentLightWindow
          viewerSettings={viewerSettings}
          onViewerSettingsChange={onViewerSettingsChange}
        />
      </FloatingWindow>

      {/* Interaction Mode */}
      <FloatingWindow
        title={WINDOW_LABELS.interactionMode}
        visible={windowStates.interactionMode.visible}
        zIndex={windowStates.interactionMode.zIndex}
        position={windowStates.interactionMode.position}
        onPositionChange={(pos) => setPosition("interactionMode", pos)}
        onFocus={() => bringToFront("interactionMode")}
        onClose={() => closeWindow("interactionMode")}
      >
        <InteractionModeWindow
          interactionMode={interactionMode}
          onInteractionModeChange={onInteractionModeChange}
          hasActiveModel={activeModel !== null}
        />
      </FloatingWindow>

      {/* Display Settings */}
      <FloatingWindow
        title={WINDOW_LABELS.displaySettings}
        visible={windowStates.displaySettings.visible}
        zIndex={windowStates.displaySettings.zIndex}
        position={windowStates.displaySettings.position}
        onPositionChange={(pos) => setPosition("displaySettings", pos)}
        onFocus={() => bringToFront("displaySettings")}
        onClose={() => closeWindow("displaySettings")}
      >
        <DisplaySettingsWindow
          viewerSettings={viewerSettings}
          onViewerSettingsChange={onViewerSettingsChange}
          physicsCapability={activeModel?.physics.capability ?? null}
          activeModel={activeModel}
          onRenderScaleChange={onRenderScaleChange}
          onDisplayScaleChange={onDisplayScaleChange}
        />
      </FloatingWindow>

      {/* Expression Control */}
      <FloatingWindow
        title={WINDOW_LABELS.expressionControl}
        visible={windowStates.expressionControl.visible}
        zIndex={windowStates.expressionControl.zIndex}
        position={windowStates.expressionControl.position}
        onPositionChange={(pos) => setPosition("expressionControl", pos)}
        onFocus={() => bringToFront("expressionControl")}
        onClose={() => closeWindow("expressionControl")}
      >
        <ExpressionControlWindow activeModel={activeModel} />
      </FloatingWindow>

      {/* Motion Control */}
      <FloatingWindow
        title={WINDOW_LABELS.motionControl}
        visible={windowStates.motionControl.visible}
        zIndex={windowStates.motionControl.zIndex}
        position={windowStates.motionControl.position}
        onPositionChange={(pos) => setPosition("motionControl", pos)}
        onFocus={() => bringToFront("motionControl")}
        onClose={() => closeWindow("motionControl")}
      >
        <MotionControlWindow activeModel={activeModel} />
      </FloatingWindow>

      {/* Movement Control */}
      <FloatingWindow
        title={WINDOW_LABELS.movementControl}
        visible={windowStates.movementControl.visible}
        zIndex={windowStates.movementControl.zIndex}
        position={windowStates.movementControl.position}
        onPositionChange={(pos) => setPosition("movementControl", pos)}
        onFocus={() => bringToFront("movementControl")}
        onClose={() => closeWindow("movementControl")}
      >
        <MovementControlWindow
          activeModel={activeModel}
          controller={getMovementController(activeModelId)}
        />
      </FloatingWindow>
    </div>
  );
}
