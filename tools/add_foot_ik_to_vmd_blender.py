"""
Add MMD foot IK keys to an existing FK-style VMD.

This is useful for VMD files produced by BVH/FBX converters that animate
`左足/左ひざ/左足首` and `右足/右ひざ/右足首` but do not animate
`左足ＩＫ/右足ＩＫ`. The original motion is imported on the target PMX,
the FK foot result is sampled, and IK target keys are added without changing
the existing upper-body, arm, hand, or FK tracks.

Run with Blender:

  "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" --background ^
    --python tools\\add_foot_ik_to_vmd_blender.py -- ^
    --pmx public\\models\\Alicia\\Alicia_solid.pmx ^
    --vmd "public\\motions\\vmd\\base\\Fast Run_アリシア・ソリッド.vmd" ^
    --out "public\\motions\\vmd\\base\\Fast Run_アリシア・ソリッド_fk_plus_ik.vmd"

The default scales match mmd_tools: import VMD at 0.08, export VMD at 12.5.
"""

from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


BLENDER_MMD_TOOLS = "bl_ext.blender_org.mmd_tools"

FOOT_IK_PAIRS = {
    "左足ＩＫ": "左足首",
    "右足ＩＫ": "右足首",
    "左つま先ＩＫ": "左つま先",
    "右つま先ＩＫ": "右つま先",
}

CHILD_IK_PARENTS = {
    "左つま先ＩＫ": "左足ＩＫ",
    "右つま先ＩＫ": "右足ＩＫ",
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    parser = argparse.ArgumentParser()
    parser.add_argument("--pmx", required=True)
    parser.add_argument("--vmd", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--pmx-scale", type=float, default=0.08)
    parser.add_argument("--vmd-scale", type=float, default=0.08)
    parser.add_argument("--export-scale", type=float, default=12.5)
    parser.add_argument("--start-frame", type=int, default=None)
    parser.add_argument("--end-frame", type=int, default=None)
    parser.add_argument(
        "--ik-rotation",
        choices=("foot", "none"),
        default="foot",
        help="Copy FK foot/toe rotation to IK bones, or bake IK positions only.",
    )
    parser.add_argument(
        "--target-offset",
        choices=("rest", "none"),
        default="rest",
        help="Keep the PMX rest-pose offset between the FK source bone and IK target bone.",
    )
    parser.add_argument(
        "--clear-fk",
        choices=("none", "ankle", "leg", "leg-and-toe"),
        default="none",
        help="Remove original FK leg rotation curves after baking IK keys.",
    )
    parser.add_argument(
        "--fix-child-ik-local",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Rewrite toe IK VMD positions as local offsets from foot IK.",
    )
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


def disable_blender_ik_constraints(arm: bpy.types.Object) -> None:
    # mmd_tools imports PMX IK constraints with zero influence in this model,
    # but keep this explicit so sampling always captures the raw FK VMD result.
    for pb in arm.pose.bones:
        for constraint in pb.constraints:
            if constraint.type in {"IK", "DAMPED_TRACK", "LIMIT_ROTATION"}:
                constraint.influence = 0.0


def action_keyframe_range(arm: bpy.types.Object) -> tuple[int, int]:
    action = arm.animation_data.action if arm.animation_data else None
    if action is None:
        raise RuntimeError("No VMD action was imported")
    starts: list[int] = []
    ends: list[int] = []
    for fc in action.fcurves:
        for kp in fc.keyframe_points:
            starts.append(round(kp.co.x))
            ends.append(round(kp.co.x))
    if not starts:
        raise RuntimeError("Imported VMD action has no keyframes")
    return min(starts), max(ends)


def compose_matrix(location: Vector, source: Matrix | None) -> Matrix:
    if source is None:
        return Matrix.Translation(location)
    return Matrix.LocRotScale(location, source.to_quaternion(), Vector((1.0, 1.0, 1.0)))


def rest_offset_matrix(arm: bpy.types.Object, ik_name: str, fk_name: str) -> Matrix:
    ik = arm.pose.bones.get(ik_name)
    fk = arm.pose.bones.get(fk_name)
    if ik is None:
        raise RuntimeError(f"Missing IK target bone: {ik_name}")
    if fk is None:
        raise RuntimeError(f"Missing FK source bone: {fk_name}")
    return fk.bone.matrix_local.inverted() @ ik.bone.matrix_local


def sample_fk_feet(
    arm: bpy.types.Object,
    start: int,
    end: int,
    copy_rotation: bool,
    keep_rest_offset: bool,
) -> dict[int, dict[str, Matrix]]:
    samples: dict[int, dict[str, Matrix]] = {}
    rest_offsets = {
        ik_name: rest_offset_matrix(arm, ik_name, fk_name) if keep_rest_offset else Matrix.Identity(4)
        for ik_name, fk_name in FOOT_IK_PAIRS.items()
    }
    for frame in range(start, end + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        frame_samples: dict[str, Matrix] = {}
        for ik_name, fk_name in FOOT_IK_PAIRS.items():
            fk = arm.pose.bones.get(fk_name)
            if fk is None:
                raise RuntimeError(f"Missing FK source bone: {fk_name}")
            src_matrix = fk.matrix.copy() @ rest_offsets[ik_name]
            frame_samples[ik_name] = compose_matrix(
                src_matrix.translation.copy(),
                src_matrix if copy_rotation else None,
            )
        samples[frame] = frame_samples
    return samples


def insert_ik_keys(
    arm: bpy.types.Object,
    samples: dict[int, dict[str, Matrix]],
    start: int,
    end: int,
) -> None:
    parent_ik_names = [name for name in FOOT_IK_PAIRS if name not in CHILD_IK_PARENTS]
    child_ik_names = [name for name in FOOT_IK_PAIRS if name in CHILD_IK_PARENTS]
    for frame in range(start, end + 1):
        bpy.context.scene.frame_set(frame)
        for ik_name in parent_ik_names:
            matrix = samples[frame][ik_name]
            pb = arm.pose.bones.get(ik_name)
            if pb is None:
                raise RuntimeError(f"Missing IK target bone: {ik_name}")
            pb.rotation_mode = "QUATERNION"
            pb.matrix = matrix
            pb.keyframe_insert("location", frame=frame)
            pb.keyframe_insert("rotation_quaternion", frame=frame)
        bpy.context.view_layer.update()
        for ik_name in child_ik_names:
            matrix = samples[frame][ik_name]
            pb = arm.pose.bones.get(ik_name)
            if pb is None:
                raise RuntimeError(f"Missing IK target bone: {ik_name}")
            pb.rotation_mode = "QUATERNION"
            pb.matrix = matrix
            pb.keyframe_insert("location", frame=frame)
            pb.keyframe_insert("rotation_quaternion", frame=frame)
        bpy.context.view_layer.update()


def export_vmd(arm: bpy.types.Object, out_path: Path, scale: float) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.ops.object.mode_set.poll() else None
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.mmd_tools.export_vmd(
        filepath=str(out_path),
        scale=scale,
        use_pose_mode=False,
        use_frame_range=True,
        preserve_curves=True,
        check_existing=False,
    )


def decode_vmd_name(raw: bytes) -> str:
    return raw.split(b"\x00", 1)[0].decode("shift_jis", errors="ignore").strip()


def filter_vmd_bone_records(path: Path, removed_bones: set[str]) -> None:
    if not removed_bones:
        return

    data = path.read_bytes()
    header_size = 30 + 20
    record_size = 15 + 4 + 12 + 16 + 64
    if len(data) < header_size + 4:
        raise RuntimeError(f"VMD file is too small: {path}")

    count = int.from_bytes(data[header_size : header_size + 4], "little")
    records_start = header_size + 4
    records_end = records_start + count * record_size
    if len(data) < records_end:
        raise RuntimeError(f"VMD bone records are truncated: {path}")

    kept = bytearray()
    removed = 0
    for index in range(count):
        start = records_start + index * record_size
        end = start + record_size
        record = data[start:end]
        name = decode_vmd_name(record[:15])
        if name in removed_bones:
            removed += 1
            continue
        kept.extend(record)

    new_count = count - removed
    patched = bytearray()
    patched.extend(data[:header_size])
    patched.extend(new_count.to_bytes(4, "little"))
    patched.extend(kept)
    patched.extend(data[records_end:])
    path.write_bytes(patched)
    print(f"[add_foot_ik] filtered_vmd_bones={removed} path={path}")


def fix_child_ik_local_positions(path: Path) -> None:
    data = bytearray(path.read_bytes())
    header_size = 30 + 20
    record_size = 15 + 4 + 12 + 16 + 64
    if len(data) < header_size + 4:
        raise RuntimeError(f"VMD file is too small: {path}")

    count = int.from_bytes(data[header_size : header_size + 4], "little")
    records_start = header_size + 4
    records_end = records_start + count * record_size
    if len(data) < records_end:
        raise RuntimeError(f"VMD bone records are truncated: {path}")

    positions: dict[tuple[str, int], tuple[float, float, float]] = {}
    for index in range(count):
        start = records_start + index * record_size
        name = decode_vmd_name(bytes(data[start : start + 15]))
        if name not in FOOT_IK_PAIRS:
            continue
        frame = int.from_bytes(data[start + 15 : start + 19], "little")
        positions[(name, frame)] = struct.unpack_from("<3f", data, start + 19)

    patched = 0
    for index in range(count):
        start = records_start + index * record_size
        name = decode_vmd_name(bytes(data[start : start + 15]))
        parent_name = CHILD_IK_PARENTS.get(name)
        if parent_name is None:
            continue
        frame = int.from_bytes(data[start + 15 : start + 19], "little")
        child_pos = positions.get((name, frame))
        parent_pos = positions.get((parent_name, frame))
        if child_pos is None or parent_pos is None:
            continue
        local_pos = tuple(child_pos[i] - parent_pos[i] for i in range(3))
        struct.pack_into("<3f", data, start + 19, *local_pos)
        patched += 1

    path.write_bytes(data)
    print(f"[add_foot_ik] fixed_child_ik_local_positions={patched} path={path}")


def fk_bones_to_clear(mode: str) -> list[str]:
    if mode == "none":
        return []
    if mode == "ankle":
        return ["左足首", "右足首"]
    if mode == "leg":
        return ["左足", "右足", "左ひざ", "右ひざ", "左足首", "右足首"]
    if mode == "leg-and-toe":
        return [
            "左足",
            "右足",
            "左ひざ",
            "右ひざ",
            "左足首",
            "右足首",
            "左つま先",
            "右つま先",
        ]
    raise RuntimeError(f"Unexpected FK clear mode: {mode}")


def clear_fk_rotation_curves(arm: bpy.types.Object, mode: str) -> None:
    action = arm.animation_data.action if arm.animation_data else None
    if action is None:
        raise RuntimeError("No VMD action was imported")

    properties = ("rotation_quaternion", "rotation_euler", "rotation_axis_angle")
    removed = 0
    for bone_name in fk_bones_to_clear(mode):
        prefix = f'pose.bones["{bone_name}"].'
        for fc in list(action.fcurves):
            if fc.data_path.startswith(prefix) and fc.data_path[len(prefix) :] in properties:
                action.fcurves.remove(fc)
                removed += 1
    print(f"[add_foot_ik] clear_fk={mode} removed_rotation_fcurves={removed}")


def main() -> None:
    args = parse_args()
    enable_mmd_tools()
    clear_scene()

    arm = import_pmx(Path(args.pmx).resolve(), args.pmx_scale)
    import_vmd(arm, Path(args.vmd).resolve(), args.vmd_scale)
    disable_blender_ik_constraints(arm)

    action_start, action_end = action_keyframe_range(arm)
    start = args.start_frame if args.start_frame is not None else action_start
    end = args.end_frame if args.end_frame is not None else action_end
    bpy.context.scene.frame_start = start
    bpy.context.scene.frame_end = end

    print(
        f"[add_foot_ik] source={args.vmd} target={arm.name} frames={start}-{end} "
        f"ik_rotation={args.ik_rotation}"
    )
    samples = sample_fk_feet(
        arm,
        start,
        end,
        copy_rotation=args.ik_rotation == "foot",
        keep_rest_offset=args.target_offset == "rest",
    )
    insert_ik_keys(arm, samples, start, end)
    clear_fk_rotation_curves(arm, args.clear_fk)
    out_path = Path(args.out).resolve()
    export_vmd(arm, out_path, args.export_scale)
    filter_vmd_bone_records(out_path, set(fk_bones_to_clear(args.clear_fk)))
    if args.fix_child_ik_local:
        fix_child_ik_local_positions(out_path)
    print(f"[add_foot_ik] wrote {out_path}")


if __name__ == "__main__":
    main()
