# AetherStrand shared tools

Tools every archetype can use. Each one exists in the web generator and in the Unity plugin with the same maths, so a
style built on the web looks the same in Unity. When a style needs something these can't do, add a tool here instead of
adding a trick to one style.

## Scalp paint (painted short hair)

`src/engine/scalpPaint.ts` · Unity: `ScalpPaintData` (Runtime/AetherStrandWebData.cs), `AetherStrandScalpPaint.cs`,
shader `AetherStrand/ScalpPaint`.

A hair-coloured layer painted on the head skin under the locks, as games use a scalp texture. It draws fades, stubble,
sideburn tips, the hairline and the scalp under thin hair, which modelled locks can't show well.

- Curves per azimuth (180 bins, 2° each): `fullPhi` (solid down to here), `edgePhi` (fades to `edgeDensity` by here),
  then `feather` to zero. phi is the polar angle from the crown on the web scalp ellipsoid.
- Every style gets an automatic paint from where its locks touch the scalp (`deriveScalpPaint`).
- A style can supply its own in `SCALP_PAINT_BY_ARCHETYPE` (hairBuilder.ts), for example `fadeScalpPaint` below.
- Exported in PresetGeometry.json as `scalpPaint`. The Unity importer builds a thin shell over the character's head skin
  (head-weighted triangles) and draws the paint there. Menu: Tools > AetherStrand > Rebuild Scalp Paint On Selected Character.

### Hairline look (all styles)

`applyHairlineLook` runs on every style's paint (`scalpPaintForConfig`). Builder config, all optional:

| Field | Range | Default | Effect |
|---|---|---|---|
| `hairlineSoftness` | 0..1 | 0.5 | 0 = crisp barbered edge, 1 = very soft, wispy blend into the skin. The edge stays where it was. |
| `hairlineIrregularity` | 0..1 | 0.5 | Unevenness of the edge (small noise along the hairline). 0 = a clean drawn curve. |
| `scalpColor` | `#rrggbb` | unset | Tint of the painted hair. Unset = the hair's own colour. |

- Default colour (`scalpPaintColor`): 20% root, 50% base, 30% tip, averaged in linear space. In Unity, the paint
  material's `_Color` can be changed by hand afterwards.
- Edge coverage (`scalpPaintAlpha`): a soft gradient mixed with fine stipple by `grain`, so it never ends on a hard line.
- Strand streaks (`paintStreak`): fine noise stretched along the comb direction, so painted sides read as short hairs
  rather than flat colour. In Unity it is the `_Streaks` slider.

### Fade

`fadeScalpPaint(options)` in hairBuilder.ts paints a barber fade or taper for any short-sided style:

- solid side hair, then a gradient to `stubble` at the ear-aligned cut line;
- a pointed sideburn in front of the ear, an arch over the ear and a curved nape (`earAlignedCutPhi`);
- no fade on the front hairline.

Config `fadeHeight` (0..1, default 0.5 for undercut-fade) sets how far up the sides the fade climbs. Use the fade paint
instead of modelling fade-cap locks.

## Textured top and side layer

- `texturedTopLocks(specs, options)`: short, pointed clumps growing from a crown whorl and flowing forward, with lift and
  spikes (crop, undercut and fade tops). Option `quiff` (0..1): front clumps keep their height where the forehead drops
  away, so the front stands up rather than out. Clumps flowing back or sideways settle onto the skull toward their tips.
- `sideLayerLocks(specs, options)`: two rows of short locks lying on the sides down to a per-azimuth end. Use it only
  when the sides are long enough to need modelled hair; short sides are better painted.

## Head conform (character skulls)

`src/engine/characterHead.ts`: `buildHeadConformMap` / `conformPoint`; `HairPhysicsSystem.conformToHead(map)`.

A character's skull is rarely the web ellipsoid (Tobin's is up to 9% bigger at the forehead), so close-lying hair would
sink into the head. The conform map stores, per azimuth and phi, how far the skull pokes past the ellipsoid, and pushes
rest positions out by that much (outward only). Not yet ported to the Unity plugin.

## Preview renderer (for humans and AI)

`npx tsx tools/preview/cpu_preview.ts --recipe recipe.json --out sheet.png` renders the real lock geometry, with no GPU.

| Flag | Effect |
|---|---|
| `--arch <id> [--seed n]` | Render a random style of that archetype instead of a recipe. |
| `--head Head.obj [--chin-y 1.5855]` | Use a character head, fitted as the plugin does. |
| `--views front,3q,left,back,top` | Pick the views. |
| `--zoom 2 --cy 0.9` | Close-up; `cy` is the centre height in metres. |
| `--no-paint` | Hide the scalp paint. |
| `--magenta` | Paint the haired scalp magenta to find bald spots. |
| `--no-conform` | Skip the head conform. |

The preview draws a stand-in for the viewport hair shader on lock cards: about 18 strands across each card, frayed tips
past 55% of the length and darker grooves between strands. Colours are taken as linear (as three.js does), so dark hair
renders at the same brightness as in the app.
