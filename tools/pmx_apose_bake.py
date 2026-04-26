#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PMX 2.0 T-pose → A-pose bake.

T ポーズの PMX モデルを読み込み、左腕/右腕を中心とした下げ回転を
頂点・ボーン位置・剛体・ジョイント・頂点モーフへ「焼き付けて」
A ポーズの PMX として書き出す。

出力モデルは bone の rest 回転が identity のまま視覚的に A ポーズに
なっているため、A ポーズ前提の VMD をそのまま再生できる。

Usage:
    python pmx_apose_bake.py INPUT.pmx OUTPUT.pmx [--angle 35]

Dependencies: numpy のみ
PMX 2.0 専用 (2.1 は非対応)
"""

import argparse
import math
import struct
import sys

import numpy as np


ARM_LEFT = "左腕"
ARM_RIGHT = "右腕"


# ─── Math helpers ─────────────────────────────────────────────

def quat_axis_angle(axis, angle):
    a = np.array(axis, dtype=np.float64)
    a = a / np.linalg.norm(a)
    s = math.sin(angle / 2.0)
    c = math.cos(angle / 2.0)
    return np.array([a[0] * s, a[1] * s, a[2] * s, c])


def quat_rotate_vec(q, v):
    qv = q[:3]
    v = np.asarray(v, dtype=np.float64)
    t = 2.0 * np.cross(qv, v)
    return v + q[3] * t + np.cross(qv, t)


def quat_multiply(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ])


def rotate_around_pivot(p, pivot, q):
    p = np.asarray(p, dtype=np.float64)
    return quat_rotate_vec(q, p - pivot) + pivot


def euler_yxz_to_quat(e):
    """PMX 剛体/ジョイントの回転 (Euler XYZ 値) を YXZ 順 (M = Ry·Rx·Rz) で
    クォータニオンへ変換。MMD 系の慣例に合わせる。"""
    qx = quat_axis_angle((1, 0, 0), e[0])
    qy = quat_axis_angle((0, 1, 0), e[1])
    qz = quat_axis_angle((0, 0, 1), e[2])
    return quat_multiply(quat_multiply(qy, qx), qz)


def quat_to_euler_yxz(q):
    """YXZ 順 (M = Ry·Rx·Rz) で Euler 値を抽出。"""
    x, y, z, w = q
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    m02 = 2.0 * (xz + wy)
    m10 = 2.0 * (xy + wz)
    m11 = 1.0 - 2.0 * (xx + zz)
    m12 = 2.0 * (yz - wx)
    m22 = 1.0 - 2.0 * (xx + yy)
    m20 = 2.0 * (xz - wy)
    m00 = 1.0 - 2.0 * (yy + zz)
    sin_rx = max(-1.0, min(1.0, -m12))
    rx = math.asin(sin_rx)
    if abs(sin_rx) < 0.9999:
        rz = math.atan2(m10, m11)
        ry = math.atan2(m02, m22)
    else:
        # gimbal lock at rx = ±90°: rz を 0 と決め打ち
        rz = 0.0
        ry = math.atan2(-m20, m00)
    return [rx, ry, rz]


# ─── PMX 2.0 reader ──────────────────────────────────────────

def read_pmx(path):
    with open(path, "rb") as f:
        sig = f.read(4)
        if sig != b"PMX ":
            raise ValueError(f"Not a PMX file: {sig!r}")
        ver = struct.unpack("<f", f.read(4))[0]
        if abs(ver - 2.0) > 0.001:
            raise ValueError(f"Only PMX 2.0 supported, got {ver}")

        gh_count = f.read(1)[0]
        globals_bytes = f.read(gh_count)
        if gh_count < 8:
            raise ValueError(f"unexpected globals count: {gh_count}")
        encoding = "utf-16-le" if globals_bytes[0] == 0 else "utf-8"
        additional_uv = globals_bytes[1]
        idx_sizes = {
            "vertex": globals_bytes[2],
            "texture": globals_bytes[3],
            "material": globals_bytes[4],
            "bone": globals_bytes[5],
            "morph": globals_bytes[6],
            "rigidbody": globals_bytes[7],
        }

        def read_text():
            n = struct.unpack("<i", f.read(4))[0]
            return f.read(n).decode(encoding)

        def read_idx(size, signed):
            return int.from_bytes(f.read(size), "little", signed=signed)

        def read_vec3():
            return list(struct.unpack("<3f", f.read(12)))

        def read_vec4():
            return list(struct.unpack("<4f", f.read(16)))

        def read_vec2():
            return list(struct.unpack("<2f", f.read(8)))

        def read_i32():
            return struct.unpack("<i", f.read(4))[0]

        def read_f32():
            return struct.unpack("<f", f.read(4))[0]

        def read_u8():
            return f.read(1)[0]

        def read_u16():
            return struct.unpack("<H", f.read(2))[0]

        model_name_jp = read_text()
        model_name_en = read_text()
        comment_jp = read_text()
        comment_en = read_text()

        # Vertices
        vertex_count = read_i32()
        vertices = []
        for _ in range(vertex_count):
            v = {
                "position": read_vec3(),
                "normal": read_vec3(),
                "uv": read_vec2(),
                "additional_uvs": [read_vec4() for _ in range(additional_uv)],
            }
            wtype = read_u8()
            v["weight_type"] = wtype
            if wtype == 0:  # BDEF1
                v["bones"] = [read_idx(idx_sizes["bone"], True)]
                v["weights"] = [1.0]
            elif wtype == 1:  # BDEF2
                v["bones"] = [
                    read_idx(idx_sizes["bone"], True),
                    read_idx(idx_sizes["bone"], True),
                ]
                w = read_f32()
                v["weights"] = [w, 1.0 - w]
            elif wtype == 2:  # BDEF4
                v["bones"] = [
                    read_idx(idx_sizes["bone"], True) for _ in range(4)
                ]
                v["weights"] = list(struct.unpack("<4f", f.read(16)))
            elif wtype == 3:  # SDEF
                v["bones"] = [
                    read_idx(idx_sizes["bone"], True),
                    read_idx(idx_sizes["bone"], True),
                ]
                w = read_f32()
                v["weights"] = [w, 1.0 - w]
                v["sdef_c"] = read_vec3()
                v["sdef_r0"] = read_vec3()
                v["sdef_r1"] = read_vec3()
            else:
                raise ValueError(f"Unknown vertex weight type {wtype}")
            v["edge_scale"] = read_f32()
            vertices.append(v)

        # Faces (raw bytes — index size depends on vertex idx size)
        face_count = read_i32()
        face_data = f.read(face_count * idx_sizes["vertex"])

        # Textures
        texture_count = read_i32()
        textures = [read_text() for _ in range(texture_count)]

        # Materials
        material_count = read_i32()
        materials = []
        for _ in range(material_count):
            m = {
                "name_jp": read_text(),
                "name_en": read_text(),
                "diffuse": read_vec4(),
                "specular": read_vec3(),
                "specular_pow": read_f32(),
                "ambient": read_vec3(),
                "flag": read_u8(),
                "edge_color": read_vec4(),
                "edge_size": read_f32(),
                "tex_index": read_idx(idx_sizes["texture"], True),
                "sphere_index": read_idx(idx_sizes["texture"], True),
                "sphere_mode": read_u8(),
                "toon_flag": read_u8(),
            }
            if m["toon_flag"] == 0:
                m["toon_index"] = read_idx(idx_sizes["texture"], True)
            else:
                m["toon_index"] = read_u8()
            m["memo"] = read_text()
            m["vertex_count"] = read_i32()
            materials.append(m)

        # Bones
        bone_count = read_i32()
        bones = []
        for _ in range(bone_count):
            b = {
                "name_jp": read_text(),
                "name_en": read_text(),
                "position": read_vec3(),
                "parent": read_idx(idx_sizes["bone"], True),
                "transform_level": read_i32(),
                "flag": read_u16(),
            }
            flag = b["flag"]
            if flag & 0x0001:
                b["link_bone"] = read_idx(idx_sizes["bone"], True)
            else:
                b["offset"] = read_vec3()
            if flag & 0x0100 or flag & 0x0200:
                b["append_parent"] = read_idx(idx_sizes["bone"], True)
                b["append_ratio"] = read_f32()
            if flag & 0x0400:
                b["axis"] = read_vec3()
            if flag & 0x0800:
                b["local_x"] = read_vec3()
                b["local_z"] = read_vec3()
            if flag & 0x2000:
                b["external_key"] = read_i32()
            if flag & 0x0020:
                b["ik_target"] = read_idx(idx_sizes["bone"], True)
                b["ik_loop"] = read_i32()
                b["ik_limit"] = read_f32()
                link_count = read_i32()
                links = []
                for _ in range(link_count):
                    link = {
                        "bone": read_idx(idx_sizes["bone"], True),
                        "has_limit": read_u8(),
                    }
                    if link["has_limit"]:
                        link["lower"] = read_vec3()
                        link["upper"] = read_vec3()
                    links.append(link)
                b["ik_links"] = links
            bones.append(b)

        # Morphs
        morph_count = read_i32()
        morphs = []
        for _ in range(morph_count):
            m = {
                "name_jp": read_text(),
                "name_en": read_text(),
                "panel": read_u8(),
                "type": read_u8(),
            }
            offset_count = read_i32()
            offsets = []
            mtype = m["type"]
            for _ in range(offset_count):
                if mtype == 0:  # group
                    o = {
                        "morph_index": read_idx(idx_sizes["morph"], True),
                        "ratio": read_f32(),
                    }
                elif mtype == 1:  # vertex
                    o = {
                        "vertex_index": read_idx(idx_sizes["vertex"], False),
                        "offset": read_vec3(),
                    }
                elif mtype == 2:  # bone
                    o = {
                        "bone_index": read_idx(idx_sizes["bone"], True),
                        "translation": read_vec3(),
                        "rotation": read_vec4(),
                    }
                elif 3 <= mtype <= 7:  # uv 0-4
                    o = {
                        "vertex_index": read_idx(idx_sizes["vertex"], False),
                        "offset": read_vec4(),
                    }
                elif mtype == 8:  # material
                    o = {
                        "material_index": read_idx(idx_sizes["material"], True),
                        "op": read_u8(),
                        "diffuse": read_vec4(),
                        "specular": read_vec3(),
                        "specular_pow": read_f32(),
                        "ambient": read_vec3(),
                        "edge_color": read_vec4(),
                        "edge_size": read_f32(),
                        "tex": read_vec4(),
                        "sphere": read_vec4(),
                        "toon": read_vec4(),
                    }
                else:
                    raise ValueError(f"Unknown morph type {mtype}")
                offsets.append(o)
            m["offsets"] = offsets
            morphs.append(m)

        # Display Frames
        df_count = read_i32()
        display_frames = []
        for _ in range(df_count):
            d = {
                "name_jp": read_text(),
                "name_en": read_text(),
                "special": read_u8(),
            }
            ec = read_i32()
            entries = []
            for _ in range(ec):
                t = read_u8()
                if t == 0:
                    entries.append(("bone", read_idx(idx_sizes["bone"], True)))
                else:
                    entries.append(("morph", read_idx(idx_sizes["morph"], True)))
            d["entries"] = entries
            display_frames.append(d)

        # Rigid Bodies
        rb_count = read_i32()
        rigid_bodies = []
        for _ in range(rb_count):
            r = {
                "name_jp": read_text(),
                "name_en": read_text(),
                "bone_index": read_idx(idx_sizes["bone"], True),
                "group": read_u8(),
                "no_collide_group": read_u16(),
                "shape": read_u8(),
                "size": read_vec3(),
                "position": read_vec3(),
                "rotation": read_vec3(),
                "mass": read_f32(),
                "linear_damp": read_f32(),
                "angular_damp": read_f32(),
                "restitution": read_f32(),
                "friction": read_f32(),
                "physics_type": read_u8(),
            }
            rigid_bodies.append(r)

        # Joints
        joint_count = read_i32()
        joints = []
        for _ in range(joint_count):
            j = {
                "name_jp": read_text(),
                "name_en": read_text(),
                "type": read_u8(),
                "rigid_a": read_idx(idx_sizes["rigidbody"], True),
                "rigid_b": read_idx(idx_sizes["rigidbody"], True),
                "position": read_vec3(),
                "rotation": read_vec3(),
                "lin_min": read_vec3(),
                "lin_max": read_vec3(),
                "ang_min": read_vec3(),
                "ang_max": read_vec3(),
                "spring_pos": read_vec3(),
                "spring_rot": read_vec3(),
            }
            joints.append(j)

        rest = f.read()
        if rest:
            print(f"warn: {len(rest)} unread bytes at EOF", file=sys.stderr)

        return {
            "version": ver,
            "encoding": encoding,
            "additional_uv": additional_uv,
            "idx_sizes": idx_sizes,
            "model_name_jp": model_name_jp,
            "model_name_en": model_name_en,
            "comment_jp": comment_jp,
            "comment_en": comment_en,
            "vertices": vertices,
            "face_count": face_count,
            "face_data": face_data,
            "textures": textures,
            "materials": materials,
            "bones": bones,
            "morphs": morphs,
            "display_frames": display_frames,
            "rigid_bodies": rigid_bodies,
            "joints": joints,
        }


# ─── PMX 2.0 writer ──────────────────────────────────────────

def write_pmx(path, pmx):
    encoding = pmx["encoding"]
    idx_sizes = pmx["idx_sizes"]
    additional_uv = pmx["additional_uv"]

    with open(path, "wb") as f:
        f.write(b"PMX ")
        f.write(struct.pack("<f", 2.0))
        globals_bytes = bytes([
            0 if encoding == "utf-16-le" else 1,
            additional_uv,
            idx_sizes["vertex"],
            idx_sizes["texture"],
            idx_sizes["material"],
            idx_sizes["bone"],
            idx_sizes["morph"],
            idx_sizes["rigidbody"],
        ])
        f.write(bytes([len(globals_bytes)]))
        f.write(globals_bytes)

        def w_text(s):
            b = s.encode(encoding)
            f.write(struct.pack("<i", len(b)))
            f.write(b)

        def w_idx(v, size, signed):
            f.write(int(v).to_bytes(size, "little", signed=signed))

        def w_vec2(v):
            f.write(struct.pack("<2f", *v))

        def w_vec3(v):
            f.write(struct.pack("<3f", *v))

        def w_vec4(v):
            f.write(struct.pack("<4f", *v))

        def w_i32(v):
            f.write(struct.pack("<i", v))

        def w_f32(v):
            f.write(struct.pack("<f", v))

        def w_u8(v):
            f.write(bytes([v]))

        def w_u16(v):
            f.write(struct.pack("<H", v))

        w_text(pmx["model_name_jp"])
        w_text(pmx["model_name_en"])
        w_text(pmx["comment_jp"])
        w_text(pmx["comment_en"])

        # Vertices
        w_i32(len(pmx["vertices"]))
        for v in pmx["vertices"]:
            w_vec3(v["position"])
            w_vec3(v["normal"])
            w_vec2(v["uv"])
            for u in v["additional_uvs"]:
                w_vec4(u)
            wtype = v["weight_type"]
            w_u8(wtype)
            if wtype == 0:
                w_idx(v["bones"][0], idx_sizes["bone"], True)
            elif wtype == 1:
                w_idx(v["bones"][0], idx_sizes["bone"], True)
                w_idx(v["bones"][1], idx_sizes["bone"], True)
                w_f32(v["weights"][0])
            elif wtype == 2:
                for b in v["bones"]:
                    w_idx(b, idx_sizes["bone"], True)
                for w in v["weights"]:
                    w_f32(w)
            elif wtype == 3:
                w_idx(v["bones"][0], idx_sizes["bone"], True)
                w_idx(v["bones"][1], idx_sizes["bone"], True)
                w_f32(v["weights"][0])
                w_vec3(v["sdef_c"])
                w_vec3(v["sdef_r0"])
                w_vec3(v["sdef_r1"])
            w_f32(v["edge_scale"])

        # Faces
        w_i32(pmx["face_count"])
        f.write(pmx["face_data"])

        # Textures
        w_i32(len(pmx["textures"]))
        for t in pmx["textures"]:
            w_text(t)

        # Materials
        w_i32(len(pmx["materials"]))
        for m in pmx["materials"]:
            w_text(m["name_jp"])
            w_text(m["name_en"])
            w_vec4(m["diffuse"])
            w_vec3(m["specular"])
            w_f32(m["specular_pow"])
            w_vec3(m["ambient"])
            w_u8(m["flag"])
            w_vec4(m["edge_color"])
            w_f32(m["edge_size"])
            w_idx(m["tex_index"], idx_sizes["texture"], True)
            w_idx(m["sphere_index"], idx_sizes["texture"], True)
            w_u8(m["sphere_mode"])
            w_u8(m["toon_flag"])
            if m["toon_flag"] == 0:
                w_idx(m["toon_index"], idx_sizes["texture"], True)
            else:
                w_u8(m["toon_index"])
            w_text(m["memo"])
            w_i32(m["vertex_count"])

        # Bones
        w_i32(len(pmx["bones"]))
        for b in pmx["bones"]:
            w_text(b["name_jp"])
            w_text(b["name_en"])
            w_vec3(b["position"])
            w_idx(b["parent"], idx_sizes["bone"], True)
            w_i32(b["transform_level"])
            w_u16(b["flag"])
            flag = b["flag"]
            if flag & 0x0001:
                w_idx(b["link_bone"], idx_sizes["bone"], True)
            else:
                w_vec3(b["offset"])
            if flag & 0x0100 or flag & 0x0200:
                w_idx(b["append_parent"], idx_sizes["bone"], True)
                w_f32(b["append_ratio"])
            if flag & 0x0400:
                w_vec3(b["axis"])
            if flag & 0x0800:
                w_vec3(b["local_x"])
                w_vec3(b["local_z"])
            if flag & 0x2000:
                w_i32(b["external_key"])
            if flag & 0x0020:
                w_idx(b["ik_target"], idx_sizes["bone"], True)
                w_i32(b["ik_loop"])
                w_f32(b["ik_limit"])
                w_i32(len(b["ik_links"]))
                for link in b["ik_links"]:
                    w_idx(link["bone"], idx_sizes["bone"], True)
                    w_u8(link["has_limit"])
                    if link["has_limit"]:
                        w_vec3(link["lower"])
                        w_vec3(link["upper"])

        # Morphs
        w_i32(len(pmx["morphs"]))
        for m in pmx["morphs"]:
            w_text(m["name_jp"])
            w_text(m["name_en"])
            w_u8(m["panel"])
            w_u8(m["type"])
            w_i32(len(m["offsets"]))
            mtype = m["type"]
            for o in m["offsets"]:
                if mtype == 0:
                    w_idx(o["morph_index"], idx_sizes["morph"], True)
                    w_f32(o["ratio"])
                elif mtype == 1:
                    w_idx(o["vertex_index"], idx_sizes["vertex"], False)
                    w_vec3(o["offset"])
                elif mtype == 2:
                    w_idx(o["bone_index"], idx_sizes["bone"], True)
                    w_vec3(o["translation"])
                    w_vec4(o["rotation"])
                elif 3 <= mtype <= 7:
                    w_idx(o["vertex_index"], idx_sizes["vertex"], False)
                    w_vec4(o["offset"])
                elif mtype == 8:
                    w_idx(o["material_index"], idx_sizes["material"], True)
                    w_u8(o["op"])
                    w_vec4(o["diffuse"])
                    w_vec3(o["specular"])
                    w_f32(o["specular_pow"])
                    w_vec3(o["ambient"])
                    w_vec4(o["edge_color"])
                    w_f32(o["edge_size"])
                    w_vec4(o["tex"])
                    w_vec4(o["sphere"])
                    w_vec4(o["toon"])

        # Display Frames
        w_i32(len(pmx["display_frames"]))
        for d in pmx["display_frames"]:
            w_text(d["name_jp"])
            w_text(d["name_en"])
            w_u8(d["special"])
            w_i32(len(d["entries"]))
            for kind, idx in d["entries"]:
                if kind == "bone":
                    w_u8(0)
                    w_idx(idx, idx_sizes["bone"], True)
                else:
                    w_u8(1)
                    w_idx(idx, idx_sizes["morph"], True)

        # Rigid Bodies
        w_i32(len(pmx["rigid_bodies"]))
        for r in pmx["rigid_bodies"]:
            w_text(r["name_jp"])
            w_text(r["name_en"])
            w_idx(r["bone_index"], idx_sizes["bone"], True)
            w_u8(r["group"])
            w_u16(r["no_collide_group"])
            w_u8(r["shape"])
            w_vec3(r["size"])
            w_vec3(r["position"])
            w_vec3(r["rotation"])
            w_f32(r["mass"])
            w_f32(r["linear_damp"])
            w_f32(r["angular_damp"])
            w_f32(r["restitution"])
            w_f32(r["friction"])
            w_u8(r["physics_type"])

        # Joints
        w_i32(len(pmx["joints"]))
        for j in pmx["joints"]:
            w_text(j["name_jp"])
            w_text(j["name_en"])
            w_u8(j["type"])
            w_idx(j["rigid_a"], idx_sizes["rigidbody"], True)
            w_idx(j["rigid_b"], idx_sizes["rigidbody"], True)
            w_vec3(j["position"])
            w_vec3(j["rotation"])
            w_vec3(j["lin_min"])
            w_vec3(j["lin_max"])
            w_vec3(j["ang_min"])
            w_vec3(j["ang_max"])
            w_vec3(j["spring_pos"])
            w_vec3(j["spring_rot"])


# ─── Transformation ──────────────────────────────────────────

def collect_descendants(bones, root_idx):
    """root_idx 自身を含む子孫ボーン集合を返す。"""
    result = {root_idx}
    while True:
        added = False
        for i, b in enumerate(bones):
            if i in result:
                continue
            p = b["parent"]
            if p >= 0 and p in result:
                result.add(i)
                added = True
        if not added:
            break
    return result


def transform_arm_side(pmx, root_name, axis, angle):
    bones = pmx["bones"]
    name_to_index = {b["name_jp"]: i for i, b in enumerate(bones)}
    if root_name not in name_to_index:
        print(f"  warn: bone '{root_name}' not found, skipping side", file=sys.stderr)
        return

    root_idx = name_to_index[root_name]
    pivot = np.array(bones[root_idx]["position"], dtype=np.float64)
    affected = collect_descendants(bones, root_idx)
    q = quat_axis_angle(axis, angle)

    print(f"  side='{root_name}' pivot={pivot.tolist()} affected_bones={len(affected)}")
    aff_names = [bones[i]["name_jp"] for i in sorted(affected)]
    print(f"    bones: {aff_names}")

    # 1. ボーン位置・補助ベクトル
    for i in affected:
        b = bones[i]
        b["position"] = rotate_around_pivot(b["position"], pivot, q).tolist()
        if "offset" in b:
            b["offset"] = quat_rotate_vec(q, b["offset"]).tolist()
        if "axis" in b:
            b["axis"] = quat_rotate_vec(q, b["axis"]).tolist()
        if "local_x" in b:
            b["local_x"] = quat_rotate_vec(q, b["local_x"]).tolist()
            b["local_z"] = quat_rotate_vec(q, b["local_z"]).tolist()
        # IK link の角度制限は局所軸ベース。世界回転していないので変更しない。

    # 2. 各頂点の chain_weight (このサイドのチェーンに対する総ウェイト)
    vc = len(pmx["vertices"])
    chain_weight = np.zeros(vc, dtype=np.float64)
    for vi, v in enumerate(pmx["vertices"]):
        cw = 0.0
        for bi, w in zip(v["bones"], v["weights"]):
            if bi >= 0 and bi in affected:
                cw += w
        chain_weight[vi] = cw

    # 3. 頂点位置・法線・SDEF パラメータ
    moved = 0
    for vi, v in enumerate(pmx["vertices"]):
        cw = chain_weight[vi]
        if cw <= 0.0:
            continue
        moved += 1
        pos = np.array(v["position"], dtype=np.float64)
        new_pos = rotate_around_pivot(pos, pivot, q)
        v["position"] = ((1.0 - cw) * pos + cw * new_pos).tolist()

        n = np.array(v["normal"], dtype=np.float64)
        rn = quat_rotate_vec(q, n)
        nb = (1.0 - cw) * n + cw * rn
        nm = float(np.linalg.norm(nb))
        if nm > 1e-8:
            nb = nb / nm
        v["normal"] = nb.tolist()

        if v["weight_type"] == 3:  # SDEF
            for key in ("sdef_c", "sdef_r0", "sdef_r1"):
                p = np.array(v[key], dtype=np.float64)
                rp = rotate_around_pivot(p, pivot, q)
                v[key] = ((1.0 - cw) * p + cw * rp).tolist()
    print(f"    transformed vertices: {moved}")

    # 4. 頂点モーフ (type=1) の delta を回転
    morph_changed = 0
    for m in pmx["morphs"]:
        if m["type"] != 1:
            continue
        for o in m["offsets"]:
            vi = o["vertex_index"]
            if vi < 0 or vi >= vc:
                continue
            cw = chain_weight[vi]
            if cw <= 0.0:
                continue
            d = np.array(o["offset"], dtype=np.float64)
            rd = quat_rotate_vec(q, d)
            o["offset"] = ((1.0 - cw) * d + cw * rd).tolist()
            morph_changed += 1
    print(f"    transformed vertex-morph offsets: {morph_changed}")

    # 5. 剛体: bone_index がチェーンに属するもの
    affected_rb = set()
    rb_changed = 0
    for ri, r in enumerate(pmx["rigid_bodies"]):
        bi = r["bone_index"]
        if bi >= 0 and bi in affected:
            r["position"] = rotate_around_pivot(r["position"], pivot, q).tolist()
            ex_q = euler_yxz_to_quat(r["rotation"])
            new_q = quat_multiply(q, ex_q)
            r["rotation"] = quat_to_euler_yxz(new_q)
            affected_rb.add(ri)
            rb_changed += 1
    print(f"    transformed rigid bodies: {rb_changed}")

    # 6. ジョイント: 両端剛体がチェーンに属するもののみ変換
    j_changed = 0
    j_skipped = 0
    for j in pmx["joints"]:
        a_in = j["rigid_a"] >= 0 and j["rigid_a"] in affected_rb
        b_in = j["rigid_b"] >= 0 and j["rigid_b"] in affected_rb
        if a_in and b_in:
            j["position"] = rotate_around_pivot(j["position"], pivot, q).tolist()
            ex_q = euler_yxz_to_quat(j["rotation"])
            new_q = quat_multiply(q, ex_q)
            j["rotation"] = quat_to_euler_yxz(new_q)
            j_changed += 1
        elif a_in != b_in:
            j_skipped += 1
    print(f"    transformed joints: {j_changed} (skipped mixed-side: {j_skipped})")


# ─── Main ────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        description="PMX 2.0 T-pose を A-pose に焼き付けて書き出す"
    )
    p.add_argument("input", help="入力 PMX ファイル (PMX 2.0)")
    p.add_argument("output", help="出力 PMX ファイル")
    p.add_argument(
        "--angle",
        type=float,
        default=35.0,
        help="腕を下げる角度 (度, 既定 35)",
    )
    args = p.parse_args()

    print(f"Reading {args.input}")
    pmx = read_pmx(args.input)
    print(
        f"  vertices={len(pmx['vertices'])} bones={len(pmx['bones'])} "
        f"morphs={len(pmx['morphs'])} rigidbodies={len(pmx['rigid_bodies'])} "
        f"joints={len(pmx['joints'])}"
    )

    rad = math.radians(args.angle)
    print(f"Baking A-pose (angle={args.angle}°)")
    transform_arm_side(pmx, ARM_LEFT, (0, 0, -1), rad)
    transform_arm_side(pmx, ARM_RIGHT, (0, 0, 1), rad)

    print(f"Writing {args.output}")
    write_pmx(args.output, pmx)
    print("Done.")


if __name__ == "__main__":
    main()
