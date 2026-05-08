import type { VoiceProfile } from "@/types/tts";

export const runtime = "nodejs";

function getProfileBaseUrl(): string {
  const value =
    process.env.LOCAL_TTS_PROFILE_BASE_URL?.trim() ||
    process.env.LOCAL_TTS_BASE_URL?.trim() ||
    "http://localhost:8000";
  return value.replace(/\/$/, "");
}

function isVoiceProfile(value: unknown): value is VoiceProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as { id?: unknown; name?: unknown; kind?: unknown };
  return (
    typeof profile.id === "string" &&
    typeof profile.name === "string" &&
    typeof profile.kind === "string"
  );
}

export async function GET() {
  const baseUrl = getProfileBaseUrl();
  const headers: Record<string, string> = {};
  const apiKey = process.env.LOCAL_TTS_API_KEY?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const upstream = await fetch(`${baseUrl}/v1/voice-profiles`, {
    headers,
    cache: "no-store",
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return Response.json(
      { error: text || `voice profiles HTTP ${upstream.status}` },
      { status: upstream.status || 502 }
    );
  }

  const data = (await upstream.json()) as unknown;
  if (!Array.isArray(data)) {
    return Response.json({ error: "invalid voice profiles response" }, { status: 502 });
  }

  return Response.json(data.filter(isVoiceProfile));
}
