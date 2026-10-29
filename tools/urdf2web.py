"""Convert a URDF + CAD meshes into a slim, web-ready robot: decimated GLB meshes and a visual-only URDF.

usage: python urdf2web.py <name> <urdf> <budget_faces> <out_root> [--base DIR ...] [--materials URDF] [--color r,g,b]
"""
import argparse, math, os, re, sys
import xml.etree.ElementTree as ET
import numpy as np
import trimesh

ap = argparse.ArgumentParser()
ap.add_argument("name")
ap.add_argument("urdf")
ap.add_argument("budget", type=int)
ap.add_argument("out_root")
ap.add_argument("--base", action="append", default=[], help="extra directories to resolve mesh paths against")
ap.add_argument("--materials", help="URDF/xacro file whose <material> definitions get inlined")
ap.add_argument("--color", help="override every visual colour with this rgb (0-1, comma separated)")
a = ap.parse_args()

out = os.path.join(a.out_root, a.name)
os.makedirs(os.path.join(out, "meshes"), exist_ok=True)
tree = ET.parse(a.urdf)
root = tree.getroot()
udir = os.path.dirname(os.path.abspath(a.urdf))

# visual-only: drop everything the browser never needs
for parent in list(root.iter()):
    for ch in list(parent):
        tag = ch.tag.split("}")[-1]
        if tag in ("collision", "inertial", "gazebo", "transmission", "ros2_control", "safety_controller", "dynamics") or ":" in ch.tag or "{" in ch.tag:
            parent.remove(ch)
for ch in list(root):
    if ch.tag.endswith("include"):
        root.remove(ch)
if a.materials:
    mroot = ET.parse(a.materials).getroot()
    for m in mroot.iter("material"):
        if m.find("color") is not None:
            root.insert(0, m)
if a.color:
    rgb = a.color.split(",")
    for vis in root.iter("visual"):
        for m in vis.findall("material"):
            vis.remove(m)
        m = ET.SubElement(vis, "material", name="")
        ET.SubElement(m, "color", rgba=" ".join(rgb + ["1"]))

def resolve(fn):
    fn = re.sub(r"^package://[^/]+/", "", fn)
    fn = re.sub(r"^file://", "", fn)
    for b in [udir] + a.base:
        p = os.path.normpath(os.path.join(b, fn))
        if os.path.exists(p):
            return p
        p2 = os.path.join(b, os.path.basename(fn))
        if os.path.exists(p2):
            return p2
    raise FileNotFoundError(fn)

def load(p):
    m = trimesh.load(p, force="mesh", process=True)
    if p.lower().endswith(".dae"):
        # COLLADA carries its own unit; three's ColladaLoader honours it, trimesh does not
        u = re.search(r'<unit[^>]*meter="([0-9.eE+-]+)"', open(p, errors="ignore").read(4096))
        if u and float(u.group(1)) != 1.0:
            m.apply_scale(float(u.group(1)))
    m.merge_vertices()
    return m

def load_parts(p):
    """One (mesh, rgba) part per colour. glTF sources keep their material colours; others get None (URDF colour)."""
    if not p.lower().endswith((".glb", ".gltf")):
        return [(load(p), None)]
    groups = {}
    for g in trimesh.load(p, force="scene").dump(concatenate=False):
        col = getattr(getattr(g.visual, "material", None), "baseColorFactor", None)
        if col is not None:
            col = np.asarray(col, float)[:4]
            col = tuple(np.round(col / 255.0 if col.max() > 1 else col, 4))
        groups.setdefault(col, []).append(trimesh.Trimesh(g.vertices, g.faces))
    parts = []
    for col, ms in groups.items():
        m = trimesh.util.concatenate(ms)
        m.merge_vertices()
        parts.append((m, col))
    return parts

nodes = [n for n in root.iter("mesh")]
meshes = {}
for n in nodes:
    p = resolve(n.get("filename"))
    if p not in meshes:
        meshes[p] = load_parts(p)

faces_of = lambda parts: sum(len(m.faces) for m, _ in parts)
# split the face budget by a sub-linear weight, so tiny parts keep their shape and huge parts give up the most
w = {p: max(faces_of(ps), 1) ** 0.6 for p, ps in meshes.items()}
tw = sum(w.values())
total_in = total_out = 0
names = {}
import json, struct

def quantized_glb(parts):
    """Positions + indices only (the viewer rebuilds creased normals), stored with KHR_mesh_quantization:
    int16 positions dequantized by the node's translation/scale, 16-bit indices when they fit.
    One primitive per part; a part with a colour gets a material named "c" that the viewer keeps."""
    allv = np.concatenate([m.vertices for m, _ in parts])
    lo, hi = allv.min(0), allv.max(0)
    c = (lo + hi) / 2
    s = float(max((hi - lo).max() / 2, 1e-9))
    blob, views, accs, prims, mats = b"", [], [], [], []
    for m, col in parts:
        q = np.round((m.vertices - c) / s * 32767).clip(-32767, 32767).astype(np.int16)
        pos = np.zeros((len(q), 4), np.int16)  # 8-byte stride: attribute strides must be multiples of 4
        pos[:, :3] = q
        big = len(q) > 65535
        idx = m.faces.astype(np.uint32 if big else np.uint16).ravel()
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": idx.nbytes, "target": 34963})
        blob += idx.tobytes()
        blob += b"\0" * (-len(blob) % 4)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": pos.nbytes, "byteStride": 8, "target": 34962})
        blob += pos.tobytes()
        accs.append({"bufferView": len(views) - 2, "componentType": 5125 if big else 5123, "count": int(idx.size), "type": "SCALAR"})
        accs.append({"bufferView": len(views) - 1, "componentType": 5122, "normalized": True, "count": int(len(q)), "type": "VEC3",
                     "min": q.min(0).tolist(), "max": q.max(0).tolist()})
        prim = {"attributes": {"POSITION": len(accs) - 1}, "indices": len(accs) - 2}
        if col is not None:
            prim["material"] = len(mats)
            mats.append({"name": "c", "pbrMetallicRoughness": {"baseColorFactor": [float(v) for v in col]}})
        prims.append(prim)
    gl = {
        "asset": {"version": "2.0", "generator": "urdf2web"},
        "extensionsUsed": ["KHR_mesh_quantization"], "extensionsRequired": ["KHR_mesh_quantization"],
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "translation": c.tolist(), "scale": [s, s, s]}],
        "meshes": [{"primitives": prims}],
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": views, "accessors": accs,
    }
    if mats:
        gl["materials"] = mats
    js = json.dumps(gl, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    return (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
            + struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(blob), 0x004E4942) + blob)

def decimate(m, target):
    """Quadric decimation, with a guard: thin CAD shells can collapse, so keep doubling the
    face count until surface area and extents survive, or give up and keep the original."""
    area, ext = m.area, m.extents
    while target < len(m.faces) * 0.8:
        try:
            d = m.simplify_quadric_decimation(face_count=target)
        except Exception as e:
            print("  decimation failed:", e, file=sys.stderr)
            return m
        if d.area >= area * 0.93 and np.all(d.extents >= ext * 0.97):
            return d
        target *= 2
    return m

empty = set()
for p, ps in meshes.items():
    n_in = faces_of(ps)
    total_in += n_in
    if n_in < 4:
        empty.add(p)
        continue
    target = min(n_in, max(300, a.budget * w[p] / tw))
    ps = [(decimate(m, int(max(100, target * len(m.faces) / n_in))) if len(m.faces) >= 4 else m, col) for m, col in ps]
    ps = [(m, col) for m, col in ps if len(m.faces)]
    meshes[p] = ps
    total_out += faces_of(ps)
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", os.path.splitext(os.path.basename(p))[0])
    while stem in names.values():
        stem += "_"
    names[p] = stem
    with open(os.path.join(out, "meshes", stem + ".glb"), "wb") as f:
        f.write(quantized_glb(ps))

# a visual whose mesh is empty upstream would only make the loader report an error
for link in root.iter("link"):
    for vis in link.findall("visual"):
        mesh = vis.find("geometry/mesh")
        if mesh is not None and resolve(mesh.get("filename")) in empty:
            link.remove(vis)
nodes = [n for n in root.iter("mesh")]
for n in nodes:
    n.set("filename", "meshes/" + names[resolve(n.get("filename"))] + ".glb")

ET.indent(tree, space=" ")
tree.write(os.path.join(out, a.name + ".urdf"), encoding="utf-8", xml_declaration=True)

ext = trimesh.util.concatenate([m for p, ps in meshes.items() if p not in empty for m, _ in ps]).extents
joints = [j for j in root.iter("joint") if j.get("type") in ("revolute", "continuous", "prismatic")]
size = sum(os.path.getsize(os.path.join(out, "meshes", f)) for f in os.listdir(os.path.join(out, "meshes")))
print(f"{a.name}: {len(meshes)} meshes, {total_in:,} -> {total_out:,} faces, {size/1e6:.2f} MB, {len(joints)} movable joints, raw extents {np.round(ext, 3)}")
