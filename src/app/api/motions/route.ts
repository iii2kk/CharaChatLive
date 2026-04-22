import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { AnimationKind } from "@/lib/file-map";

interface PresetMotionDto {
  name: string;
  path: string;
  kind: AnimationKind;
}

function classifyAnimation(fileName: string): AnimationKind | null {
  if (/\.vmd$/i.test(fileName)) return "vmd";
  if (/\.vrma$/i.test(fileName)) return "vrma";
  if (/\.motion3\.json$/i.test(fileName)) return "motion3";
  return null;
}

function collectMotionFiles(
  publicRootDir: string,
  currentDir: string
): PresetMotionDto[] {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const out: PresetMotionDto[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      out.push(...collectMotionFiles(publicRootDir, fullPath));
      continue;
    }

    const kind = classifyAnimation(entry.name);
    if (!kind) continue;

    const relativeSegments = path
      .relative(publicRootDir, fullPath)
      .split(path.sep);
    const displayPath = relativeSegments.join("/");
    // 各セグメントを percent-encode し、日本語・スペース・& を含むパスでも
    // fetch で 404 にならないようにする (URL 全体を encodeURI すると
    // / まで変換されるのでセグメント単位で encodeURIComponent する)
    const urlPath = relativeSegments.map(encodeURIComponent).join("/");

    out.push({
      name: displayPath,
      path: `/motions/${urlPath}`,
      kind,
    });
  }

  return out;
}

export async function GET() {
  const motionsDir = path.join(process.cwd(), "public", "motions");

  if (!fs.existsSync(motionsDir)) {
    return NextResponse.json([]);
  }

  const motions = collectMotionFiles(motionsDir, motionsDir);
  motions.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json(motions);
}
