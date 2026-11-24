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

- Default colour (`scalpPaintColor`): 5% root, 40% base, 55% tip, averaged in linear space, times 2.0 for the sheen
  locks get from the hair shader (a plain average made painted sides read as bare scalp), plus the primary highlight
  colour times its intensity times 0.8 (`PAINT_SPEC`). On dark hair the lit locks are mostly highlight: without that
  term a black-brown undercut's solid painted band measured about a quarter as bright as the hair above it and read as a
  dark rim. In Unity, the paint material's `_Color` can be changed by hand afterwards.
- Edge coverage (`scalpPaintAlpha`): a soft gradient mixed with fine stipple by `grain`, so it never ends on a hard line.
- Strand streaks (`paintStreak`): fine noise stretched along the comb direction, so painted sides read as short hairs
  rather than flat colour. In Unity it is the `_Streaks` slider.

### Fade

`fadeScalpPaint(options)` in hairBuilder.ts paints a barber fade or taper for any short-sided style:

- solid side hair, then a gradient to `stubble` at the ear-aligned cut line;
- a pointed sideburn in front of the ear, an arch over the ear and a curved nape (`earAlignedCutPhi`);
- no fade on the front hairline (`frontBlend`, rad, default 0, instead thins the paint over a band behind the forehead
  hairline, so the front edge is a soft gradient and not a dark painted brim).

The density along a fade is one smooth curve (`paintRamp` in scalpPaint.ts, mirrored in the web overlay shader and the
Unity ScalpPaint shader and C#): 1 down to the solid side hair, `stubble` at the cut line, 0 at cut line + `feather`. It
keeps falling through the stubble value. The old two-part curve went flat there, so every fade showed a separate band of
stubble that read as stacked layers. For a natural fade use a small `stubble` (about 0.3), a wide `feather` (about 0.16)
and little `grain` (about 0.2): a soft gradient with fine grain, not a stippled band or white frost.

`topPhi` caps how far up the fade can reach, but a hairline set higher than it (for example the temple corners of a
`roundedHairline`) now wins. Before, the cap also pulled the hairline down to `topPhi`, so corner lift did nothing.

Painted short hair now matches the lit locks: the default paint colour is brighter (see Hairline look). At the old
brightness, painted sides showed as a dark band under the hair wherever the locks thinned.

Builder config, both shown as sliders in the app for fade styles:

| Field | Range | Default | Effect |
|---|---|---|---|
| `fadeHeight` | 0..1 | 0.4 | How far up the sides the fade climbs. |
| `fadeBlend` | 0..1 | 0.75 (undercut-fade) | Width of the gradient from the top length into the short sides. Low = a hard barbered line, high = a long soft blend. |

### Ears (every cut line follows the head's ears)

Every sideburn, arch over the ear, fade line and nape curve is placed from the ear landmarks (`EAR_FRONT_THETA`,
`EAR_BACK_THETA`, `EAR_CENTER_THETA`, `EAR_TOP_PHI`, `EAR_MID_PHI`, `EAR_LOBE_PHI` in hairBuilder.ts). They are live
values: each build sets them from `config.earLandmarks` (`setEarLandmarks`), or the defaults (Tobin_Head.obj).

- The web app measures the ears of a loaded character head (`measureHeadLandmarks` in characterHead.ts) and builds with
  them, and Copy JSON and the exports carry them, so the Unity export is cut for the same ears it was previewed on.
- `measureHeadLandmarks` finds the pinna as vertices standing more than 5% of the scalp radius off the skull right behind
  them, which holds for any head. The earlier version misread jaw, mastoid and neck as ear and put Tobin's ear 0.2 rad
  (about 5 cm) too far back, which put sideburns on the ear and opened bald temple corners.
- To check landmarks by eye, render with `--no-hair --lines th:1.43,th:1.78,ph:1.68,ph:2.16` (see Preview renderer).

Where the front hairline sits matters on a near-vertical forehead like Tobin's. At phi 1.3 the front locks had to climb
the forehead wall and read as a hanging fringe from every view; at about phi 1.0 the hair starts where the forehead
curves back and rises from there (undercut-fade uses `roundedHairline(1.02, 0.12, 0.8)`).

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
  - `length`, `volume` (height of the hair surface), `spike` (spiked clump tips on the top), `stand` and `quiff` (front lift:
    low where the hair leaves the hairline, highest a few centimetres back, rising straight up rather than out), `sweep`, `sideTaper` (0..1, default 0.5: how much flatter the sides and back lie than the top, so the head
    doesn't read as a bowl).
  - `fadeEdge` (rad, default 0.3): in this band above the side and back edge the crop melts into the painted fade. The
    hair surface sinks to the scalp, locks thin out and narrow, and the layer shadow lifts, so the crop ends with no
    ledge or dark rim and the paint carries the fade on. 0 gives a hard-edged crop. The front hairline is not affected.
  - Every lock lies on one smooth hair surface whose height is set by position on the head, not per lock. Neighbouring
    locks then curve the same way in the same place, so the highlights run as broad bands across the clumps. Per-lock
    height profiles put a highlight dash on every lock.
  - `spikeHeight` (m, default 0.02): how far a full spike tip leaves the surface. `quiffBack` (0..1, default 0.25): how
    far back the quiff leans (0 = straight up, 1 = 45 degrees back). Leaning back is what keeps a quiff from reading as
    a visor or fringe.
  - `clumpCards` (share of `clumpSpacing`, default 0): one wide pointed card on each clump guide, over the narrow locks,
    so the top reads as a few chunky game-style clumps. Skipped in the fade band, on the back below the crown and at a
    visible whorl.
  - `combDown` (0..1, default 0) with `whorlRadius: 0`: a combed-back crop has no visible whorl, so behind the ears the
    hair is combed straight down from where the top turns over the crown. Without it, flow away from the front meets
    again on the back of the head (a starburst), and a crown whorl in front of the back hair either crumples where the
    two flows meet or parts into a bald spot.
  - `backSmooth` (0..1, default 1): behind the ears the locks are longer and the under layer is shaded like the outer one,
    so the back reads as one combed surface instead of shingles with dark gaps.
  - Near the edge a lock turns to run along it instead of stopping, so locks rooted close to the edge are long enough to
    keep and the crop's edge has no lone locks on the paint. The fade band thins locks less (squared), for the same reason.
  - The under layer shows no dark roots: seen through gaps in the outer layer, dark roots read as holes.
  - `surfaceShine` (default 0.85): see Lock options below.
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

- `surfaceShine` (0..1, LockBuildSpec, exported per lock): highlights follow the hair surface over the scalp instead of
  each lock's own rise off it. The shading tangent loses its component along the head normal (by this much), so
  neighbouring locks shine together in broad bands instead of every short lock catching the light at its own bend and
  dotting the top with flecks. Only the highlight changes, never the shape. Unity: `LockData.surfaceShine`, applied to
  the mesh tangents in AetherStrandWebMesh.
- Dark hair: hex colours are taken as linear, so pick very dark values (undercut-fade: root `#0e0a07`, base `#1c140f`,
  tip `#271d16`) and a muted highlight colour (`#6e6258`, intensity about 0.17). A near-black base with strong highlights
  turns every lock that misses the highlight into a black streak; a bright highlight colour turns the whole head tan.

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
| `--no-hair` | Hide the hair (head and paint only). |
| `--grid` | Draw the scalp coordinate grid on the head: blue lines of \|azimuth\|, red lines of phi, every 0.1 rad. |
| `--lines th:1.43,ph:1.68,...` | Draw only these scalp lines (theta = \|azimuth\|, ph = phi), coloured blue, cyan, red, orange, green, yellow, magenta, white in order. Use it to place landmarks and cut lines on a head. |

The JSON line the preview prints is `hair.auditQuality` (coverage, floating roots, penetration, crown hooks, clipping,
score, verdict). Crown hooks skip rigid locks, whose rise off the scalp is built in, not the solver hooking a strand up.

The preview draws a stand-in for the viewport hair shader on lock cards: about 18 strands across each card, frayed tips
past 55% of the length and darker grooves between strands. Colours are taken as linear (as three.js does), so dark hair
renders at the same brightness as in the app.
Colour and highlights follow the web hair shader: root colour blended by `scalpRoot`, the gradient taken over
`colorRange`, and the same specular lobes (tilted toward the head normal and masked near the root), so speckle seen in
the preview is in the app too. Diffuse light also uses the normal blended 42% toward the head normal, as the app does;
with the raw card normal, cards seen edge-on showed as black leaves the app never draws.
