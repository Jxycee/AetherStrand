# Headless check of the Blender bridge (issue #9):
#   blender -b --factory-startup -P tools/blender/headless_check.py -- <hair.glb> <outdir>
# Imports the .glb from tools/blender/export_glb.ts, prints vertex and triangle counts per hair type, renders front, left,
# back and three-quarter views at 512 px (Cycles on the CPU, fixed seed and samples, so runs are repeatable), exports
# hair.fbx, and writes summary.json. No UI calls, no network.
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aetherstrand_hybrid_import as asi  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) < 2:
    raise SystemExit("usage: blender -b --factory-startup -P headless_check.py -- <hair.glb> <outdir>")
glb, outdir = args[0], args[1]
os.makedirs(outdir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
found = asi.import_hair(glb)
counts = asi.counts(found)
for t, c in counts.items():
    print(f"[AetherStrand] {t}: {c['vertices']} vertices, {c['triangles']} triangles")

# bounds of all hair, for the camera framing
lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for obj in found.values():
    for corner in obj.bound_box:
        w = obj.matrix_world @ Vector(corner)
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
centre = (lo + hi) * 0.5
size = max(hi - lo)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.cycles.seed = 7
scene.cycles.use_denoising = False
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
world = bpy.data.worlds.new("AS_World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.6, 0.6, 0.62, 1.0)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
scene.world = world
sun_data = bpy.data.lights.new("AS_Key", "SUN")
sun_data.energy = 3.0
sun = bpy.data.objects.new("AS_Key", sun_data)
sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
scene.collection.objects.link(sun)

cam_data = bpy.data.cameras.new("AS_Cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = size * 1.15
cam = bpy.data.objects.new("AS_Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

# the file is Blender Z up, -Y front (the character faces -Y)
views = {"front": -90.0, "left": 0.0, "back": 90.0, "threequarter": -45.0}  # left = the character's left (+X)
renders = {}
for name, az in views.items():
    a = math.radians(az)
    d = size * 3.0
    cam.location = centre + Vector((math.cos(a) * d, math.sin(a) * d, 0.0))
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    path = os.path.join(outdir, f"{name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    renders[name] = os.path.basename(path)

fbx = os.path.join(outdir, "hair.fbx")
asi.export_fbx(fbx)
summary = {
    "source": os.path.basename(glb),
    "blender": bpy.app.version_string,
    "meshes": counts,
    "bounds": {"min": list(lo), "max": list(hi)},
    "renders": renders,
    "fbx": os.path.basename(fbx),
}
with open(os.path.join(outdir, "summary.json"), "w") as f:
    json.dump(summary, f, indent=2)
print("[AetherStrand] summary", json.dumps(summary))
