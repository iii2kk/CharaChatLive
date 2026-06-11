"""
Convert a Mixamo-style FBX motion to an MMD VMD for a target PMX model.

Run with Blender:

  & "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe" --background `
    --python tools\\fbx2vmd.py -- `
    --pmx public\\models\\Alicia\\Alicia_solid.pmx `
    --fbx "public\\motions\\vmd\\base\\Fast Run.fbx" `
    --out "public\\motions\\vmd\\base\\Fast Run_v2.vmd"

Design notes (why this works where the previous attempt did not):

* Retargeting is done in WORLD space with direction alignment. For every
  mapped bone we compute the source bone's world rotation delta from its
  bind pose, pre-multiply a fixed "rest alignment" quaternion (the shortest
  arc from the target's rest bone direction to the source's rest bone
  direction -- this absorbs the Mixamo T-pose vs PMX A-pose difference),
  and apply it to the target's rest orientation. The target bone therefore
  points in exactly the same world direction as the source bone on every
  frame.
* Local pose values (what mmd_tools exports to VMD) are computed
  ANALYTICALLY from rest matrices: basis = ref^-1 @ desired_pose, where
  ref is the pose the bone would have with zero local transform under its
  (already solved) parent. We never assign PoseBone.matrix, so no stale
  depsgraph evaluation can corrupt chained bones.
* Legs are baked to the MMD foot IK bones (position + rotation). The
  runtime player (three.js MMDAnimationHelper) solves leg/toe IK with CCD,
  so the foot IK bone position drives the leg and its rotation drives the
  foot orientation via the toe IK. FK leg bones are keyed too as solver
  hints.
* Output is resampled to 30 fps (VMD's fixed frame rate) by time, so the
  source FBX may have any frame rate.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

BLENDER_MMD_TOOLS = "bl_ext.blender_org.mmd_tools"
VMD_FPS = 30.0

# Mixamo bone (without the "mixamorig:" prefix) -> MMD bone, FK rotation.
# mode "align": match the source bone's world direction exactly (rest
#   directions are aligned first; needed for arms where Mixamo's T-pose and
#   the PMX A-pose disagree by ~35 deg).
# mode "delta": transfer only the world rotation delta from the source's
#   bind pose, keeping the target's natural rest posture. Used for the trunk:
#   the Mixamo skeleton's bind pose has its spine chain tilted ~7-8.5 deg
#   backward (a skeleton convention absorbed by its mesh), and "align" would
#   transplant that tilt onto the PMX model as a visible backward lean.
FK_MAP = [
    ("Hips", "下半身", "delta"),
    ("Spine1", "上半身", "delta"),
    ("Spine2", "上半身2", "delta"),
    ("Neck", "首", "delta"),
    ("Head", "頭", "delta"),
    ("LeftShoulder", "左肩", "align"),
    ("LeftArm", "左腕", "align"),
    ("LeftForeArm", "左ひじ", "align"),
    ("LeftHand", "左手首", "align"),
    ("RightShoulder", "右肩", "align"),
    ("RightArm", "右腕", "align"),
    ("RightForeArm", "右ひじ", "align"),
    ("RightHand", "右手首", "align"),
    ("LeftUpLeg", "左足", "align"),
    ("LeftLeg", "左ひざ", "align"),
    ("LeftFoot", "左足首", "align"),
    ("RightUpLeg", "右足", "align"),
    ("RightLeg", "右ひざ", "align"),
    ("RightFoot", "右足首", "align"),
]

# bones receiving --tilt-offset-deg / --head-tilt-offset-deg
TRUNK_BONES = ("上半身", "上半身2", "首", "頭")
HEAD_BONES = ("首", "頭")

# source foot, IK bone, FK ankle used for direction alignment
IK_MAP = [
    ("LeftFoot", "左足ＩＫ", "左足首"),
    ("RightFoot", "右足ＩＫ", "右足首"),
]

CENTER_BONE = "センター"


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--pmx", required=True)
    parser.add_argument("--fbx", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--pmx-scale", type=float, default=0.08)
    parser.add_argument(
        "--scale",
        type=float,
        default=None,
        help="Motion scale (target/source). Default: inferred from leg lengths.",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Strip horizontal (XZ) root motion so the motion loops in place.",
    )
    parser.add_argument(
        "--tilt-offset-deg",
        type=float,
        default=0.0,
        help="Extra forward pitch (deg) applied to the trunk (上半身/上半身2/首/頭). "
        "Use to counteract a source motion's own backward lean.",
    )
    parser.add_argument(
        "--head-tilt-offset-deg",
        type=float,
        default=0.0,
        help="Additional forward pitch (deg) applied to 首/頭 on top of --tilt-offset-deg.",
    )
    return parser.parse_args(argv)


def enable_mmd_tools() -> None:
    import addon_utils

    addon_utils.enable(BLENDER_MMD_TOOLS, default_set=False, persistent=False)


def import_pmx(path: Path, scale: float) -> bpy.types.Object:
    before = set(bpy.context.scene.objects)
    bpy.ops.mmd_tools.import_model(
        filepath=str(path),
        scale=scale,
        rename_bones=False,
        clean_model=True,
    )
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
    else:
        raise RuntimeError("No FBX import operator available")
    arms = [o for o in bpy.context.scene.objects if o not in before and o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("FBX armature was not imported")
    return arms[0]


def detect_prefix(arm: bpy.types.Object) -> str:
    for bone in arm.data.bones:
        if bone.name.endswith("Hips"):
            return bone.name[: -len("Hips")]
    raise RuntimeError(f"Could not find a *Hips bone in {arm.name}")


def quat_of(matrix: Matrix) -> Quaternion:
    """Rotation of a (possibly uniformly scaled) matrix."""
    return matrix.to_3x3().normalized().to_quaternion()


def bone_dir(world_matrix: Matrix) -> Vector:
    """World direction of a bone (its local +Y axis)."""
    return (world_matrix.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()


class Retargeter:
    def __init__(
        self,
        source: bpy.types.Object,
        target: bpy.types.Object,
        scale: float | None,
        in_place: bool,
        tilt_offset_deg: float = 0.0,
        head_tilt_offset_deg: float = 0.0,
    ) -> None:
        self.source = source
        self.target = target
        self.in_place = in_place
        self.tilt_offset_deg = tilt_offset_deg
        self.head_tilt_offset_deg = head_tilt_offset_deg
        prefix = detect_prefix(source)
        self.src_name = lambda n: prefix + n

        # --- rest data -----------------------------------------------------
        self.src_rest_world: dict[str, Matrix] = {
            b.name: source.matrix_world @ b.matrix_local for b in source.data.bones
        }
        self.tgt_rest_arm: dict[str, Matrix] = {
            b.name: b.matrix_local.copy() for b in target.data.bones
        }
        self.tgt_rest_world: dict[str, Matrix] = {
            n: target.matrix_world @ m for n, m in self.tgt_rest_arm.items()
        }
        self.tgt_world_inv = target.matrix_world.inverted()
        self.tgt_world_rot_inv = quat_of(target.matrix_world).inverted()

        # topological order of target bones
        self.tgt_order: list[str] = []
        self.tgt_parent: dict[str, str | None] = {}

        def visit(bone: bpy.types.Bone) -> None:
            self.tgt_order.append(bone.name)
            self.tgt_parent[bone.name] = bone.parent.name if bone.parent else None
            for child in bone.children:
                visit(child)

        for root in (b for b in target.data.bones if b.parent is None):
            visit(root)

        # --- bone mapping --------------------------------------------------
        def has_src(n: str) -> bool:
            return self.src_name(n) in self.src_rest_world

        def has_tgt(n: str) -> bool:
            return n in self.tgt_rest_arm

        self.fk_pairs: list[tuple[str, str]] = []
        fk_mode: dict[str, str] = {}
        for src, dst, mode in FK_MAP:
            if has_src(src) and has_tgt(dst):
                self.fk_pairs.append((self.src_name(src), dst))
                fk_mode[dst] = mode
            else:
                print(f"[fbx2vmd] skip mapping {src} -> {dst} (missing bone)")

        self.ik_triples: list[tuple[str, str, str]] = []
        for src, ik, ankle in IK_MAP:
            if has_src(src) and has_tgt(ik) and has_tgt(ankle):
                self.ik_triples.append((self.src_name(src), ik, ankle))
            else:
                print(f"[fbx2vmd] skip IK mapping {src} -> {ik} (missing bone)")

        for required in (CENTER_BONE,):
            if not has_tgt(required):
                raise RuntimeError(f"Target model has no bone named {required}")
        self.src_hips = self.src_name("Hips")

        # --- rest alignment (T-pose vs A-pose) ------------------------------
        # A[dst] is the world-space shortest arc taking the target's rest bone
        # direction onto the source's rest bone direction. Skipped when the
        # rest directions disagree by more than ~90 deg (e.g. Hips points up,
        # 下半身 points down -- there the raw world delta is what we want).
        self.align: dict[str, Quaternion] = {}

        def alignment(src: str, dst: str) -> Quaternion:
            d_src = bone_dir(self.src_rest_world[src])
            d_dst = bone_dir(self.tgt_rest_world[dst])
            if d_src.dot(d_dst) <= 0.0:
                return Quaternion()
            return d_dst.rotation_difference(d_src)

        for src, dst in self.fk_pairs:
            self.align[dst] = alignment(src, dst) if fk_mode[dst] == "align" else Quaternion()
        for src, ik, ankle in self.ik_triples:
            # foot IK rotation is driven by the ankle's direction alignment
            self.align[ik] = alignment(src, ankle)

        # --- optional forward-pitch correction (world space) ----------------
        # +X is the character's pitch axis (faces -Y, up +Z); a positive angle
        # tips the bone forward. Pre-multiplied in world space, so each trunk
        # bone's absolute orientation is pitched by the same amount.
        self.pitch_offset: dict[str, Quaternion] = {}
        for name in TRUNK_BONES:
            deg = self.tilt_offset_deg + (
                self.head_tilt_offset_deg if name in HEAD_BONES else 0.0
            )
            if abs(deg) > 1e-6:
                self.pitch_offset[name] = Quaternion((1.0, 0.0, 0.0), math.radians(deg))

        # --- motion scale ----------------------------------------------------
        if scale is not None:
            self.scale = scale
        else:
            self.scale = self._infer_scale()
        print(f"[fbx2vmd] motion scale: {self.scale:.4f}")

    def _infer_scale(self) -> float:
        def length(points: list[Vector]) -> float:
            return sum((a - b).length for a, b in zip(points, points[1:]))

        try:
            src = length(
                [
                    self.src_rest_world[self.src_name(n)].to_translation()
                    for n in ("LeftUpLeg", "LeftLeg", "LeftFoot")
                ]
            )
            tgt = length(
                [self.tgt_rest_world[n].to_translation() for n in ("左足", "左ひざ", "左足首")]
            )
        except KeyError as e:
            print(f"[fbx2vmd] cannot infer scale ({e}), using 1.0")
            return 1.0
        if src < 1e-6:
            return 1.0
        return tgt / src

    # -- per-frame ------------------------------------------------------------

    def src_pose_world(self, name: str) -> Matrix:
        return self.source.matrix_world @ self.source.pose.bones[name].matrix

    def world_delta(self, name: str) -> Quaternion:
        return quat_of(self.src_pose_world(name)) @ quat_of(self.src_rest_world[name]).inverted()

    def solve(self) -> dict[str, tuple[Vector, Quaternion]]:
        """Compute basis (location, rotation) for every animated target bone
        from the source's current pose. Pure math over rest matrices; does not
        read the target's pose state at all."""
        desired_rot: dict[str, Quaternion] = {}
        desired_loc: dict[str, Vector] = {}

        for src, dst in self.fk_pairs:
            rot = self.world_delta(src) @ self.align[dst] @ quat_of(self.tgt_rest_world[dst])
            offset = self.pitch_offset.get(dst)
            desired_rot[dst] = offset @ rot if offset is not None else rot

        # center: hips translation delta, no rotation
        hips_delta = (
            self.src_pose_world(self.src_hips).to_translation()
            - self.src_rest_world[self.src_hips].to_translation()
        )
        # world up is +Z here; in-place removes the horizontal root motion
        # from hips and feet alike so strides relative to the body survive
        horizontal = Vector((hips_delta.x, hips_delta.y, 0.0)) if self.in_place else Vector()
        hips_delta -= horizontal
        desired_loc[CENTER_BONE] = (
            self.tgt_rest_world[CENTER_BONE].to_translation() + hips_delta * self.scale
        )

        for src, ik, _ankle in self.ik_triples:
            desired_rot[ik] = self.world_delta(src) @ self.align[ik] @ quat_of(
                self.tgt_rest_world[ik]
            )
            foot_delta = (
                self.src_pose_world(src).to_translation()
                - self.src_rest_world[src].to_translation()
                - horizontal
            )
            desired_loc[ik] = (
                self.tgt_rest_world[ik].to_translation() + foot_delta * self.scale
            )

        # walk the target hierarchy, building armature-space pose matrices and
        # extracting basis transforms
        pose: dict[str, Matrix] = {}
        basis: dict[str, tuple[Vector, Quaternion]] = {}
        for name in self.tgt_order:
            rest = self.tgt_rest_arm[name]
            parent = self.tgt_parent[name]
            if parent is None:
                ref = rest
            else:
                ref = pose[parent] @ self.tgt_rest_arm[parent].inverted() @ rest

            keyed = name in desired_rot or name in desired_loc
            if not keyed:
                pose[name] = ref
                continue

            if name in desired_rot:
                rot_arm = self.tgt_world_rot_inv @ desired_rot[name]
            else:
                rot_arm = quat_of(ref)
            if name in desired_loc:
                loc_arm = self.tgt_world_inv @ desired_loc[name]
            else:
                loc_arm = ref.to_translation()

            matrix = Matrix.LocRotScale(loc_arm, rot_arm, Vector((1.0, 1.0, 1.0)))
            pose[name] = matrix
            b = ref.inverted() @ matrix
            basis[name] = (b.to_translation(), b.to_quaternion().normalized())
        return basis


def bake(retargeter: Retargeter, target: bpy.types.Object) -> int:
    scene = bpy.context.scene
    source = retargeter.source
    action = source.animation_data.action if source.animation_data else None
    if action is None:
        raise RuntimeError("Source FBX has no animation action")
    f_start, f_end = action.frame_range
    fps = scene.render.fps / scene.render.fps_base
    duration = (f_end - f_start) / fps
    n_frames = max(1, round(duration * VMD_FPS)) + 1
    print(
        f"[fbx2vmd] source frames {f_start:.0f}-{f_end:.0f} @ {fps:.4g} fps"
        f" -> {n_frames} VMD frames"
    )

    if target.animation_data:
        target.animation_data_clear()
    for pb in target.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)

    prev_quat: dict[str, Quaternion] = {}
    for f_out in range(n_frames):
        t = f_out / VMD_FPS
        f_src = min(f_start + t * fps, f_end)
        scene.frame_set(int(f_src), subframe=f_src - int(f_src))
        bpy.context.view_layer.update()

        for name, (loc, quat) in retargeter.solve().items():
            prev = prev_quat.get(name)
            if prev is not None and prev.dot(quat) < 0.0:
                quat = -quat
            prev_quat[name] = quat
            pb = target.pose.bones[name]
            pb.location = loc
            pb.rotation_quaternion = quat
            pb.keyframe_insert("location", frame=f_out)
            pb.keyframe_insert("rotation_quaternion", frame=f_out)
    return n_frames


def export_vmd(target: bpy.types.Object, out_path: Path, scale: float, n_frames: int) -> None:
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = n_frames - 1
    out_path.parent.mkdir(parents=True, exist_ok=True)
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

    bpy.ops.wm.read_homefile(use_empty=True)
    enable_mmd_tools()

    target = import_pmx(pmx_path, args.pmx_scale)
    source = import_fbx(fbx_path)
    print(f"[fbx2vmd] target={target.name} source={source.name}")

    retargeter = Retargeter(
        source,
        target,
        args.scale,
        args.in_place,
        tilt_offset_deg=args.tilt_offset_deg,
        head_tilt_offset_deg=args.head_tilt_offset_deg,
    )
    n_frames = bake(retargeter, target)
    export_vmd(target, out_path, 1.0 / args.pmx_scale, n_frames)
    print(f"[fbx2vmd] wrote {out_path}")


if __name__ == "__main__":
    main()
