"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  bringWindowToFront,
  computeNextZIndex,
  initializeZMap,
  type FloatingWindowLayerConfig,
} from "@/lib/floating-window-layer";

const STORAGE_KEY = "chara-chat-live-floating-windows";

export type WindowId =
  | "menu"
  | "presetModels"
  | "presetProps"
  | "presetTextures"
  | "fileUpload"
  | "loadedModels"
  | "lights"
  | "environmentLight"
  | "interactionMode"
  | "displaySettings"
  | "expressionControl"
  | "motionControl"
  | "movementControl"
  | "lipSync";

export const WINDOW_IDS: WindowId[] = [
  "menu",
  "presetModels",
  "presetProps",
  "presetTextures",
  "fileUpload",
  "loadedModels",
  "lights",
  "environmentLight",
  "interactionMode",
  "displaySettings",
  "expressionControl",
  "motionControl",
  "movementControl",
  "lipSync",
];

export const WINDOW_LABELS: Record<WindowId, string> = {
  menu: "メニュー",
  presetModels: "プリセットモデル",
  presetProps: "プロップ配置",
  presetTextures: "背景・地面",
  fileUpload: "ファイル読み込み",
  loadedModels: "読み込み済みモデル",
  lights: "ライト",
  environmentLight: "環境ライト",
  interactionMode: "操作モード",
  displaySettings: "表示調整",
  expressionControl: "表情コントロール",
  motionControl: "モーションコントロール",
  movementControl: "移動コントロール",
  lipSync: "リップシンク",
};

interface WindowState {
  position: { x: number; y: number };
  visible: boolean;
  zIndex: number;
}

interface SavedState {
  windows: Record<string, WindowState>;
  menuMinimized: boolean;
}

const DEFAULT_LAYER_CONFIG: FloatingWindowLayerConfig = {
  minZIndex: 1000,
  maxZIndex: 1099,
};

const DEFAULT_POSITIONS: Record<WindowId, { x: number; y: number }> = {
  menu: { x: 16, y: 16 },
  presetModels: { x: 16, y: 120 },
  presetProps: { x: 16, y: 170 },
  presetTextures: { x: 16, y: 220 },
  fileUpload: { x: 16, y: 300 },
  loadedModels: { x: 16, y: 500 },
  lights: { x: 340, y: 16 },
  environmentLight: { x: 340, y: 300 },
  interactionMode: { x: 340, y: 500 },
  displaySettings: { x: 660, y: 16 },
  expressionControl: { x: 660, y: 500 },
  motionControl: { x: 980, y: 16 },
  movementControl: { x: 980, y: 500 },
  lipSync: { x: 660, y: 260 },
};

const DEFAULT_VISIBLE: Record<WindowId, boolean> = {
  menu: true,
  presetModels: true,
  presetProps: false,
  presetTextures: false,
  fileUpload: true,
  loadedModels: false,
  lights: false,
  environmentLight: false,
  interactionMode: false,
  displaySettings: false,
  expressionControl: false,
  motionControl: false,
  movementControl: false,
  lipSync: false,
};

function buildDefaultStates(config: FloatingWindowLayerConfig): Record<WindowId, WindowState> {
  const zMap = initializeZMap(WINDOW_IDS, config);
  const states = {} as Record<WindowId, WindowState>;
  for (const id of WINDOW_IDS) {
    states[id] = {
      position: DEFAULT_POSITIONS[id],
      visible: DEFAULT_VISIBLE[id],
      zIndex: zMap[id],
    };
  }
  return states;
}

function loadFromStorage(config: FloatingWindowLayerConfig): {
  windows: Record<WindowId, WindowState>;
  menuMinimized: boolean;
} {
  const defaults = buildDefaultStates(config);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { windows: defaults, menuMinimized: false };
    const saved: SavedState = JSON.parse(raw);
    const windows = { ...defaults };
    for (const id of WINDOW_IDS) {
      if (saved.windows && saved.windows[id]) {
        const s = saved.windows[id];
        windows[id] = {
          position: s.position ?? defaults[id].position,
          visible: s.visible ?? defaults[id].visible,
          zIndex: typeof s.zIndex === "number" ? s.zIndex : defaults[id].zIndex,
        };
      }
    }
    return {
      windows,
      menuMinimized: saved.menuMinimized ?? false,
    };
  } catch {
    return { windows: defaults, menuMinimized: false };
  }
}

export function useFloatingWindows(config: FloatingWindowLayerConfig = DEFAULT_LAYER_CONFIG) {
  // Always initialize with defaults to avoid hydration mismatch
  const [windowStates, setWindowStates] = useState<Record<WindowId, WindowState>>(() =>
    buildDefaultStates(config)
  );
  const [menuMinimized, setMenuMinimized] = useState(false);
  const hydratedRef = useRef(false);

  // Load saved state from localStorage after mount (client only)
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const saved = loadFromStorage(config);
    const hydrationTimer = window.setTimeout(() => {
      setWindowStates(saved.windows);
      setMenuMinimized(saved.menuMinimized);
    }, 0);
    return () => {
      window.clearTimeout(hydrationTimer);
    };
  }, [config]);

  // Debounced save to localStorage
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSaveRef = useRef(true); // Skip the initial save from default state
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      try {
        const data: SavedState = { windows: windowStates, menuMinimized };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        // ignore quota errors
      }
    }, 150);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [windowStates, menuMinimized]);

  const bringToFront = useCallback(
    (id: WindowId) => {
      setWindowStates((prev) => {
        const currentZMap = {} as Record<WindowId, number>;
        for (const wid of WINDOW_IDS) {
          currentZMap[wid] = prev[wid].zIndex;
        }
        const result = bringWindowToFront(
          id,
          currentZMap,
          computeNextZIndex(currentZMap, config),
          config
        );
        const next = { ...prev };
        for (const wid of WINDOW_IDS) {
          if (result.zMap[wid] !== prev[wid].zIndex) {
            next[wid] = { ...prev[wid], zIndex: result.zMap[wid] };
          }
        }
        return next;
      });
    },
    [config]
  );

  const setPosition = useCallback((id: WindowId, position: { x: number; y: number }) => {
    setWindowStates((prev) => ({
      ...prev,
      [id]: { ...prev[id], position },
    }));
  }, []);

  const closeWindow = useCallback((id: WindowId) => {
    setWindowStates((prev) => ({
      ...prev,
      [id]: { ...prev[id], visible: false },
    }));
  }, []);

  const showWindow = useCallback(
    (id: WindowId) => {
      setWindowStates((prev) => {
        const currentZMap = {} as Record<WindowId, number>;
        for (const wid of WINDOW_IDS) {
          currentZMap[wid] = prev[wid].zIndex;
        }
        const result = bringWindowToFront(
          id,
          currentZMap,
          computeNextZIndex(currentZMap, config),
          config
        );
        const next = { ...prev };
        for (const wid of WINDOW_IDS) {
          if (result.zMap[wid] !== prev[wid].zIndex) {
            next[wid] = { ...prev[wid], zIndex: result.zMap[wid] };
          }
        }
        next[id] = { ...next[id], visible: true };
        return next;
      });
    },
    [config]
  );

  const toggleWindow = useCallback(
    (id: WindowId) => {
      setWindowStates((prev) => {
        if (prev[id].visible) {
          return { ...prev, [id]: { ...prev[id], visible: false } };
        }
        // Show and bring to front
        const currentZMap = {} as Record<WindowId, number>;
        for (const wid of WINDOW_IDS) {
          currentZMap[wid] = prev[wid].zIndex;
        }
        const result = bringWindowToFront(
          id,
          currentZMap,
          computeNextZIndex(currentZMap, config),
          config
        );
        const next = { ...prev };
        for (const wid of WINDOW_IDS) {
          if (result.zMap[wid] !== prev[wid].zIndex) {
            next[wid] = { ...prev[wid], zIndex: result.zMap[wid] };
          }
        }
        next[id] = { ...next[id], visible: true };
        return next;
      });
    },
    [config]
  );

  const toggleMenuMinimized = useCallback(() => {
    setMenuMinimized((prev) => !prev);
  }, []);

  return {
    windowStates,
    menuMinimized,
    bringToFront,
    setPosition,
    closeWindow,
    showWindow,
    toggleWindow,
    toggleMenuMinimized,
  };
}
