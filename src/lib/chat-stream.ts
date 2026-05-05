import type {
  ChatAttachment,
  ChatMessage,
  ChatTargetMode,
  ChatTargetSnapshot,
} from "@/types/chat";

export interface StreamChatRequest {
  targetMode: ChatTargetMode;
  model: ChatTargetSnapshot;
  userMessage: string;
  attachments: ChatAttachment[];
  history: ChatMessage[];
}

function extractDeltaFromJson(value: unknown): string {
  if (!value || typeof value !== "object") return "";

  const choices = (value as { choices?: unknown }).choices;
  if (Array.isArray(choices)) {
    return choices
      .map((choice) => {
        if (!choice || typeof choice !== "object") return "";
        const delta = (choice as { delta?: unknown }).delta;
        if (delta && typeof delta === "object") {
          const content = (delta as { content?: unknown }).content;
          return typeof content === "string" ? content : "";
        }
        const text = (choice as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }

  const delta = (value as { delta?: unknown }).delta;
  if (typeof delta === "string") return delta;

  const content = (value as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

function readSsePayload(payload: string): string | null {
  const lines = payload
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());

  if (lines.length === 0) return "";

  const data = lines.join("\n");
  if (data === "[DONE]") return null;

  try {
    return extractDeltaFromJson(JSON.parse(data));
  } catch {
    return data;
  }
}

export async function streamChatResponse(
  request: StreamChatRequest,
  onDelta: (delta: string) => void
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, stream: true }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error("レスポンスストリームがありません");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const delta = readSsePayload(chunk);
      if (delta === null) return;
      if (delta) onDelta(delta);
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const delta = readSsePayload(tail);
    if (delta) onDelta(delta);
  }
}
