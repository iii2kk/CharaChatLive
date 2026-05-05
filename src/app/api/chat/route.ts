import type { ChatAttachment, ChatMessage, ChatTargetMode } from "@/types/chat";

export const runtime = "nodejs";

interface ChatRouteRequest {
  targetMode: ChatTargetMode;
  model: {
    id: string;
    name: string;
    kind: string;
  };
  userMessage: string;
  attachments?: ChatAttachment[];
  history?: ChatMessage[];
  stream?: boolean;
}

interface OpenAiContentPartText {
  type: "text";
  text: string;
}

interface OpenAiContentPartImage {
  type: "image_url";
  image_url: {
    url: string;
  };
}

type OpenAiContent = string | Array<OpenAiContentPartText | OpenAiContentPartImage>;

interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: OpenAiContent;
  name?: string;
}

const encoder = new TextEncoder();

function sseChunk(content: string): Uint8Array {
  return encoder.encode(
    `data: ${JSON.stringify({
      choices: [{ delta: { content } }],
    })}\n\n`
  );
}

function sseDone(): Uint8Array {
  return encoder.encode("data: [DONE]\n\n");
}

function getBaseUrl(): string | null {
  const value = process.env.LOCAL_LLM_BASE_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

function toOpenAiHistory(history: ChatMessage[] | undefined): OpenAiMessage[] {
  if (!history) return [];

  return history
    .slice(-16)
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content,
      name:
        message.role === "assistant" && message.modelName
          ? message.modelName.replace(/[^\w-]/g, "_").slice(0, 64)
          : undefined,
    }));
}

function buildUserContent(
  text: string,
  attachments: ChatAttachment[] | undefined
): OpenAiContent {
  const images = (attachments ?? []).filter((attachment) =>
    attachment.type.startsWith("image/")
  );

  if (images.length === 0) {
    return text;
  }

  return [
    { type: "text", text },
    ...images.map((attachment) => ({
      type: "image_url" as const,
      image_url: { url: attachment.dataUrl },
    })),
  ];
}

function buildOpenAiBody(payload: ChatRouteRequest): Record<string, unknown> {
  const llmModel = process.env.LOCAL_LLM_MODEL?.trim() || "local-model";
  const targetMode =
    payload.targetMode === "nearby" ? "周囲の全員" : "正面のモデル";

  return {
    model: llmModel,
    stream: true,
    messages: [
      {
        role: "system",
        content:
          `あなたは「${payload.model.name}」として会話します。` +
          `対象モードは「${targetMode}」です。` +
          "短く自然に返答してください。",
      },
      ...toOpenAiHistory(payload.history),
      {
        role: "user",
        content: buildUserContent(payload.userMessage, payload.attachments),
      },
    ],
  };
}

function fakeStream(payload: ChatRouteRequest): Response {
  const chunks = [
    `${payload.model.name}です。`,
    payload.userMessage
      ? `「${payload.userMessage}」について考えています。`
      : "画像を受け取りました。",
    "これはローカルLLM未設定時のテスト応答です。",
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(sseChunk(chunk));
        await new Promise((resolve) => setTimeout(resolve, 260));
      }
      controller.enqueue(sseDone());
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as ChatRouteRequest;
  const baseUrl = getBaseUrl();

  if (!baseUrl) {
    return fakeStream(payload);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = process.env.LOCAL_LLM_API_KEY?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(buildOpenAiBody(payload)),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return Response.json(
      {
        error: text || `ローカルLLMが HTTP ${upstream.status} を返しました`,
      },
      { status: upstream.status || 502 }
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
