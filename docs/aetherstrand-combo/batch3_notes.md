# Batch 3 integration notes (2026-11-24)

Integrated in hairBuilder.ts / hair.ts (each id once in union, METADATA, PRESET_MAP, buildArchetypeParameters case, ARCH block). tsc clean. Raw Neon text: C:\Dev\scratch\neon_code\<id>.txt. Smoke renders: C:\Dev\scratch\parity_out\b3i_<id>_4view.png; ref-above-render comparisons: C:\Dev\scratch\loop\b3i_<id>_cmp.png. Renders were taken with SC_TOBIN_HUG 0.4, views empty (front/back/left/right; no 3/4), recipe sliders = midpoints of Neon's ranges.
Reference dir: C:\Dev\game-repo\Reference\private\hair_refs\ (ref_<name>_realistic.jpg / _stylized.jpg).

## pixie-cut
- Block: C:\Dev\scratch\blocks\pixie-cut.ts
- Recipe: C:\Dev\scratch\batch\pixie-cut\recipe.json (preset leon)
- Refs: ref_pixie_cut_realistic.jpg, ref_pixie_cut_stylized.jpg
- Differences: hair is only a thin fringe/side band; the whole crown, top and back stay bare scalp (front shows a bald forehead strip, back shows long separated spikes with gaps). Locks hang straight down like a curtain, not a layered crop; no swept fringe covering the forehead; ear/sideburn area has no tapered sideburn; colour renders lighter and more orange than the dark brown reference.

## twin-buns
- Block: C:\Dev\scratch\blocks\twin-buns.ts
- Recipe: C:\Dev\scratch\batch\twin-buns\recipe.json (preset crimson)
- Refs: ref_twin_buns_realistic.jpg, ref_twin_buns_stylized.jpg
- Differences: buns are small and sit too far back and out (front view: tiny balls at the sides, side view: only one bun, centred over the crown rather than behind-above the ear); scalp covered by gapped wide spikes, no smooth centre-parted swept-up hair; large bare patches on the crown and back; a stray diagonal band of locks in the back view; bun lacks the coiled swirl; temple tendrils not visible.

## mohawk-warrior
- Block: C:\Dev\scratch\blocks\mohawk-warrior.ts
- Recipe: C:\Dev\scratch\batch\mohawk-warrior\recipe.json (preset noctis)
- Refs: ref_mohawk_warrior_realistic.jpg, ref_mohawk_warrior_stylized.jpg
- Differences: ridge is a row of thin separated spikes rather than a dense tall swept crest (front view shows only 3 tiny spikes at the top and the front ridge is a bare strip); a wide flat band (the base-strip locks) wraps diagonally across the head from the temple to the nape, which looks like a headband; side fade is a dithered gradient reaching up to the crown and fills the sides too much, and the back tail is a small stub, not a braid; the ridge is far too thin and short for the reference.

## low-side-ponytail
- Block: C:\Dev\scratch\blocks\low-side-ponytail.ts
- Recipe: C:\Dev\scratch\batch\low-side-ponytail\recipe.json (preset silver; CAMDROP 0.1, CAMZOOM 1.4)
- Refs: ref_low_side_ponytail_realistic.jpg, ref_low_side_ponytail_stylized.jpg
- Differences: head is mostly bare (only the swept crown region and fringe are covered; side and back have gaps with big triangular spikes); the ponytail attaches at the nape behind the ear and runs mostly straight down the neck instead of arcing forward over the shoulder; tail is a stiff flat bundle with no wave and no tie band; the front view shows a bald left temple, no side-swept bangs covering the forehead; colour is more yellow than the reference's warm brown.
