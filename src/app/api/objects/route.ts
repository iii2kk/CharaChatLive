import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { ModelEntry } from "@/types/models";

function collectObjectFiles(
  publicRootDir: string,
  currentDir: string,
  displayRootDir: string
): Array<{ name: string; path: string }> {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files: Array<{ name: string; path: string }> = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(
        ...collectObjectFiles(publicRootDir, fullPath, displayRootDir)
      );
      continue;
    }

    if (!/\.(pmx|pmd|vrm|glb|gltf)$/i.test(entry.name)) {
      continue;
    }

    const publicRelativeSegments = path
      .relative(publicRootDir, fullPath)
      .split(path.sep);
    const displayRelativePath = path
      .relative(displayRootDir, fullPath)
      .split(path.sep)
      .join("/");
    const urlPath = publicRelativeSegments.map(encodeURIComponent).join("/");

    files.push({
      name: displayRelativePath,
      path: `/objects/${urlPath}`,
    });
  }

  return files;
}

export async function GET() {
  const objectsDir = path.join(process.cwd(), "public", "objects");

  if (!fs.existsSync(objectsDir)) {
    return NextResponse.json([]);
  }

  const entries = fs.readdirSync(objectsDir, { withFileTypes: true });
  const objects: ModelEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = path.join(objectsDir, entry.name);
    const objectFiles = collectObjectFiles(objectsDir, dirPath, dirPath);

    if (objectFiles.length > 0) {
      objects.push({
        folder: entry.name,
        files: objectFiles,
      });
    }
  }

  return NextResponse.json(objects);
}
