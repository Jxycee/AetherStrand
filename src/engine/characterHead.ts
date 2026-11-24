// Character head support: load any character's head mesh (OBJ) and place it in web head-pivot space exactly where the
// Unity plugin's head fit (AetherStrandHeadFit.TryCompute) puts the web hair relative to that head. Viewing hair on the
// fitted head in the web generator therefore shows the same hair-to-head relationship as Unity: ears, nape, hairline.
//
// The fit (mirrors AetherStrandHeadFit.cs; keep both in step):
//   chin-to-crown height h, cranium width/depth = bbox of the head points above chinY + 0.55 h,
//   scale = (width / 0.5432, h / 0.742, depth / 0.6104), scale.x >= 0.94 * max(scale.y, scale.z),
//   offset = (cranium x centre, chinY, cranium z centre).  Unity: charPoint = webPoint * scale + offset.
// Here we apply the inverse to the character's head so it lands in web space.
//
// chinY: Unity measures the vertices weighted > 0.5 to the head bone, so the neck is excluded. An OBJ has no weights,
// so chinY is detected from the front profile (the jump at the underside of the chin) unless given explicitly.
import * as THREE from 'three';

export const WEB_HEAD_HEIGHT = 0.742;
export const WEB_HEAD_WIDTH = 0.5432;
export const WEB_HEAD_DEPTH = 0.6104;

export interface HeadFit {
  scale: THREE.Vector3;
  offset: THREE.Vector3;
  height: number;
  width: number;
  depth: number;
  chinY: number;
}

export interface CharacterHead {
  name: string;
  /** Triangle soup positions in web head-pivot-local space (non-indexed, 9 floats per triangle). */
  positions: Float32Array;
  fit: HeadFit;
  landmarks: HeadLandmarks;
  /** How far the real skull stands out from the web scalp ellipsoid, per direction (hair is pushed out by it). */
  conform: HeadConformMap;
}

/** Ear and nape landmarks in web scalp coordinates (theta = |azimuth| from the front, phi from the crown apex). */
export interface HeadLandmarks {
  earFrontTheta: number;
  earBackTheta: number;
  earCenterTheta: number;
  earTopPhi: number;
  earMidPhi: number;
  earLobePhi: number;
  /** phi where the skull meets the neck at the back centre (hair below this hangs off the neck). */
  napePhi: number;
}

/** Minimal OBJ reader: v and f records (polygons fan-triangulated). Returns indexed geometry in the file's units. */
export function parseObj(text: string): { positions: Float32Array; indices: Uint32Array } {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      pos.push(Number(p[1]), Number(p[2]), Number(p[3]));
    } else if (line.startsWith('f ')) {
      const p = line.split(/\s+/).slice(1).map((t) => {
        const i = parseInt(t.split('/')[0], 10);
        return i < 0 ? pos.length / 3 + i : i - 1;
      });
      for (let k = 1; k + 1 < p.length; k++) idx.push(p[0], p[k], p[k + 1]);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Chin height from the front profile: the lowest height where the face front stands well forward of the neck front. */
export function detectChinY(positions: Float32Array): number {
  let yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    yMin = Math.min(yMin, positions[i + 1]); yMax = Math.max(yMax, positions[i + 1]);
    zMin = Math.min(zMin, positions[i + 2]); zMax = Math.max(zMax, positions[i + 2]);
  }
  const bins = 120, step = (yMax - yMin) / bins;
  const front = new Array(bins).fill(-Infinity);
  const midW = 0.06 * (zMax - zMin);
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i]) > midW) continue;
    const b = Math.min(bins - 1, Math.floor((positions[i + 1] - yMin) / step));
    front[b] = Math.max(front[b], positions[i + 2]);
  }
  // largest forward jump of the front profile in the lower half = chin underside
  let best = 0, bestB = Math.floor(bins * 0.3);
  for (let b = 1; b < bins / 2; b++) {
    if (!isFinite(front[b]) || !isFinite(front[b - 1])) continue;
    const j = front[b] - front[b - 1];
    if (j > best) { best = j; bestB = b; }
  }
  return yMin + bestB * step;
}

/** The Unity plugin's head fit, computed from head points (character space, +Y up, +Z forward). */
export function computeHeadFit(positions: Float32Array, chinY?: number): HeadFit {
  let yMax = -Infinity;
  for (let i = 1; i < positions.length; i += 3) yMax = Math.max(yMax, positions[i]);
  const y0 = chinY ?? detectChinY(positions);
  const h = yMax - y0;
  const cut = y0 + 0.55 * h;
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 1] < cut) continue;
    xMin = Math.min(xMin, positions[i]); xMax = Math.max(xMax, positions[i]);
    zMin = Math.min(zMin, positions[i + 2]); zMax = Math.max(zMax, positions[i + 2]);
  }
  const width = xMax - xMin, depth = zMax - zMin;
  const scale = new THREE.Vector3(width / WEB_HEAD_WIDTH, h / WEB_HEAD_HEIGHT, depth / WEB_HEAD_DEPTH);
  scale.x = Math.max(scale.x, 0.94 * Math.max(scale.y, scale.z));
  const offset = new THREE.Vector3((xMin + xMax) * 0.5, y0, (zMin + zMax) * 0.5);
  return { scale, offset, height: h, width, depth, chinY: y0 };
}

const HC = new THREE.Vector3(0, 0.425, -0.01); // HEAD_CENTER_LOCAL
const RX = 0.282, RY = 0.318, RZ = 0.31; // SCALP_RX/RY/RZ

/** Scalp coordinates of a web head-pivot-local point: |azimuth| from the front, polar angle from the crown, ellipsoid radius ratio. */
export function scalpCoords(x: number, y: number, z: number): { theta: number; phi: number; r: number } {
  const dx = (x - HC.x) / RX, dy = (y - HC.y) / RY, dz = (z - HC.z) / RZ;
  const r = Math.hypot(dx, dy, dz);
  return { theta: Math.abs(Math.atan2(dx, dz)), phi: Math.acos(Math.max(-1, Math.min(1, dy / r))), r };
}

/**
 * Ear landmarks from a fitted head (web space points). The ear is found as the outward bump on the side of the head:
 * for each side band, the skull's lateral silhouette is estimated from the points just in front of and behind the ear
 * region, and points standing clear of it by more than 6% of the cranium half-width are the pinna.
 */
export function measureHeadLandmarks(pts: Float32Array): HeadLandmarks {
  type P = { theta: number; phi: number; r: number };
  const sc: P[] = [];
  for (let i = 0; i < pts.length; i += 3) sc.push(scalpCoords(pts[i], pts[i + 1], pts[i + 2]));
  // skull radius profile by phi from the side region just behind the ear zone (theta 2.3..2.6) and in front (1.1..1.3)
  const prof = (lo: number, hi: number) => {
    const bins = new Array(64).fill(0).map(() => [] as number[]);
    for (const p of sc) if (p.theta > lo && p.theta < hi && p.phi < Math.PI) bins[Math.min(63, Math.floor((p.phi / Math.PI) * 64))].push(p.r);
    return bins.map((b) => (b.length ? b.sort((a, c) => a - c)[Math.floor(b.length * 0.9)] : NaN));
  };
  const front = prof(1.05, 1.3), back = prof(2.35, 2.6);
  const ear: P[] = [];
  for (const p of sc) {
    if (p.theta < 1.3 || p.theta > 2.35 || p.phi < 1.3 || p.phi > 2.7) continue;
    const b = Math.min(63, Math.floor((p.phi / Math.PI) * 64));
    const ref = Math.max(front[b] || 0, back[b] || 0);
    if (ref > 0 && p.r > ref + 0.06) ear.push(p);
  }
  const q = (a: number[], f: number) => { const s = a.slice().sort((x, y) => x - y); return s[Math.max(0, Math.min(s.length - 1, Math.round(f * (s.length - 1))))]; };
  if (ear.length < 12) {
    // fall back to the builder's defaults (Tobin, measured 2026-11-24)
    return { earFrontTheta: 1.62, earBackTheta: 1.94, earCenterTheta: 1.78, earTopPhi: 1.64, earMidPhi: 1.86, earLobePhi: 2.10, napePhi: 2.1 };
  }
  const th = ear.map((p) => p.theta), ph = ear.map((p) => p.phi);
  // nape: lowest phi at the back centre where the surface stops following the skull (radius drops below 0.9)
  let napePhi = 2.1;
  {
    const bins = new Array(64).fill(0).map(() => [] as number[]);
    for (const p of sc) if (p.theta > 2.85) bins[Math.min(63, Math.floor((p.phi / Math.PI) * 64))].push(p.r);
    for (let b = 32; b < 64; b++) {
      const m = bins[b].length ? bins[b].sort((a, c) => a - c)[Math.floor(bins[b].length * 0.5)] : NaN;
      if (isFinite(m) && m < 0.86) { napePhi = (b / 64) * Math.PI; break; }
    }
  }
  return {
    earFrontTheta: q(th, 0.04), earBackTheta: q(th, 0.96), earCenterTheta: q(th, 0.5),
    earTopPhi: q(ph, 0.03), earMidPhi: q(ph, 0.5), earLobePhi: q(ph, 0.97), napePhi,
  };
}

/** Loads an OBJ head, fits it like the Unity plugin and returns it in web head-pivot-local space with its landmarks. */
export function loadCharacterHead(objText: string, name = 'character', chinY?: number): CharacterHead {
  const { positions, indices } = parseObj(objText);
  const fit = computeHeadFit(positions, chinY);
  const web = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    web[i] = (positions[i] - fit.offset.x) / fit.scale.x;
    web[i + 1] = (positions[i + 1] - fit.offset.y) / fit.scale.y;
    web[i + 2] = (positions[i + 2] - fit.offset.z) / fit.scale.z;
  }
  const tri = new Float32Array(indices.length * 3);
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k] * 3;
    tri[k * 3] = web[i]; tri[k * 3 + 1] = web[i + 1]; tri[k * 3 + 2] = web[i + 2];
  }
  return { name, positions: tri, fit, landmarks: measureHeadLandmarks(web), conform: buildHeadConformMap(web) };
}

// ---- Head conform: fit the hair to the character's real skull, not just its bounding box ----
// The builder lays hair on the web scalp ellipsoid. A character's skull bulges past it in places (Tobin: up to 9% at the
// forehead, 2-7% over the upper sides) so hair lying close to the scalp ends up inside the head, and dips inside it elsewhere.
// The conform map stores, per scalp direction, how far the real skull stands out from the ellipsoid (in ellipsoid radius
// units); conformPoint pushes a hair node outward by that amount, so every lock keeps its height above the real skull.
// Outward only: where the skull is smaller than the ellipsoid the hair is left as built (the collider owns that case).

export const CONFORM_AZ_BINS = 72;
export const CONFORM_PHI_BINS = 48;
export const CONFORM_PHI_MAX = 2.4;

export interface HeadConformMap {
  azBins: number;
  phiBins: number;
  phiMax: number;
  /** excess[a * phiBins + p] = skull radius / ellipsoid radius - 1, >= 0 */
  excess: Float32Array;
}

const _sa = (x: number, y: number, z: number) => {
  const dx = (x - HC.x) / RX, dy = (y - HC.y) / RY, dz = (z - HC.z) / RZ;
  const r = Math.hypot(dx, dy, dz);
  return { az: Math.atan2(dx, dz), phi: Math.acos(Math.max(-1, Math.min(1, dy / (r || 1)))), r };
};

/** Builds the conform map from head points in web head-pivot space (e.g. CharacterHead.positions). */
export function buildHeadConformMap(pts: Float32Array): HeadConformMap {
  const A = CONFORM_AZ_BINS, P = CONFORM_PHI_BINS, PM = CONFORM_PHI_MAX;
  const bins: number[][] = Array.from({ length: A * P }, () => []);
  for (let i = 0; i < pts.length; i += 3) {
    const s = _sa(pts[i], pts[i + 1], pts[i + 2]);
    if (s.phi >= PM) continue;
    const a = Math.min(A - 1, Math.floor(((s.az + Math.PI) / (Math.PI * 2)) * A));
    const p = Math.min(P - 1, Math.floor((s.phi / PM) * P));
    bins[a * P + p].push(s.r);
  }
  const raw = new Float32Array(A * P).fill(NaN);
  bins.forEach((b, i) => { if (b.length) { b.sort((x, y) => x - y); raw[i] = b[Math.floor((b.length - 1) * 0.97)] - 1; } });
  // fill holes from neighbours, then two 3x3 box passes (azimuth wraps)
  const at = (arr: Float32Array, a: number, p: number) => arr[(((a % A) + A) % A) * P + Math.max(0, Math.min(P - 1, p))];
  for (let pass = 0; pass < 6; pass++) {
    for (let a = 0; a < A; a++) for (let p = 0; p < P; p++) {
      if (!isNaN(raw[a * P + p])) continue;
      let s = 0, n = 0;
      for (let da = -1; da <= 1; da++) for (let dp = -1; dp <= 1; dp++) { const v = at(raw, a + da, p + dp); if (!isNaN(v)) { s += v; n++; } }
      if (n) raw[a * P + p] = s / n;
    }
  }
  let cur = raw.map((v) => (isNaN(v) ? 0 : v));
  // 3x3 max first (a lock must clear the highest point under it), then two 3x3 box passes to smooth
  {
    const mx = new Float32Array(A * P);
    for (let a = 0; a < A; a++) for (let p = 0; p < P; p++) {
      let m = -Infinity;
      for (let da = -1; da <= 1; da++) for (let dp = -1; dp <= 1; dp++) m = Math.max(m, at(cur, a + da, p + dp));
      mx[a * P + p] = m;
    }
    cur = mx;
  }
  for (let pass = 0; pass < 2; pass++) {
    const nx = new Float32Array(A * P);
    for (let a = 0; a < A; a++) for (let p = 0; p < P; p++) {
      let s = 0;
      for (let da = -1; da <= 1; da++) for (let dp = -1; dp <= 1; dp++) s += at(cur, a + da, p + dp);
      nx[a * P + p] = s / 9;
    }
    cur = nx;
  }
  return { azBins: A, phiBins: P, phiMax: PM, excess: cur.map((v) => Math.max(0, Math.min(0.2, v))) };
}

/** Skull excess (ellipsoid radius units, >= 0) at signed azimuth az and polar angle phi (bilinear, azimuth wraps). */
export function sampleHeadConform(m: HeadConformMap, az: number, phi: number): number {
  const fa = ((az + Math.PI) / (Math.PI * 2)) * m.azBins - 0.5;
  const fp = Math.max(0, Math.min(m.phiBins - 1, (phi / m.phiMax) * m.phiBins - 0.5));
  const a0 = Math.floor(fa), p0 = Math.floor(fp), ta = fa - a0, tp = fp - p0;
  const g = (a: number, p: number) => m.excess[(((a % m.azBins) + m.azBins) % m.azBins) * m.phiBins + Math.min(m.phiBins - 1, p)];
  return (g(a0, p0) * (1 - ta) + g(a0 + 1, p0) * ta) * (1 - tp) + (g(a0, p0 + 1) * (1 - ta) + g(a0 + 1, p0 + 1) * ta) * tp;
}

/**
 * Pushes a hair node (web head-pivot space, in place) outward by the skull excess. Nodes below the hairline cap (hair hanging
 * past the scalp: bangs, long hair, ponytails) take the excess at the cap, so a lock moves as one piece and never follows
 * the face or neck. capPhi(az) is the lowest hairline (hairBuilder.naturalMaxHairlinePhi).
 */
export function conformPoint(m: HeadConformMap, p: THREE.Vector3, capPhi: (az: number) => number): void {
  const s = _sa(p.x, p.y, p.z);
  if (s.r < 1e-6) return;
  const ex = sampleHeadConform(m, s.az, Math.min(s.phi, capPhi(s.az)));
  if (ex <= 0) return;
  const k = (s.r + ex) / s.r;
  p.set(HC.x + (p.x - HC.x) * k, HC.y + (p.y - HC.y) * k, HC.z + (p.z - HC.z) * k);
}
