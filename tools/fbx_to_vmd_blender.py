"""
Convert a Mixamo-style FBX motion to an MMD VMD for a target PMX model.

Run with Blender, for example:

  "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" --background --python tools\\fbx_to_vmd_blender.py -- ^
    --pmx public\\models\\Alicia\\Alicia_solid.pmx ^
    --fbx "public\\motions\\vmd\\base\\Fast Run.fbx" ^
    --out "public\\motions\\vmd\\base\\Fast Run_アリシア・ソリッド_ik.vmd"

This script intentionally bakes leg motion to MMD foot IK bones. Plain FK
leg export tends to look frozen when played with MMD IK enabled.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


BLENDER_MMD_TOOLS = "bl_ext.blender_org.mmd_tools"


MIXAMO_TO_MMD_ROTATION = {
    # Mixamo has Hips -> Spine -> Spine1 -> Spine2. Alicia has lower body plus
    # two upper body bones. Mapping Spine1/Spine2 usually matches the visible
    # chest motion better than using Spine/Spine1.
    "mixamorig:Hips": "下半身",
    "mixamorig:Spine1": "上半身",
    "mixamorig:Spine2": "上半身2",
    "mixamorig:Neck": "首",
    "mixamorig:Head": "頭",
    "mixamorig:LeftShoulder": "左肩",
    "mixamorig:LeftArm": "左腕",
    "mixamorig:LeftForeArm": "左ひじ",
    "mixamorig:LeftHand": "左手首",
    "mixamorig:RightShoulder": "右肩",
    "mixamorig:RightArm": "右腕",
    "mixamorig:RightForeArm": "右ひじ",
    "mixamorig:RightHand": "右手首",
}


MIXAMO_TO_MMD_IK = {
    "mixamorig:LeftFoot": "左足ＩＫ",
    "mixamorig:RightFoot": "右足ＩＫ",
    "mixamorig:LeftToeBase": "左つま先ＩＫ",
    "mixamorig:RightToeBase": "右つま先ＩＫ",
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    parser = argparse.ArgumentParser()
    parser.add_argument("--pmx", required=True, help="Target PMX path")
    parser.add_argument("--fbx", required=True, help="Source FBX path")
    parser.add_argument("--out", required=True, help="Output VMD path")
    parser.add_argument("--pmx-scale", type=float, default=0.08)
    parser.add_argument("--export-scale", type=float, default=12.5)
    parser.add_argument("--start-frame", type=int, default=None)
    parser.add_argument("--end-frame", type=int, default=None)
    parser.add_argument("--calibration-frame", type=int, default=None)
    parser.add_argument("--center-scale", type=float, default=1.0)
    parser.add_argument("--ik-scale", type=float, default=1.0)
    parser.add_argument(
        "--rotation-space",
        choices=("global", "local"),
        default="global",
        help="Retarget rotations in object/global or parent/local bone space.",
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
    after = [o for o in bpy.context.scene.objects if o not in before]
    arms = [o for o in after if o.type == "ARMATURE"]
    if not arms:
        arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("PMX armature was not imported")
    return arms[0]


def import_fbx(path: Path) -> bpy.types.Object:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=str(path))
    after = [o for o in bpy.context.scene.objects if o not in before]
    arms = [o for o in after if o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("FBX armature was not imported")
    return arms[0]


def require_pose_bone(arm: bpy.types.Object, name: str) -> bpy.types.PoseBone:
    bone = arm.pose.bones.get(name)
    if bone is None:
        raise RuntimeError(f"Missing pose bone: {arm.name}:{name}")
    return bone


def pose_matrix(arm: bpy.types.Object, bone_name: str) -> Matrix:
    return require_pose_bone(arm, bone_name).matrix.copy()


def world_location(arm: bpy.types.Object, bone_name: str) -> Vector:
    return arm.matrix_world @ pose_matrix(arm, bone_name).translation


def rest_pose_matrices(arm: bpy.types.Object) -> dict[str, Matrix]:
    return {name: pb.matrix.copy() for name, pb in arm.pose.bones.items()}


def rest_matrices(arm: bpy.types.Object) -> dict[str, Matrix]:
    return {name: bone.matrix_local.copy() for name, bone in arm.data.bones.items()}


def local_matrix_from_parent(
    matrices: dict[str, Matrix], arm: bpy.types.Object, bone_name: str
) -> Matrix:
    bone = arm.data.bones[bone_name]
    matrix = matrices[bone_name]
    if bone.parent is None:
        return matrix.copy()
    return matrices[bone.parent.name].inverted() @ matrix


def local_pose_matrix(arm: bpy.types.Object, bone_name: str) -> Matrix:
    bone = arm.data.bones[bone_name]
    matrix = pose_matrix(arm, bone_name)
    if bone.parent is None:
        return matrix
    return pose_matrix(arm, bone.parent.name).inverted() @ matrix


def compose_matrix(location: Vector, rotation) -> Matrix:
    return Matrix.LocRotScale(location, rotation, Vector((1.0, 1.0, 1.0)))


def clear_animation(arm: bpy.types.Object) -> None:
    if arm.animation_data:
        arm.animation_data_clear()
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)


def infer_motion_scale(
    source: bpy.types.Object,
    target: bpy.types.Object,
    source_left_foot: str = "mixamorig:LeftFoot",
    target_left_ankle: str = "左足首",
) -> float:
    src_hips = world_location(source, "mixamorig:Hips")
    src_foot = world_location(source, source_left_foot)
    tgt_center = target.matrix_world @ pose_matrix(target, "下半身").translation
    tgt_foot = target.matrix_world @ pose_matrix(target, target_left_ankle).translation
    src_len = (src_hips - src_foot).length
    tgt_len = (tgt_center - tgt_foot).length
    if src_len <= 0.0001:
        return 1.0
    return tgt_len / src_len


def set_pose_matrix(pb: bpy.types.PoseBone, matrix: Matrix) -> None:
    pb.matrix = matrix


def key_pose(pb: bpy.types.PoseBone, frame: int, include_location: bool) -> None:
    if include_location:
        pb.keyframe_insert("location", frame=frame)
    pb.keyframe_insert("rotation_quaternion", frame=frame)


def bake_motion(
    source: bpy.types.Object,
    target: bpy.types.Object,
    start: int,
    end: int,
    calibration_frame: int,
    center_scale: float,
    ik_scale: float,
    rotation_space: str,
) -> None:
    bpy.context.scene.frame_set(calibration_frame)
    bpy.context.view_layer.update()

    # Use the FBX bind/rest pose as the source reference. Using frame 1 as the
    # reference breaks Mixamo motions because frame 1 is usually already an
    # animated running/walking pose, not a T-pose.
    source_rest = rest_matrices(source)
    target_rest = rest_matrices(target)
    source_hips_rest = source.matrix_world @ source_rest["mixamorig:Hips"].translation

    scale = infer_motion_scale(source, target)
    print(f"[fbx_to_vmd] inferred motion scale: {scale:.6f}")
    print(f"[fbx_to_vmd] rotation space: {rotation_space}")

    missing = []
    for src, dst in {**MIXAMO_TO_MMD_ROTATION, **MIXAMO_TO_MMD_IK}.items():
        if not source.pose.bones.get(src):
            missing.append(src)
        if not target.pose.bones.get(dst):
            missing.append(dst)
    if missing:
        print("[fbx_to_vmd] missing mapped bones:", sorted(set(missing)))

    clear_animation(target)
    bpy.context.scene.frame_start = start
    bpy.context.scene.frame_end = end

    center_pb = target.pose.bones.get("センター")
    center_rest = target_rest.get("センター")

    for frame in range(start, end + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()

        if center_pb and center_rest:
            hips_delta_world = world_location(source, "mixamorig:Hips") - source_hips_rest
            hips_delta_target = target.matrix_world.inverted().to_3x3() @ hips_delta_world
            center_mat = center_rest.copy()
            center_mat.translation = center_rest.translation + hips_delta_target * scale * center_scale
            set_pose_matrix(center_pb, center_mat)
            key_pose(center_pb, frame, include_location=True)

        for src, dst in MIXAMO_TO_MMD_ROTATION.items():
            if src not in source_rest or dst not in target_rest:
                continue
            pb = target.pose.bones.get(dst)
            if pb is None:
                continue
            if rotation_space == "local":
                src_rest_local = local_matrix_from_parent(source_rest, source, src)
                src_pose_local = local_pose_matrix(source, src)
                tgt_rest_local = local_matrix_from_parent(target_rest, target, dst)
                delta_rot = src_rest_local.to_quaternion().inverted() @ src_pose_local.to_quaternion()
                desired_local = compose_matrix(
                    tgt_rest_local.translation,
                    tgt_rest_local.to_quaternion() @ delta_rot,
                )
                parent = target.data.bones[dst].parent
                desired = (
                    pose_matrix(target, parent.name) @ desired_local
                    if parent is not None
                    else desired_local
                )
            else:
                delta_rot = pose_matrix(source, src).to_quaternion() @ source_rest[src].to_quaternion().inverted()
                desired = compose_matrix(
                    target_rest[dst].translation,
                    delta_rot @ target_rest[dst].to_quaternion(),
                )
            set_pose_matrix(pb, desired)
            key_pose(pb, frame, include_location=False)

        for src, dst in MIXAMO_TO_MMD_IK.items():
            if src not in source_rest or dst not in target_rest:
                continue
            pb = target.pose.bones.get(dst)
            if pb is None:
                continue
            delta_rot = pose_matrix(source, src).to_quaternion() @ source_rest[src].to_quaternion().inverted()
            desired = compose_matrix(
                target_rest[dst].translation,
                delta_rot @ target_rest[dst].to_quaternion(),
            )

            loc_delta_world = world_location(source, src) - (
                source.matrix_world @ source_rest[src].translation
            )
            loc_delta_target = target.matrix_world.inverted().to_3x3() @ loc_delta_world
            desired.translation = target_rest[dst].translation + loc_delta_target * scale * ik_scale

            set_pose_matrix(pb, desired)
            key_pose(pb, frame, include_location=True)

        bpy.context.view_layer.update()


def export_vmd(target: bpy.types.Object, out_path: Path, scale: float) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.ops.object.mode_set.poll() else None
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.mmd_tools.export_vmd(
        filepath=str(out_path),
        scale=scale,
        use_pose_mode=False,
        use_frame_range=True,
        preserve_curves=False,
        check_existing=False,
    )


def main() -> None:
    args = parse_args()
    pmx_path = Path(args.pmx).resolve()
    fbx_path = Path(args.fbx).resolve()
    out_path = Path(args.out).resolve()

    enable_mmd_tools()
    clear_scene()

    target = import_pmx(pmx_path, args.pmx_scale)
    source = import_fbx(fbx_path)

    start = args.start_frame if args.start_frame is not None else bpy.context.scene.frame_start
    end = args.end_frame if args.end_frame is not None else bpy.context.scene.frame_end
    calibration = args.calibration_frame if args.calibration_frame is not None else start

    print(f"[fbx_to_vmd] target={target.name} source={source.name} frames={start}-{end}")
    bake_motion(
        source=source,
        target=target,
        start=start,
        end=end,
        calibration_frame=calibration,
        center_scale=args.center_scale,
        ik_scale=args.ik_scale,
        rotation_space=args.rotation_space,
    )
    export_vmd(target, out_path, args.export_scale)
    print(f"[fbx_to_vmd] wrote {out_path}")


if __name__ == "__main__":
    main()
