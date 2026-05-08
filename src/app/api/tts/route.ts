export const runtime = "nodejs";

interface TtsRouteRequest {
  text: string;
  voiceProfileId?: string | null;
  model?: {
    id: string;
    name: string;
    kind: string;
  };
}

type TtsProvider = "openai" | "irodori";

function getBaseUrl(provider: TtsProvider): string | null {
  const value = process.env.LOCAL_TTS_BASE_URL?.trim();
  if (value) return value.replace(/\/$/, "");
  return provider === "irodori" ? "http://localhost:8000" : null;
}

function getProvider(voiceProfileId?: string | null): TtsProvider {
  const value = process.env.LOCAL_TTS_PROVIDER?.trim().toLowerCase();
  if (value === "irodori") return "irodori";
  if (value === "openai") return "openai";
  return voiceProfileId ? "irodori" : "openai";
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function appendOptionalFormField(
  formData: FormData,
  field: string,
  envName: string
): void {
  const value = optionalEnv(envName);
  if (value !== null) {
    formData.append(field, value);
  }
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

async function requestOpenAiSpeech(
  baseUrl: string,
  input: string
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey =
    process.env.LOCAL_TTS_API_KEY?.trim() ||
    process.env.LOCAL_LLM_API_KEY?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: process.env.LOCAL_TTS_MODEL?.trim() || "tts-1",
      voice: process.env.LOCAL_TTS_VOICE?.trim() || "alloy",
      input,
      response_format: process.env.LOCAL_TTS_FORMAT?.trim() || "wav",
    }),
  });
}

async function requestIrodoriSpeech(
  baseUrl: string,
  input: string,
  voiceProfileId: string | null | undefined
): Promise<Response> {
  const formData = new FormData();
  formData.append("text", input);
  formData.append("num_candidates", "1");

  if (voiceProfileId) {
    formData.append("voice_profile_id", voiceProfileId);
  }

  const noRef = optionalEnv("IRODORI_TTS_NO_REF");
  if (noRef !== null) {
    formData.append("no_ref", noRef);
  } else if (!voiceProfileId) {
    formData.append("no_ref", "true");
  }

  appendOptionalFormField(formData, "caption", "IRODORI_TTS_CAPTION");
  appendOptionalFormField(formData, "seed", "IRODORI_TTS_SEED");
  appendOptionalFormField(formData, "num_steps", "IRODORI_TTS_NUM_STEPS");
  appendOptionalFormField(
    formData,
    "cfg_scale_text",
    "IRODORI_TTS_CFG_SCALE_TEXT"
  );
  appendOptionalFormField(
    formData,
    "cfg_scale_caption",
    "IRODORI_TTS_CFG_SCALE_CAPTION"
  );
  appendOptionalFormField(
    formData,
    "cfg_scale_speaker",
    "IRODORI_TTS_CFG_SCALE_SPEAKER"
  );
  appendOptionalFormField(
    formData,
    "cfg_guidance_mode",
    "IRODORI_TTS_CFG_GUIDANCE_MODE"
  );
  appendOptionalFormField(formData, "cfg_min_t", "IRODORI_TTS_CFG_MIN_T");
  appendOptionalFormField(formData, "cfg_max_t", "IRODORI_TTS_CFG_MAX_T");
  appendOptionalFormField(
    formData,
    "truncation_factor",
    "IRODORI_TTS_TRUNCATION_FACTOR"
  );
  appendOptionalFormField(formData, "rescale_k", "IRODORI_TTS_RESCALE_K");
  appendOptionalFormField(
    formData,
    "rescale_sigma",
    "IRODORI_TTS_RESCALE_SIGMA"
  );
  appendOptionalFormField(
    formData,
    "context_kv_cache",
    "IRODORI_TTS_CONTEXT_KV_CACHE"
  );
  appendOptionalFormField(
    formData,
    "speaker_kv_scale",
    "IRODORI_TTS_SPEAKER_KV_SCALE"
  );

  const headers: Record<string, string> = {};
  const apiKey = process.env.LOCAL_TTS_API_KEY?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return fetch(`${baseUrl}/v1/audio/speech`, {
    method: "POST",
    headers,
    body: formData,
  });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as TtsRouteRequest;
  const input = payload.text.trim();

  if (!input) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  const provider = getProvider(payload.voiceProfileId);
  const baseUrl = getBaseUrl(provider);
  if (!baseUrl) {
    return debugResponse(payload);
  }

  const upstream =
    provider === "irodori"
      ? await requestIrodoriSpeech(baseUrl, input, payload.voiceProfileId)
      : await requestOpenAiSpeech(baseUrl, input);

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return Response.json(
      {
        error:
          text || `${provider} TTS upstream HTTP ${upstream.status}`,
      },
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
