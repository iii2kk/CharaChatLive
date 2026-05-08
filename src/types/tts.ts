export type VoiceProfileKind = "reference" | "voice_design" | string;

export interface VoiceProfile {
  id: string;
  name: string;
  kind: VoiceProfileKind;
  description?: string | null;
  sample_rate?: number | null;
  has_reference?: boolean;
  default_caption?: string | null;
}
