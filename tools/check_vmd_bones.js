/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");

const path = process.argv[2];
if (!path) {
  console.error("usage: node tools/check_vmd_bones.js <file.vmd>");
  process.exit(2);
}

const decoder = new TextDecoder("shift_jis");

function fixed(buf, offset, len) {
  let bytes = buf.subarray(offset, offset + len);
  const zero = bytes.indexOf(0);
  if (zero >= 0) bytes = bytes.subarray(0, zero);
  return decoder.decode(bytes).replace(/\u0000/g, "").trim();
}

const buf = fs.readFileSync(path);
let offset = 0;
const header = fixed(buf, offset, 30);
offset += 30;
const model = fixed(buf, offset, 20);
offset += 20;
const count = buf.readUInt32LE(offset);
offset += 4;

const bones = new Map();
for (let i = 0; i < count; i++) {
  const name = fixed(buf, offset, 15);
  offset += 15;
  const frame = buf.readUInt32LE(offset);
  offset += 4 + 12 + 16 + 64;
  const stat = bones.get(name) ?? { count: 0, min: frame, max: frame };
  stat.count++;
  stat.min = Math.min(stat.min, frame);
  stat.max = Math.max(stat.max, frame);
  bones.set(name, stat);
}

console.log(JSON.stringify({
  file: path,
  header,
  model,
  boneKeyCount: count,
  uniqueBones: bones.size,
  important: Object.fromEntries(
    [
      "センター",
      "下半身",
      "左足ＩＫ",
      "右足ＩＫ",
      "左つま先ＩＫ",
      "右つま先ＩＫ",
      "左足",
      "右足",
      "左ひざ",
      "右ひざ",
      "左足首",
      "右足首",
      "左つま先",
      "右つま先",
    ]
      .map((name) => [name, bones.get(name) ?? null])
  ),
}, null, 2));
