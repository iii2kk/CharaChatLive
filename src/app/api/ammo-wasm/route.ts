import fs from "fs/promises";
import path from "path";

export async function GET() {
  const filePath = path.join(
    process.cwd(),
    "node_modules",
    "three",
    "examples",
    "jsm",
    "libs",
    "ammo.wasm.wasm"
  );
  const content = await fs.readFile(filePath);

  return new Response(content, {
    headers: {
      "Content-Type": "application/wasm",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
