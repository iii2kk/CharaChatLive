import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  const modelsDir = path.join(process.cwd(), "public", "models");

  if (!fs.existsSync(modelsDir)) {
    return NextResponse.json([]);
  }

  const entries = fs.readdirSync(modelsDir, { withFileTypes: true });
  const models: { name: string; path: string }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = path.join(modelsDir, entry.name);
    const files = fs.readdirSync(dirPath);
    const pmxFile = files.find((f) => /\.(pmx|pmd)$/i.test(f));

    if (pmxFile) {
      models.push({
        name: entry.name,
        path: `/models/${entry.name}/${pmxFile}`,
      });
    }
  }

  return NextResponse.json(models);
}
