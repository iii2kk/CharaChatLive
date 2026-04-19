import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

interface TextureFile {
  name: string;
  path: string;
  isEquirect?: boolean;
}

interface TextureEntry {
  folder: string;
  files: TextureFile[];
}

const IMAGE_REGEX = /\.(jpg|jpeg|png|webp|avif|hdr|exr)$/i;
const EQUIRECT_REGEX = /equirect|panorama|skybox|360/i;

function collectTextureFiles(
  rootDir: string,
  currentDir: string,
  displayRootDir: string,
  urlPrefix: string,
  markEquirect: boolean
): TextureFile[] {
  if (!fs.existsSync(currentDir)) return [];
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files: TextureFile[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      const nestedEquirect = markEquirect || EQUIRECT_REGEX.test(entry.name);
      files.push(
        ...collectTextureFiles(
          rootDir,
          fullPath,
          displayRootDir,
          urlPrefix,
          nestedEquirect
        )
      );
      continue;
    }

    if (!IMAGE_REGEX.test(entry.name)) continue;

    const rootRelativePath = path
      .relative(rootDir, fullPath)
      .split(path.sep)
      .join("/");
    const displayRelativePath = path
      .relative(displayRootDir, fullPath)
      .split(path.sep)
      .join("/");

    const isEquirect = markEquirect || EQUIRECT_REGEX.test(rootRelativePath);

    files.push({
      name: displayRelativePath,
      path: `${urlPrefix}/${rootRelativePath}`,
      ...(isEquirect ? { isEquirect: true } : {}),
    });
  }

  return files;
}

function collectEntries(rootDir: string, urlPrefix: string): TextureEntry[] {
  if (!fs.existsSync(rootDir)) return [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const results: TextureEntry[] = [];

  const looseFiles: TextureFile[] = [];
  for (const entry of entries) {
    if (entry.isFile() && IMAGE_REGEX.test(entry.name)) {
      const fullPath = path.join(rootDir, entry.name);
      const rootRelativePath = path
        .relative(rootDir, fullPath)
        .split(path.sep)
        .join("/");
      const isEquirect = EQUIRECT_REGEX.test(entry.name);
      looseFiles.push({
        name: entry.name,
        path: `${urlPrefix}/${rootRelativePath}`,
        ...(isEquirect ? { isEquirect: true } : {}),
      });
    }
  }
  if (looseFiles.length > 0) {
    results.push({ folder: "(root)", files: looseFiles });
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(rootDir, entry.name);
    const markEquirect = EQUIRECT_REGEX.test(entry.name);
    const files = collectTextureFiles(
      rootDir,
      dirPath,
      dirPath,
      urlPrefix,
      markEquirect
    );
    if (files.length > 0) {
      results.push({ folder: entry.name, files });
    }
  }

  return results;
}

export async function GET() {
  const groundDir = path.join(process.cwd(), "public", "textures", "ground");
  const backgroundDir = path.join(
    process.cwd(),
    "public",
    "textures",
    "backgrounds"
  );

  const ground = collectEntries(groundDir, "/textures/ground");
  const background = collectEntries(backgroundDir, "/textures/backgrounds");

  return NextResponse.json({ ground, background });
}
