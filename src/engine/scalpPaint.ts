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
//   Partial density is drawn as a soft gradient mixed with grain stipple (scalpPaintAlpha), never a hard line.
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

/** Hairline wobble (rad) at azimuth az: two octaves of value noise, wrapping at the back seam, up to about +-0.035 rad at irregularity 1. */
export function hairlineJag(irregularity: number, az: number): number {
  if (irregularity <= 0) return 0;
  return irregularity * (0.024 * (vnoise(az, 150) - 0.5) * 2 + 0.011 * (vnoise(az, 440) - 0.5) * 2);
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

/**
 * Paint coverage (alpha 0..1) for a density and a grain noise value n01 (0..1, per ~1 mm cell). Partial density is a
 * soft gradient mixed with stipple by `grain`, so a hairline or fade blends into the skin instead of ending on a line.
 * Mirrored in scalpPaintMaterial.ts and the Unity AetherStrand/ScalpPaint shader.
 */
export function scalpPaintAlpha(dens: number, grain: number, n01: number): number {
  if (dens <= 0.002) return 0;
  if (dens >= 0.999) return 1;
  const n = 0.5 + (n01 - 0.5) * Math.min(1, grain + 0.2);
  const e = 0.14;
  const t = Math.max(0, Math.min(1, (dens - n + e) / (2 * e)));
  const stip = t * t * (3 - 2 * t);
  const soft = Math.pow(dens, 0.85);
  return soft + (stip - soft) * Math.min(1, grain * 0.5);
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
  const feather = 0.02 + 0.1 * s;
  const shift = feather * 0.45; // keep the visual edge (about half density) where the cut line was
  const out: ScalpPaint = {
    ...p,
    edgePhi: p.edgePhi.map((v, i) => Math.max(p.fullPhi[i], v - shift)),
    fullPhi: p.fullPhi.map((v, i) => Math.max(0, Math.min(v, p.edgePhi[i] - shift) - 0.03 * s)),
    feather: Math.max(p.feather, feather),
    grain: Math.max(p.grain, 0.3 + 0.3 * s),
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
    edgePhi.push(Math.max(f, o.edge ? o.edge(az) : f + 0.03));
    edgeDensity.push(o.edgeDensity ? o.edgeDensity(az) : 0.55);
  }
  return { bins, fullPhi, edgePhi, edgeDensity, feather: o.feather ?? 0.035, density: o.density ?? 1, grain: o.grain ?? 0.5 };
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
  };
}
