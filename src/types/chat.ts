import type { ModelKind } from "@/lib/file-map";

export type ChatTargetMode = "front" | "nearby";

export interface ChatTargetSnapshot {
  id: string;
  name: string;
  kind: ModelKind;
  distance: number;
}

export interface ChatTargetsSnapshot {
  front: ChatTargetSnapshot | null;
  nearby: ChatTargetSnapshot[];
}

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export type ChatMessageRole = "user" | "assistant";

export type ChatMessageStatus = "streaming" | "done" | "error";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  createdAt: number;
  targetMode?: ChatTargetMode;
  modelId?: string;
  modelName?: string;
  modelKind?: ModelKind;
  attachments?: ChatAttachment[];
  status?: ChatMessageStatus;
}

export interface SpeechBubble {
  id: string;
  modelId: string;
  text: string;
  createdAt: number;
  expiresAt: number | null;
  status: ChatMessageStatus;
}

export interface ChatSendPayload {
  text: string;
  attachments: ChatAttachment[];
}
