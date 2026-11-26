# AetherStrand Blender bridge (hybrid hair)

Gets a hair style into Blender as the exact meshes the web viewport draws, then out as FBX.

1. Export the meshes (in the AetherStrand repo):
   `npx tsx tools/blender/export_glb.ts <recipe.json> hair.glb [--mass] [--edge-cards N]`
2. Import in Blender 4.2 or newer: install `aetherstrand_hybrid_import.py` as an addon and use
   File > Import > AetherStrand hair (.glb), or call `import_hair("hair.glb")` from a script.
3. Check it headless:
   `blender -b --factory-startup -P headless_check.py -- hair.glb out/`
   This prints vertex and triangle counts per type, renders four views, writes `hair.fbx` and `summary.json`.

Objects: `Hair_Locks`, `Hair_StrandCards` (fine strands and edge cards), `Hair_FadeCaps`, `Hair_BaseShell`, `Hair_Mass`.
Vertex colour (linear, the Unity plugin's layout): r = seed fraction, g = layer AO, b = seed high byte / 255, a = card mask
(0 base shell, 0.15 to 0.45 fade cap, 0.5 to 0.9 strand or edge card, 1 lock). The AS_ materials are previews only.

Why a .glb and not a Python rebuild from PresetGeometry.json: three.js already builds these meshes for the viewport, and
Blender reads glTF natively, so there is one mesh builder and nothing to keep in sync.
