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
- `underShade` (0..1, default 0): the paint is darker under the hair, easing in over `UNDER_SHADE_BAND` (0.2 rad) above
  `fullPhi`: the shadow the locks cast on the short hair below them. Without it, the paint between lock tips is lit like
  open short hair and comes out lighter than the locks, so every tip over it reads as a dark leaf (the undercut's side
  wedges). `paintUnderShade` in scalpPaint.ts; mirrored in scalpPaintMaterial.ts and the Unity shader (`_UnderShade`,
  read from the JSON as `underShade`). Undercut: 0.5.
- `grainStretch` (>= 1, default 1): the grain's cells are this much longer along phi (the comb direction of short hair)
  and narrower across by its square root, so the same area. At 1 the partial-density stipple is round dots, which read as
  noise; at about 5 a fade reads as short hairs growing down. Mirrored in scalpPaintMaterial.ts (`uGrainStretch`),
  cpu_preview.ts and the Unity shader (`_GrainStretch`, read from the JSON as `grainStretch`). `fadeScalpPaint` takes it
  as an option. Undercut: 5.
- `extendFrontPaint(paint, reach, width)` (hairBuilder.ts): moves the paint's full and edge lines `reach` rad down the
  forehead. Lock roots along a front hairline leave the scalp as a row of small teeth; on full-density paint they sit on
  hair colour instead of the paint's thin edge. Build the hair from the unextended cut (undercut:
  `undercutFadeBasePaint`, reach 0.025). An optional `wobble(az)` (rad) moves both lines too, so the painted strip follows an
  uneven lock edge (undercut: `undercutHairlineWobble`, see `hairlineWobble` below).
- `hairlineWobble(amount, seed)` (hairBuilder.ts): a low, uneven wobble of about +-`amount` rad over the front, fading out
  by |azimuth| 1.3. Add it to the locks' front edge and pass the same function to `extendFrontPaint`, so the forehead edge
  isn't a ruled line and the strip under it matches. Keep it small: 0.025 put a visible step in the middle of the
  forehead; 0.015 reads as a natural soft edge (undercut: 0.015, seeded from `config.seed`).
- `fadeScalpPaint` `backBlend` (default 0): behind the ears the fade band grows by up to (1 + `backBlend`), full by the
  nape. The fade then starts where short back locks end, instead of leaving a strip of solid paint between the lock ends
  and the fade: under `underShade` that strip read as a dark horizontal shelf at the occiput. The hair extent must not use
  it (undercut: `undercutFadeBasePaint(config, 0)` for the extent, 0.3 for the paint: the game reference's undercut is solid
short hair, fading only near the bottom).

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
- a pointed sideburn in front of the ear, an arch over the ear and a curved nape (`earAlignedCutPhi`). The temple-to-
  sideburn descent spans `sideburnTaper` (rad of azimuth) with the shape `sideburnCurve`: the default 1.8 holds the
  hairline and drops late (a long diagonal over the temple), below 1 (the undercut uses 0.6) it drops early, so the temple
  is covered and the sideburn edge runs down in front of the ear. `sideburnGap` sets how far in front of the ear it sits;
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
curves back and rises from there (undercut-fade uses `roundedHairline(1.06, 0.03, 0.75)`: a lower, crisp front line
as in the game reference).

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
  - `hairlineRow` (share of `spacing`, e.g. 0.55; default off): an extra row of outer locks rooted evenly along the front
    hairline. Scattered roots leave gaps along the edge, and seen from the front the rising locks read as a picket fence
    (or hanging bangs) with the paint showing between them. The row closes the front into one mass.
  - Front edge locks are sunk into the scalp at the root and have full-width roots (`rootWidth` 0.95, `scalpRoot` 0.9),
    so they grow out of the skin along one line. Narrow roots made each lock a rounded or pointed end, and a row of those
    along the forehead read as bangs. The quiff starts from zero at the hairline (a floor there made the front row jump
    off the scalp as a shelf), and the edge locks climb more slowly, so they lean back as they rise.
  - `clumpSpacing` (default 0.055) and `clump` (0..1, default 0.55): clump size and how strongly tips gather.
  - `length`, `volume` (height of the hair surface), `spike` (spiked clump tips on the top), `stand` and `quiff` (front lift:
    low where the hair leaves the hairline, highest a few centimetres back, rising straight up rather than out), `sweep`
    (the top leans to one side, so seen from the front it rises on a diagonal instead of in vertical bars; never pointed
    down, and not on the back, which stays combed straight down), `sideTaper` (0..1, default 0.5: how much flatter the sides and back lie than the top, so the head
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
  - `flowPoleDrop` (rad, default 0.9): how far below the front hairline the flow's front pole sits. 0.9 gives nearly
    parallel lines up and back; closer (undercut: 0.3) fans the front out, each side rising up and outward, as stylised
    game hair does. With a strong sideways `sweep` the front chunks lay flat across the forehead like a brim; the
    undercut now uses sweep 0.6 (was 1.5), `quiff` 3.5, `quiffBack` 0.25, `stand` 0.65 + 0.5 x spikeLift and
    `spikeHeight` 0.08 so the front stands off the hairline and the outline is broken by spiky tips.
  - `chunks` (0..1, default 0): game chunks. The clump cards become the main hair: thick, rounded, pointed chunks that
    cover the top, with the narrow locks only as fill under them (the narrow outer layer goes; the under layer thins out
    toward the fade). A row of chunk guides grows from the front hairline itself. None on the sides (se > 0.05), where
    they stacked as dark leaves above the fade. Made for the stylised (game) reference, which shows a few big swept
    pieces, not a field of strands. With these, undercut-fade uses:
    - `chunkLength` (default 1): chunk length multiplier. Short chunks (1) read as scattered scales with paint between
      them; 1.8 (about hairline to crown) reads as swept pieces. Undercut: 1.8.
    - `chunkRoot` (0..1): root width. A narrow root makes every chunk a petal pointed at both ends, and along the front
      the points read as teeth hanging on the forehead. Undercut: 0.95.
    - `chunkBury` (m, default 0): the root end starts this far under the scalp, so a chunk grows out of the paint instead
      of showing its cut end (a sawtooth along a diagonal front). Undercut: 0.012.
    - `chunkEdgeIn` (rad, default 0): away from the front, chunks root at least this far inside the hair edge, and the
      under layer is dropped wherever no chunk covers it (its ends lay on the undercut as dark leaves). Undercut: 0.3.
    - `chunkFrontWidth` (rad, default 1.0): how far round from the centre the front row runs. At 1.0 the end chunks ran
      back along the temple above the ear and lay edge-on as dark blocks in three-quarter view. Undercut: 0.65.
    - `chunkBackThin` (default 0): the under layer also thins through the tapered back, so the back chunks end in their
      own points over the undercut instead of over a ragged fringe of narrow locks. Undercut: 20.
    - `chunkTip` (0..1, default 0.3): where a chunk's point starts tapering. Early tapering plus a spike lift drew long thin
      streaks off the top in side view; 0.55 gives short points. `chunkSpikePow` (default 2): the spike lift's power of t;
      3 lifts only the tip. Undercut: 0.55 and 3, with `spikeHeight` 0.06.
    - `chunkFrontSpacing` (default `clumpSpacing`): spacing of the front row. With wider field chunks (undercut
      `clumpSpacing` 0.11, `clumpCards` 1.6: fewer chunks overlapping in tiers) the front row needs its own closer spacing
      or paint shows between its chunks. Undercut: 0.055.
    - `chunkFrontJag` (rad, default 0): each front-row chunk starts a random way lower than the hairline, so the front edge
      is a row of uneven peaks rather than a ruled band. Undercut: 0.05, with `undercutHairlineWobble` 0.04.
    - `chunkStand` (m, default 0): each chunk on the top and crown leans out of the hair surface along its length (fading
      out down the back), so the top gains height and its tips stand up and out, instead of lying back with only the points
      lifting. `chunkFrontStand` (default 1) is the front row's share; the front already rises with the quiff. Undercut:
      0.045 and 0, with `spikeHeight` 0.03. Keep `pieceTwist` at 0 with chunks: a twisted crest chunk lies edge-on to the
      side camera and reads as a thin streak over the top.
    - `chunkUnderHeight` (default 1): height of the narrow under layer under the chunks. At full height it poked up between
      and above them, the source of the side-view streaks. `chunkUnderEdgeIn` (rad, default `chunkEdgeIn`): the under
      layer starts further inside the side edge, where no chunk covers it and its locks showed as dark leaves above the
      temples. Undercut: 0.5 and 0.7 (`chunkEdgeIn` 0.45).
    - `chunkMinLen` (0..1, default 0): drops chunks the hairline or fade cuts shorter than this share of their length
      (stubs read as detached bits). `chunkAspect` (default 0.3): widest width as a share of length, so short chunks stay
      broad. Undercut: 0.5 and 0.45, with `chunkLength` 1.25.
    - `chunkBackWidth` (default 1) and `chunkBackTipWidth` (0..1, default 0): the back's chunks are wider and keep a share
      of width to their ends, so the back is a few broad tapered pieces over the fade instead of thin points with the dark
      fade between them. Undercut v19 used 1.3 and 0.3; with rows of short domed chunks that read as scales, so v20 drops
      them (see `chunkBackFlat`).
    - `chunkUnderKeep` (0..1, default 1): share of the under layer kept under the chunks. Its locks are paper thin, and the
      quiff lifts them over the front row; from the side, edge-on, they showed over the crest as a tangle of dark shards
      (found by rendering each layer alone). With 0 the gaps between chunks show the painted short hair. Undercut: 0.
    - `chunkBackFlat` (0..1, default 0): flattens the back's chunks (less thickness and roundness), so they lie as one
      combed surface with pointed ends into the fade instead of domed scales. Undercut: 0.8, with `backTaper` 0.
    - `chunkThickness` (default 0.32) and `chunkRoundness` (default 0.6): a chunk's cross-section. Tested higher for the
      undercut; it only made the side and back look puffy, so the defaults stay.
  - `combDown` (0..1, default 0) with `whorlRadius: 0`: a combed-back crop has no visible whorl, so behind the ears the
    hair is combed straight down from where the top turns over the crown. Without it, flow away from the front meets
    again on the back of the head (a starburst), and a crown whorl in front of the back hair either crumples where the
    two flows meet or parts into a bald spot.
  - `backSmooth` (0..1, default 1): behind the ears the locks are longer and the under layer is shaded like the outer one,
    so the back reads as one combed surface instead of shingles with dark gaps.
  - `smoothFrom` (|azimuth| rad, default 1.6): where that smooth back begins. 1.0 also lays the side above the ear smooth,
    where the hair turns from combed back to combed down; short clumped locks crossing that turn read as dark leaves,
    because they point away from the highlight their neighbours catch. `combTurn` (rad, default 0.9): how wide that turn
    is. A narrow turn bends each lock crossing it and the bent ends read as a row of dark crescents (undercut: 1.4).
  - `sideSpikeCut` (0..1, default 0): spiked tips fade out beyond |azimuth| 1.0 to 1.4, so the side of the top lies flat
    and the three-quarter silhouette isn't hairy at the side.
  - `turnTaper` (default 0): in the turn from combed back to combed down (|azimuth| 0.9 to 2.2) tips taper sooner, so
    they melt into the layer below instead of ending as hard wedges (undercut: 0.15).
  - `tufts` (0..1, default 0): share of the top's clump guides that are tufts. Their outer locks are about half as long
    and lift early (t^1.6 instead of t^3) with 0.8 to 1.4 times the spike height, so the top is a base cap with shorter
    tufts standing out of it rather than one brushed sheet (undercut: 0.8).
  - Pieces (`pieceDepth`, `pieceGroove`, `pieceGather`, `pieceTwist`, `pieceLift`, all default 0): each clump becomes a
    separate raised piece instead of a stretch of one combed sheet. `pieceDepth` (m) lowers an outer lock by up to that
    much the further its root is from its clump guide (squared, never more than 60% of the hair surface height there), so
    every clump has a ridge and neighbours meet in a valley. `pieceGroove` (0..1) shades those border locks darker, so
    the valleys read as shadow lines. `pieceGather` (0..1) gathers the outer locks onto their guide from near the root
    (t^0.6 instead of t^1.5), so a piece runs together along its length rather than only at the tip. `pieceTwist` (rad)
    turns each clump's direction by a random angle up to that (less at the front hairline), so pieces cross and overlap
    instead of lying parallel. `pieceLift` (0..1) gives each top piece up to that much extra height. All fade out toward
    the fade edge. With every option at 0 the layout is exactly as before (no extra random draws). Undercut: depth 0.014,
    groove 0.65, gather 0.7, twist 0.35, lift 0.4, with `clumpSpacing` 0.085, `clump` 1, `tufts` 0.8, `surfaceNoise` 0.012
    (v15).
  - `surfaceNoise` (m, default 0): low-frequency rises and dips of the hair surface by position on the head, so light
    falls in broad patches (undercut: 0.012).
  - `centreArch` (m, default 0): the middle third of the front stands higher than the temples, so the front has an arched
    silhouette instead of a flat block (undercut: 0.02).
  - `sideUnderLight` (0..1, default 0): on the sides the under layer is shaded like the outer one, with a lighter root.
  - `sideTaperFrom` (phi, default 0.85): where `sideTaper` starts flattening the hair. 0.6 keeps the sides of the top
    close to the head, so the front view has no helmet bulge past the temples (undercut: 0.6).
  - `sideLength` (default 1): length multiplier for locks on the side of the top (|azimuth| 0.95 to 2.0). Longer (1.4)
    leaves fewer rows of tips above the ear; shorter (0.6) made more rows of dark tips (undercut: 1.4).
  - `backTaper` (0..1, default 0): from behind the temples round the back (|azimuth| 1.2 to 1.8 and on), the crop
    tapers short toward the edge, over the last 0.45 rad inside it. Locks there are up to 60% shorter (and wider, so the
    shorter locks leave no gaps), the hair surface lowers onto the scalp by up to 70%, the layer AO darkens by up to 55%
    and the colour moves to the root end of the gradient, the colour of the painted short hair below. It also turns off
    the smooth-back lengthening (`backSmooth`) in proportion. The top then blends down into the fade with no long
    overhanging shelf and no ledge where the locks end. Not over the temples: the head bulges past the scalp ellipsoid
    there and lowered locks dip into it (undercut: 1). Tapered locks are narrower, not wider (width cap
    `realLen * (0.6 - 0.25 * backTaper)`), and the AO darkens by up to 35%: wide dark short locks over the painted fade
    read as dangling leaves.
  - `backTaperBand` (rad, default 0.45): how far inside the edge the back taper reaches. 0.9 spreads it over a tall band,
    so the back gets shorter steadily and no cutoff line shows (undercut: 0.9).
  - `taperShade` (0..1, default 1): scales the back taper's AO darkening and its colour move toward the root end. 0
    keeps the tapered locks the same tone as the rest of the top, so their tips don't read as dark leaves hanging over the
    lighter painted fade (undercut: 0).
  - `backThin` (0..1, default 0): through the back taper, this share of locks is dropped, growing toward the edge
    (squared), so the painted fade shows through more and more and carries the taper (undercut: 0.8).
  - Undercut: the top's locks end where a 0.6 fade would put the hair edge, whatever the recipe's `fadeHeight`. The
    recipe's `fadeHeight` is 0.4, so the fade climbs most of the way to the top's edge and the sides read as short hair
    under a separate top, not one dark helmet (0.18 left solid paint to the cut line; 0.6 went too pale and high).
    The recipe's `backLength` is 1.0: the nape sits lower and the back fade is longer, while the top's locks still end where `backLength` 0.6 would put them (the archetype caps it for the locks), so a longer back lengthens the painted fade, not the top. `backTaper` is 0.3 with `taperShade` 0: the back keeps longer pointed pieces that end over the fade, like the
    stylised reference, instead of a flat dark skirt. Paint `feather` 0.08 and `sideburnSolid` 0.6 keep that
    painted side crisp. The hairline is `roundedHairline(0.98, 0.03, 0.75)` with `templeRecede` 0.03 (more corner lift and temple recession scored lower against the references, which keep a fairly straight hairline with full temples): a soft curve across
    the forehead with a small recession at each temple corner (a straight 0.02 lift read as a cap brim in the 3/4 view),
    plus `hairlineWobble(0.015)`. `sweep` 1.5 (was 0.9): seen from the front the top leans to one side instead of standing in vertical bars. The top's `volume` is 0.75 of the old value and `spikeHeight` 0.045, for a tighter
    crown; measured against the bald head, the back already lies close to the skull.
  - Every crop lock starts 3.2 mm off the scalp ellipsoid (was 2.5 mm), so nodes that cross the temple bulge on a
    character skull clear it after the conform.
  - Front hairline locks (`edgeK` > 0.4) have `scalpRoot` 0.3: their roots are about the colour of the painted strip they
    grow out of. A dark root made each of them a dark tooth along the forehead.
  - Clump cards have `scalpRoot` 0.2, like the outer locks they lie on. With the usual dark root the first fifth of every
    card read as a dark leaf on the side of the top.
  - Each crop lock and card sets `shadeDir`, the comb direction at its root (its march along the flow, before the tip
    gathers onto the clump guide). See Lock options below.
  - Tuft locks are 1.5 times wider (up to 0.9 of their length) and show the colour gradient out to the tip colour
    (`colorRange` [0.3, 1]), so tufts read as lit, chunky clumps over the darker base cap.
  - Outer-layer locks have `scalpRoot` 0.2 (they lie on other hair, not skin), so their roots keep a light shade; the
    shaders darken the root by `rootAO x 0.72 x scalpRoot`. A full root shade under every row of tips doubled up with the
    layer shading as dark wedges.
  - `hairlineWisps` (0..2, default 0): fine short hairs along the front hairline, rooted from just outside the lock edge
    (on the painted strip) to a little inside it, lying up and back with the flow at random small angles. The front
    row's ribbons leave the skin as a row of small teeth along one line; the wisps break that into a soft, uneven edge.
    Their roots stay light (`scalpRoot` 0.05): a dark root drew a thin dark line along the forehead (undercut: 1).
  - Locks stop at the edge. (v7 turned them to run along it; they crossed the combed-down hair above the ear as dark
    hooks, and the hairline row covers the front edge better.) The fade band thins locks less (squared), so the temples
    don't show lone locks on the paint.
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
  the mesh tangents in AetherStrandWebMesh. Before the flattening the tangent also leans (by the same amount) to the
  lock's `shadeDir`, or without one to its own root-to-tip direction, so a lock that bends or gathers onto a clump keeps
  one highlight along its length.
- `shadeDir` (head-local vector, LockBuildSpec, exported per lock in Blender axes like `rootNormal`): the direction the
  highlight follows with `surfaceShine`. Give neighbouring locks the comb direction at their roots and they shine
  together. The highlight is almost all of a dark lock's brightness, so a lock (or the part of one) that misses it reads
  as a dark dash; that was the dark dashes on the side of the undercut's top. Unity: `LockData.shadeDir`, parsed by
  AetherStrandWebData and used by AetherStrandWebMesh.
- Root highlight (all styles, web and Unity hair shaders and the preview): the highlight is held off the root only in
  proportion to `scalpRoot` (fully from 0.5 up). A light-rooted lock lies on other hair, so it keeps its highlight to
  the root; a root left uncovered at a crop's edge is then not a dark crescent.
- `rootWidth` (0.05..1, LockBuildSpec, exported per lock): the width of the root end as a share of the lock's width. By
  default it follows `scalpRoot` (0.36, or 0.08 below 0.5), and the root widens to full over the first quarter of the
  lock, so the root is a rounded or pointed end. Near 1, with the root sunk in the scalp, the lock grows out of the skin
  along one clean line. Unity: `LockData.rootWidth` in AetherStrandWebMesh and AetherStrandWebSolver.
- Dark hair: hex colours are taken as linear, so pick very dark, fairly neutral values (undercut-fade: root `#0e0a07`,
  base `#241d18`, tip `#31281f`) and a muted highlight colour (`#6e6258`, primary intensity about 0.13 with a broad
  secondary lobe, power 8, intensity 0.1). A near-black base with a strong, narrow highlight turns every lock that misses
  the highlight into a black streak; a bright highlight colour turns the whole head tan; a warmer base turns it orange.

## Head conform (character skulls)

`src/engine/characterHead.ts`: `buildHeadConformMap` / `conformPoint`; `HairPhysicsSystem.conformToHead(map)`.

A character's skull is rarely the web ellipsoid (Tobin's is up to 9% bigger at the forehead), so close-lying hair would
sink into the head. The conform map stores, per azimuth and phi, how far the skull pokes past the ellipsoid, and pushes
rest positions by that much. Locks that stay on the scalp move out or in (Tobin's occiput is 2 to 8% inside the
ellipsoid, so back hair would otherwise float); locks that hang past the hairline only move out. While a head is loaded
the web head collider uses the same skull over the scalp (`headConformClearance`). Not yet ported to the Unity plugin;
the port should keep the same two-way rule.

## Shape shell (outer shape as a thickness grid)

`src/engine/hairShell.ts`; recipe field `builder.shell` (`HairShellGrid` in src/types/hair.ts); web generator:
Builder tab > Shape shell; fit tool: `tools/preview/shell_fit.ts`.

Why: a style's outline was set indirectly, through a dozen archetype numbers (volume, spike height, quiff, taper), so
"the top is too low in profile" meant guessing which number moves it. The shell says the shape directly: how high the
hair surface stands above the scalp in each direction.

The grid, plain JSON (any person or AI can read and write it):

```json
{
  "azDeg": [0, 20, 40, 60, 80, 100, 120, 140, 160, 180],
  "phiDeg": [0, 15, 30, 45, 60, 75, 90, 105, 120, 135],
  "mirror": true,
  "strength": 1,
  "mm": [[36, 36, ...], [64.5, 58, ...], ...]
}
```

- `mm[row][col]` is the target height of the hair surface above the scalp ellipsoid, in scene mm (1 scalp radius is
  about 295 mm in the web scene), at `phiDeg[row]` (degrees down from the crown: 0 top, about 75 the forehead hairline,
  95 the temples, 125 the ear lobe, 135 the nape) and `azDeg[col]` (degrees round from the front: 0 forehead, 90 over the
  ear, 180 back). `null` leaves that cell as built.
- `mirror` (default true): both sides share the grid. With `false`, `azDeg` runs -180 to 180, positive = the +x side
  (the character's left, screen right in the front view).
- `strength` 0..1 blends from the style as built to the shell.

What it does: after the archetype builds its locks, `applyHairShell` measures the surface it built (per cell, the
height most locks reach: the 75th percentile of each lock's highest point within a small disc) and scales every lock
node's height above the scalp by target / built, in three passes. Each lock keeps its layering under the surface and its
root stays on the scalp. It never adds hair where there is none, and fade caps (stubble) are left alone. It runs before
the head conform, so the exported locks carry the result and Unity needs nothing new.

Workflow:
1. Capture the style as built: `--shell-capture grid.json` (every run also prints the grid as a table to stderr:
   `built mm`, and with a shell `target mm` and `result mm`).
2. Edit numbers (or drag cells in the web generator), render with `--shell grid.json --shell-overlay` and look at both
   the clean render and the overlay. Then paste the grid into the recipe as `builder.shell`.
3. Or let the fit tool move it toward a reference outline: `npx tsx tools/preview/shell_fit.ts <render flags> --ref
   refs/style_views.json --iters 6 --save fitted.json --out fit.png`. Each round renders, reads `--shell-gaps` (for each
   cell on a view's rim, where the rendered hair edge ends against where the reference hair ends, along the cell's
   outward direction on screen) and moves cells by 70% of their gap, at most 12 mm a round, never below 2 mm. It keeps
   the round with the best mean overlap (unrounded, so small gains don't tie). Options: `--damp`, `--step`, `--rows 15,30,45` (only those rows move),
   `--shell start.json`. Always look at the best round's render: the fit only reads the outline. Later rounds can score higher by
   building a ledge over the forehead to reach a stylised reference's spikes (seen on the undercut v14), so compare the
   rounds' renders and pick by eye (each round's grid is saved beside its render as `<out>_fit_shell_<n>.json`).

What it can't fix: the hairline, the fade and anything painted on the scalp (those are scalp paint), and hair that isn't
there. On the undercut v13 the fit took the outline score from 72 to 74 (top and quiff front in profile); what is left
is the forehead hairline and the fade, which are paint.

Web generator: Builder tab > Shape shell. "Start from this style" copies the built heights into the recipe. Drag a cell
up or down to change it (Alt: fine steps; the Soft and Wide brushes spread the change to neighbouring cells), Shift-click
leaves a cell as built, arrow keys nudge the focused cell. Warm cells are thicker than the style builds them, cool ones
thinner. The green grid in the viewport follows the drag; the hair rebuilds when the drag ends. Copy JSON carries the grid.

## Hair sheen (strand highlights)

`src/engine/hairShadingModel.ts` (reference maths) · web: `hairShaders.ts` · Unity: `Shaders/AetherStrand_Hair.shader`
(ForwardLit). Search for `SHEEN v2` in each: the three must stay the same maths. The preview renderer runs the
reference, so a preview render is what the viewport and Unity show.

Two highlights that run along the hair, the way real and anime hair catch light (Kajiya-Kay):

- **Primary**: a narrow, near-white streak, shifted toward the tip (`primaryShift`, `primaryPower`, `primaryIntensity`).
- **Secondary**: a wider streak tinted by the hair colour, shifted toward the root (`secondary*`).
- **Sheen band**: the soft ring of light across the lit side of the head that anime hair reads by.

The tangent the highlights follow is the lock's direction bent by the baked strand flow map, so the streaks follow
each strand's wave instead of the card's straight edge. Each clump has its own shift, so neighbouring clumps catch
light a little higher or lower, which breaks the highlight into pieces instead of one painted stripe.

Recipe `shader` settings (all optional; defaults in `SHEEN_DEFAULTS`). Each has a slider under Shader > Sheen look:

| Setting | Default | What it does |
|---|---|---|
| `primaryTint` | 0.2 | 0 = primary uses `primarySpecColor`; 1 = the hair's own colour, brightened. |
| `secondaryTint` | 0.8 | The same for the secondary. |
| `sheenStrength` | 0.4 | Brightness of the sheen band. |
| `sheenPower` | 10 | Sharpness of the sheen band. |
| `sheenShift` | 0.02 | Moves the sheen band up or down the hair. |
| `sheenTint` | 0.7 | Colour of the band, from `primarySpecColor` (0) to the hair colour (1). |
| `shiftJitter` | 0.35 | How much clumps and locks shift their highlights from each other. |
| `specBreakup` | 0.4 | How much single strands break up the highlight (0 = smooth streak). |
| `flowStrength` | 0.6 | How much the baked strand flow bends the highlight. |
| `shadowLift` | 0.3 | Lifts the darkest parts of the hair. |
| `clumpVariation` | 0.2 | Tone difference between clumps. |
| `tipLighten` | 0.12 | Lighter tips. |

Unity reads the same keys from the recipe JSON (`AetherStrandSetupWindow.ApplySheen`); a missing key takes the default.

## Hair-card baking (strand atlases)

`src/engine/cardBake.ts` · tool: `tools/cards/bake_cards.ts` · Unity: the PNGs in `Textures/`.

Games draw hair as cards with a texture of real strands on them. The baker draws a few hundred strands in clumps into a
strip that repeats sideways (512x1024, root at the bottom row), and writes the maps the hair shader reads:

| Map | Channels |
|---|---|
| GrooveAO | r: contact shadow between strands and clumps |
| FlowIDShift | r: strand tone, g: depth (top strand to bottom), b: highlight shift per clump |
| Normal | from the strand height field |
| AlphaCard | r: coverage (tips thin out and stagger) |
| StrandFlow | rg: strand direction, b: strand id, a: clump id |

Recipe `shader.cardBake` (all optional; defaults in `CARD_BAKE_DEFAULTS`, sliders under Shader > Card strands):
`strands` 520, `clumps` 13, `clumpTightness` 0.55, `strandWidthPx` 2.4, `frizz` 0.004, `wave` 0.012, `tipStagger` 0.6,
`strays` 0.06, `cardAspect` 0.18, `seed`. `shader.cardTextures: "procedural"` uses the old procedural maps instead.

- The viewport rebakes when a setting changes (about 0.3 s) and the Unity ZIP export carries the result.
- `npx tsx tools/cards/bake_cards.ts --sheet sheet.png [--recipe r.json]` draws every channel side by side, to check a bake.
- `npx tsx tools/cards/bake_cards.ts --unity [--recipe r.json]` rewrites the plugin's package textures. The package
  ships the default bake; a style with its own `cardBake` brings its maps in its ZIP export.

## Scalp paint calibration

`npx tsx tools/preview/paint_calibrate.ts recipe.json [--head Head.obj] [--target 1.0] [--write] [preview flags]` tones a
style's painted short hair to its own lit hair: it renders left, 3/4 and back views with the preview renderer, measures the
mean linear luminance of the paint that shows and of the hair, and scales the paint colour (hue kept) until paint / hair =
target. `--write` stores it as `builder.scalpColor`, which the web app, the preview and the Unity export use as the paint
colour. Why: the default paint rule (PAINT_MIX x PAINT_SHEEN + PAINT_SPEC) gave 1.06x on the undercut but 2.5x on Messy
Mage, a tan band above the ears; the gap comes from how the geometry renders, which no rule on the colours alone predicts.
Messy Mage: #71665d (2.52x) to #3f3833 (1.03x), Nov 26.

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
| `--aa N` | Render N times larger and box-filter down in linear light (default 3, or 1 when `--ref`, `--debug` or a shell overlay measures pixels). Tips and the fade dither average out as MSAA/TAA show them. |
| `--look game\|legacy` | `game` (default): mid-grey backdrop, skin-toned head, hair and body lit by one rig (key upper left, fill right, rim behind). `legacy`: the old navy backdrop, plaster head and studio rig; with `--aa 1` it matches earlier renders exactly. |
| `--layers` | Also write `<out>_layers.png`: the first view as base (ambient only), key only, rim only and full. |
| `--turntable` | 8 views every 45 degrees (`t0` front, `t90` left profile, `t180` back) instead of the standard set. |
| `--mass` / `--mass-height F` / `--no-mass` | Hybrid phase 1: build the inner hair mass (`hairMass.ts`) and drop the base shells (or force it off when the recipe's `builder.hybrid` turns it on). `--mass-height` is the mass height as a share of the locks' height (default 0.6). |
| `--mass-only` / `--mass-tint` | Draw only the mass, or draw it flat cyan among the locks (shows where it shows through). |
| `--edge-cards N` | Add N thin strand cards at the silhouette (`hairCards.ts`). |
| `--pose turn\|nod` | Run the live solver through the app's turn motion (or a nod) and draw the hair at its first swing through centre, in the head's frame. Prints `pose {..., massStretchMaxPct}`: the mass's largest edge stretch over the run. |
| `--pair refs/style_views.json` | Also write `<out>_pair.png`: each view after the game reference panel at that angle, framed to the reference head by its chin and ear-top landmarks (unless `--zoom`/`--cy` are given). |
| `--ref refs/style_views.json` | Outline score against a reference (needs `--head`). See below. |
| `--shell grid.json` / `--no-shell` | Use that shape shell instead of the recipe's, or none. See Shape shell. |
| `--shell-capture grid.json` | Write the hair's current outer heights as an editable shell grid. |
| `--shell-overlay` | Write `<out>_shell.png`: the shell as a green grid on the render. |
| `--shell-gaps gaps.json` | With `--ref`: per shell cell, how far its hair edge sits from the reference outline (mm). |
| `--debug silhouette,roots,fade` | Debug views, one `<out>_<view>.png` each. See below. |
| `--cards baked\|procedural` | Strand maps for the hair: the card baker (default) or the old procedural maps. See Hair-card baking. |
| `--sheen legacy` | Shade with the pre-v2 sheen settings and lobe weights, for before/after renders. |
| `--lights world` | Keep the light rig fixed in the world. By default it turns with each view, so every view is lit from the front. |
| `--vertex-shade` | The old per-vertex hair shading. By default every hair pixel runs the real hair shader (hairShadingModel.ts). |

### Debug views (`--debug`)

Three flat views that each answer one question a shaded render hides. Example: docs/previews/debug-views-undercut-v13.png.

- `silhouette`: is the outline right? Lock hair white, scalp paint at alpha 0.6 or more light grey, head dark grey,
  background black. Shows which parts of the outline are locks and which are paint (on the undercut v13 the whole back
  below the crown is paint, not hair).
- `roots`: where does each lock grow from, and which way is it combed? The bare head with its paint, a dot at every lock
  root coloured by layer (grey base shell, blue nape/under, green sides/back, orange crown/bangs, magenta accents, cyan
  fade caps) and a short line along the lock's first nodes. Roots behind the head are hidden. Use it to find bald gaps
  between root rows, roots on the skin past the hairline, and locks combed the wrong way.
- `fade`: what does the scalp paint do? Its alpha (with grain) as a heat map on the bare head: grey none, then blue, green,
  yellow and red for solid, with white contours at 0.25, 0.5 and 0.75. A fade that "reads as nearly invisible" shows here
  as a narrow band of blue and green under a big solid red area (as on the undercut v13).

The web app already has a silhouette vision mode; roots and fade are preview-only for now.

### Outline score (`--ref`)

Why: styles were tuned one number at a time and judged by eye from a rough render, so "closer to the reference" was a
guess. The outline score lines each reference view up with the render and measures the gap, so a change can be checked.

How it works (tools/preview/outline.ts):
- A JSON sidecar next to the reference image gives, per view (`front`, `3q`, `left`, `back`), the panel's `crop` and a
  few landmarks in panel pixels: `chin`, `earTop`/`earLobe` (the ear nearer the camera) or `earTopL`/`earTopR`/
  `earLobeL`/`earLobeR` (the ear on the image's left/right). Optional per view: `mirror`, `hairLumMax` (default 95),
  `hairRowsBelowLobe` (default 0.3 ear heights), `ownScale`. Example: tools/hair-blocks/refs/undercut-fade_views.json.
- The same landmarks are measured on the character head (chin front; each ear's top and lobe from the head's ear
  landmarks) and projected into each view. One head size is shared by every view, taken from the views that show both
  ears (front, back); each view then gets only its own offset. (Fitting each view's own size let a profile's different
  chin-to-ear span shrink the reference by 30%.)
- The reference's hair is the largest dark region above a row a little below the ear lobe, with small highlight holes
  closed. The render's hair is every lock pixel plus scalp paint at alpha 0.6 or more, front faces only.
- Printed per view: `iou` (overlap / union), `over` (hair the render has and the reference doesn't, as a share of the
  reference's hair: too big or too low) and `under` (reference hair the render misses: too small or too high), plus
  `outlineScore` = mean IoU x 100.
- `<out>_outline.png`: the render with red where only the render has hair, blue where only the reference has it, the
  reference outline in cyan, and the landmarks (yellow: head, magenta: reference after the fit). Look at it before you
  trust a number: a wrong landmark shows as yellow and magenta dots apart.

Read it as a target for the outline, not a verdict: the reference is another person's head, so a few percent is face
shape. Faded sides that are lighter than the reference's dark short hair also show blue.

Adding a reference: write the sidecar, place the landmarks by eye at 4x zoom, run once and check the dots and the cyan
outline in the overlay. If the hair mask catches the shirt, eyebrows or the ear's shadow, lower `hairLumMax` or
`hairRowsBelowLobe`.

The JSON line the preview prints is `hair.auditQuality` (coverage, floating roots, penetration, crown hooks, clipping,
score, verdict). Crown hooks skip rigid locks, whose rise off the scalp is built in, not the solver hooking a strand up.

The preview draws a stand-in for the viewport hair shader on lock cards: about 18 strands across each card, frayed tips
past 55% of the length and darker grooves between strands. Colours are taken as linear (as three.js does), so dark hair
renders at the same brightness as in the app.
Colour and highlights follow the web hair shader: root colour blended by `scalpRoot`, the gradient taken over
`colorRange`, and the same specular lobes (tilted toward the head normal and masked near the root), so speckle seen in
the preview is in the app too. Diffuse light also uses the normal blended 42% toward the head normal, as the app does;
with the raw card normal, cards seen edge-on showed as black leaves the app never draws.
Root occlusion and layer AO follow the web shader too: the root darkens by `rootAO x 0.72 x scalpRoot` over the first
22% of the lock, and layer AO scales by 0.72 + 0.32 x `layerAO`. The paint's `underShade` is drawn as in the app.

Tracing a dark patch: render the same close-up with `--no-paint` (is it paint showing through gaps, or a lock?), then
with the builder's under layer or clump cards switched off (whose lock is it?). If a lock is dark with no paint and no
AO, it is missing the highlight, which is most of a dark lock's brightness: check its shading tangent (`surfaceShine`,
`shadeDir`) and whether it is a root (`scalpRoot`) left uncovered.

## Matching the game reference (Undercut Fade, Nov 25)

The reference sheets show a photo column and a game (stylised) column. The target is the game column: Jaycee's rule is
that the game version decides the build, not the life-like one. `tools/hair-blocks/refs/undercut-fade_game_views.json`
crops the game column (the 3q and side panels are mirrored to face the same way as the render) and is the `--ref` for
undercut renders. The photo-fitted volume shell (`builder.shell`) came out of `ref_undercut-fade.json`: fitted to the
photo outline, it pushed the chunks into curls. Undercut cut values for the game look: `templeRecede` 0, `sideburnTaper`
0.55, `napePhi` lerp(2.2, 2.55) by backLength with `napeCurve` 0.45 (the nape sits below the ear lobes), the top's own
paint capped at backLength 0.34 so the longer nape lengthens the painted undercut, not the top. Recipe: charcoal colours,
`fadeHeight` 0.25, `fadeBlend` 0.4.

## Hybrid hair in Unity (mass, edge cards, strand cards)

The hybrid (plan phases 1 and 2) reaches the plugin through PresetGeometry.json. The web builds everything; the plugin only
deforms and draws.

| Tool | What it does |
|---|---|
| `npx tsx tools/unity-parity/web_export.ts <recipe.json> <outDir> [--mass] [--edge-cards N]` | Writes PresetGeometry.json. With the mass on, the file carries a `hybridMass` block: the built mesh, its binding to the lock nodes and the follow data (`web_geometry.ts exportMass`). Edge cards are ordinary locks. |
| `npx tsx tools/unity-parity/mass_roundtrip.ts <recipe.json> [--vectors out.json]` | Rebuilds the mass from the exported block alone and checks it deforms like the live one under a set motion. `--vectors` writes that motion and the expected result. |
| `dotnet run --project tools/unity-parity/mass_test -- PresetGeometry.json vectors.json` | Runs the plugin's C# mass deform (`Runtime/AetherStrandWebMass.cs`, no Unity needed) on the vectors and compares it with the web. Also prints the deform's cost per frame. |

- Strand cards: a lock with `strandCard` (the hybrid's fine strands, such as the Messy Mage baby hairs) gets card mask 0.75.
  The shaders cut it into 3 fine hairs along its whole length (`strandCardAlpha` in hairShaders.ts, `AetherStrandCardAlpha`
  in AetherStrand_Hair.shader). Strand cards are also rigid: short hair barely moves.
- In Unity the mass needs the live web solver (`AetherStrandWebImport.ApplyLive`, component `AetherStrandWebHair`), which
  adds a child `AetherStrand_Mass` with the hair material. The baked-mesh path (`Apply`) ignores the block.
- Alpha to coverage: the hair material's **Alpha To Coverage** toggle (`_AlphaToMask`, keyword `_ALPHA_TO_COVERAGE`) turns
  the tip and strand-card cut-outs into a sharpened coverage that MSAA resolves into smooth fine tips without TAA. It needs
  MSAA on, and set Tip Dither to 0. Fade-cap dither and the shadow and depth passes still clip. With TAA instead, leave it off
  and use Tip Dither 1.
- `AetherStrandWebHair.manualStep` + `Tick(dt)` step the live hair by hand (test harnesses, scrubbing). The head-centre
  driver now writes `_HeadCenterWS` to every renderer under the hair, the mass included.

### Hybrid proof scene (Unity, PC)

`tools/parity/HybridProofTest.cs` (Editor folder) builds Tobin with today's mage and the hybrid mage through `ApplyLive`,
the web studio rig, and plays `tools/parity/runtime/HybridProofRunner.cs` (non-Editor folder, with `HybridOverdraw.shader`).
For 1080p and 1440p, MSAA 4x + A2C and clip + dither + TAA, close and mid camera, it runs one recorded path (the web turn
motion and a slow orbit, `cam_path.json`) with no hair, today's hair and the hybrid, and writes `summary.md` (GPU frame time,
hair cost, overdraw, shimmer, CPU solver time), stills, overdraw heat maps, one-second frame sequences and the four parity
views (`sheet_baseline.png`, `sheet_hybrid.png`).

```
npx tsx tools/unity-parity/web_export.ts tools/hair-blocks/recipes/loop_messy-mage.json <out>/mage_base
npx tsx tools/unity-parity/web_export.ts tools/hair-blocks/recipes/loop_messy-mage.json <out>/mage_hybrid --mass --edge-cards 24
SC_HP_BASE_GEO=<out>/mage_base/PresetGeometry.json SC_HP_HYB_GEO=<out>/mage_hybrid/PresetGeometry.json \
SC_HP_RECIPE=tools/hair-blocks/recipes/loop_messy-mage.json SC_PARITY_RIG=<rig_studio.json> SC_PARITY_OUT=<results> \
Unity -batchmode -projectPath <game> -executeMethod HybridProofTest.Run     # no -quit, no -nographics
ffmpeg -framerate 60 -i <results>/seq/<run>/%03d.jpg -c:v libx264 -crf 16 -pix_fmt yuv420p <run>.mp4   # to judge shimmer
```

In the editor: Tools > AetherStrand > Parity > Hybrid Proof. `TobinFitTest` now builds the scalp paint too
(`SC_TOBIN_PAINT=0` skips it), so short and faded sides render as they ship (AET-15).
