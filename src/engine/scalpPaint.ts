// Scalp paint: the hair-coloured layer painted on the head under the locks (what games do with a scalp texture).
//
// Why: hair that is very short (fades, stubble, sideburn tips, the scalp under thin or parted hair) has no visible
// movement, and modelling it as lock geometry either dissolves to nothing or looks like a helmet. A painted layer shows
// it reliably, hides any scalp gap between locks, and gives a natural root shadow at the hairline.
//
// Representation (web scalp coordinates, the same for the web app, the export and the Unity plugin):
//   bins azimuth samples over [-pi, pi) (signed azimuth, + = web +X side, 0 = front), linearly interpolated, wrapping.
//   For a sample:  phi <= fullPhi          -> density 1
//                  fullPhi .. edgePhi      -> eases from 1 to edgeDensity (a fade)
//                  edgePhi .. +feather     -> edgeDensity to 0 (soft cut line)
//   density (0..1) scales everything; grain (0..1) is how dotted (stubble-like) partial density looks.
//   irregularity (0..1) wobbles the whole profile along the azimuth by a small noise (hairlineJag), so the hairline is
//   not a drawn curve but a natural, slightly uneven edge. color (optional '#rrggbb') overrides the paint colour; without
//   it the paint takes the hair's own colour (scalpPaintColor).
//   Partial density is drawn as a soft gradient mixed with directional short-hair fibres (paintFibreAlpha), never a hard line.
// phi is the polar angle from the crown apex on the scalp ellipsoid (HEAD_CENTER_LOCAL, SCALP_RX/RY/RZ).
//
// Every style gets an automatic paint from where its locks touch the scalp (deriveScalpPaint). A style can override it
// (fades, sideburns, shaved patterns) by registering a function in hairBuilder's SCALP_PAINT_BY_ARCHETYPE.
import * as THREE from 'three';

/** Azimuth samples per paint (2 degrees each): fine enough for a sideburn (about 0.2 rad wide). */
export const SCALP_PAINT_BINS = 180;

export interface ScalpPaint {
  bins: number;
  fullPhi: number[];
  edgePhi: number[];
  edgeDensity: number[];
  feather: number;
  density: number;
  grain: number;
  /** 0..1 hairline unevenness (default 0.5 when absent). */
  irregularity?: number;
  /** '#rrggbb' paint colour override; absent = the hair's own colour. */
  color?: string;
  /** 0..1, default 0: how much darker the paint is under the hair (from UNDER_SHADE_BAND above fullPhi upward), the
   *  shadow the locks cast on the short hair below them. Without it the paint between lock tips is lit like open short hair
   *  and lighter than the locks, so every tip over it reads as a dark leaf. */
  underShade?: number;
  /** >= 1, default 1: grain cells stretched along phi (the comb direction of short hair) by this much, narrower across
   *  by its square root (same cell area). At 1 the stipple is round dots; at about 5 a fade reads as short hairs
   *  growing down instead of noise. Mirrored in scalpPaintMaterial.ts, cpu_preview.ts and the Unity shader. */
  grainStretch?: number;
}

/** Hairline softness and colour controls shared by every style (HairBuilderConfig.hairlineSoftness / scalpColor). */
export interface HairlineLook {
  /** 0 = crisp (barbered) edge, 1 = very soft, wispy edge. Default 0.5. */
  softness?: number;
  /** 0..1 unevenness of the edge. Default 0.5. */
  irregularity?: number;
  /** '#rrggbb' override for the painted hair; absent = the hair's colour. */
  color?: string;
}

const HC = new THREE.Vector3(0, 0.425, -0.01);
const RX = 0.282, RY = 0.318, RZ = 0.31;
const ss = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

/** Signed azimuth (0 = front, + toward web +X) and polar angle from the crown, plus ellipsoid radius ratio, of a head-pivot-local point. */
export function scalpAngles(x: number, y: number, z: number): { az: number; phi: number; r: number } {
  const dx = (x - HC.x) / RX, dy = (y - HC.y) / RY, dz = (z - HC.z) / RZ;
  const r = Math.hypot(dx, dy, dz);
  return { az: Math.atan2(dx, dz), phi: Math.acos(Math.max(-1, Math.min(1, dy / r))), r };
}

export const binAzimuth = (i: number, bins = SCALP_PAINT_BINS) => -Math.PI + ((i + 0.5) / bins) * Math.PI * 2;

export function sampleArr(arr: number[], az: number): number {
  const n = arr.length;
  const f = ((az + Math.PI) / (Math.PI * 2)) * n - 0.5;
  const i0 = Math.floor(f);
  const t = f - i0;
  const a = arr[((i0 % n) + n) % n], b = arr[(((i0 + 1) % n) + n) % n];
  return a + (b - a) * t;
}

/** Small float-stable hash (0..1) of an integer cell; mirrored in the GLSL and Unity HLSL/C#. */
export function paintHash(i: number): number {
  let t = i * 0.1031; t -= Math.floor(t);
  t *= t + 33.33; t *= t + t; return t - Math.floor(t);
}

function vnoise(az: number, cells: number): number {
  const x = ((az + Math.PI) / (Math.PI * 2)) * cells;
  const i = Math.floor(x), f = x - i;
  const a = paintHash(((i % cells) + cells) % cells), b = paintHash((((i + 1) % cells) + cells) % cells);
  return a + (b - a) * f * f * (3 - 2 * f);
}

/** Hairline wave (rad) at azimuth az: one slow octave of value noise (28 cells, about 22 mm), wrapping at the back seam,
 *  up to +-0.008 rad at irregularity 1. The older 150/440-cell jag (+-0.035 rad over a 0.035 rad feather) cut the edge
 *  into scallops; the fine unevenness now comes from the fibres ending at staggered heights (paintFibreAlpha). */
export function hairlineJag(irregularity: number, az: number): number {
  if (irregularity <= 0) return 0;
  return irregularity * 0.008 * (vnoise(az, 28) - 0.5) * 2;
}

/** Paint density 0..1 at signed azimuth az and polar angle phi. */
export function evalScalpPaint(p: ScalpPaint, az: number, phiIn: number): number {
  const phi = phiIn - hairlineJag(p.irregularity ?? 0.5, az);
  const full = sampleArr(p.fullPhi, az), edge = Math.max(full + 1e-4, sampleArr(p.edgePhi, az)), ed = sampleArr(p.edgeDensity, az);
  return paintRamp(phi, full, edge, ed, p.feather) * p.density;
}

/**
 * Density along a fade: 1 down to `full`, `ed` at `edge`, 0 at `edge + feather`, as ONE smooth monotone curve (cubic
 * Hermite with the Fritsch-Carlson middle slope). The older two-piece smoothstep went flat at `edge`, so every fade had a
 * plateau of stubble density that read as a separate band (a stacked, layered look); this ramp keeps falling through it.
 * Mirrored in scalpPaintMaterial.ts (GLSL) and AetherStrand_ScalpPaint.shader (Unity).
 */
export function paintRamp(phi: number, full: number, edge: number, ed: number, feather: number): number {
  if (phi <= full) return 1;
  const x2 = edge + Math.max(1e-4, feather);
  if (phi >= x2) return 0;
  const h0 = Math.max(1e-4, edge - full), h1 = x2 - edge;
  const s0 = (ed - 1) / h0, s1 = -ed / h1;
  const m1 = s0 < 0 && s1 < 0 ? (2 * s0 * s1) / (s0 + s1) : 0;
  const herm = (t: number, ya: number, yb: number, ma: number, mb: number, h: number) => {
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ya + (t3 - 2 * t2 + t) * h * ma + (-2 * t3 + 3 * t2) * yb + (t3 - t2) * h * mb;
  };
  const d = phi <= edge ? herm((phi - full) / h0, 1, ed, 0, m1, h0) : herm((phi - edge) / h1, ed, 0, m1, 0, h1);
  return Math.max(0, Math.min(1, d));
}

/** Width (rad) over which the under-hair shade eases in, from fullPhi up toward the crown. Mirrored in the GLSL and Unity shader. */
export const UNDER_SHADE_BAND = 0.32;

/**
 * Brightness factor (0..1) of the paint under the hair: 1 - underShade at UNDER_SHADE_BAND or more above fullPhi, easing
 * to 1 just past fullPhi. The forehead (|az| under about 0.95) takes 55% less of it: bangs stand off the brow, so the
 * hairline there is lit, while the sides and nape sit in the locks' shadow. `phi` is the jagged phi (as evalScalpPaint
 * uses it). Mirrored in scalpPaintMaterial.ts and the Unity AetherStrand/ScalpPaint shader.
 */
export function paintUnderShade(underShade: number, phi: number, full: number, az = Math.PI): number {
  if (underShade <= 0) return 1;
  const front = ss((0.95 - Math.abs(az)) / 0.6);
  const cavity = 1 - ss((phi - (full - UNDER_SHADE_BAND)) / (UNDER_SHADE_BAND + 0.02));
  return 1 - underShade * (1 - 0.55 * front) * cavity;
}

/**
 * Strand streaks for painted hair (0..1): fine noise stretched along phi (the comb direction of short side hair), so the
 * paint reads as many short hairs, not a flat colour. Renderers scale brightness by 0.82 + 0.36 * streak.
 * Mirrored in scalpPaintMaterial.ts and the Unity shader.
 */
export function paintStreak(az: number, phi: number): number {
  const ia = Math.floor((az + Math.PI) / 0.006);
  const y = phi / 0.03, ib = Math.floor(y), f = y - ib;
  const a = paintHash(ia * 157 + ib * 113), b = paintHash(ia * 157 + (ib + 1) * 113);
  return a + (b - a) * f * f * (3 - 2 * f);
}

/** Box-filtered coverage of a band |d| < hw through a footprint of half-width r (as bandCoverage in the hair shaders). */
const bandCov = (d: number, hw: number, r: number) => Math.max(0, Math.min(1, (Math.min(d + r, hw) - Math.max(d - r, -hw)) / (2 * r)));

/** One octave of fibres: lanes `freq` per radian of azimuth, broken along phi into short hairs (rows `stretch` lanes long),
 *  each hair reaching its own density (stagger), so hairs end at different heights instead of on one contour. fwLane is the
 *  pixel footprint in lanes; once a lane is under a pixel the octave fades to its mean coverage instead of aliasing. */
function fibreOctave(az: number, phi: number, dens: number, grain: number, freq: number, stretch: number, stagAmp: number,
  w0: number, w1: number, d0: number, d1: number, c1: number, k: number[], fwLane: number): number {
  const x = az * freq, lane = Math.floor(x), f = x - lane;
  const row = Math.floor(phi * (freq / stretch) + paintHash(lane * k[0] + k[1]) * k[2]);
  const stag = paintHash(lane * k[3] + row * k[4]);
  const localD = Math.max(0, Math.min(1, dens + (stag - 0.5) * stagAmp * grain));
  const hw = w0 + (w1 - w0) * ss((localD - d0) / (d1 - d0));
  const r = Math.max(0.08, fwLane * 0.5);
  const fib = r < 0.5 ? bandCov(Math.abs(f - 0.5), hw, r) : 2 * hw;
  const lanes = fib + (2 * hw - fib) * ss((r - 0.35) / 0.15);
  return lanes * ss((localD - 0.02) / (c1 - 0.02));
}

/**
 * Paint coverage (alpha 0..1): a soft density ramp mixed by `grain` with directional short-hair fibres (two octaves,
 * about 2.4 mm and 0.9 mm apart, stretched along phi, the comb direction), so a hairline or fade reads as hairs growing
 * down and ending at staggered heights instead of round stipple dots. fwAz = pixel footprint in radians of azimuth
 * (fwidth, seam-safe), 0 for a point sample. From Neon's issue #7 deliverable. Mirrored in scalpPaintMaterial.ts and the
 * Unity AetherStrand/ScalpPaint shader.
 */
export function paintFibreAlpha(az: number, phi: number, dens: number, grain: number, stretch: number, fwAz = 0): number {
  if (dens <= 0.002) return 0;
  if (dens >= 0.995) return 1;
  const st = Math.max(2, stretch);
  const c1 = fibreOctave(az, phi, dens, grain, 260, st, 0.34, 0.14, 0.5, 0.05, 0.85, 0.28, [2.91, 37.3, 4, 3.17, 17.13], fwAz * 260);
  const c2 = fibreOctave(az, phi, dens, grain, 680, st * 1.25, 0.38, 0.12, 0.48, 0.04, 0.82, 0.24, [4.13, 19.1, 6, 5.71, 23.41], fwAz * 680);
  const fibres = c1 + (c2 - c1) * 0.45;
  const base = Math.pow(dens, 0.9);
  return Math.max(0, Math.min(1, base + (fibres - base) * Math.min(0.85, grain * 0.78)));
}

/** Broad strand sheen on the paint (Kajiya-Kay style lobe on the downward comb tangent), so a painted fade shares the locks'
 *  highlight response instead of reading as matte. N, L, V world space, unit length. Mirrored in the paint shaders. */
export function paintSheen(N: THREE.Vector3, L: THREE.Vector3, V: THREE.Vector3, dens: number): number {
  // downward tangent: (0,-1,0) projected onto the surface
  let tx = N.x * N.y, ty = -1 + N.y * N.y, tz = N.z * N.y;
  const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  let hx = L.x + V.x, hy = L.y + V.y, hz = L.z + V.z;
  const hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
  const th = Math.max(-1, Math.min(1, tx * hx + ty * hy + tz * hz));
  return 0.08 * Math.pow(Math.sqrt(Math.max(0, 1 - th * th)), 10) * ss((dens - 0.15) / 0.7);
}

/**
 * Paint colour: the override if set, else the hair's own colour, the average tone a lock shows along its length
 * (PAINT_MIX and PAINT_SHEEN below; sRGB hex in, colour out). Mirrored in the Unity importer (AetherStrandScalpPaint).
 */
export function scalpPaintColor(p: Pick<ScalpPaint, 'color'> | null | undefined, rootHex: string, baseHex?: string, tipHex?: string, specHex?: string, specIntensity?: number): THREE.Color {
  if (p?.color && /^#[0-9a-fA-F]{6}$/.test(p.color)) return new THREE.Color(p.color);
  const r = new THREE.Color(rootHex), b = new THREE.Color(baseHex ?? rootHex), t = new THREE.Color(tipHex ?? baseHex ?? rootHex);
  const [wr, wb, wt] = PAINT_MIX, g = PAINT_SHEEN;
  const s = specHex ? new THREE.Color(specHex) : new THREE.Color(0, 0, 0), k = PAINT_SPEC * (specIntensity ?? 0);
  return new THREE.Color((r.r * wr + b.r * wb + t.r * wt) * g + s.r * k, (r.g * wr + b.g * wb + t.g * wt) * g + s.g * k, (r.b * wr + b.b * wb + t.b * wt) * g + s.b * k);
}

/**
 * Default paint colour = (root, base, tip) mixed by PAINT_MIX in linear space, times PAINT_SHEEN. The paint is lit flat
 * while locks get sheen and tip colour from the hair shader, so a plain average reads darker than the locks and painted
 * sides look like bare scalp; the mix leans to base and tip and the gain stands in for the sheen. Mirrored in Unity
 * (AetherStrandScalpPaint.PaintColor).
 */
// 2.0 (was 1.25): measured on the undercut fade with the preview renderer, painted sides at 1.25 came out about half as
// bright as the lit locks above them, so a fade read as a dark band under the hair instead of the same hair cut shorter.
export const PAINT_MIX: [number, number, number] = [0.05, 0.4, 0.55];
export const PAINT_SHEEN = 2.0;
// Plus the primary highlight colour (linear) times its intensity times PAINT_SPEC. On dark hair the lit locks are mostly
// highlight, not base colour: a black-brown undercut measured hair at sRGB ~48 and its solid painted band at ~13 (a dark
// rim under the hair) until the highlight was counted in.
export const PAINT_SPEC = 0.8;

/**
 * Applies the shared hairline look to a paint: softness widens the final falloff (centred on the cut line, so the hairline
 * does not move) and the full-to-edge blend, and adds grain; irregularity and colour are stored for the renderers.
 */
export function applyHairlineLook(p: ScalpPaint, look: HairlineLook = {}): ScalpPaint {
  const s = Math.max(0, Math.min(1, look.softness ?? 0.5));
  // 4.5 mm (crisp) to 15.5 mm (very soft): the older 2-12 mm band was narrower than the fibres are long, so the edge read
  // as a painted line (Neon, issue #7)
  const feather = 0.045 + 0.11 * s;
  const shift = feather * 0.42; // keep the visual edge (about half density) where the cut line was
  const out: ScalpPaint = {
    ...p,
    edgePhi: p.edgePhi.map((v, i) => Math.max(p.fullPhi[i], v - shift)),
    fullPhi: p.fullPhi.map((v, i) => Math.max(0, Math.min(v, p.edgePhi[i] - shift) - 0.03 * s)),
    feather: Math.max(p.feather, feather),
    grain: Math.max(p.grain, 0.35 + 0.35 * s),
    // fibres combed along phi by default (1 = round dots)
    grainStretch: Math.max(p.grainStretch ?? 1, 6 + 4 * s),
    irregularity: look.irregularity ?? p.irregularity ?? 0.5,
  };
  if (look.color) out.color = look.color; else delete out.color;
  return out;
}

/** A paint built from per-azimuth functions (signed azimuth). */
export function makeScalpPaint(o: { full: (az: number) => number; edge?: (az: number) => number; edgeDensity?: (az: number) => number; feather?: number; density?: number; grain?: number; bins?: number }): ScalpPaint {
  const bins = o.bins ?? SCALP_PAINT_BINS;
  const fullPhi: number[] = [], edgePhi: number[] = [], edgeDensity: number[] = [];
  for (let i = 0; i < bins; i++) {
    const az = binAzimuth(i, bins);
    const f = o.full(az);
    fullPhi.push(f);
    // defaults: a soft hairline is under 30% density by its mid line (was 0.55 at f + 0.03 with a 0.035 feather, a cliff)
    edgePhi.push(Math.max(f, o.edge ? o.edge(az) : f + 0.045));
    edgeDensity.push(o.edgeDensity ? o.edgeDensity(az) : 0.28);
  }
  return { bins, fullPhi, edgePhi, edgeDensity, feather: o.feather ?? 0.065, density: o.density ?? 1, grain: o.grain ?? 0.5 };
}

/**
 * Automatic paint from where the locks touch the scalp: for each azimuth, the lowest point (largest phi) a lock reaches while
 * still lying on the scalp (from its root until it first stands off the skull). Clamped to `maxPhi`, the lowest a natural
 * hairline goes, so bangs lying on the forehead or hair resting on the neck never paint the face or neck.
 */
export function deriveScalpPaint(locks: { pointsLocal: THREE.Vector3[]; isBaseShell?: boolean }[], maxPhi: (az: number) => number, o: { contactR?: number; soft?: number } = {}): ScalpPaint {
  const bins = SCALP_PAINT_BINS;
  const reach = new Array(bins).fill(-1);
  const contactR = o.contactR ?? 1.1;
  const binOf = (az: number) => Math.min(bins - 1, Math.max(0, Math.floor(((az + Math.PI) / (Math.PI * 2)) * bins)));
  for (const L of locks) {
    const pts = L.pointsLocal;
    const root = scalpAngles(pts[0].x, pts[0].y, pts[0].z);
    if (root.r > 1.08) continue;
    for (let n = 0; n < pts.length; n++) {
      const a = scalpAngles(pts[n].x, pts[n].y, pts[n].z);
      if (a.r > contactR) break;
      const b = binOf(a.az);
      reach[b] = Math.max(reach[b], Math.min(a.phi, maxPhi(a.az)));
    }
  }
  // fill empty bins from the nearest filled neighbours, then a light max-filter + smoothing so the line is clean
  const filled = reach.map((v, i) => {
    if (v >= 0) return v;
    for (let k = 1; k < bins / 2; k++) {
      const a = reach[(i - k + bins) % bins], b = reach[(i + k) % bins];
      if (a >= 0 || b >= 0) return Math.max(a, b);
    }
    return 0;
  });
  // filter widths in radians (about +-0.09 rad max, then a +-0.09 rad tent), independent of the bin count
  const kw = Math.max(1, Math.round((0.09 / (Math.PI * 2)) * bins));
  const at = (a: number[], i: number) => a[((i % bins) + bins) % bins];
  const mx = filled.map((_, i) => { let m = -1; for (let k = -kw; k <= kw; k++) m = Math.max(m, at(filled, i + k)); return m; });
  const sm = mx.map((_, i) => { let s = 0, w = 0; for (let k = -kw; k <= kw; k++) { const ww = kw + 1 - Math.abs(k); s += ww * at(mx, i + k); w += ww; } return s / w; });
  const soft = o.soft ?? 0.03;
  return {
    bins,
    fullPhi: sm.map((v) => Math.max(0, v - soft)),
    edgePhi: sm.map((v) => v + 0.005),
    edgeDensity: sm.map(() => 0.55),
    feather: 0.035,
    density: 1,
    grain: 0.5,
  };
}

/** Combines paints by taking the denser one at each point (sampled per bin: max lines, max edge density). */
export function unionScalpPaint(a: ScalpPaint, b: ScalpPaint): ScalpPaint {
  return {
    bins: a.bins,
    fullPhi: a.fullPhi.map((v, i) => Math.max(v, b.fullPhi[i])),
    edgePhi: a.edgePhi.map((v, i) => Math.max(v, b.edgePhi[i])),
    edgeDensity: a.edgeDensity.map((v, i) => Math.max(v, b.edgeDensity[i])),
    feather: Math.max(a.feather, b.feather),
    density: Math.max(a.density, b.density),
    grain: Math.max(a.grain, b.grain),
    grainStretch: Math.max(a.grainStretch ?? 1, b.grainStretch ?? 1),
  };
}
