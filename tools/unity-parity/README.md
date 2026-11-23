# Unity parity tools

Tools used to make the Unity plugin (`/unity-plugin/com.aetherstrand.sculptedhair`) match this web app 1:1 and to fit any web hairstyle onto a rigged character. Overview: `/docs/unity-parity/PIPELINE.md`; physics port details: `/docs/unity-parity/PHYSICS_PORT.md`.

Run from the repo root (needs `npm install`; `npx tsx` runs the .ts files):

- `npx tsx tools/unity-parity/web_export.ts <recipe.json> <outDir>` writes `PresetGeometry.json` (schema 2.1: per-lock rest points, widths, seed, layerAO, scalpRoot, lockNormal, rootNormal, plus solver extras at full precision). It mirrors the viewport's own load path, so it equals what the web renders and simulates. Example recipe: `tools/unity-parity/recipes/halfup059.json`.
- `npx tsx tools/unity-parity/gen_recipes.ts <outDir>` writes a recipe + geometry for each of the 12 archetypes.
- `npx tsx tools/unity-parity/web_trace.ts <recipe.json> <outDir> <idle|walk|turn|gust> [frames]` runs the web solver headless and writes a per-frame particle trace (ground truth for the C# solver port).
- Capture URL additions in this change: `?capture=1&sim=rest&nobust=1&cfg=<base64 recipe JSON>` renders the 4-view sheet for an arbitrary recipe, optionally without the bust.
- `unity/` holds the Unity-side scratch harnesses (parity render with the web light rig and three's ACES, the test character fit render, head wiggle); copy them into a project's `Assets/Editor` (HeadWiggle.cs into a runtime folder).
- `cmp.py` / `cmp_batch.py` compare web and Unity 4-view sheets (hair overlap and pixel error).
