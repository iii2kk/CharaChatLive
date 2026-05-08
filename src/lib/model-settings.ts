import type {
  MotionMappingKey,
  SemanticExpressionKey,
} from "@/lib/character/types";

export const MODEL_SETTINGS_SCHEMA_VERSION = 1;

export const MODEL_SETTINGS_MOTION_KEYS: readonly MotionMappingKey[] = [
  "idle",
  "walk",
  "run",
];

export const MODEL_SETTINGS_EXPRESSION_KEYS: readonly SemanticExpressionKey[] = [
  "blink",
  "blinkLeft",
  "blinkRight",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
];

export type ModelSettingsMotionMapping = Partial<
  Record<MotionMappingKey, string | null>
>;

export type ModelSettingsExpressionMapping = Partial<
  Record<SemanticExpressionKey, string | null>
>;

export interface ModelSettings {
  schemaVersion: typeof MODEL_SETTINGS_SCHEMA_VERSION;
  modelPath: string;
  updatedAt: string;
  motionMapping?: ModelSettingsMotionMapping;
  expressionMapping?: ModelSettingsExpressionMapping;
  voiceProfileId?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStringNullMapping<Key extends string>(
  value: unknown,
  keys: readonly Key[]
): Partial<Record<Key, string | null>> | undefined {
  if (!isRecord(value)) return undefined;

  const out: Partial<Record<Key, string | null>> = {};
  let hasValue = false;

  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" || item === null) {
      out[key] = item;
      hasValue = true;
    }
  }

  return hasValue ? out : undefined;
}

export function normalizeModelSettings(
  value: unknown,
  expectedModelPath?: string
): ModelSettings | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== MODEL_SETTINGS_SCHEMA_VERSION) return null;
  if (typeof value.modelPath !== "string") return null;
  if (expectedModelPath !== undefined && value.modelPath !== expectedModelPath) {
    return null;
  }
  if (typeof value.updatedAt !== "string") return null;

  const settings: ModelSettings = {
    schemaVersion: MODEL_SETTINGS_SCHEMA_VERSION,
    modelPath: value.modelPath,
    updatedAt: value.updatedAt,
  };

  const motionMapping = normalizeStringNullMapping(
    value.motionMapping,
    MODEL_SETTINGS_MOTION_KEYS
  );
  if (motionMapping) {
    settings.motionMapping = motionMapping;
  }

  const expressionMapping = normalizeStringNullMapping(
    value.expressionMapping,
    MODEL_SETTINGS_EXPRESSION_KEYS
  );
  if (expressionMapping) {
    settings.expressionMapping = expressionMapping;
  }

  if (typeof value.voiceProfileId === "string" || value.voiceProfileId === null) {
    settings.voiceProfileId = value.voiceProfileId;
  }

  return settings;
}
