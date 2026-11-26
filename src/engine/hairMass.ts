// ---- Hair mass: the hybrid pipeline's inner volume (hybrid plan, phase 1) ----
// A closed sheet of hair-coloured surface that sits under the locks, over the hair-bearing scalp, so no scalp shows
// between locks and the locks no longer need wide base-shell ribbons to fill the head. It replaces the base shells; the
// sculpted locks stay on top as the shape and the strand detail.
//
// How it is built (all from the style's own locks, so it fits any style and any head the locks are conformed to):
//  1. A fine grid over the scalp (azimuth x phi, in the ellipsoid angles of hairShell.ts / scalpPaint.ts).
//  2. Mask: cells the locks actually touch near the scalp (from each root until the lock first stands off, as
//     deriveScalpPaint measures contact), closed so small gaps between locks are filled, and kept above the natural
//     hairline minus an inset. Fade caps (stubble) and base shells are left out, so a fade stays paint, and bangs that
//     hang over the face never pull the mass onto the forehead.
//  3. Height: a share of the outer height the locks reach over each cell (75th percentile of each lock's highest point,
//     as captureHairShell measures it), so the mass stays inside the lock layer. Feathered down near the mask edge so the
//     edge is not a step (no helmet lip). Smoothed.
//  4. Triangulated, then each vertex is conformed to the character head exactly as short locks are (characterHead.ts).
//  5. Skinning: each vertex follows the displacement of its nearest lock nodes (inverse-distance weights), so the mass
//     moves with the hair the solver moves and stays rigid with the head when the hair is at rest.
// Deterministic: no randomness except a seeded per-vertex strand seed; the same locks and options give the same mesh.
//
// Attributes match the lock geometry (hairPhysics.ts buildVolumetricBuffers), so the same hair material shades it:
// cardMask 0 (opaque, the base-shell path in hairShadingModel / hairShaders / AetherStrand_Hair.shader).
import * as THREE from 'three';
import { scalpAngles } from './scalpPaint';
import { shellSurfacePoint, SHELL_MM_PER_UNIT } from './hairShell';

const DEG = Math.PI / 180;
const HC = new THREE.Vector3(0, 0.425, -0.01);

export interface MassLockInput {
  /** Node positions in web head-pivot space, in the space the mass is built in (before the head conform). */
  points: THREE.Vector3[];
  isBaseShell?: boolean;
  isFadeCap?: boolean;
}

export interface HairMassOptions {
  /** Lowest natural hairline per azimuth (hairBuilder.naturalMaxHairlinePhi): the mass never goes below it. */
  maxPhi: (az: number) => number;
  /** Grid spacing. 3 x 2.5 degrees is about 15 x 13 mm on the web head: finer than a lock, so the mask follows the
   *  hairline and the parting without stair steps. */
  azStepDeg?: number;
  phiStepDeg?: number;
  /** Mass height as a share of the locks' outer height over each cell. 0.6 keeps it well inside the lock layer (the locks
   *  are 2 to 4 layers deep on most styles), high enough that a gap between two outer locks shows hair, not scalp. */
  heightFrac?: number;
  /** Height at the very edge of the mask (mm). Not 0: the conform map and the z-buffer both have some error near the skin,
   *  and an edge exactly on the skin flickers through it. */
  edgeMm?: number;
  /** A lock node counts as touching the scalp while its ellipsoid radius ratio is at most this (deriveScalpPaint's 1.1). */
  contactR?: number;
  /** Radius (degrees, true angle on the scalp) each contact and each lock node marks around itself. */
  splatDeg?: number;
  /** Optional lower limit per azimuth (phi, radians) on top of maxPhi - insetRad: e.g. the painted hairline less a band,
   *  so the bottom of the head between hanging tips shows the painted short hair, as it did with base shells, and the
   *  mass ends higher up under the locks (seen from below its underside faces away from every light and reads black). */
  lowerPhi?: (az: number) => number;
  /** How far above the natural hairline the mask stops (radians), so the mass edge sits under the locks and the painted
   *  hairline, not on bare skin. */
  insetRad?: number;
  /** How steeply the mass may rise from its edge (mm of height per mm across the scalp). The edge starts at edgeMm and
   *  the height can grow by at most this much per mm inward, so the mass rolls off like the hair over it instead of
   *  ending in a cliff (the helmet lip the phase 1 checklist rules out). 0.45 is about a 24 degree rise. */
  edgeSlope?: number;
  /** Extra footprints that mark scalp the mass should cover (e.g. the style's base-shell specs, which say where the
   *  builder wanted a base layer). Same space as `locks`; points on the scalp (radius ratio <= contactR) count. */
  footprint?: THREE.Vector3[][];
  /** Morphological closing in cells: fills gaps between locks up to about twice this wide. */
  closeCells?: number;
  /** Feather band (cells) inside the mask edge where the height ramps from edgeMm to full. */
  featherCells?: number;
  smoothPasses?: number;
  /** Smoothing passes over the outline (default 3), so a slanted edge is not a staircase of grid steps. */
  edgeSmooth?: number;
  /** How far a vertex may follow its lock nodes, as a share of its own height over the scalp. 0.5: the mass stands for
   *  the hair lying within its height of the scalp, so moving more than half of that would lift it off the skin at the
   *  hairline (uncovering scalp) or push it through the locks lying over it. */
  followShare?: number;
  /** Smoothing passes over the follow offsets on the coarse blocks, so neighbouring vertices bound to different locks
   *  move together. */
  followSmooth?: number;
  /** Coarse block size in grid cells for the follow (4: 12 x 10 degrees, about 6 x 5 cm on the scalp, the size of a lock
   *  group; the follow is smoothed on these blocks, which is about 16 times cheaper than on the vertices). */
  followBlock?: number;
  /** How many nodes from each lock's root may be followed (of 12). */
  bindNodes?: number;
  /** Lock nodes each vertex follows. */
  bindCount?: number;
  /** Seed for the per-vertex strand seed (texture variation only). */
  seed?: number;
  /** Rings of vertices inside the outline over which the colour rolls to the root colour of the painted short hair
   *  (default 3, about 9 degrees, 4 cm on the scalp: the width of the fade's soft band). 0 turns it off. */
  edgeRollCells?: number;
  /** Optional head conform (characterHead.conformPoint, bound to the map), applied to each vertex after building. */
  conform?: (p: THREE.Vector3) => void;
}

export interface HairMass {
  vertexCount: number;
  /** Rest positions after the conform, web head-pivot space. */
  rest: Float32Array;
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  normals: Float32Array;
  headNormals: Float32Array;
  tangents: Float32Array;
  /** Head normals and tangents at rest, head-pivot space (deformHairMass turns them with the head). */
  restHeadNormals: Float32Array;
  restTangents: Float32Array;
  /** vertexCount x bindCount global node indices (lockIndex * nodesPerLock + node) and weights. */
  bindNode: Int32Array;
  bindW: Float32Array;
  /** Each vertex's rest height over the scalp (m) and the follow limits (deformHairMass). */
  restHeight: Float32Array;
  /** Weight toward the outline (1 on it, 0 from edgeRollCells hops in): colour rolls to the fade and the normal to the scalp's. */
  edgeW: Float32Array;
  followShare: number;
  followSmooth: number;
  /** Vertex neighbours, CSR: neighbours of i are adjIdx[adjStart[i] .. adjStart[i+1]). */
  adjStart: Int32Array;
  adjIdx: Int32Array;
  /** Scratch for the follow offsets. */
  offA: Float32Array;
  offB: Float32Array;
  /** Coarse follow blocks: each vertex's block (for averaging), its 4 interpolation blocks and weights, block neighbours
   *  (CSR), and scratch. */
  vBlock: Int32Array;
  vInterpB: Int32Array;
  vInterpW: Float32Array;
  blockCount: number;
  bAdjStart: Int32Array;
  bAdjIdx: Int32Array;
  bA: Float32Array;
  bB: Float32Array;
  bN: Float32Array;
  bindCount: number;
  nodesPerLock: number;
  /** Rest node positions (head-pivot space, after the conform) the binding was made against, 3 per node. */
  restNodes: Float32Array;
  /** Grid used, for the debug overlay and the report. */
  grid: { cols: number; rows: number; azStep: number; phiStep: number; mask: Uint8Array; mm: Float32Array };
  stats: { cells: number; maskCells: number; triangles: number; meanMm: number; maxMm: number; boundLocks: number };
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sstep = (e0: number, e1: number, x: number) => { const c = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return c * c * (3 - 2 * c); };

/**
 * Builds the mass from the style's locks. `locks` are in the build space (before the head conform); `restNodesNow` are the
 * same locks' nodes in the space the solver runs in (after the conform), used for the skinning binding. Both lists have
 * the same lock order and node count.
 */
export function buildHairMass(locks: MassLockInput[], restNodesNow: THREE.Vector3[][], o: HairMassOptions): HairMass {
  const azStep = (o.azStepDeg ?? 3) * DEG, phiStep = (o.phiStepDeg ?? 2.5) * DEG;
  const heightFrac = o.heightFrac ?? 0.6, edgeMm = o.edgeMm ?? 1.0, contactR = o.contactR ?? 1.1;
  const splat = (o.splatDeg ?? 6) * DEG, inset = o.insetRad ?? 0.06;
  const closeCells = o.closeCells ?? 3, featherCells = o.featherCells ?? 1, smoothPasses = o.smoothPasses ?? 4;
  const K = o.bindCount ?? 3;
  const cols = Math.round((2 * Math.PI) / azStep);
  // rows down to the lowest natural hairline anywhere (the mask trims each column to its own)
  let lowest = 0;
  for (let c = 0; c < cols; c++) lowest = Math.max(lowest, o.maxPhi(-Math.PI + (c + 0.5) * azStep));
  const rows = Math.ceil(lowest / phiStep);
  const cellAz = (c: number) => -Math.PI + (c + 0.5) * azStep;
  const cellPhi = (r: number) => (r + 0.5) * phiStep;
  const N = rows * cols;
  const idx = (r: number, c: number) => r * cols + (((c % cols) + cols) % cols);

  // ---- 1. splat every lock into the grid: contact and per-lock highest point ----
  const contact = new Uint8Array(N);
  const lockMax = new Float32Array(N);
  const heights: number[][] = Array.from({ length: N }, () => []);
  const stamp = new Int32Array(N).fill(-1);
  const touched: number[] = [];
  const cosSplat = Math.cos(splat);
  const visit = (p: THREE.Vector3, li: number, isContact: boolean) => {
    const s = scalpAngles(p.x, p.y, p.z);
    const mm = (s.r - 1) * SHELL_MM_PER_UNIT;
    if (mm <= 0 && !isContact) return;
    const cp = Math.cos(s.phi), sp = Math.sin(s.phi);
    const r0 = Math.max(0, Math.floor((s.phi - splat) / phiStep)), r1 = Math.min(rows - 1, Math.floor((s.phi + splat) / phiStep));
    for (let r = r0; r <= r1; r++) {
      const ph = cellPhi(r), spr = Math.sin(ph), cpr = Math.cos(ph);
      const span = spr < 1e-3 ? Math.PI : Math.min(Math.PI, splat / spr + azStep);
      const c0 = Math.floor((s.az - span + Math.PI) / azStep), c1 = Math.floor((s.az + span + Math.PI) / azStep);
      for (let cc = c0; cc <= c1 && cc - c0 < cols; cc++) {
        const k = idx(r, cc);
        if (cp * cpr + sp * spr * Math.cos(s.az - cellAz(cc)) < cosSplat) continue;
        if (isContact) contact[k] = 1;
        if (mm > 0 && li >= 0) {
          if (stamp[k] !== li) { stamp[k] = li; lockMax[k] = 0; touched.push(k); }
          if (mm > lockMax[k]) lockMax[k] = mm;
        }
      }
    }
  };
  const tmp = new THREE.Vector3();
  // base-layer footprints: contact only (they are not built as locks, so they set no height)
  for (const fp of o.footprint ?? []) {
    for (let n = 0; n < fp.length; n++) {
      const a = scalpAngles(fp[n].x, fp[n].y, fp[n].z);
      if (a.r > contactR) break;
      if (a.phi <= o.maxPhi(a.az)) visit(fp[n], -2, true);
      if (n + 1 < fp.length) visit(tmp.copy(fp[n]).lerp(fp[n + 1], 0.5), -2, a.phi <= o.maxPhi(a.az));
    }
  }
  locks.forEach((L, li) => {
    if (L.isBaseShell || L.isFadeCap) return;
    const pts = L.points;
    const root = scalpAngles(pts[0].x, pts[0].y, pts[0].z);
    let onScalp = root.r <= 1.08;
    touched.length = 0;
    for (let n = 0; n < pts.length; n++) {
      const a = scalpAngles(pts[n].x, pts[n].y, pts[n].z);
      if (a.r > contactR) onScalp = false;
      // contact only above the natural hairline: bangs lying on the forehead do not mark it
      visit(pts[n], li, onScalp && a.phi <= o.maxPhi(a.az));
      if (n + 1 < pts.length) for (let q = 1; q < 3; q++) visit(tmp.copy(pts[n]).lerp(pts[n + 1], q / 3), li, false);
    }
    for (const k of touched) heights[k].push(lockMax[k]);
  });

  // ---- 2. mask: contact, closed, above the hairline minus the inset ----
  const limitPhi = (az: number) => Math.min(o.maxPhi(az) - inset, o.lowerPhi ? o.lowerPhi(az) : Infinity);
  let mask = new Uint8Array(N);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = idx(r, c);
    mask[k] = contact[k] && cellPhi(r) <= limitPhi(cellAz(c)) ? 1 : 0;
  }
  const morph = (m: Uint8Array, grow: boolean) => {
    const out = new Uint8Array(N);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let v = grow ? 0 : 1;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        // across the crown the neighbouring row continues on the far side; past the last row counts as outside
        const q = rr < 0 ? m[idx(0, c + dc + cols / 2)] : rr >= rows ? 0 : m[idx(rr, c + dc)];
        if (grow ? q : !q) { v = grow ? 1 : 0; }
      }
      out[idx(r, c)] = v;
    }
    return out;
  };
  for (let i = 0; i < closeCells; i++) mask = morph(mask, true);
  for (let i = 0; i < closeCells; i++) mask = morph(mask, false);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (cellPhi(r) > limitPhi(cellAz(c))) mask[idx(r, c)] = 0;

  // ---- 3. height ----
  const outer = new Float32Array(N).fill(NaN);
  for (let k = 0; k < N; k++) {
    const h = heights[k];
    if (!h.length) continue;
    h.sort((a, b) => a - b);
    outer[k] = h[Math.floor((h.length - 1) * 0.75)];
  }
  // cells in the mask that no lock passes over (closed gaps) take the mean of their known neighbours, outward in rings
  for (let pass = 0; pass < 40; pass++) {
    let missing = 0;
    const next = outer.slice();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = idx(r, c);
      if (!mask[k] || !isNaN(outer[k])) continue;
      let s = 0, w = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        const v = outer[idx(rr, c + dc)];
        if (!isNaN(v)) { s += v; w++; }
      }
      if (w) next[k] = s / w; else missing++;
    }
    outer.set(next);
    if (!missing) break;
  }
  // distance to the mask edge (cells, 8-neighbour), for the feather
  const dist = new Float32Array(N).fill(1e9);
  const queue: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = idx(r, c);
    if (!mask[k]) continue;
    let edge = r === rows - 1;
    for (let dr = -1; dr <= 1 && !edge; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      if (rr >= rows || (rr >= 0 && !mask[idx(rr, c + dc)])) { edge = true; break; }
    }
    if (edge) { dist[k] = 0; queue.push(k); }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi], r = Math.floor(k / cols), c = k % cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      if (rr < 0 || rr >= rows) continue;
      const q = idx(rr, c + dc);
      if (mask[q] && dist[q] > dist[k] + 1) { dist[q] = dist[k] + 1; queue.push(q); }
    }
  }
  let mm = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    if (!mask[k]) continue;
    const full = (isNaN(outer[k]) ? 0 : outer[k]) * heightFrac;
    mm[k] = edgeMm + Math.max(0, full - edgeMm) * sstep(0, featherCells + 0.5, dist[k]);
  }
  // slope limit from the edge inward (relaxed until stable): no cell stands more than edgeSlope x its distance above a
  // neighbour, so the rise from the edge is a roll-off, not a step
  const slope = o.edgeSlope ?? 0.45;
  const arcPhi = phiStep * SHELL_MM_PER_UNIT;
  for (let pass = 0; pass < rows + cols; pass++) {
    let changed = false;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = idx(r, c);
      if (!mask[k]) continue;
      const arcAz = azStep * Math.sin(cellPhi(r)) * SHELL_MM_PER_UNIT;
      let lim = mm[k];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        const q = idx(rr, c + dc);
        // outside the mask counts as the edge height
        const h = mask[q] ? mm[q] : edgeMm;
        lim = Math.min(lim, h + slope * Math.hypot(dr * arcPhi, dc * arcAz));
      }
      if (lim < mm[k] - 1e-4) { mm[k] = lim; changed = true; }
    }
    if (!changed) break;
  }
  // Laplacian smoothing inside the mask (edge cells keep the edge height, so the feather holds)
  for (let pass = 0; pass < smoothPasses; pass++) {
    const next = mm.slice();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = idx(r, c);
      if (!mask[k] || dist[k] === 0) continue;
      let s = 0, w = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        const q = idx(rr, c + dc);
        if (!mask[q]) continue;
        s += mm[q]; w++;
      }
      next[k] = 0.5 * mm[k] + 0.5 * (s / w);
    }
    mm = next;
  }

  // ---- 4. mesh: one vertex per masked cell corner region; a cell's quad uses its own and its neighbours' centres ----
  // Vertices sit at cell centres, so the mesh is the dual of the cell grid: a quad joins four neighbouring masked cells,
  // a triangle three where the fourth is outside.
  const vid = new Int32Array(N).fill(-1);
  const pts: THREE.Vector3[] = [];
  const vCell: number[] = [];
  for (let k = 0; k < N; k++) if (mask[k]) { vid[k] = pts.length; vCell.push(k); const r = Math.floor(k / cols), c = k % cols; pts.push(shellSurfacePoint(cellAz(c), cellPhi(r), mm[k])); }
  // (no crown pole vertex: a fan there would converge every strand-texture column into one point and show a bright
  // starburst. When the whole first ring is in the mask, its 6 mm hole is capped by a fan from one of its own vertices.)
  let firstRow = 0;
  for (let c = 0; c < cols; c++) if (mask[idx(0, c)]) firstRow++;
  const tris: number[] = [];
  for (let r = 0; r + 1 < rows; r++) for (let c = 0; c < cols; c++) {
    const a = vid[idx(r, c)], b = vid[idx(r, c + 1)], d = vid[idx(r + 1, c)], e = vid[idx(r + 1, c + 1)];
    // outward facing (counter-clockwise seen from outside): az grows toward +X seen from the front, phi grows downward
    const n = (a >= 0 ? 1 : 0) + (b >= 0 ? 1 : 0) + (d >= 0 ? 1 : 0) + (e >= 0 ? 1 : 0);
    if (n === 4) tris.push(a, d, e, a, e, b);
    else if (n === 3) {
      if (a < 0) tris.push(b, d, e); else if (b < 0) tris.push(a, d, e); else if (d < 0) tris.push(a, e, b); else tris.push(a, d, b);
    }
  }

  if (rows > 0 && firstRow === cols) for (let c = 1; c + 1 < cols; c++) tris.push(vid[idx(0, 0)], vid[idx(0, c + 1)], vid[idx(0, c)]);
  // Smooth the outline: on the cell grid a slanted edge is a staircase of 3-degree steps, which shows as teeth when the
  // locks over it part (a turn lifts the fringe off the temple). Each outline vertex moves toward the mean of its outline
  // neighbours in (azimuth, phi), at most about half a cell, then is rebuilt at its own height.
  const vAz = vCell.map((k) => cellAz(k % cols)), vPh = vCell.map((k) => cellPhi(Math.floor(k / cols)));
  {
    const inMask = (r: number, c: number) => r >= 0 && r < rows && mask[idx(r, c)] === 1;
    const onEdge = vCell.map((k) => { const r = Math.floor(k / cols), c = k % cols; return r > 0 && (!inMask(r - 1, c) || !inMask(r + 1, c) || !inMask(r, c - 1) || !inMask(r, c + 1)); });
    const nb: Set<number>[] = Array.from({ length: pts.length }, () => new Set<number>());
    for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = tris[t + e], b = tris[t + ((e + 1) % 3)];
      if (onEdge[a] && onEdge[b]) { nb[a].add(b); nb[b].add(a); }
    }
    const wrap = (x: number) => x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
    for (let pass = 0; pass < (o.edgeSmooth ?? 3); pass++) {
      const nAz = vAz.slice(), nPh = vPh.slice();
      for (let i = 0; i < pts.length; i++) {
        if (!onEdge[i] || nb[i].size < 2) continue;
        let da = 0, dp = 0;
        for (const q of nb[i]) { da += wrap(vAz[q] - vAz[i]); dp += vPh[q] - vPh[i]; }
        nAz[i] = wrap(vAz[i] + 0.5 * da / nb[i].size); nPh[i] = vPh[i] + 0.5 * dp / nb[i].size;
      }
      for (let i = 0; i < pts.length; i++) { vAz[i] = nAz[i]; vPh[i] = nPh[i]; }
    }
    vCell.forEach((k, i) => { if (onEdge[i]) pts[i] = shellSurfacePoint(vAz[i], vPh[i], mm[k]); });
  }
  if (o.conform) for (const p of pts) o.conform(p);

  const V = pts.length;
  const rest = new Float32Array(V * 3);
  pts.forEach((p, i) => { rest[i * 3] = p.x; rest[i * 3 + 1] = p.y; rest[i * 3 + 2] = p.z; });

  // ---- 5. skinning binding to the nearest lock nodes (after the conform, in the solver's space) ----
  const nodesPerLock = restNodesNow[0]?.length ?? 0;
  const restNodes = new Float32Array(restNodesNow.length * nodesPerLock * 3);
  restNodesNow.forEach((ps, li) => ps.forEach((p, k) => { const o3 = (li * nodesPerLock + k) * 3; restNodes[o3] = p.x; restNodes[o3 + 1] = p.y; restNodes[o3 + 2] = p.z; }));
  // candidates: nodes of the locks that built the mass, bucketed in a coarse 3D hash for the nearest search
  const cand: number[] = [];
  // Any node of a lock may be followed (bindNodes limits it to the first few from the root, for tests). Root-only binding
  // was tried and fails: lock roots are sparse where the base shell carried the side and nape, so vertices there bound
  // to roots 10 cm away. The follow is instead smoothed and limited in deformHairMass.
  const bindNodes = o.bindNodes ?? nodesPerLock;
  locks.forEach((L, li) => { if (!L.isBaseShell && !L.isFadeCap) for (let k = 0; k < Math.min(nodesPerLock, bindNodes); k++) cand.push(li * nodesPerLock + k); });
  const cellSize = 0.06;
  const hash = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;
  for (const g of cand) { const kk = key(restNodes[g * 3], restNodes[g * 3 + 1], restNodes[g * 3 + 2]); (hash.get(kk) ?? hash.set(kk, []).get(kk)!).push(g); }
  const bindNode = new Int32Array(V * K).fill(-1), bindW = new Float32Array(V * K);
  const boundLocks = new Set<number>();
  for (let i = 0; i < V; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    const best: [number, number][] = [];
    for (let ring = 1; ring <= 4 && best.length < K; ring++) {
      best.length = 0;
      const cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize), cz = Math.floor(z / cellSize);
      for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) for (let dz = -ring; dz <= ring; dz++) {
        for (const g of hash.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          const d2 = (restNodes[g * 3] - x) ** 2 + (restNodes[g * 3 + 1] - y) ** 2 + (restNodes[g * 3 + 2] - z) ** 2;
          best.push([d2, g]);
        }
      }
    }
    best.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let ws = 0;
    for (let j = 0; j < Math.min(K, best.length); j++) {
      const w = 1 / (Math.sqrt(best[j][0]) + 0.004);
      bindNode[i * K + j] = best[j][1]; bindW[i * K + j] = w; ws += w;
      boundLocks.add(Math.floor(best[j][1] / nodesPerLock));
    }
    for (let j = 0; j < K; j++) bindW[i * K + j] /= ws || 1;
  }

  // ---- attributes ----
  const rnd = mulberry32((o.seed ?? 1) >>> 0);
  const positions = rest.slice();
  const normals = new Float32Array(V * 3), headNormals = new Float32Array(V * 3), tangents = new Float32Array(V * 3);
  const uvs = new Float32Array(V * 2), seeds = new Float32Array(V), layerAO = new Float32Array(V), cardMask = new Float32Array(V);
  const scalpRoot = new Float32Array(V), gradT = new Float32Array(V), edgeW = new Float32Array(V);
  const hn = new THREE.Vector3(), tg = new THREE.Vector3(), t1 = new THREE.Vector3();
  const lockSeed = Array.from({ length: locks.length }, () => rnd());
  // Hops from the outline (vertices on an edge used by one triangle only), so the colour can roll into the painted short
  // hair at the edge: seen in Unity and the preview, a mass in mid-length colour shows as a pale shell with a hard lip
  // above the ears where the fade starts below it.
  const edgeUse = new Map<number, number>();
  const ekey = (a: number, b: number) => (a < b ? a * V + b : b * V + a);
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const k2 = ekey(tris[t + e], tris[t + ((e + 1) % 3)]); edgeUse.set(k2, (edgeUse.get(k2) ?? 0) + 1); }
  const hop = new Int32Array(V).fill(1 << 20);
  const nb0: number[][] = Array.from({ length: V }, () => []);
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const a = tris[t + e], b = tris[t + ((e + 1) % 3)]; nb0[a].push(b); nb0[b].push(a); }
  let front: number[] = [];
  edgeUse.forEach((n, k2) => { if (n === 1) { const a = Math.floor(k2 / V), b = k2 % V; for (const q of [a, b]) if (hop[q] !== 0) { hop[q] = 0; front.push(q); } } });
  while (front.length) { const nx: number[] = []; for (const q of front) for (const r of nb0[q]) if (hop[r] > hop[q] + 1) { hop[r] = hop[q] + 1; nx.push(r); } front = nx; }
  const edgeRoll = o.edgeRollCells ?? 3;
  for (let i = 0; i < V; i++) {
    const k = vCell[i];
    const az = vAz[i], ph = vPh[i];
    // head normal: the ellipsoid gradient at the vertex
    hn.set((rest[i * 3] - HC.x) / (0.282 * 0.282), (rest[i * 3 + 1] - HC.y) / (0.318 * 0.318), (rest[i * 3 + 2] - HC.z) / (0.31 * 0.31)).normalize();
    headNormals.set([hn.x, hn.y, hn.z], i * 3);
    // comb direction: the weighted tangent of the bound lock nodes, laid into the scalp's tangent plane
    tg.set(0, 0, 0);
    for (let j = 0; j < K; j++) {
      const g = bindNode[i * K + j];
      if (g < 0) continue;
      const li = Math.floor(g / nodesPerLock), n = g % nodesPerLock;
      const a0 = li * nodesPerLock + Math.max(0, n - 1), a1 = li * nodesPerLock + Math.min(nodesPerLock - 1, n + 1);
      t1.set(restNodes[a1 * 3] - restNodes[a0 * 3], restNodes[a1 * 3 + 1] - restNodes[a0 * 3 + 1], restNodes[a1 * 3 + 2] - restNodes[a0 * 3 + 2]);
      if (t1.lengthSq() > 1e-12) tg.addScaledVector(t1.normalize(), bindW[i * K + j]);
    }
    tg.addScaledVector(hn, -tg.dot(hn));
    if (tg.lengthSq() < 1e-8) {
      // no usable lock direction: comb straight down from the crown
      tg.set(Math.sin(az) * Math.cos(ph), -Math.sin(ph), Math.cos(az) * Math.cos(ph));
      tg.addScaledVector(hn, -tg.dot(hn));
    }
    tg.normalize();
    tangents.set([tg.x, tg.y, tg.z], i * 3);
    // strand texture coordinates: u around the head, a whole number of card widths (about 4.5 cm each) per ring so the
    // texture closes without a seam at the back; t down from the crown. The mass is mostly seen through gaps, so its
    // texture only has to read as hair, not line up with each lock.
    const cards = Math.max(1, Math.round((2 * Math.PI * Math.sin(ph) * SHELL_MM_PER_UNIT) / 45));
    uvs[i * 2] = ((az + Math.PI) / (2 * Math.PI)) * cards;
    // At the crown whorl the locks part around the roots, and what shows between them is root hair: t ramps up from the
    // root band there (the shader's root occlusion darkens it) to the mid-length value by 20 degrees from the apex.
    const crown = sstep(0, 0.35, ph);
    uvs[i * 2 + 1] = 0.08 + 0.22 * crown + 0.25 * Math.min(1, ph / Math.max(0.5, lowest));
    const g0 = bindNode[i * K];
    seeds[i] = g0 >= 0 ? lockSeed[Math.floor(g0 / nodesPerLock)] : rnd();
    // the deepest layer: a little darker than the locks (as the base shells were: layer AO 0.7, scalp root 0.4) and
    // from the root half of the colour gradient, so gaps read as depth, not as a black hole
    // Toward the outline (edgeRollCells hops) it takes the root colour and full scalp-root shading, the colour of the
    // painted short hair it meets, so the edge reads as the hair thinning into the fade instead of a lip.
    const edge = edgeRoll > 0 ? 1 - sstep(0, edgeRoll, hop[i]) : 0;
    edgeW[i] = edge;
    layerAO[i] = 0.7 - 0.12 * edge;
    cardMask[i] = 0;
    scalpRoot[i] = 0.4 + 0.6 * edge;
    gradT[i] = (0.05 + 0.15 * crown + 0.3 * Math.min(1, ph / Math.max(0.5, lowest))) * (1 - edge);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('aHeadNormal', new THREE.BufferAttribute(headNormals, 3));
  geometry.setAttribute('aHairTangent', new THREE.BufferAttribute(tangents, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('aStrandSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aLayerAO', new THREE.BufferAttribute(layerAO, 1));
  geometry.setAttribute('aCardMask', new THREE.BufferAttribute(cardMask, 1));
  geometry.setAttribute('aScalpRoot', new THREE.BufferAttribute(scalpRoot, 1));
  geometry.setAttribute('aGradT', new THREE.BufferAttribute(gradT, 1));
  // the lock material also reads these (hairShaders.ts): clearance well off the skin, no solver instability tint
  geometry.setAttribute('aClearance', new THREE.BufferAttribute(new Float32Array(V).fill(0.015), 1));
  geometry.setAttribute('aInstability', new THREE.BufferAttribute(new Float32Array(V), 1));
  geometry.setIndex(tris);
  // neighbours (unique) from the triangles, for the follow smoothing
  const nbr: Set<number>[] = Array.from({ length: V }, () => new Set<number>());
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const a = tris[t + e], b = tris[t + ((e + 1) % 3)]; nbr[a].add(b); nbr[b].add(a); }
  const adjStart = new Int32Array(V + 1);
  for (let i = 0; i < V; i++) adjStart[i + 1] = adjStart[i] + nbr[i].size;
  const adjIdx = new Int32Array(adjStart[V]);
  nbr.forEach((set, i) => { let j = adjStart[i]; for (const q of set) adjIdx[j++] = q; });
  // coarse follow blocks (see followBlock). A block row spans BS cell rows; the number of blocks around a row shrinks with
  // the ring's circumference (sin phi), so blocks stay near square up to the crown, where one block caps the whorl
  // (equal-azimuth blocks there would be millimetres wide, and vertices a few mm apart across the crown would follow
  // unrelated blocks).
  const BS = Math.max(1, o.followBlock ?? 4);
  const nbc = Math.ceil(cols / BS), nbRows = Math.max(1, Math.ceil(rows / BS));
  const rowCols: number[] = [], rowStart: number[] = [0];
  for (let br = 0; br < nbRows; br++) {
    const phc = cellPhi(Math.min(rows - 1, br * BS + (BS - 1) / 2));
    rowCols.push(Math.max(1, Math.round(nbc * Math.sin(Math.min(Math.PI / 2, phc)))));
    rowStart.push(rowStart[br] + rowCols[br]);
  }
  const blockCount = rowStart[nbRows];
  const bidx = (br: number, bc: number) => rowStart[br] + (((bc % rowCols[br]) + rowCols[br]) % rowCols[br]);
  const blockOf = (r: number, c: number) => { const br = Math.min(nbRows - 1, Math.floor(r / BS)); return bidx(br, Math.floor(((c + 0.5) / cols) * rowCols[br])); };
  const vBlock = new Int32Array(V), hasB = new Uint8Array(blockCount);
  vCell.forEach((k, i) => { vBlock[i] = blockOf(Math.floor(k / cols), k % cols); hasB[vBlock[i]] = 1; });
  const vInterpB = new Int32Array(V * 4), vInterpW = new Float32Array(V * 4);
  const half = (BS - 1) / 2;
  vCell.forEach((k, i) => {
    const r = Math.floor(k / cols), c = k % cols;
    const fr = (r - half) / BS, r0 = Math.floor(fr), tr = fr - r0;
    let ws = 0, j = 0;
    for (const [br0, wr] of [[r0, 1 - tr], [r0 + 1, tr]] as const) {
      const br = Math.max(0, Math.min(nbRows - 1, br0)), nc = rowCols[br];
      const f = ((c + 0.5) / cols) * nc - 0.5, c0 = Math.floor(f), tc = f - c0;
      for (const [bc, wc] of [[c0, 1 - tc], [c0 + 1, tc]] as const) {
        const bb = bidx(br, bc), w = hasB[bb] ? wr * wc : 0;
        vInterpB[i * 4 + j] = bb; vInterpW[i * 4 + j] = w; ws += w; j++;
      }
    }
    if (ws < 1e-6) { vInterpW.fill(0, i * 4, i * 4 + 4); vInterpB[i * 4] = vBlock[i]; vInterpW[i * 4] = 1; }
    else for (let q = 0; q < 4; q++) vInterpW[i * 4 + q] /= ws;
  });
  // block neighbours: either side in the row, and every block of the rows above and below whose azimuth span overlaps
  const bN: number[][] = Array.from({ length: blockCount }, () => []);
  const overlaps = (a0: number, a1: number, b0: number, b1: number) => {
    for (const sh of [-1, 0, 1]) if (b0 + sh < a1 && b1 + sh > a0) return true;
    return false;
  };
  for (let br = 0; br < nbRows; br++) for (let bc = 0; bc < rowCols[br]; bc++) {
    const bb = bidx(br, bc);
    if (!hasB[bb]) continue;
    const add = (q: number) => { if (hasB[q] && q !== bb && !bN[bb].includes(q)) bN[bb].push(q); };
    add(bidx(br, bc - 1)); add(bidx(br, bc + 1));
    const a0 = bc / rowCols[br], a1 = (bc + 1) / rowCols[br];
    for (const rr of [br - 1, br + 1]) {
      if (rr < 0 || rr >= nbRows) continue;
      for (let qc = 0; qc < rowCols[rr]; qc++) if (overlaps(a0, a1, qc / rowCols[rr], (qc + 1) / rowCols[rr])) add(bidx(rr, qc));
    }
  }
  const bAdjStart = new Int32Array(blockCount + 1);
  for (let b = 0; b < blockCount; b++) bAdjStart[b + 1] = bAdjStart[b] + bN[b].length;
  const bAdjIdx = new Int32Array(bAdjStart[blockCount]);
  bN.forEach((l, b) => l.forEach((q, j) => { bAdjIdx[bAdjStart[b] + j] = q; }));
  const restHeight = new Float32Array(V);
  vCell.forEach((k, i) => { restHeight[i] = mm[k] / 1000; });
  const mass: HairMass = {
    restHeight, edgeW, followShare: o.followShare ?? 0.5, followSmooth: o.followSmooth ?? 8, adjStart, adjIdx, offA: new Float32Array(V * 3), offB: new Float32Array(V * 3),
    vBlock, vInterpB, vInterpW, blockCount, bAdjStart, bAdjIdx, bA: new Float32Array(blockCount * 3), bB: new Float32Array(blockCount * 3), bN: new Float32Array(blockCount),
    vertexCount: V, rest, geometry, positions, normals, headNormals, tangents, restHeadNormals: headNormals.slice(), restTangents: tangents.slice(), bindNode, bindW, bindCount: K, nodesPerLock, restNodes,
    grid: { cols, rows, azStep, phiStep, mask, mm },
    stats: {
      cells: N, maskCells: vCell.filter((k) => k >= 0).length, triangles: tris.length / 3,
      meanMm: vCell.reduce((s, k) => s + (k >= 0 ? mm[k] : 0), 0) / Math.max(1, V), maxMm: Math.max(0, ...Array.from(mm)), boundLocks: boundLocks.size,
    },
  };
  computeMassNormals(mass);
  return mass;
}

const _turnM = new THREE.Matrix4();
const _idQ = new THREE.Quaternion();

/** Area-weighted vertex normals, oriented away from the head centre. */
export function computeMassNormals(m: HairMass): void {
  const P = m.positions, Nn = m.normals, I = m.geometry.index!.array as ArrayLike<number>;
  Nn.fill(0);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    Nn[a] += nx; Nn[a + 1] += ny; Nn[a + 2] += nz;
    Nn[b] += nx; Nn[b + 1] += ny; Nn[b + 2] += nz;
    Nn[c] += nx; Nn[c + 1] += ny; Nn[c + 2] += nz;
  }
  for (let i = 0; i < m.vertexCount; i++) {
    let x = Nn[i * 3], y = Nn[i * 3 + 1], z = Nn[i * 3 + 2];
    // outward: same side as the head normal
    if (x * m.headNormals[i * 3] + y * m.headNormals[i * 3 + 1] + z * m.headNormals[i * 3 + 2] < 0) { x = -x; y = -y; z = -z; }
    // half toward the head normal: the mass stands for a volume of hair over the head, so it is lit by the head's form;
    // its feathered roll-off at the edge (a device to hide the edge) would otherwise face down and read as a black band
    // Toward the outline it turns all the way to the head normal, so the edge is lit like the scalp it lies on and shows
    // no lighting step even where the colours match (Neon's review, Nov 25).
    let l = Math.hypot(x, y, z) || 1;
    const w = m.edgeW ? m.edgeW[i] : 0, keep = 1 - w, toward = 1 + w;
    x = (x / l) * keep + m.headNormals[i * 3] * toward; y = (y / l) * keep + m.headNormals[i * 3 + 1] * toward; z = (z / l) * keep + m.headNormals[i * 3 + 2] * toward;
    l = Math.hypot(x, y, z) || 1;
    Nn[i * 3] = x / l; Nn[i * 3 + 1] = y / l; Nn[i * 3 + 2] = z / l;
  }
  m.geometry.attributes.position.needsUpdate = true;
  m.geometry.attributes.normal.needsUpdate = true;
}

/**
 * Moves the mass with the hair: each vertex = its rest position + the weighted displacement of its bound lock nodes
 * (nodesLocal: current node positions in head-pivot space, 3 per node, same layout as restNodes). With a head pose, the
 * geometry is written in world space like the lock geometry (positions, normals, head normals and tangents turned by
 * the head); without one it stays in head-pivot space. Returns the largest relative edge stretch, for the deformation audit.
 */
export function deformHairMass(m: HairMass, nodesLocal: Float32Array, headQuat?: THREE.Quaternion, headPos?: THREE.Vector3, measure = false): number {
  const K = m.bindCount, R = m.restNodes, P = m.positions, S = m.rest, V = m.vertexCount;
  let A = m.offA, B = m.offB;
  // raw follow: weighted displacement of the bound nodes
  for (let i = 0; i < V; i++) {
    let dx = 0, dy = 0, dz = 0;
    for (let j = 0; j < K; j++) {
      const g = m.bindNode[i * K + j];
      if (g < 0) continue;
      const w = m.bindW[i * K + j];
      dx += w * (nodesLocal[g * 3] - R[g * 3]); dy += w * (nodesLocal[g * 3 + 1] - R[g * 3 + 1]); dz += w * (nodesLocal[g * 3 + 2] - R[g * 3 + 2]);
    }
    A[i * 3] = dx; A[i * 3 + 1] = dy; A[i * 3 + 2] = dz;
  }
  // Neighbouring vertices can be bound to different locks that swing apart; following each raw would tear the sheet.
  // So: average the offsets into coarse blocks, smooth the blocks, interpolate back to the vertices, limit each to its
  // share of the vertex height, then smooth twice on the vertices so the limit (which changes with the height) leaves no
  // step.
  let CA = m.bA, CB = m.bB;
  const nb = m.blockCount;
  CA.fill(0); m.bN.fill(0);
  for (let i = 0; i < V; i++) { const b = m.vBlock[i]; CA[b * 3] += A[i * 3]; CA[b * 3 + 1] += A[i * 3 + 1]; CA[b * 3 + 2] += A[i * 3 + 2]; m.bN[b]++; }
  for (let b = 0; b < nb; b++) if (m.bN[b]) { CA[b * 3] /= m.bN[b]; CA[b * 3 + 1] /= m.bN[b]; CA[b * 3 + 2] /= m.bN[b]; }
  for (let pass = 0; pass < m.followSmooth; pass++) {
    for (let b = 0; b < nb; b++) {
      const s0 = m.bAdjStart[b], s1 = m.bAdjStart[b + 1], n = s1 - s0;
      if (!m.bN[b] || !n) { CB[b * 3] = CA[b * 3]; CB[b * 3 + 1] = CA[b * 3 + 1]; CB[b * 3 + 2] = CA[b * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (let j = s0; j < s1; j++) { const q = m.bAdjIdx[j] * 3; x += CA[q]; y += CA[q + 1]; z += CA[q + 2]; }
      CB[b * 3] = 0.5 * CA[b * 3] + 0.5 * x / n; CB[b * 3 + 1] = 0.5 * CA[b * 3 + 1] + 0.5 * y / n; CB[b * 3 + 2] = 0.5 * CA[b * 3 + 2] + 0.5 * z / n;
    }
    const t = CA; CA = CB; CB = t;
  }
  for (let i = 0; i < V; i++) {
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < 4; j++) { const w = m.vInterpW[i * 4 + j]; if (!w) continue; const q = m.vInterpB[i * 4 + j] * 3; x += w * CA[q]; y += w * CA[q + 1]; z += w * CA[q + 2]; }
    A[i * 3] = x; A[i * 3 + 1] = y; A[i * 3 + 2] = z;
  }
  const smooth = (passes: number) => {
    for (let pass = 0; pass < passes; pass++) {
      for (let i = 0; i < V; i++) {
        const s0 = m.adjStart[i], s1 = m.adjStart[i + 1];
        let x = 0, y = 0, z = 0;
        for (let j = s0; j < s1; j++) { const q = m.adjIdx[j] * 3; x += A[q]; y += A[q + 1]; z += A[q + 2]; }
        const n = s1 - s0;
        if (!n) { B[i * 3] = A[i * 3]; B[i * 3 + 1] = A[i * 3 + 1]; B[i * 3 + 2] = A[i * 3 + 2]; continue; }
        B[i * 3] = 0.5 * A[i * 3] + 0.5 * x / n; B[i * 3 + 1] = 0.5 * A[i * 3 + 1] + 0.5 * y / n; B[i * 3 + 2] = 0.5 * A[i * 3 + 2] + 0.5 * z / n;
      }
      const t = A; A = B; B = t;
    }
  };
  for (let i = 0; i < V; i++) {
    const lim = m.followShare * m.restHeight[i];
    const l = Math.hypot(A[i * 3], A[i * 3 + 1], A[i * 3 + 2]);
    if (l > lim) { const f = lim / l; A[i * 3] *= f; A[i * 3 + 1] *= f; A[i * 3 + 2] *= f; }
  }
  smooth(2);
  for (let i = 0; i < V * 3; i++) P[i] = S[i] + A[i];
  // the stretch audit walks every edge, so only when asked (the preview's pose check), not every frame in the app
  const stretch = measure ? massStretch(m) : 0;
  // rotation as a 3x3 matrix (cheaper per vertex than applyQuaternion)
  const e = _turnM.makeRotationFromQuaternion(headQuat ?? _idQ).elements;
  const tx = headPos?.x ?? 0, ty = headPos?.y ?? 0, tz = headPos?.z ?? 0;
  const turn = (src: Float32Array, dst: Float32Array, move: boolean) => {
    const ox = move ? tx : 0, oy = move ? ty : 0, oz = move ? tz : 0;
    for (let i = 0; i < V * 3; i += 3) {
      const x = src[i], y = src[i + 1], z = src[i + 2];
      dst[i] = e[0] * x + e[4] * y + e[8] * z + ox;
      dst[i + 1] = e[1] * x + e[5] * y + e[9] * z + oy;
      dst[i + 2] = e[2] * x + e[6] * y + e[10] * z + oz;
    }
  };
  if (headQuat || headPos) {
    turn(P, P, true);
    turn(m.restHeadNormals, m.headNormals, false);
    turn(m.restTangents, m.tangents, false);
    m.geometry.attributes.aHeadNormal.needsUpdate = true;
    m.geometry.attributes.aHairTangent.needsUpdate = true;
  }
  computeMassNormals(m);
  return stretch;
}

/** Largest relative change of any edge length from the rest mesh (0.1 = 10% longer or shorter). */
export function massStretch(m: HairMass): number {
  const P = m.positions, S = m.rest, I = m.geometry.index!.array as ArrayLike<number>;
  let worst = 0;
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = I[t + e] * 3, b = I[t + ((e + 1) % 3)] * 3;
    const l0 = Math.hypot(S[a] - S[b], S[a + 1] - S[b + 1], S[a + 2] - S[b + 2]);
    if (l0 < 1e-6) continue;
    const l1 = Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]);
    // relative to at least 2 mm: the crown cap's first ring has sub-millimetre edges, where a tenth of a millimetre reads
    // as tens of percent yet nothing shows; stretch is a visual audit
    worst = Math.max(worst, Math.abs(l1 - l0) / Math.max(l0, 0.002));
  }
  return worst;
}
