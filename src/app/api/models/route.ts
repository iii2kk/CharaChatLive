import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export interface ModelEntry {
  folder: string;
  files: { name: string; path: string }[];
}

function collectModelFiles(
  publicRootDir: string,
  currentDir: string,
  displayRootDir: string
): Array<{ name: string; path: string }> {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files: Array<{ name: string; path: string }> = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectModelFiles(publicRootDir, fullPath, displayRootDir));
      continue;
    }

    if (!/\.(pmx|pmd|vrm|model3\.json)$/i.test(entry.name)) {
      continue;
    }

    const publicRelativePath = path
      .relative(publicRootDir, fullPath)
      .split(path.sep)
      .join("/");
    const displayRelativePath = path
      .relative(displayRootDir, fullPath)
      .split(path.sep)
      .join("/");

    files.push({
      name: displayRelativePath,
      path: `/models/${publicRelativePath}`,
    });
  }

  return files;
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
    const modelFiles = collectModelFiles(modelsDir, dirPath, dirPath);

    if (modelFiles.length > 0) {
      models.push({
        folder: entry.name,
        files: modelFiles,
      });
    }
  }

  return NextResponse.json(models);
}
