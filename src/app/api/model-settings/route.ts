import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  MODEL_SETTINGS_SCHEMA_VERSION,
  normalizeModelSettings,
  type ModelSettings,
} from "@/lib/model-settings";

interface ResolvedModelPath {
  modelPath: string;
  settingsPath: string;
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

function resolveModelPath(modelPath: string): ResolvedModelPath | null {
  let pathname: string;
  try {
    pathname = new URL(modelPath, "http://local").pathname;
  } catch {
    return null;
  }

  if (!pathname.startsWith("/models/")) {
    return null;
  }

  const encodedSegments = pathname.slice("/models/".length).split("/");
  if (encodedSegments.length === 0) {
    return null;
  }

  const decodedSegments: string[] = [];
  for (const segment of encodedSegments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (
      decoded.length === 0 ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      return null;
    }
    decodedSegments.push(decoded);
  }

  const filePath = path.join(
    process.cwd(),
    "public",
    "models",
    ...decodedSegments
  );

  return {
    modelPath: pathname,
    settingsPath: `${filePath}.chara-settings.json`,
  };
}

async function readRequestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const modelPath = url.searchParams.get("modelPath");
  if (!modelPath) {
    return badRequest("modelPath is required");
  }

  const resolved = resolveModelPath(modelPath);
  if (!resolved) {
    return badRequest("modelPath must point inside /models");
  }

  if (!fs.existsSync(resolved.settingsPath)) {
    return NextResponse.json({ settings: null });
  }

  try {
    const raw = fs.readFileSync(resolved.settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    const settings = normalizeModelSettings(parsed, resolved.modelPath);
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("[model-settings] read failed:", error);
    return NextResponse.json({ settings: null }, { status: 200 });
  }
}

export async function PUT(request: Request) {
  const body = await readRequestJson(request);
  const settings = normalizeModelSettings(body);
  if (!settings) {
    return badRequest("invalid model settings");
  }

  const resolved = resolveModelPath(settings.modelPath);
  if (!resolved) {
    return badRequest("modelPath must point inside /models");
  }

  const normalized: ModelSettings = {
    ...settings,
    schemaVersion: MODEL_SETTINGS_SCHEMA_VERSION,
    modelPath: resolved.modelPath,
    updatedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(
      resolved.settingsPath,
      `${JSON.stringify(normalized, null, 2)}\n`,
      "utf8"
    );
    return NextResponse.json({ settings: normalized });
  } catch (error) {
    console.error("[model-settings] write failed:", error);
    return NextResponse.json(
      { error: "failed to write model settings" },
      { status: 500 }
    );
  }
}
