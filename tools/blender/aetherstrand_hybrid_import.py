# AetherStrand hybrid hair import for Blender 4.2+ (issue #9, plan row 2b "minimal Blender bridge").
#
# Input is the .glb that tools/blender/export_glb.ts writes from a recipe: the exact meshes the web viewport draws (locks,
# strand and edge cards, fade caps, hybrid inner mass), so nothing is rebuilt in Python and Blender can't drift from the web.
# This module imports it, gives each hair type one preview material (named AS_<type>, dithered alpha on cards so they read
# in Eevee and Cycles), and can export an FBX that keeps the vertex colours linear, in the Unity plugin's layout:
#   r = seed fraction, g = layer AO, b = seed high byte / 255, a = card mask
#   (0 base shell, 0.15-0.45 fade cap, 0.5-0.9 strand/edge card, 1 lock).
#
# Use from a script:   import aetherstrand_hybrid_import as asi; asi.import_hair("hair.glb"); asi.export_fbx("hair.fbx")
# Or as an addon: File > Import > AetherStrand hair (.glb).
bl_info = {
    "name": "AetherStrand hybrid hair import",
    "author": "AetherStrand",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "File > Import > AetherStrand hair (.glb)",
    "category": "Import-Export",
}

import bpy

HAIR_TYPES = ("Hair_Locks", "Hair_StrandCards", "Hair_FadeCaps", "Hair_BaseShell", "Hair_Mass")
CARD_TYPES = ("Hair_StrandCards", "Hair_FadeCaps")
# preview tint only (a neutral dark brown); the real look comes from the Unity and web shaders
PREVIEW_TINT = (0.11, 0.075, 0.055, 1.0)


def _hair_type(obj_name):
    for t in HAIR_TYPES:
        if obj_name == t or obj_name.startswith(t + "."):
            return t
    return None


def _preview_material(hair_type, color_attr):
    name = "AS_" + hair_type
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    col = nt.nodes.new("ShaderNodeVertexColor")
    col.layer_name = color_attr
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs["A"].default_value = PREVIEW_TINT
    nt.links.new(col.outputs["Color"], sep.inputs["Color"])
    # layer AO (green) darkens under-layers, as in the plugin
    nt.links.new(sep.outputs["Green"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.45
    if hair_type in CARD_TYPES:
        # cards fade out toward the tip (uv.y runs root 0 to tip 1), dithered so overlapping cards sort cleanly
        uv = nt.nodes.new("ShaderNodeUVMap")
        sepuv = nt.nodes.new("ShaderNodeSeparateXYZ")
        ramp = nt.nodes.new("ShaderNodeMapRange")
        ramp.inputs["From Min"].default_value = 0.7
        ramp.inputs["From Max"].default_value = 1.0
        ramp.inputs["To Min"].default_value = 1.0
        ramp.inputs["To Max"].default_value = 0.0
        nt.links.new(uv.outputs["UV"], sepuv.inputs["Vector"])
        nt.links.new(sepuv.outputs["Y"], ramp.inputs["Value"])
        nt.links.new(ramp.outputs["Result"], bsdf.inputs["Alpha"])
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "DITHERED"
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def import_hair(glb_path):
    """Imports the .glb and sets up preview materials. Returns {hair type: object}."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    found = {}
    for obj in set(bpy.data.objects) - before:
        t = _hair_type(obj.name)
        if t is None or obj.type != "MESH":
            continue
        mesh = obj.data
        color_attr = mesh.color_attributes[0].name if len(mesh.color_attributes) else "Color"
        mesh.materials.clear()
        mesh.materials.append(_preview_material(t, color_attr))
        found[t] = obj
    return found


def counts(found):
    out = {}
    for t, obj in sorted(found.items()):
        m = obj.data
        m.calc_loop_triangles()
        out[t] = {"vertices": len(m.vertices), "triangles": len(m.loop_triangles)}
    return out


def export_fbx(fbx_path):
    """Exports all AetherStrand hair objects to FBX with linear vertex colours (what the plugin's mesh colours use)."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        if _hair_type(obj.name):
            obj.select_set(True)
    bpy.ops.export_scene.fbx(
        filepath=fbx_path,
        use_selection=True,
        object_types={"MESH"},
        colors_type="LINEAR",
        mesh_smooth_type="OFF",
        add_leaf_bones=False,
        apply_scale_options="FBX_SCALE_UNITS",
        axis_forward="-Z",
        axis_up="Y",
    )


class AETHERSTRAND_OT_import(bpy.types.Operator):
    bl_idname = "import_scene.aetherstrand_hair"
    bl_label = "AetherStrand hair (.glb)"
    filepath: bpy.props.StringProperty(subtype="FILE_PATH")
    filter_glob: bpy.props.StringProperty(default="*.glb", options={"HIDDEN"})

    def execute(self, context):
        found = import_hair(self.filepath)
        self.report({"INFO"}, "AetherStrand: " + ", ".join(f"{t} {c['vertices']} verts" for t, c in counts(found).items()))
        return {"FINISHED"}

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}


def _menu(self, context):
    self.layout.operator(AETHERSTRAND_OT_import.bl_idname, text="AetherStrand hair (.glb)")


def register():
    bpy.utils.register_class(AETHERSTRAND_OT_import)
    bpy.types.TOPBAR_MT_file_import.append(_menu)


def unregister():
    bpy.types.TOPBAR_MT_file_import.remove(_menu)
    bpy.utils.unregister_class(AETHERSTRAND_OT_import)
