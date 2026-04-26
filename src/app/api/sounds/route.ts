import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export interface SoundEntry {
  /** 表示用 (public/sounds 配下からの相対パス) */
  name: string;
  /** ブラウザから fetch 可能な絶対パス (/sounds/...) */
  path: string;
}

const AUDIO_EXT = /\.(wav|mp3|ogg|m4a|aac|flac|webm)$/i;

function collectSoundFiles(rootDir: string, currentDir: string): SoundEntry[] {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files: SoundEntry[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSoundFiles(rootDir, fullPath));
      continue;
    }
    if (!AUDIO_EXT.test(entry.name)) continue;

    const segments = path.relative(rootDir, fullPath).split(path.sep);
    files.push({
      name: segments.join("/"),
      path: `/sounds/${segments.map(encodeURIComponent).join("/")}`,
    });
  }

  return files;
}

export async function GET() {
  const soundsDir = path.join(process.cwd(), "public", "sounds");
  if (!fs.existsSync(soundsDir)) {
    return NextResponse.json([]);
  }
  const list = collectSoundFiles(soundsDir, soundsDir);
  list.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json(list);
}
