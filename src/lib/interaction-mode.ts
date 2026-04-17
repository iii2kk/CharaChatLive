"use client";

export type InteractionMode = "orbit" | "freeCamera" | "placement";

export const INTERACTION_MODE_LABELS: Record<InteractionMode, string> = {
  orbit: "通常カメラ",
  freeCamera: "フリーカメラ",
  placement: "配置",
};
