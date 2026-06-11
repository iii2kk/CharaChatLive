"""
Visual + numeric check for a generated VMD: load it back onto the PMX with
mmd_tools (whose IK constraints mirror MMD/three.js runtime behaviour) and
render sample frames.

  & "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" --background `
    --python tools\\fbx2vmd_check.py -- `
    --pmx public\\models\\Alicia\\Alicia_solid.pmx `
    --vmd "public\\motions\\vmd\\base\\Fast Run_v2.vmd" `
    --fbx "public\\motions\\vmd\\base\\Fast Run.fbx" `
    --out-dir tmp\\fbx2vmd_check
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector

BLENDER_MMD_TOOLS = "bl_ext.blender_org.mmd_tools"


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--pmx", required=True)
    parser.add_argument("--vmd", required=True)
    parser.add_argument("--fbx", default=None, help="Optional source FBX for numeric comparison")
    parser.add_argument("--out-dir", default="tmp/fbx2vmd_check")
    parser.add_argument("--pmx-scale", type=float, default=0.08)
    parser.add_argument("--samples", type=int, default=8)
    return parser.parse_args(argv)


def enable_mmd_tools() -> None:
    import addon_utils

    addon_utils.enable(BLENDER_MMD_TOOLS, default_set=False, persistent=False)


def import_pmx(path: Path, scale: float) -> bpy.types.Object:
    before = set(bpy.context.scene.objects)
    bpy.ops.mmd_tools.import_model(filepath=str(path), scale=scale, rename_bones=False)
    arms = [o for o in bpy.context.scene.objects if o not in before and o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("PMX armature was not imported")
    return arms[0]


def import_fbx(path: Path) -> bpy.types.Object:
    before = set(bpy.context.scene.objects)
    for op in ("import_scene.fbx", "wm.fbx_import"):
        ns, name = op.split(".")
        if hasattr(getattr(bpy.ops, ns), name):
            getattr(getattr(bpy.ops, ns), name)(filepath=str(path))
            break
    arms = [o for o in bpy.context.scene.objects if o not in before and o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("FBX armature was not imported")
    # keep it far away so it never shows up in renders
    arms[0].location.x += 100.0
    for o in bpy.context.scene.objects:
        if o not in before and o is not arms[0]:
            o.location.x += 100.0
    return arms[0]


def make_camera(name: str, location: Vector, look_at: Vector) -> bpy.types.Object:
    cam_data = bpy.data.cameras.new(name)
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = location
    direction = (look_at - location).normalized()
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return cam


def world_bone(arm: bpy.types.Object, name: str) -> Vector | None:
    pb = arm.pose.bones.get(name)
    if pb is None:
        return None
    return (arm.matrix_world @ pb.matrix).translation.copy()


def fmt(v: Vector | None) -> str:
    return "--" if v is None else f"({v.x: 7.3f},{v.y: 7.3f},{v.z: 7.3f})"


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_homefile(use_empty=True)
    enable_mmd_tools()

    target = import_pmx(Path(args.pmx).resolve(), args.pmx_scale)
    source = import_fbx(Path(args.fbx).resolve()) if args.fbx else None

    # apply VMD to the PMX armature
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.mmd_tools.import_vmd(
        filepath=str(Path(args.vmd).resolve()),
        scale=args.pmx_scale,
        margin=0,
    )

    action = target.animation_data.action
    f_start, f_end = (int(v) for v in action.frame_range)
    print(f"[check] VMD frames {f_start}-{f_end}")

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.render.resolution_x = 420
    scene.render.resolution_y = 640
    scene.render.image_settings.file_format = "PNG"

    look_at = Vector((0.0, 0.0, 0.8))
    cams = {
        "front": make_camera("cam_front", Vector((0.0, -3.2, 0.9)), look_at),
        "side": make_camera("cam_side", Vector((3.2, 0.0, 0.9)), look_at),
    }

    n = max(2, args.samples)
    frames = sorted({round(f_start + (f_end - f_start) * i / (n - 1)) for i in range(n)})

    src_fps = scene.render.fps / scene.render.fps_base
    print("frame |  center(センター)        |  L足首                  |  R足首                  | src L-ankle (raw)")
    for f in frames:
        scene.frame_set(f)
        bpy.context.view_layer.update()
        center = world_bone(target, "センター")
        l_ankle = world_bone(target, "左足首")
        r_ankle = world_bone(target, "右足首")
        l_ik = world_bone(target, "左足ＩＫ")
        src_l = None
        if source is not None:
            # VMD is 30fps; map back onto the source timeline
            sf = f / 30.0 * src_fps
            scene.frame_set(int(sf), subframe=sf - int(sf))
            bpy.context.view_layer.update()
            for cand in ("mixamorig:LeftFoot", "LeftFoot"):
                src_l = world_bone(source, cand)
                if src_l is not None:
                    src_l = src_l - Vector((100.0, 0.0, 0.0))
                    break
            scene.frame_set(f)
            bpy.context.view_layer.update()
        ik_err = "--"
        if l_ankle is not None and l_ik is not None:
            ik_err = f"{(l_ankle - l_ik).length:.3f}"
        print(f"{f:5d} | {fmt(center)} | {fmt(l_ankle)} | {fmt(r_ankle)} | {fmt(src_l)} ikerr={ik_err}")

        for view, cam in cams.items():
            scene.camera = cam
            scene.render.filepath = str(out_dir / f"f{f:04d}_{view}.png")
            bpy.ops.render.render(write_still=True)

    print(f"[check] renders in {out_dir}")


if __name__ == "__main__":
    main()
