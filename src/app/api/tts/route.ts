export const runtime = "nodejs";

interface TtsRouteRequest {
  text: string;
  model?: {
    id: string;
    name: string;
    kind: string;
  };
}

function getBaseUrl(): string | null {
  const value = process.env.LOCAL_TTS_BASE_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function createDebugWav(text: string): ArrayBuffer {
  const sampleRate = 24000;
  const durationSec = Math.min(4, Math.max(0.8, text.length * 0.045));
  const sampleCount = Math.floor(sampleRate * durationSec);
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate;
    const envelope = Math.min(1, t * 8, (durationSec - t) * 8);
    const syllable = 0.55 + 0.45 * Math.sin(t * Math.PI * 7);
    const wave =
      Math.sin(t * Math.PI * 2 * 180) * 0.55 +
      Math.sin(t * Math.PI * 2 * 360) * 0.25 +
      Math.sin(t * Math.PI * 2 * 720) * 0.12;
    const sample = Math.max(-1, Math.min(1, wave * envelope * syllable * 0.28));
    view.setInt16(44 + i * bytesPerSample, sample * 32767, true);
  }

  return buffer;
}

function debugResponse(payload: TtsRouteRequest): Response {
  const wav = createDebugWav(payload.text);
  return new Response(wav, {
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as TtsRouteRequest;
  const input = payload.text.trim();

  if (!input) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    return debugResponse(payload);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey =
    process.env.LOCAL_TTS_API_KEY?.trim() ||
    process.env.LOCAL_LLM_API_KEY?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const upstream = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: process.env.LOCAL_TTS_MODEL?.trim() || "tts-1",
      voice: process.env.LOCAL_TTS_VOICE?.trim() || "alloy",
      input,
      response_format: process.env.LOCAL_TTS_FORMAT?.trim() || "wav",
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return Response.json(
      { error: text || `TTS upstream HTTP ${upstream.status}` },
      { status: upstream.status || 502 }
    );
  }

  const audio = await upstream.arrayBuffer();
  return new Response(audio, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
