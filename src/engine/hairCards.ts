// ---- Edge and tip cards: the hybrid pipeline's fine strands (hybrid plan, phase 1 prototype) ----
// A few thin, alpha-cut strand cards that split off the outer locks at the silhouette and run a little past their tips,
// so the outline breaks into separate strands the way modern game hair does, instead of ending on each lock's solid
// leaf. They use the baked strand strip (cardBake.ts, PR #5) through the normal lock path (card mask 1: the strand alpha
// cuts the tip from t 0.58), so they need no new shader.
//
// Each card is a lock spec: it starts at its parent's root and follows the parent, drifting sideways and slightly outward
// along its length, so it moves with the parent under the solver and never floats free of it. Cards are appended after
// every other spec, so the seeded per-lock variation of the existing locks is unchanged.
import * as THREE from 'three';
import type { LockBuildSpec } from './hairBuilder';
import { scalpAngles } from './scalpPaint';

const HC = new THREE.Vector3(0, 0.425, -0.01);

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sstep = (e0: number, e1: number, x: number) => { const c = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return c * c * (3 - 2 * c); };

export interface EdgeCardOptions {
  /** How many cards. */
  count: number;
  seed?: number;
  /** Card width as a share of the parent lock's width. 0.3: a few strands wide, so the baked strip reads as separate
   *  strands rather than a narrow copy of the lock. */
  widthShare?: number;
  /** How far past the parent's tip a card runs, as a share of the parent's length. */
  overshoot?: number;
}

/** Point at arc-length share s (0 root, 1 tip, >1 continues straight on from the last segment) along a polyline. */
function along(pts: THREE.Vector3[], s: number, out: THREE.Vector3): THREE.Vector3 {
  const seg: number[] = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const L = seg[seg.length - 1], d = s * L;
  if (d >= L) {
    const n = pts.length - 1;
    const dir = out.subVectors(pts[n], pts[n - 1]).normalize();
    return dir.multiplyScalar(d - L).add(pts[n]);
  }
  let i = 1;
  while (i < seg.length - 1 && seg[i] < d) i++;
  const f = (d - seg[i - 1]) / Math.max(1e-9, seg[i] - seg[i - 1]);
  return out.copy(pts[i - 1]).lerp(pts[i], f);
}

/**
 * Picks the outer locks whose tips make the silhouette (farthest from the head centre, so the cards land where the eye
 * reads the outline) and returns the cards' specs. Parents are spread around the head: the candidates are sorted by
 * azimuth and taken at even steps, so the cards do not bunch on one side. Deterministic for a seed.
 */
export function edgeCardSpecs(specs: LockBuildSpec[], o: EdgeCardOptions): LockBuildSpec[] {
  if (o.count <= 0) return [];
  const rnd = mulberry32((o.seed ?? 1) * 7919 + 17);
  const widthShare = o.widthShare ?? 0.3, overshoot = o.overshoot ?? 0.1;
  const cand = specs
    .map((s, i) => ({ s, i, tip: s.pointsLocal[s.pointsLocal.length - 1] }))
    .filter(({ s }) => !s.isBaseShell && !s.isFadeCap && !s.rigid && s.pointsLocal.length >= 4 && s.layerOrder >= 2)
    .map((c) => ({ ...c, r: scalpAngles(c.tip.x, c.tip.y, c.tip.z).r, az: scalpAngles(c.tip.x, c.tip.y, c.tip.z).az }));
  if (!cand.length) return [];
  // the outer half by tip distance: those tips are the outline
  cand.sort((a, b) => b.r - a.r || a.i - b.i);
  const outer = cand.slice(0, Math.max(o.count, Math.ceil(cand.length / 2)));
  outer.sort((a, b) => a.az - b.az || a.i - b.i);
  const out: LockBuildSpec[] = [];
  const p = new THREE.Vector3(), q = new THREE.Vector3(), side = new THREE.Vector3(), rad = new THREE.Vector3();
  for (let k = 0; k < o.count; k++) {
    const pick = outer[Math.min(outer.length - 1, Math.floor(((k + rnd() * 0.8) / o.count) * outer.length))];
    const par = pick.s, pts = par.pointsLocal, n = pts.length;
    const dir = rnd() < 0.5 ? -1 : 1;
    const drift = (0.45 + 0.5 * rnd()) * par.width * dir;
    const lift = 0.002 + 0.004 * rnd();
    const len = 1 + overshoot * (0.4 + 0.6 * rnd());
    const cardPts: THREE.Vector3[] = [];
    for (let j = 0; j < n; j++) {
      const s = (j / (n - 1)) * len;
      along(pts, Math.min(s, len), p);
      // sideways = across the lock (its direction x the outward ray from the head centre)
      along(pts, Math.min(len, s + 0.04), q);
      rad.subVectors(p, HC).normalize();
      side.subVectors(q, p).cross(rad).normalize();
      if (!isFinite(side.x)) side.set(1, 0, 0);
      const t = j / (n - 1);
      cardPts.push(p.clone().addScaledVector(side, drift * sstep(0.25, 1, t)).addScaledVector(rad, lift * sstep(0.15, 1, t)));
    }
    out.push({
      pointsLocal: cardPts,
      width: par.width * widthShare,
      thickness: par.thickness * 0.35,
      stiffnessBias: par.stiffnessBias,
      layerAO: Math.min(1, par.layerAO + 0.05),
      layerOrder: 4,
      lockNormal: par.lockNormal,
      scalpRoot: par.scalpRoot,
      smooth: Math.max(par.smooth ?? 1, 2),
      // a long, gentle taper: the card is all strand, no body
      tipStart: 0.3,
      tipWidth: 0,
      colorRange: par.colorRange,
    });
  }
  return out;
}
