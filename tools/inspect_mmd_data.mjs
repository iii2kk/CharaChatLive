import fs from "node:fs";
import { MMDParser } from "three/examples/jsm/libs/mmdparser.module.js";

const [pmxPath, vmdPath] = process.argv.slice(2);
if (!pmxPath) {
  console.error("usage: node tools/inspect_mmd_data.mjs <model.pmx> [motion.vmd]");
  process.exit(2);
}

const parser = new MMDParser.Parser();

function readArrayBuffer(path) {
  const buf = fs.readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function vec(values) {
  return Array.from(values ?? []).map(round);
}

function quat(values) {
  return Array.from(values ?? []).map(round);
}

const pmx = parser.parsePmx(readArrayBuffer(pmxPath), true);
const bonesByName = new Map(pmx.bones.map((bone, index) => [bone.name, { bone, index }]));

const interestingBones = [
  "下半身",
  "左足",
  "左ひざ",
  "左足首",
  "左つま先",
  "左足ＩＫ",
  "左つま先ＩＫ",
  "右足",
  "右ひざ",
  "右足首",
  "右つま先",
  "右足ＩＫ",
  "右つま先ＩＫ",
];

console.log("PMX bones");
for (const name of interestingBones) {
  const entry = bonesByName.get(name);
  if (!entry) {
    console.log(JSON.stringify({ name, missing: true }));
    continue;
  }
  const { bone, index } = entry;
  console.log(
    JSON.stringify({
      index,
      name,
      parentIndex: bone.parentIndex,
      parentName: pmx.bones[bone.parentIndex]?.name ?? null,
      position: vec(bone.position),
      flag: bone.flag,
      ik: bone.ik
        ? {
            effector: bone.ik.effector,
            effectorName: pmx.bones[bone.ik.effector]?.name ?? null,
            target: index,
            iteration: bone.ik.iteration,
            maxAngle: round(bone.ik.maxAngle),
            links: bone.ik.links.map((link) => ({
              index: link.index,
              name: pmx.bones[link.index]?.name ?? null,
              angleLimitation: link.angleLimitation,
              lower: vec(link.lowerLimitationAngle),
              upper: vec(link.upperLimitationAngle),
            })),
          }
        : null,
    })
  );
}

if (!vmdPath) process.exit(0);

const vmd = parser.parseVmd(readArrayBuffer(vmdPath), true);
const wanted = new Set(interestingBones);
const motions = new Map();
for (const motion of vmd.motions) {
  if (!wanted.has(motion.boneName)) continue;
  const list = motions.get(motion.boneName) ?? [];
  list.push(motion);
  motions.set(motion.boneName, list);
}

console.log("VMD motions");
for (const name of interestingBones) {
  const list = motions.get(name) ?? [];
  list.sort((a, b) => a.frameNum - b.frameNum);
  const ranges = {
    x: [Infinity, -Infinity],
    y: [Infinity, -Infinity],
    z: [Infinity, -Infinity],
  };
  for (const motion of list) {
    for (const [axis, index] of [
      ["x", 0],
      ["y", 1],
      ["z", 2],
    ]) {
      ranges[axis][0] = Math.min(ranges[axis][0], motion.position[index]);
      ranges[axis][1] = Math.max(ranges[axis][1], motion.position[index]);
    }
  }
  const rangeOut =
    list.length === 0
      ? null
      : Object.fromEntries(
          Object.entries(ranges).map(([axis, [min, max]]) => [
            axis,
            [round(min), round(max), round(max - min)],
          ])
        );
  console.log(
    JSON.stringify({
      name,
      count: list.length,
      frames: list.length ? [list[0].frameNum, list[list.length - 1].frameNum] : null,
      positionRange: rangeOut,
      first: list[0]
        ? {
            frame: list[0].frameNum,
            position: vec(list[0].position),
            rotation: quat(list[0].rotation),
          }
        : null,
      last: list.at(-1)
        ? {
            frame: list.at(-1).frameNum,
            position: vec(list.at(-1).position),
            rotation: quat(list.at(-1).rotation),
          }
        : null,
    })
  );
}
