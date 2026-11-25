// ---- Hair shell: the outer shape of a hairstyle as an editable thickness grid over the scalp ----
// A style's archetype builds its locks; the shell then says how high the hair surface should stand above the scalp in
// each direction, and moves every lock node in or out (along the ray from the head centre) so the outer surface meets it.
// It is plain JSON in the recipe (builder.shell), so a person can drag it in the web generator and an AI can read and
// write it directly: rows are angles down from the crown, columns are angles around from the front, values are mm.
//
// Units: scene millimetres above the scalp ellipsoid, the same scale as the conform clearance (1 ellipsoid radius
// ~= 295 mm in the web scene). Read the numbers against a capture (captureHairShell) of the style as built: a cell that
// says 40 where the capture says 25 makes the hair there 1.6 times as thick.
//
// The shell only reshapes; it never adds hair where there is none (a cell over bare scalp has nothing to move). It runs in
// the builder, before the head conform, so the exported locks carry the result and Unity needs nothing new.
import * as THREE from 'three';
import type { HairShellGrid } from '../types/hair';
import { scalpAngles } from './scalpPaint';

const HC = new THREE.Vector3(0, 0.425, -0.01); // HEAD_CENTER_LOCAL
const RX = 0.282, RY = 0.318, RZ = 0.31; // SCALP_RX/RY/RZ
/** Scene mm per ellipsoid radius unit (as headConformClearance). */
export const SHELL_MM_PER_UNIT = 295;
export const DEFAULT_SHELL_AZ_DEG = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180];
export const DEFAULT_SHELL_PHI_DEG = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135];
const DEG = Math.PI / 180;

interface ShellPoints { pointsLocal: THREE.Vector3[]; isFadeCap?: boolean }

/** Index and blend of v in an ascending axis (clamped to the ends). */
function axisPos(axis: number[], v: number): [number, number, number] {
  if (v <= axis[0]) return [0, 0, 0];
  const n = axis.length - 1;
  if (v >= axis[n]) return [n, n, 0];
  let i = 0;
  while (i < n - 1 && v > axis[i + 1]) i++;
  return [i, i + 1, (v - axis[i]) / Math.max(1e-6, axis[i + 1] - axis[i])];
}

/** Column coordinate (degrees) of a signed azimuth for a grid: |az| when mirrored, else signed -180..180. */
function colDeg(g: Pick<HairShellGrid, 'mirror'>, az: number): number {
  return g.mirror === false ? az / DEG : Math.abs(az) / DEG;
}

/** Bilinear sample of a grid of numbers or nulls; null corners take `fallback`. */
function sampleGrid(azDeg: number[], phiDeg: number[], mm: (number | null)[][], ad: number, pd: number, fallback: number | null): number | null {
  const [a0, a1, ta] = axisPos(azDeg, ad);
  const [p0, p1, tp] = axisPos(phiDeg, pd);
  const v = (p: number, a: number) => { const x = mm[p]?.[a]; return x === null || x === undefined || !isFinite(x) ? fallback : x; };
  const c = [v(p0, a0), v(p0, a1), v(p1, a0), v(p1, a1)];
  if (c.some((x) => x === null)) return null;
  const [c00, c01, c10, c11] = c as number[];
  return (c00 * (1 - ta) + c01 * ta) * (1 - tp) + (c10 * (1 - ta) + c11 * ta) * tp;
}

/** Height above the scalp of a node, in mm, and its scalp angles. */
function nodeHeight(p: THREE.Vector3) {
  const s = scalpAngles(p.x, p.y, p.z);
  return { az: s.az, phi: s.phi, mm: (s.r - 1) * SHELL_MM_PER_UNIT, r: s.r };
}

/**
 * The outer hair height (mm above the scalp) at every grid node, measured on built locks: within a small disc around
 * the node (0.6 of the grid spacing there), the height most locks reach (75th percentile of each lock's highest point). null where no hair reaches. Fade caps (stubble) are left
 * out. Each lock segment is sampled at a few in-between points, so long straight segments still count.
 */
export function captureHairShell(specs: ShellPoints[], azDeg = DEFAULT_SHELL_AZ_DEG, phiDeg = DEFAULT_SHELL_PHI_DEG, mirror = true): HairShellGrid {
  const step = (axis: number[], i: number) => Math.max(axis[i] - (axis[i - 1] ?? axis[i]), (axis[i + 1] ?? axis[i]) - axis[i]) || 10;
  // each node gathers the hair within a disc on the scalp sphere: 0.6 of the larger grid spacing there (columns close in
  // toward the crown, so the disc is measured in true angle, and every column of the crown row sees the same disc)
  const nodes: { i: number; j: number; ph: number; cp: number; sp: number; az: number; cr: number; rad: number; lockMax: number[] }[] = [];
  phiDeg.forEach((ph, i) => azDeg.forEach((a, j) => {
    const rad = 0.6 * Math.max(step(phiDeg, i), step(azDeg, j) * Math.sin(ph * DEG), 3) * DEG;
    nodes.push({ i, j, ph: ph * DEG, cp: Math.cos(ph * DEG), sp: Math.sin(ph * DEG), az: a * DEG, cr: Math.cos(rad), rad, lockMax: [] });
  }));
  const tmp = new THREE.Vector3();
  const lockBest = new Float32Array(nodes.length);
  const visit = (p: THREE.Vector3) => {
    const h = nodeHeight(p);
    if (h.mm <= 0) return;
    const az = mirror ? Math.abs(h.az) : h.az, cp = Math.cos(h.phi), sp = Math.sin(h.phi);
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (Math.abs(h.phi - n.ph) > n.rad) continue;
      if (cp * n.cp + sp * n.sp * Math.cos(az - n.az) < n.cr) continue;
      if (h.mm > lockBest[k]) lockBest[k] = h.mm;
    }
  };
  for (const s of specs) {
    if (s.isFadeCap) continue;
    lockBest.fill(0);
    const pts = s.pointsLocal;
    for (let k = 0; k < pts.length; k++) {
      visit(pts[k]);
      if (k + 1 < pts.length) for (let q = 1; q < 3; q++) visit(tmp.copy(pts[k]).lerp(pts[k + 1], q / 3));
    }
    for (let k = 0; k < nodes.length; k++) if (lockBest[k] > 0) nodes[k].lockMax.push(lockBest[k]);
  }
  // the surface is where most locks reach, not the odd spike tip above it (tips taper and fray to nothing on screen):
  // the 75th percentile of each lock's highest point in the disc
  const mm = phiDeg.map(() => azDeg.map((): number | null => null));
  for (const n of nodes) {
    if (!n.lockMax.length) continue;
    const v = n.lockMax.sort((a, b) => a - b)[Math.floor((n.lockMax.length - 1) * 0.75)];
    mm[n.i][n.j] = Math.round(v * 2) / 2;
  }
  return { azDeg: azDeg.slice(), phiDeg: phiDeg.slice(), mm, mirror };
}

/**
 * Moves lock nodes in or out so the hair's outer surface meets the shell. Each node's height above the scalp is scaled by
 * target / current (current = captureHairShell of the same locks), blended by `strength`, so every lock keeps its own
 * layering under the surface and its root stays on the scalp. Cells set to null, and directions past the last row (with a
 * 12 degree fade), are left as built. Returns the capture of the result.
 */
export function applyHairShell(specs: ShellPoints[], shell: HairShellGrid, passes = 3): HairShellGrid {
  // a lock spans several cells and each cell's surface is a percentile of many locks, so one pass lands short of the
  // target; a few passes, each measuring again, close most of the gap
  for (let i = 0; i < passes; i++) applyShellPass(specs, shell);
  return captureHairShell(specs, shell.azDeg, shell.phiDeg, shell.mirror !== false);
}

function applyShellPass(specs: ShellPoints[], shell: HairShellGrid): void {
  const cur = captureHairShell(specs, shell.azDeg, shell.phiDeg, shell.mirror !== false);
  const strength = THREE.MathUtils.clamp(shell.strength ?? 1, 0, 1);
  const lastPhi = shell.phiDeg[shell.phiDeg.length - 1];
  for (const s of specs) {
    if (s.isFadeCap) continue;
    for (const p of s.pointsLocal) {
      const h = nodeHeight(p);
      if (h.mm <= 0) continue;
      const ad = colDeg(shell, h.az), pd = h.phi / DEG;
      const fade = 1 - THREE.MathUtils.clamp((pd - lastPhi) / 12, 0, 1);
      if (fade <= 0) continue;
      const c = sampleGrid(cur.azDeg, cur.phiDeg, cur.mm, ad, pd, null);
      if (c === null || c < 0.5) continue;
      const t = sampleGrid(shell.azDeg, shell.phiDeg, shell.mm, ad, pd, c); // null target cells keep the current height
      if (t === null) continue;
      const k = THREE.MathUtils.clamp(t / c, 0.2, 4);
      const kk = 1 + (k - 1) * strength * fade;
      const r2 = 1 + (h.r - 1) * kk;
      const f = r2 / h.r;
      p.set(HC.x + (p.x - HC.x) * f, HC.y + (p.y - HC.y) * f, HC.z + (p.z - HC.z) * f);
    }
  }
}

/** Point (web head-pivot space) on the shell surface: `mm` above the scalp ellipsoid in direction (az, phi). */
export function shellSurfacePoint(az: number, phi: number, mm: number): THREE.Vector3 {
  const r = 1 + mm / SHELL_MM_PER_UNIT;
  const sp = Math.sin(phi);
  return new THREE.Vector3(HC.x + Math.sin(az) * sp * RX * r, HC.y + Math.cos(phi) * RY * r, HC.z + Math.cos(az) * sp * RZ * r);
}

/** Target shell height (mm) at a signed azimuth and phi (radians), or null where the grid leaves the hair as built. */
export function sampleHairShell(shell: HairShellGrid, az: number, phi: number): number | null {
  return sampleGrid(shell.azDeg, shell.phiDeg, shell.mm, colDeg(shell, az), phi / DEG, null);
}

/** The grid as compact JSON, one row of the table per line (easy to read and edit by hand or by an AI). */
export function hairShellJson(g: HairShellGrid): string {
  const row = (r: (number | null)[]) => '[' + r.map((v) => (v === null || v === undefined ? 'null' : String(v))).join(', ') + ']';
  return [
    '{',
    `  "azDeg": ${row(g.azDeg)},`,
    `  "phiDeg": ${row(g.phiDeg)},`,
    `  "mirror": ${g.mirror !== false},`,
    `  "strength": ${g.strength ?? 1},`,
    '  "mm": [',
    g.mm.map((r) => '    ' + row(r)).join(',\n'),
    '  ]',
    '}',
  ].join('\n') + '\n';
}

/** The grid as a fixed-width text table (rows = phi from the crown, columns = azimuth from the front), for logs and AI. */
export function formatHairShell(g: HairShellGrid, label = 'shell mm'): string {
  const w = 6;
  const pad = (s: string) => s.padStart(w);
  const head = `${label.padEnd(10)}` + g.azDeg.map((a) => pad(`az${a}`)).join('');
  const rows = g.phiDeg.map((p, i) => `${`phi${p}`.padEnd(10)}` + g.azDeg.map((_, j) => { const v = g.mm[i]?.[j]; return pad(v === null || v === undefined ? '-' : String(Math.round(v * 10) / 10)); }).join(''));
  return [head, ...rows].join('\n');
}

/**
 * The shell as polylines along its rows (constant phi) and columns (constant azimuth), both sides when mirrored, in web
 * head-pivot space: what the preview renderer and the web viewport draw. `place` can move each point (e.g. the head
 * conform, so the lines sit on a character's skull as the hair does). Cells left null break the lines.
 */
export function hairShellPolylines(g: HairShellGrid, place?: (p: THREE.Vector3) => void, stepDeg = 1.5): THREE.Vector3[][] {
  const out: THREE.Vector3[][] = [];
  const at = (az: number, phi: number) => {
    const mm = sampleHairShell(g, az * DEG, phi * DEG);
    if (mm === null) return null;
    const p = shellSurfacePoint(az * DEG, phi * DEG, mm);
    place?.(p);
    return p;
  };
  const runs = (pts: (THREE.Vector3 | null)[]) => {
    let cur: THREE.Vector3[] = [];
    for (const q of pts) { if (q) cur.push(q); else { if (cur.length > 1) out.push(cur); cur = []; } }
    if (cur.length > 1) out.push(cur);
  };
  const mir = g.mirror !== false;
  const azMax = Math.max(...g.azDeg), azMin = mir ? -azMax : Math.min(...g.azDeg);
  const phMax = Math.max(...g.phiDeg);
  for (const ph of g.phiDeg) {
    if (ph <= 0) continue;
    const pts: (THREE.Vector3 | null)[] = [];
    for (let a = azMin; a <= azMax + 1e-6; a += stepDeg) pts.push(at(a, ph));
    runs(pts);
  }
  const cols = mir ? [...g.azDeg, ...g.azDeg.filter((a) => a > 0 && a < 180).map((a) => -a)] : g.azDeg;
  for (const a of cols) {
    const pts: (THREE.Vector3 | null)[] = [];
    for (let ph = 0; ph <= phMax + 1e-6; ph += stepDeg) pts.push(at(a, ph));
    runs(pts);
  }
  return out;
}
