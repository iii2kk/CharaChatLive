import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export interface ModelEntry {
  folder: string;
  files: { name: string; path: string }[];
}

export async function GET() {
  const modelsDir = path.join(process.cwd(), "public", "models");

  if (!fs.existsSync(modelsDir)) {
    return NextResponse.json([]);
  }

  const entries = fs.readdirSync(modelsDir, { withFileTypes: true });
  const models: ModelEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = path.join(modelsDir, entry.name);
    const files = fs.readdirSync(dirPath);
    const pmxFiles = files.filter((f) => /\.(pmx|pmd)$/i.test(f));

    if (pmxFiles.length > 0) {
      models.push({
        folder: entry.name,
        files: pmxFiles.map((f) => ({
          name: f,
          path: `/models/${entry.name}/${f}`,
        })),
      });
    }
  }

  return NextResponse.json(models);
}
