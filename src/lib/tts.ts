import type { ChatTargetSnapshot } from "@/types/chat";

export interface TtsAudioUrl {
  url: string;
  revoke: () => void;
}

export async function synthesizeSpeechUrl(
  model: ChatTargetSnapshot,
  text: string,
  options?: { voiceProfileId?: string | null }
): Promise<TtsAudioUrl> {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      text,
      voiceProfileId: options?.voiceProfileId ?? null,
    }),
  });

  if (!response.ok) {
    throw new Error(`TTS HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  return {
    url,
    revoke: () => URL.revokeObjectURL(url),
  };
}
