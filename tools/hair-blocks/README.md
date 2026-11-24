# Hair archetype blocks

`src/engine/hairBuilder.ts` holds every archetype branch between `// ARCH-BEGIN <id>` and `// ARCH-END <id>` markers. The source of each branch is `tools/hair-blocks/<id>.ts` (full `if (arch === '<id>') { ... return specs; }`). To change a style: edit only its block file, run `python tools/hair-blocks/compose.py` (lock-protected, safe with several editors), then `npx tsc --noEmit`. A new style also needs: the id in `src/types/hair.ts`, an `ARCHETYPE_METADATA` line, an `ARCHETYPE_PRESET_MAP` entry and a `buildArchetypeParameters` case in `hairBuilder.ts` (outside the block regions).

Shared helpers in `hairBuilder.ts`: `earAlignedCutPhi`, `earSideburnTip`, `sideburnLocks` (ear-aligned cut lines for Tobin), per-lock `isFadeCap` + `fadeStart` (stubble fade), `smooth` + `roundness` (spline-smoothed round locks), `lockNormal`, `customOutDir`. Lessons and the Unity render loop: see the game repo's `Reference/sessions/aetherstrand-combo/` (PIPELINE.md, STATUS.md).
