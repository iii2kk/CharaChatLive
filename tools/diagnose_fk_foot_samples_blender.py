from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy


BLENDER_MMD_TOOLS = "bl_ext.blender_org.mmd_tools"


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--pmx", required=True)
    parser.add_argument("--vmd", required=True)
    parser.add_argument("--pmx-scale", type=float, default=0.08)
    parser.add_argument("--vmd-scale", type=float, default=0.08)
    return parser.parse_args(argv)


def enable_mmd_tools() -> None:
    import addon_utils

    addon_utils.enable(BLENDER_MMD_TOOLS, default_set=False, persistent=False)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_pmx(path: Path, scale: float) -> bpy.types.Object:
    before = set(bpy.context.scene.objects)
    bpy.ops.mmd_tools.import_model(
        filepath=str(path),
        scale=scale,
        rename_bones=False,
        clean_model=True,
        fix_ik_links=True,
    )
    arms = [o for o in bpy.context.scene.objects if o not in before and o.type == "ARMATURE"]
    if not arms:
        arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("PMX armature was not imported")
    return arms[0]


def import_vmd(arm: bpy.types.Object, path: Path, scale: float) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.mmd_tools.import_vmd(
        filepath=str(path),
        scale=scale,
        rename_bones=False,
        use_pose_mode=False,
        update_scene_settings=True,
        create_new_action=True,
    )


def disable_constraints(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        for constraint in pb.constraints:
            if constraint.type in {"IK", "DAMPED_TRACK", "LIMIT_ROTATION"}:
                constraint.influence = 0.0


def frame_range(arm: bpy.types.Object) -> tuple[int, int]:
    action = arm.animation_data.action if arm.animation_data else None
    if action is None:
        raise RuntimeError("No action")
    frames = [round(kp.co.x) for fc in action.fcurves for kp in fc.keyframe_points]
    return min(frames), max(frames)


def loc(arm: bpy.types.Object, bone_name: str):
    bone = arm.pose.bones[bone_name]
    return bone.matrix.translation.copy()


def main() -> None:
    args = parse_args()
    enable_mmd_tools()
    clear_scene()
    arm = import_pmx(Path(args.pmx).resolve(), args.pmx_scale)
    import_vmd(arm, Path(args.vmd).resolve(), args.vmd_scale)
    disable_constraints(arm)
    start, end = frame_range(arm)
    print(f"[diagnose_fk] frames={start}-{end}")
    for frame in range(start, end + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for side, ankle_name, toe_name in [
            ("L", "左足首", "左つま先"),
            ("R", "右足首", "右つま先"),
        ]:
            ankle = loc(arm, ankle_name)
            toe = loc(arm, toe_name)
            delta = toe - ankle
            print(
                f"[diagnose_fk] frame={frame:03d} side={side} "
                f"ankle=({ankle.x:.4f},{ankle.y:.4f},{ankle.z:.4f}) "
                f"toe=({toe.x:.4f},{toe.y:.4f},{toe.z:.4f}) "
                f"delta=({delta.x:.4f},{delta.y:.4f},{delta.z:.4f}) "
                f"dist={delta.length:.4f}"
            )


if __name__ == "__main__":
    main()
