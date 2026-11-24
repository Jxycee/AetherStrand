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

- Default colour (`scalpPaintColor`): 10% root, 45% base, 45% tip, averaged in linear space, times 1.25 for the sheen
  locks get from the hair shader (a plain average made painted sides read as bare scalp). In Unity, the paint
  material's `_Color` can be changed by hand afterwards.
- Edge coverage (`scalpPaintAlpha`): a soft gradient mixed with fine stipple by `grain`, so it never ends on a hard line.
- Strand streaks (`paintStreak`): fine noise stretched along the comb direction, so painted sides read as short hairs
  rather than flat colour. In Unity it is the `_Streaks` slider.

### Fade

`fadeScalpPaint(options)` in hairBuilder.ts paints a barber fade or taper for any short-sided style:

- solid side hair, then a gradient to `stubble` at the ear-aligned cut line;
- a pointed sideburn in front of the ear, an arch over the ear and a curved nape (`earAlignedCutPhi`);
- no fade on the front hairline.

Builder config, both shown as sliders in the app for fade styles:

| Field | Range | Default | Effect |
|---|---|---|---|
| `fadeHeight` | 0..1 | 0.4 | How far up the sides the fade climbs. |
| `fadeBlend` | 0..1 | 0.75 (undercut-fade) | Width of the gradient from the top length into the short sides. Low = a hard barbered line, high = a long soft blend. |

`roundedHairline(centre, cornerLift, width)` gives a curved front hairline for the cut line (`hairlinePhi`): highest at
the temple corners, lowest in the middle of the forehead. Combine it with `templeRecede` for the temple dip of most men's
cuts. Use the fade paint instead of modelling fade-cap locks, and don't model a dark base shell under a crop: its edge
shows as dark teeth along the hairline.

## Textured top and side layer

- `texturedTopLocks(specs, options)`: short, pointed clumps growing from a crown whorl and flowing forward, with lift and
  spikes (crop, undercut and fade tops). Option `quiff` (0..1): front clumps keep their height where the forehead drops
  away, so the front stands up rather than out. Clumps flowing back or sideways settle onto the skull toward their tips.
  - `endPhi(az)`: drape line. Clumps flowing back or sideways follow the skull past the dome edge and lie down over the
    sides and back to this line, so the top layers into painted sides instead of sitting on them as a cap. The march runs
    on the scalp ellipsoid, so a flow pointing out past the dome edge turns down the head by itself.
  - `hairlineRow(az)`: a row of short locks rooted along the front hairline, rising off the skin in tufts with their tips
    leaning forward. Use it when the top's front edge would otherwise leave a bare painted strip.
  - `whorlCap` (default 1): a small flat swirl of short locks over the crown whorl, so the crown never opens into a bald spot.
  - Clumps cut shorter than about 4 cm are dropped, because a clump shorter than it is wide renders as a curled blob.
  - `frontBack` (0..1): clumps rooted near the front flow back toward the crown, so the front rises up and back
    instead of reading as a fringe. `clumpScale`: >1 gives fewer, larger clumps.
- `cropFieldLocks(specs, options)`: the newer crop top, used by undercut-fade. One combed field of many narrow locks: the
  flow runs back from the front hairline and out from the crown whorl, and neighbouring tips gather onto clump guides, so
  the top reads as larger swept clumps with pointed ends rather than a pile of flakes. Main options:
  - `hairPhi(az)` (required): where the modelled hair ends, usually the solid part of the fade paint.
  - `frontInset` (default 0.03 rad): at the front, roots start just behind the painted hairline, so the forehead shows the
    paint's soft hairline and the hair rises from behind it.
  - `clumpSpacing` (default 0.055) and `clump` (0..1, default 0.55): clump size and how strongly tips gather.
  - `length`, `volume` (height off the scalp), `spike` (spiked clump tips on the top), `stand` (front lift), `sweep`.
  - `rigid` (default true): see Rigid locks below.
- `sideLayerLocks(specs, options)`: two rows of short locks lying on the sides down to a per-azimuth end. Use it only
  when the sides are long enough to need modelled hair; short sides are better painted.

## Lock options for close-cut hair

- `rigid` (LockBuildSpec, exported per lock): the lock keeps its built shape exactly and follows the head rigidly. It
  skips the rest-pose bake (head margin, smoothing, inter-lock push) and the live physics. Short, densely layered hair
  needs it: the bake pushes overlapping locks apart and crumples them into knots, which is what made crop tops look like
  flakes. Unity: `LockData.rigid`, honoured by AetherStrandWebSolver (follows the head, no cohesion or collision).
- `colorRange: [from, to]` (exported as `colorFrom` / `colorTo`): the part of the root-to-tip colour gradient the lock
  shows. A short lock is a piece of longer hair, so it shouldn't get a dark root and a light tip of its own (that dots the
  surface). Unity: read by AetherStrandWebMesh and the URP ForwardLit pass of AetherStrand_Hair.shader; the Built-in
  pass and the legacy Editor mesh generator still use the full gradient.

## Head conform (character skulls)

`src/engine/characterHead.ts`: `buildHeadConformMap` / `conformPoint`; `HairPhysicsSystem.conformToHead(map)`.

A character's skull is rarely the web ellipsoid (Tobin's is up to 9% bigger at the forehead), so close-lying hair would
sink into the head. The conform map stores, per azimuth and phi, how far the skull pokes past the ellipsoid, and pushes
rest positions by that much. Locks that stay on the scalp move out or in (Tobin's occiput is 2 to 8% inside the
ellipsoid, so back hair would otherwise float); locks that hang past the hairline only move out. While a head is loaded
the web head collider uses the same skull over the scalp (`headConformClearance`). Not yet ported to the Unity plugin;
the port should keep the same two-way rule.

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
Colour and highlights follow the web hair shader: root colour blended by `scalpRoot`, the gradient taken over
`colorRange`, and the same specular lobes (tilted toward the head normal and masked near the root), so speckle seen in
the preview is in the app too.
