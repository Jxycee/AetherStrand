import * as THREE from 'three';
import { applyHairlineLook, deriveScalpPaint, makeScalpPaint, sampleArr, ScalpPaint } from './scalpPaint';
import {
  HairBuilderArchetype,
  HairBuilderConfig,
  HairPresetId,
  PhysicsConfig,
  ShaderConfig,
} from '../types/hair';

export interface LockBuildSpec {
  pointsLocal: THREE.Vector3[];
  width: number;
  thickness: number;
  stiffnessBias: number;
  layerAO: number;
  layerOrder: number; // 0 = baseShell, 1 = inner nape/underlayer, 2 = mid sides/back, 3 = outer crown/bangs, 4 = accent spikes/flyaways
  customOutDir?: THREE.Vector3;
  isBaseShell?: boolean;
  lockNormal?: boolean;
  scalpRoot?: number;
  /** Neon round 11: short-fade / stubble cap. Flat ribbon taper (no pointy tips) + shader stipple dissolve toward the skin line (vertex alpha 0.25). */
  isFadeCap?: boolean;
  /** 0..1: where along the ribbon a fade cap starts to dissolve (default curve starts at 0.25). */
  fadeStart?: number;
  /** Shared fix 3: mesh-only smoothing. Integer 1..4: Catmull-Rom resamples the 12 solver nodes into (N-2)*smooth+1 rings (default 1 = legacy mesh). */
  smooth?: number;
  /** 0..1: blends ribbon thickness toward its width for a rounder, tube-like cross-section (default 0). */
  roundness?: number;
  /** 0.2..0.97: where the end taper starts along the lock (default 0.44). Later = fuller to the end. Mesh-only. */
  tipStart?: number;
  /** 0..0.9: share of width/thickness held through the end, closed with a short rounded cap (locs, blunt cuts). 0 = pointed tip. Mesh-only. */
  tipWidth?: number;
  /** 0..0.45: periodic width/thickness bumps along the lock (locs, rope twists, braid sections). Use smooth 3-4. Mesh-only. */
  ripple?: number;
  /** Bumps along the lock for ripple (default 9). */
  rippleFreq?: number;
  /**
   * [from, to] in 0..1: the part of the root -> base -> tip colour gradient this lock shows (default [0, 1]). A short lock
   * in a cropped field is a piece of longer hair, so [0.1, 0.65] keeps every tip from lighting up and dotting the surface.
   */
  colorRange?: [number, number];
  /**
   * Close-cut hair: keeps this exact shape and follows the head rigidly (no rest-pose bake, no live physics). Use for short,
   * densely layered hair (crops, fades); the bake pushes overlapping locks apart and crumples them into knots and flakes.
   */
  rigid?: boolean;
}

export interface CuratedHairPalette {
  id: string;
  label: string;
  shader: ShaderConfig;
}

export interface ArchetypeMeta {
  id: HairBuilderArchetype;
  label: string;
  inspiration: string;
}

export interface RandomizedHairstyleResult {
  name: string;
  paletteLabel: string;
  basePreset: HairPresetId;
  builder: HairBuilderConfig;
  shader: ShaderConfig;
  physics: Omit<PhysicsConfig, 'showColliders' | 'showBones'>;
}

const HEAD_CENTER_LOCAL = new THREE.Vector3(0, 0.425, -0.01);
const SCALP_RX = 0.282;
const SCALP_RY = 0.318;
const SCALP_RZ = 0.31;
const NODES_PER_LOCK = 12;

export const ARCHETYPE_METADATA: ArchetypeMeta[] = [
  { id: 'noble-hime', label: 'Noble Hime', inspiration: 'Aristocratic sleek straight + blunt bangs' },
  { id: 'layered-shag', label: 'Layered Shag', inspiration: 'Squall / Leon' },
  { id: 'spiky-hero', label: 'SOLDIER Spikes', inspiration: 'Cloud / Zack' },
  { id: 'long-cascade', label: 'Silky Cascade', inspiration: 'Sephiroth' },
  { id: 'wolf-cut', label: 'Crown Wolf-Cut', inspiration: 'Noctis / Vincent' },
  { id: 'sleek-bob', label: 'Sleek Blade Bob', inspiration: '2B / Yuna' },
  { id: 'asym-cascade', label: 'Valkyrie Asym', inspiration: 'Lightning' },
  { id: 'dolphin-long', label: 'Dolphin-Tail', inspiration: 'Tifa' },
  { id: 'ribbon-halfup', label: 'Half-Up Cascade', inspiration: 'Aerith / Jill' },
  { id: 'swept-back', label: 'Swept-Back', inspiration: 'Clive / Vergil' },
  { id: 'high-ponytail', label: 'Battle Ponytail', inspiration: 'Yuna X-2 / Fang' },
  { id: 'twin-tails', label: 'Dual Twin-Tails', inspiration: 'JRPG Twin Cascade' },
  { id: 'emo-sweep', label: 'Side-Swept Fringe', inspiration: 'Riku / Dante' },
  { id: 'short-crop', label: 'Short Crop', inspiration: 'Veteran / Soldier crop' },
  { id: 'messy-mage', label: 'Messy Mage', inspiration: 'Young mage tousled medium shag' },
  { id: 'elder-scholar', label: 'Elder Scholar', inspiration: 'Balding crown + swept sides tied low' },
  { id: 'low-side-ponytail', label: 'Low Side Ponytail', inspiration: 'Long hair gathered low over one shoulder' },
  { id: 'mohawk-warrior', label: 'Mohawk Warrior', inspiration: 'Shaved stubble sides + tall central ridge' },
  { id: 'twin-buns', label: 'Twin Buns', inspiration: 'High symmetrical buns with center part' },
  { id: 'pixie-cut', label: 'Pixie Cut', inspiration: 'Short layered crop with side-swept fringe' },
  { id: 'undercut-fade', label: 'Undercut Fade', inspiration: 'Rogue / mercenary shaved sides' },
  { id: 'braided-crown', label: 'Braided Crown', inspiration: 'Fantasy healer / noble braids' },
  { id: 'wavy-bard', label: 'Wavy Bard', inspiration: 'Healer / bard loose shoulder waves' },
  { id: 'samurai-topknot', label: 'Samurai Topknot', inspiration: 'Ronin / warrior high bun' },
  { id: 'curtain-part', label: 'Curtain Part', inspiration: 'Centre-parted curtain fringe, idol / young swordsman' },
  { id: 'rope-locs', label: 'Rope Locs', inspiration: 'Wanderer / druid shoulder-length locs' },
  { id: 'coily-afro', label: 'Coily Crown', inspiration: 'Rounded coily afro, monk / brawler' },
];

export const ALL_ARCHETYPES: HairBuilderArchetype[] = ARCHETYPE_METADATA.map((a) => a.id);

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function skullSurfacePoint(theta: number, phi: number, lift = 0): THREE.Vector3 {
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  return new THREE.Vector3(
    HEAD_CENTER_LOCAL.x + Math.sin(theta) * sinPhi * (SCALP_RX + lift),
    HEAD_CENTER_LOCAL.y + cosPhi * (SCALP_RY + lift),
    HEAD_CENTER_LOCAL.z + Math.cos(theta) * sinPhi * (SCALP_RZ + lift)
  );
}

// ---- Shared ear-aligned cut line (SHARED FIX 1) ----
// Ear landmarks in web scalp coords (theta = |azimuth| from front, phi from crown apex). They are live values: each build
// sets them from config.earLandmarks (the loaded character head's measured ears, measureHeadLandmarks in
// characterHead.ts), or the defaults, so every cut line, sideburn and fade follows the ears of the head the hair is for.
// Defaults: Tobin_Head.obj measured 2026-11-24 with the pinna detector (an earlier hand measurement put the ear about
// 0.2 rad too far back, which put sideburns on the ear and pulled the temple corners back).
export const DEFAULT_EAR_LANDMARKS = { earFrontTheta: 1.43, earBackTheta: 1.78, earCenterTheta: 1.66, earTopPhi: 1.68, earMidPhi: 1.94, earLobePhi: 2.16 };
export let EAR_FRONT_THETA = DEFAULT_EAR_LANDMARKS.earFrontTheta;
export let EAR_BACK_THETA = DEFAULT_EAR_LANDMARKS.earBackTheta;
export let EAR_CENTER_THETA = DEFAULT_EAR_LANDMARKS.earCenterTheta;
export let EAR_TOP_PHI = DEFAULT_EAR_LANDMARKS.earTopPhi;
export let EAR_MID_PHI = DEFAULT_EAR_LANDMARKS.earMidPhi;
export let EAR_LOBE_PHI = DEFAULT_EAR_LANDMARKS.earLobePhi;

/** Sets the ears every cut line uses (call before building; undefined restores the defaults). */
export function setEarLandmarks(l?: HairBuilderConfig['earLandmarks'] | null): void {
  const d = DEFAULT_EAR_LANDMARKS;
  const ok = (v: unknown, lo: number, hi: number) => typeof v === 'number' && isFinite(v) && v > lo && v < hi;
  const use = !!l && ok(l.earFrontTheta, 1, 2.4) && ok(l.earBackTheta, 1, 2.6) && ok(l.earTopPhi, 1.2, 2.4) && ok(l.earLobePhi, 1.5, 2.8) && l.earBackTheta > l.earFrontTheta && l.earLobePhi > l.earTopPhi;
  EAR_FRONT_THETA = use ? l!.earFrontTheta : d.earFrontTheta;
  EAR_BACK_THETA = use ? l!.earBackTheta : d.earBackTheta;
  EAR_CENTER_THETA = use && ok(l!.earCenterTheta, 1, 2.6) ? l!.earCenterTheta : (EAR_FRONT_THETA + EAR_BACK_THETA) / 2;
  EAR_TOP_PHI = use ? l!.earTopPhi : d.earTopPhi;
  EAR_LOBE_PHI = use ? l!.earLobePhi : d.earLobePhi;
  EAR_MID_PHI = use && ok(l!.earMidPhi, 1.3, 2.7) ? l!.earMidPhi : (EAR_TOP_PHI + EAR_LOBE_PHI) / 2;
}

export interface EarCutOptions {
  /** 0..1: sideburn tip from just above the ear top (0) to the lobe bottom (1). Default 0.6 (below mid-ear). May exceed 1 (fade caps dissolve before their nominal end). */
  sideburnLength?: number;
  /** Azimuth gap (rad) between the sideburn tip and the ear front edge. Default 0.08. */
  sideburnGap?: number;
  /** Azimuth span (rad) of the pointed descent from the temple to the sideburn tip. Default 0.40. */
  sideburnTaper?: number;
  /** phi clearance kept above the ear top by the arch. Default 0.07. */
  earClearance?: number;
  /** phi of the cut at the nape centre (theta = pi). Default 2.10. */
  napePhi?: number;
  /** Nape curve exponent (>1 keeps the sides high behind the ear, drops towards the centre). Default 1.3. */
  napeCurve?: number;
  /** phi of the cut just behind the ear (default arch + 0.10). */
  behindEarPhi?: number;
  /** Front hairline phi (number) or function of |theta|. Default 1.28. */
  hairlinePhi?: number | ((a: number) => number);
  /** Extra recession (phi decrease) of the temple corner. Default 0.10. */
  templeRecede?: number;
}

const _ss = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

/** Sideburn tip (azimuth, phi) for the options: the tip sits in front of the ear at mid/lower ear height. */
export function earSideburnTip(o: EarCutOptions = {}): { theta: number; phi: number } {
  const len = o.sideburnLength ?? 0.6;
  return {
    theta: EAR_FRONT_THETA - (o.sideburnGap ?? 0.08),
    phi: EAR_TOP_PHI + 0.02 + len * (EAR_LOBE_PHI - 0.06 - (EAR_TOP_PHI + 0.02)),
  };
}

/** phi where the side/back cut line ends at azimuth theta: temple hairline -> pointed sideburn in front of the ear -> arch over the ear -> drop behind it to the nape curve. */
export function earAlignedCutPhi(theta: number, o: EarCutOptions = {}): number {
  const a = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta)));
  const hl = o.hairlinePhi ?? 1.28;
  const hair = (x: number) => (typeof hl === 'number' ? hl : hl(x));
  const recede = o.templeRecede ?? 0.10;
  const temple = (x: number) => hair(x) - recede * _ss((x - 0.55) / 0.4) * (1 - _ss((x - 1.0) / 0.35));
  const tip = earSideburnTip(o);
  const taper = o.sideburnTaper ?? 0.40;
  const a0 = tip.theta - taper;
  const clear = o.earClearance ?? 0.07;
  const arch = (x: number) => EAR_TOP_PHI - clear + 0.05 * Math.pow(Math.min(1.5, Math.abs(x - EAR_CENTER_THETA) / 0.2), 2);
  const rise = 0.07;
  const eb = EAR_BACK_THETA + 0.03;
  if (a <= a0) return temple(a);
  if (a <= tip.theta) return THREE.MathUtils.lerp(temple(a0), tip.phi, Math.pow((a - a0) / taper, 1.8));
  if (a <= tip.theta + rise) return THREE.MathUtils.lerp(tip.phi, arch(tip.theta + rise), _ss((a - tip.theta) / rise));
  if (a <= eb) return arch(a);
  const behind = o.behindEarPhi ?? arch(eb) + 0.10;
  const napePhi = o.napePhi ?? 2.10;
  const t = _ss((a - eb) / (Math.PI - eb));
  const f = Math.pow(t, o.napeCurve ?? 1.3);
  const start = arch(eb) + (behind - arch(eb)) * _ss((a - eb) / 0.12);
  return THREE.MathUtils.lerp(start, napePhi, f);
}

/** Pointed sideburn lock group (both sides): narrow tapered locks from the temple hairline down in front of the ear, longest at the tip azimuth. */
export function sideburnLocks(specs: LockBuildSpec[], o: EarCutOptions & { count?: number; width?: number; layerOrder?: number; baseLift?: number; isFadeCap?: boolean; rootPhi?: number } = {}): void {
  const tip = earSideburnTip(o);
  const n = o.count ?? 7;
  const span = 0.14;
  for (const sd of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 1 : i / (n - 1); // 0 = front/outer edge, 1 = tip azimuth
      const th = sd * (tip.theta - span * (1 - u));
      const endPhi = THREE.MathUtils.lerp(tip.phi - 0.34, tip.phi, Math.pow(u, 0.8));
      const startPhi = o.rootPhi ?? Math.min(1.2, endPhi - 0.45);
      const pts = buildSculptedLock({ thetaStart: th, thetaEnd: th, phiStart: startPhi, phiEnd: endPhi, baseLift: o.baseLift ?? 0.004, midArch: 0.0, tipFlickOut: 0.0, napeHug: 1.4 });
      specs.push({ pointsLocal: pts, width: (o.width ?? 0.022) * (0.7 + 0.3 * u), thickness: 0.006, stiffnessBias: 0.97, layerAO: 0.9, layerOrder: o.layerOrder ?? 3, isFadeCap: o.isFadeCap, lockNormal: false, scalpRoot: 0.4 });
    }
  }
}

// ---- Shared textured top (short crops, undercuts, fades) ----
/** Point on the scalp dome from its top-down projection (x, z in head-pivot space) lifted by `lift`; the projection is clamped to r^2 <= maxR2. */
export function domePoint(x: number, z: number, lift: number, maxR2 = 0.88): THREE.Vector3 {
  const nx = x / SCALP_RX, nz = z / SCALP_RZ;
  const r2 = nx * nx + nz * nz;
  const k = r2 > maxR2 ? Math.sqrt(maxR2 / r2) : 1.0;
  const cx = nx * k, cz = nz * k;
  const cy = Math.sqrt(Math.max(0.04, 1.0 - cx * cx - cz * cz));
  return new THREE.Vector3(HEAD_CENTER_LOCAL.x + cx * (SCALP_RX + lift), HEAD_CENTER_LOCAL.y + cy * (SCALP_RY + lift), HEAD_CENTER_LOCAL.z + cz * (SCALP_RZ + lift));
}

export interface TexturedTopOptions {
  /** Crown whorl (x, z) the hair grows away from. Default [0.02, -0.15]. */
  whorl?: [number, number];
  /** -1..1: front flow swings to web -X / +X. Default 0. */
  sweep?: number;
  /** 0..1: how much the front half flows straight forward instead of radially from the whorl. Default 0.8. */
  forward?: number;
  /** Lock length (projected, head-pivot units) at the crown and at the front. Defaults 0.13 / 0.2. */
  lenCrown?: number;
  lenFront?: number;
  /** 0..1 overall volume (how far the locks stand off the scalp). Default 0.5. */
  lift?: number;
  /** 0..1: how much the tips kick up into spikes. Default 0.5. */
  spike?: number;
  /** Clump spacing (projected units). Default 0.065. */
  spacing?: number;
  /** Root area: ellipse half-axes in x and z (projected). Defaults 0.235 / 0.275. */
  extentX?: number;
  extentZ?: number;
  /** Tips stop inside this projected dome radius^2, +-0.05 per clump (keeps the top from flaring over the sides). Default 0.86. */
  reach?: number;
  /** Extra reach^2 at the front centre so the front edge meets the hairline. Default 0.14. */
  frontReach?: number;
  /** Base lock width. Default 0.028. */
  width?: number;
  /**
   * 0..1: front quiff. Front clumps that flow toward the face stand off the forehead instead of following it down, so
   * the front lifts up and forward (textured crops, fades) rather than hanging as a fringe. Default 0.
   */
  quiff?: number;
  /**
   * Drape: phi (polar angle from the crown, by signed azimuth) where clumps flowing back or sideways end. When set, those
   * clumps follow the skull past the dome edge and lie down over the sides and back to this line, so the top layers into
   * painted sides (fades, undercuts) instead of ending on a ledge. Clumps flowing toward the face still stop at `reach`.
   * Unset = every clump stops at `reach` (the old behaviour).
   */
  endPhi?: (az: number) => number;
  /** 0..1: extra length for draping clumps so roots near the crown can reach `endPhi`. Default 0.6. */
  drapeLength?: number;
  /**
   * With `endPhi`: how far past it (rad) front clumps may run. They start at the hairline and the quiff stands them up,
   * so a positive value lets the front edge grow from the hairline itself. Default -0.08 (stop just above it).
   */
  frontOver?: number;
  /**
   * Front hairline row: phi of the hairline by signed azimuth. When set, short locks root along it across the forehead and
   * temples (|az| < 1.1) and rise up off the skin with their tips leaning forward, so the front edge of a crop grows from
   * the hairline instead of leaving a bare painted strip under the top's tips.
   */
  hairlineRow?: (az: number) => number;
  /**
   * 0..1: front swept up and back. Clumps rooted near the front hairline flow back toward the crown (with the sweep) and
   * lift off the forehead at the root, so the front reads as a hairline rising up and back with a little lift, not a
   * fringe. 0 = every clump follows the whorl flow (fringe-like front). Default 0.
   */
  frontBack?: number;
  /** Clump size: scales spacing, clump width and lock spread together. >1 = fewer, larger swept clumps. Default 1. */
  clumpScale?: number;
  /** Length scale of the flat swirl of short locks that covers the crown whorl (0 = none). Default 1. */
  whorlCap?: number;
  seed?: number;
  wMul?: number;
}

/**
 * Textured top: pointed clumps that grow from the crown whorl and flow forward (short crops, undercuts, fades, messy tops).
 * Two layers: an under layer (shorter, flatter, layerOrder 2) fills the scalp; the outer layer (layerOrder 3) carries the texture.
 * Each clump is 2-3 locks whose roots spread across the flow and whose tips converge on one point, so the surface
 * reads as separate spikes rather than a helmet. Lengths grow from the crown to the front, lift grows toward the tips.
 */
export function texturedTopLocks(specs: LockBuildSpec[], o: TexturedTopOptions = {}): void {
  let st = ((o.seed ?? 1337) >>> 0) || 1;
  const rnd = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
  const [wx, wz] = o.whorl ?? [0.02, -0.15];
  const sweep = o.sweep ?? 0, fwdK = o.forward ?? 0.8;
  const ex = o.extentX ?? 0.235, ez = o.extentZ ?? 0.275;
  const cS = o.clumpScale ?? 1;
  const sp = (o.spacing ?? 0.065) * cS;
  const frontBackK = o.frontBack ?? 0;
  const back = new THREE.Vector2(sweep * 0.45, -1).normalize();
  // front zone for frontBack: from about a third of the way back from the front edge of the root area to the hairline
  const frontZone = (z: number) => _ss((z - (wz + 0.04)) / Math.max(0.05, ez * 0.75 - (wz + 0.04)));
  // where front clumps stop: just above the hairline (hairlineRow) or the drape line, never on the forehead
  const frontLimit = (az: number) => (o.hairlineRow ? o.hairlineRow(az) : o.endPhi ? o.endPhi(az) : 1.3) + (o.frontOver ?? -0.08);
  const reach = o.reach ?? 0.86;
  const lift = o.lift ?? 0.5, spike = o.spike ?? 0.5;
  const wMul = o.wMul ?? 1;
  const fwd = new THREE.Vector2(sweep * 0.35, 1).normalize();
  const frontness = (z: number) => _ss((z - (wz - 0.02)) / 0.2);
  const flow = (x: number, z: number): THREE.Vector2 => {
    const rad = new THREE.Vector2(x - wx, z - wz);
    const d = rad.length();
    if (d < 1e-4) return fwd.clone();
    rad.divideScalar(d);
    const k = fwdK * frontness(z) * _ss(d / 0.05);
    return rad.lerp(fwd, k).normalize();
  };
  // the front edge may run further down (to the hairline) than the sides, which stay inside `reach`
  const inside = (x: number, z: number, jit = 0) => (x / SCALP_RX) ** 2 + (z / SCALP_RZ) ** 2 <= reach + jit + (o.frontReach ?? 0.14) * _ss(z / SCALP_RZ / 0.8) * Math.max(0, 1 - Math.abs(x) / 0.2);
  for (let layer = 0; layer < 2; layer++) {
    const s = layer === 0 ? sp : sp * 0.9;
    for (let zc = -ez; zc <= ez; zc += s) {
      for (let xc = -ex; xc <= ex; xc += s) {
        const x0 = xc + (rnd() - 0.5) * s * 1.1 + (layer ? s * 0.5 : 0);
        const z0 = zc + (rnd() - 0.5) * s * 1.1 + (layer ? s * 0.45 : 0);
        if ((x0 / ex) ** 2 + (z0 / ez) ** 2 > 1) continue;
        const fz = _ss((z0 + ez) / (2 * ez));
        const outer = layer === 0;
        let len = THREE.MathUtils.lerp(o.lenCrown ?? 0.13, o.lenFront ?? 0.2, fz) * (0.6 + 0.8 * rnd()) * (outer ? 1 : 0.7);
        // march the clump centre line over the unit scalp ellipsoid (u = direction, |u| = 1; x = u.x * RX, z = u.z * RZ is
        // the old top-down projection). The top-down flow is projected onto the surface, so a clump flowing out past the
        // dome edge turns down the side or back by itself.
        const uOf = (x: number, z: number) => { const nx = x / SCALP_RX, nz = z / SCALP_RZ; return new THREE.Vector3(nx, Math.sqrt(Math.max(0.0016, 1 - nx * nx - nz * nz)), nz).normalize(); };
        // `down` adds a pull toward the floor: below the dome edge a level flow would project back upward, so draping clumps
        // are pulled down the side or back instead
        const tangentToward = (u: THREE.Vector3, dx: number, dz: number, down = 0) => {
          const d = new THREE.Vector3(dx / SCALP_RX, 0, dz / SCALP_RZ).normalize();
          d.y -= down;
          d.addScaledVector(u, -d.dot(u));
          if (d.lengthSq() < 1e-10) d.set(0, -1, 0).addScaledVector(u, u.y);
          return d.normalize();
        };
        // frontBack: a clump rooted in the front zone flows back toward the crown (fixed per clump, so it doesn't turn round)
        const fb = frontBackK * frontZone(z0);
        const flowC = (x: number, z: number) => {
          if (fb <= 0) return flow(x, z);
          const f = flow(x, z).lerp(back, Math.min(1, fb * 1.3));
          return f.lengthSq() < 1e-6 ? back.clone() : f.normalize();
        };
        const d0 = flowC(x0, z0);
        const fwdness = _ss((d0.y + 0.2) / 0.9); // 1 when the clump flows toward the face, 0 when it flows back or sideways
        const drapes = !!o.endPhi && fwdness < 0.5 && fb < 0.3;
        if (drapes) len *= 1 + (o.drapeLength ?? 0.6) * (1 - 2 * fwdness);
        const path: THREE.Vector3[] = [uOf(x0, z0)];
        const jit = (rnd() - 0.5) * 0.1; // ragged edge: clumps stop at different heights
        const steps = 8;
        const arc = len / steps / 0.3; // step as an angle on the unit scalp (~0.3 m radius)
        for (let k = 1; k <= steps; k++) {
          const u = path[k - 1];
          const d = flowC(u.x * SCALP_RX, u.z * SCALP_RZ);
          const q = u.clone().addScaledVector(tangentToward(u, d.x, d.y, drapes ? 2.5 * _ss((0.65 - u.y) / 0.65) : 0), arc).normalize();
          if (drapes) {
            const az = Math.atan2(q.x, q.z), phi = Math.acos(THREE.MathUtils.clamp(q.y, -1, 1));
            if (phi > o.endPhi!(az) + jit * 0.6) break;
            // over the forehead a clump never drapes: it stops above the hairline like a front clump
            if (Math.abs(az) < 0.95 && phi > frontLimit(az) + jit * 0.3) break;
          } else if (o.endPhi) {
            // with a drape line set, front clumps also run to just above it, so the front hair grows from the hairline
            // (the quiff stands it up) instead of leaving a bare painted strip under the tips
            const az = Math.atan2(q.x, q.z), phi = Math.acos(THREE.MathUtils.clamp(q.y, -1, 1));
            if (phi > frontLimit(az) + jit * 0.3) break;
          } else if (q.y < 0.17 || !inside(q.x * SCALP_RX, q.z * SCALP_RZ, jit)) break;
          path.push(q);
        }
        // a clump cut shorter than it is wide renders as a curled blob, so drop it (the scalp paint covers there)
        if (path.length < 3 || (path.length - 1) * arc * 0.3 < 0.04) continue;
        const at = (t: number) => {
          const f = t * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f));
          return path[i].clone().lerp(path[i + 1], f - i).normalize();
        };
        const perp2 = new THREE.Vector2(-d0.y, d0.x);
        const nL = 2 + Math.floor(rnd() * 2);
        // clumps flowing back lie flatter, draping ones flatter still; front clumps swept back (fb) lift off the forehead
        const liftAmt = (0.008 + 0.035 * lift) * (0.75 + 0.5 * rnd()) * (0.55 + 0.45 * fz) * (outer ? 1 : 0.55) * Math.max(drapes ? 0.3 + 0.7 * fwdness : 0.45 + 0.55 * fwdness, 1.3 * fb);
        const upK = Math.max(fwdness * fz, fb); // how much the lift is steered upward (front stands up, not out)
        const surf = (u: THREE.Vector3, l: number) => new THREE.Vector3(HEAD_CENTER_LOCAL.x + u.x * (SCALP_RX + l), HEAD_CENTER_LOCAL.y + u.y * (SCALP_RY + l), HEAD_CENTER_LOCAL.z + u.z * (SCALP_RZ + l));
        for (let k = 0; k < nL; k++) {
          const off = (((k - (nL - 1) / 2) / Math.max(1, nL - 1)) * 0.03 + (rnd() - 0.5) * 0.006) * cS;
          const reachT = 1 - 0.2 * Math.abs(off) / (0.015 * cS); // centre locks run furthest: pointed clump
          const pts: THREE.Vector3[] = [];
          // quiff: where the surface drops away in front, the lock keeps its height (stands off the forehead)
          const qK = (o.quiff ?? 0) * fwdness * _ss((fz - 0.45) / 0.4) * (outer ? 1 : 0.6);
          const yRoot = surf(path[0], 0).y;
          for (let n = 0; n < NODES_PER_LOCK; n++) {
            const t = n / (NODES_PER_LOCK - 1);
            const c = at(t * reachT);
            const spread = off * (1 - 0.75 * Math.pow(t, 1.5)); // tips gather but stay apart: a clump, not a cone
            // lift rises near the root, then the lock lies along the surface (a smooth layered top, not shingles); spikes kick only at the tip
            // where the clump flows forward the tip stays up (lift and spike); where it flows back or down the sides it settles
            // back onto the skull, so the top melts into the sides instead of ending in a ledge
            const settle = (1 - fwdness) * (1 - fb) * (drapes ? _ss((t - 0.2) / 0.5) : _ss((t - 0.45) / 0.55));
            const lh = 0.006 + liftAmt * Math.sqrt(t) * (1 - 0.85 * settle) + (outer ? spike * 0.04 * Math.pow(t, 3) * (0.35 + 0.65 * fz) * Math.max(fwdness, fb) : 0);
            // spread across the flow, kept on the surface
            const side = tangentToward(c, perp2.x, perp2.y);
            const u = c.clone().addScaledVector(side, spread / 0.3).normalize();
            const base = surf(u, 0);
            // lift goes along the scalp normal, but toward the front it is steered upward so the front stands up, not out
            const dir = surf(u, 1).sub(base).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.65 * upK).normalize();
            const p = base.clone().addScaledVector(dir, lh);
            // quiff: give back the height the forehead drops away, plus a little rise, so the front stands up rather than out
            if (qK > 0) p.y += qK * (Math.max(0, yRoot - base.y) * 0.9 + 0.012 * Math.sin(Math.PI * Math.min(1, t * 1.2)));
            pts.push(p);
          }
          specs.push({
            pointsLocal: pts, width: ((o.width ?? 0.028) + rnd() * 0.01) * cS * wMul * (outer ? 1 : 1.3), thickness: 0.006,
            // draping clumps taper over a longer tip so the top thins out into the painted sides instead of ending on a ledge
            stiffnessBias: 0.96, layerAO: outer ? 0.8 + rnd() * 0.2 : 0.7, layerOrder: outer ? 3 : 2, smooth: 2, tipStart: drapes ? 0.4 : 0.62,
            lockNormal: false, scalpRoot: 0.55,
          });
        }
      }
    }
  }
  // front hairline row: pointed clumps rising off the hairline (see hairlineRow). Each clump is 2-3 locks rooted side by
  // side along the hairline whose tips gather to a point, with strongly varied heights, so the front edge reads as hair
  // rising in spikes from a natural hairline rather than an even band of strands.
  if (o.hairlineRow) {
    const azMax = 1.1, step = 0.085 * cS;
    for (let azc = -azMax; azc <= azMax + 1e-6; azc += step * (0.8 + 0.4 * rnd())) {
      const edge = 1 - _ss((Math.abs(azc) - 0.55) / 0.55); // shorter and flatter toward the temples
      const L = (0.04 + 0.06 * rnd()) * (0.55 + 0.45 * edge);
      const rise = (0.014 + 0.024 * lift) * (0.45 + 0.55 * edge) * (0.5 + 0.9 * rnd());
      const tipAz = azc + sweep * 0.1 + (rnd() - 0.5) * 0.04;
      const nL = 2 + Math.floor(rnd() * 2);
      for (let k = 0; k < nL; k++) {
        const fk = nL === 1 ? 0 : k / (nL - 1) - 0.5;
        const az0 = azc + fk * step * 0.9;
        const ph0 = o.hairlineRow(az0) - 0.008 - rnd() * 0.02;
        const pts: THREE.Vector3[] = [];
        for (let n = 0; n < NODES_PER_LOCK; n++) {
          const t = n / (NODES_PER_LOCK - 1);
          // up the head along the surface, lifting off it, tips gathering on the clump's tip azimuth
          const ph = ph0 - (L / 0.3) * t;
          const a = THREE.MathUtils.lerp(az0, tipAz, Math.pow(t, 1.4));
          const base = skullSurfacePoint(a, ph, 0);
          const nrm = skullSurfacePoint(a, ph, 1).sub(base).normalize();
          const up = nrm.clone().lerp(new THREE.Vector3(0, 1, 0), 0.4 * edge).normalize();
          const p = base.addScaledVector(up, 0.004 + rise * Math.sin(Math.PI * 0.5 * Math.min(1, t * 1.2)));
          p.z += 0.01 * edge * Math.pow(t, 2) * (1 - frontBackK); // swept-back fronts don't lean forward
          pts.push(p);
        }
        specs.push({
          pointsLocal: pts, width: (0.022 + rnd() * 0.008) * cS * wMul, thickness: 0.005, stiffnessBias: 0.97, layerAO: 0.9 + rnd() * 0.1,
          layerOrder: 3, smooth: 2, tipStart: 0.45, lockNormal: false, scalpRoot: 0.6,
        });
      }
    }
  }
  // whorl cap: short locks lying flat in a small swirl over the whorl, so the crown doesn't open into a bald spot where
  // every clump grows away from the same point
  {
    const nCap = 9, swirl = 0.6;
    for (let i = 0; i < nCap; i++) {
      const a = (i / nCap) * Math.PI * 2 + rnd() * 0.4;
      const r0 = 0.004 + rnd() * 0.01;
      const x0 = wx + Math.sin(a) * r0, z0 = wz + Math.cos(a) * r0;
      const dx = Math.sin(a + swirl), dz = Math.cos(a + swirl);
      const L = (0.045 + rnd() * 0.025) * (o.whorlCap ?? 1);
      if (L <= 0.005) break;
      const pts: THREE.Vector3[] = [];
      for (let n = 0; n < NODES_PER_LOCK; n++) {
        const t = n / (NODES_PER_LOCK - 1);
        // curve the lock round the whorl as it goes out
        const bend = swirl * 0.8 * t;
        const cx = x0 + (dx * Math.cos(bend) + dz * Math.sin(bend)) * L * t, cz = z0 + (dz * Math.cos(bend) - dx * Math.sin(bend)) * L * t;
        pts.push(domePoint(cx, cz, 0.006 + 0.004 * Math.sin(Math.PI * t), 0.97));
      }
      specs.push({
        pointsLocal: pts, width: 0.024 * wMul, thickness: 0.005, stiffnessBias: 0.97, layerAO: 0.85, layerOrder: 3, smooth: 2,
        tipStart: 0.55, lockNormal: false, scalpRoot: 0.6,
      });
    }
  }
}

export interface CropFieldOptions {
  /** phi (polar angle from the crown) by signed azimuth where the modelled hair ends: the painted hairline / top of the fade. */
  hairPhi: (az: number) => number;
  /** How far past `hairPhi` (rad) roots may sit, so the locks overlap the solid paint instead of leaving a seam. Default 0.03. */
  edgeOverlap?: number;
  /** Height of the front quiff, in multiples of `volume`, scaled by `stand`. Default 3. */
  quiff?: number;
  /** 0..1: how much flatter the hair lies down the sides and back than on the top (no bowl read). Default 0.5. */
  sideTaper?: number;
  /**
   * Width (rad) of the band above the side and back edge where the crop melts into the painted fade: the hair surface
   * sinks to the scalp, locks thin out and narrow, so the lock layer ends without a ledge and the paint carries the fade on.
   * 0 turns it off (hard-edged crop). The front hairline is not affected. Default 0.3.
   */
  fadeEdge?: number;
  /** At the front, how far behind the painted hairline (rad) the roots start. Default 0.03. */
  frontInset?: number;
  /** Keep the locks exactly as built, following the head rigidly (default true; see LockBuildSpec.rigid). */
  rigid?: boolean;
  /** Lock length at the top, metres. Locks near the edge run out of room and come out shorter by themselves. Default 0.055. */
  length?: number;
  /** Height of the hair surface above the scalp at the top, metres. It thins to about a third at the edge. Default 0.018. */
  volume?: number;
  /** 0..1: tips kick up off the surface (textured spikes). Default 0.4. */
  spike?: number;
  /** 0..1: the front hairline rises up and back with a little lift (no fringe). Default 0.6. */
  stand?: number;
  /** Crown whorl as [signed azimuth, phi]. Default [PI, 0.45]. */
  whorl?: [number, number];
  /** Size of the crown whorl (rad on the scalp) inside which hair radiates out from it. Default 0.3. */
  whorlRadius?: number;
  /** Swirl round the whorl, radians at the whorl, fading out. Default 0.5. */
  swirl?: number;
  /** -1..1: sideways comb bias (+ = toward +x). Default 0. */
  sweep?: number;
  /** Root spacing of the outer locks, metres (the under layer is 1.35x sparser). Default 0.025. */
  spacing?: number;
  /** Lock width, as a multiple of `spacing`. Default 0.65. */
  clumpWidth?: number;
  /** Spacing of the clump guides, metres. Larger = fewer, larger swept clumps. Default 0.055. */
  clumpSpacing?: number;
  /** 0..1: how strongly lock tips gather onto their clump guide. 0 = an even comb, 1 = tight pointed clumps. Default 0.55. */
  clump?: number;
  /** Part of the colour gradient each lock shows (LockBuildSpec.colorRange). Default [0.12, 0.62] outer, [0.05, 0.4] under. */
  colorRange?: [number, number];
  seed?: number;
  wMul?: number;
}

/**
 * Crop field: a short haircut grown as a field of clumps over the whole haired scalp (short crops, undercut and fade tops,
 * buzz-plus-top styles). Roots are spread evenly over the scalp down to `hairPhi`; every clump follows one flow field on
 * the skull (out from the crown whorl, with the front hairline rising up and back), so the surface reads as a few clear
 * directions instead of a pile of separate flakes. Two layers: a flat under layer for coverage and an outer layer of
 * pointed 2-lock clumps that carries the volume and texture. Hair gets shorter and flatter toward `hairPhi`, so it blends
 * into painted sides (fades) without a ledge.
 */
export function cropFieldLocks(specs: LockBuildSpec[], o: CropFieldOptions): void {
  let st = ((o.seed ?? 4242) >>> 0) || 1;
  const rnd = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
  const wMul = o.wMul ?? 1;
  const overlap = o.edgeOverlap ?? 0.03;
  const L0 = o.length ?? 0.055, V0 = o.volume ?? 0.018, spike = o.spike ?? 0.4, stand = o.stand ?? 0.6;
  const swirl = o.swirl ?? 0.5, sweep = o.sweep ?? 0;
  const uAt = (az: number, phi: number) => new THREE.Vector3(Math.sin(az) * Math.sin(phi), Math.cos(phi), Math.cos(az) * Math.sin(phi));
  const azOf = (u: THREE.Vector3) => Math.atan2(u.x, u.z);
  const phiOf = (u: THREE.Vector3) => Math.acos(THREE.MathUtils.clamp(u.y, -1, 1));
  const surf = (u: THREE.Vector3, l: number) => new THREE.Vector3(HEAD_CENTER_LOCAL.x + u.x * (SCALP_RX + l), HEAD_CENTER_LOCAL.y + u.y * (SCALP_RY + l), HEAD_CENTER_LOCAL.z + u.z * (SCALP_RZ + l));
  const W = uAt(o.whorl?.[0] ?? Math.PI, o.whorl?.[1] ?? 0.45);
  // front pole, far below the hairline (about at the nose), so the hair flows away from it in nearly parallel lines: straight
  // up and back over the top instead of fanning sideways at the front
  const F = uAt(0, o.hairPhi(0) + 0.9);
  // how far (rad) a point is inside the hairline
  const insideHair = (u: THREE.Vector3) => o.hairPhi(azOf(u)) - phiOf(u);
  // tangent direction at u leading away from the point P along the great circle
  const awayFrom = (u: THREE.Vector3, P: THREE.Vector3) => {
    const d = u.clone().multiplyScalar(u.dot(P)).sub(P);
    return d.lengthSq() < 1e-10 ? null : d.normalize();
  };
  // how much a root belongs to the front hairline (rises up and back)
  const frontK = (u: THREE.Vector3) => {
    const az = azOf(u);
    return stand * (1 - _ss((insideHair(u) - 0.03) / 0.3)) * _ss((1.15 - Math.abs(az)) / 0.45);
  };
  // quiff: the hair surface rises toward the front hairline, so the front is pushed up instead of falling as a fringe
  const frontAzK = (az: number) => _ss((1.05 - Math.abs(az)) / 0.45);
  const flowAt = (u: THREE.Vector3, fk: number) => {
    // the head is combed away from the front: up and back over the top, back and down the sides, down the back. Only
    // close to the crown whorl does the hair radiate out from it (with a swirl), as a real crown does.
    let d = awayFrom(u, F) ?? new THREE.Vector3(0, 1, 0);
    const wK = Math.exp(-Math.pow(u.angleTo(W) / (o.whorlRadius ?? 0.3), 2));
    const dw = awayFrom(u, W);
    if (dw && wK > 0.01) d.lerp(dw, wK).normalize();
    const a = swirl * wK;
    if (a !== 0) d = d.clone().multiplyScalar(Math.cos(a)).add(u.clone().cross(d).multiplyScalar(Math.sin(a)));
    if (sweep) { const sx = new THREE.Vector3(1, 0, 0).addScaledVector(u, -u.x); d.addScaledVector(sx, sweep * 0.45); }
    d.addScaledVector(u, -d.dot(u));
    return d.lengthSq() < 1e-10 ? new THREE.Vector3(0, 0, -1) : d.normalize();
  };
  // height of the hair surface above the scalp (m) by position: full on the top, thinning toward the edge and down the
  // sides and back (a crop's sides lie close, so the head doesn't read as a bowl), and rising toward the front hairline
  // (the quiff: the front is pushed up and back instead of falling as a fringe)
  const sideTaper = o.sideTaper ?? 0.5;
  // fade edge: 1 at the side/back edge, 0 from fadeEdge inside it (none along the front hairline)
  const fadeW = o.fadeEdge ?? 0.3;
  const sideEdge = (u: THREE.Vector3) => (fadeW > 0 ? (1 - frontAzK(azOf(u))) * (1 - _ss(insideHair(u) / fadeW)) : 0);
  const hairSurface = (u: THREE.Vector3) => {
    const room = _ss((insideHair(u) + 0.05) / 0.45);
    const side = 1 - sideTaper * _ss((phiOf(u) - 0.85) / 0.45);
    return V0 * (0.3 + 0.7 * room) * side * (1 - 0.9 * sideEdge(u));
  };
  // the quiff's rise (m), straight up and a little back rather than out of the forehead (out reads as a visor)
  const quiffUp = new THREE.Vector3(0, 1, -0.25).normalize();
  // profile: low where the hair leaves the hairline, highest a few centimetres back, then easing into the top, so the front
  // is a ramp of rising hair rather than a wall standing on the forehead
  const quiffAt = (u: THREE.Vector3) => {
    const ih = insideHair(u);
    return V0 * (o.quiff ?? 3) * stand * frontAzK(azOf(u)) * (0.35 + 0.65 * _ss(ih / 0.18)) * (1 - _ss((ih - 0.15) / 0.55));
  };
  const lim = (az: number) => o.hairPhi(az) + overlap + 0.03 + (rnd() - 0.5) * 0.04;
  // march a centre line over the scalp along the flow; it stops at the edge, so nothing runs down into the fade
  const march = (u: THREE.Vector3, len: number, fk: number) => {
    const steps = 8, arc = len / steps / 0.3;
    const path: THREE.Vector3[] = [u];
    for (let k = 1; k <= steps; k++) {
      const p = path[k - 1];
      const q = p.clone().addScaledVector(flowAt(p, fk), arc).normalize();
      if (phiOf(q) > lim(azOf(q))) break;
      path.push(q);
    }
    return path;
  };
  const pathAt = (path: THREE.Vector3[], t: number) => {
    const f = t * (path.length - 1), j = Math.min(path.length - 2, Math.floor(f));
    return path[j].clone().lerp(path[j + 1], f - j).normalize();
  };
  // even, jittered roots over the haired scalp (Fibonacci points on the unit scalp)
  const roots = (spacing: number, phase: number, keep: (u: THREE.Vector3) => void) => {
    const s = spacing / 0.3;
    const N = Math.round((4 * Math.PI) / (s * s));
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N;
      if (y < -0.2) break;
      const r = Math.sqrt(Math.max(0, 1 - y * y)), ang = i * golden + phase;
      const u = new THREE.Vector3(r * Math.sin(ang), y, r * Math.cos(ang));
      const jt = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(s * 0.7);
      jt.addScaledVector(u, -jt.dot(u));
      u.add(jt).normalize();
      // at the front the painted hairline is the edge: roots start just behind it, so the forehead shows the paint's soft
      // natural hairline and the hair rises from behind it instead of ending in a row of lock ends
      const az = azOf(u);
      if (phiOf(u) > o.hairPhi(az) + overlap - frontAzK(az) * (overlap + (o.frontInset ?? 0.03))) continue;
      keep(u);
    }
  };
  // clump guides: neighbouring locks pull their tips onto the nearest guide, so the field forms larger swept clumps with
  // pointed ends (and highlights that run along them) while the roots stay evenly spread
  type Guide = { u: THREE.Vector3; path: THREE.Vector3[]; vol: number; spike: number };
  const guides: Guide[] = [];
  roots(o.clumpSpacing ?? 0.055, 0.7, (u) => {
    const fk = frontK(u);
    const path = march(u, L0 * (1 - 0.3 * fk), fk);
    if (path.length < 3) return;
    const topK = _ss((1.0 - phiOf(u)) / 0.6); // spikes only on the top, not the sides
    guides.push({ u, path, vol: 0.9 + 0.2 * rnd(), spike: spike * (0.4 + 1.2 * rnd()) * topK });
  });
  const nearestGuide = (u: THREE.Vector3) => {
    let best: Guide | null = null, bd = -2;
    for (const g of guides) { const d = g.u.dot(u); if (d > bd) { bd = d; best = g; } }
    return best;
  };
  for (let layer = 0; layer < 2; layer++) {
    const outer = layer === 1;
    const spacing = (o.spacing ?? 0.025) * (outer ? 1 : 1.35);
    const clumpK = (o.clump ?? 0.55) * (outer ? 1 : 0.4);
    roots(spacing, layer * 1.3, (u) => {
      const az0 = azOf(u), phi0 = phiOf(u);
      const edgePhi = o.hairPhi(az0);
      const fk = frontK(u);
      // toward the fade the crop thins out (fewer, narrower locks), so the paint under it shows through more and more
      const se = sideEdge(u);
      if (rnd() < 0.55 * se) return;
      const g = nearestGuide(u);
      // the outer layer lies on the hair surface, the under layer below it; a hair's breadth of order between locks
      const layerMul = (outer ? 1 : 0.85) * (g ? g.vol : 1), order = outer ? 0.0015 * rnd() : 0;
      const len = L0 * (0.75 + 0.5 * rnd()) * (outer ? 1 : 0.75) * (1 - 0.3 * fk);
      const path = march(u, len, fk);
      if (path.length < 3) return;
      const realLen = (path.length - 1) * (len / 8);
      const sp = outer && g ? g.spike : 0;
      // closeness to the front hairline (1 on it, 0 from about 6 cm inside)
      const edgeK = frontAzK(az0) * (1 - _ss(insideHair(u) / 0.2));
      const pts: THREE.Vector3[] = [];
      for (let n = 0; n < NODES_PER_LOCK; n++) {
        const t = n / (NODES_PER_LOCK - 1);
        let cu = pathAt(path, t);
        // the tip gathers onto the guide: guide position at the same distance from its root, shifted by this root's offset
        // fading out, so the clump narrows to a point rather than collapsing onto one line
        // (not at the front hairline, where the flow fans out and pulled tips would cross into knots)
        if (g && clumpK > 0 && fk < 0.95) {
          const gt = Math.min(1, (t * realLen) / Math.max(0.01, (g.path.length - 1) * (L0 / 8)));
          const gu = pathAt(g.path, gt);
          cu = cu.lerp(gu, clumpK * (1 - fk) * Math.pow(t, 1.5)).normalize();
        }
        // height: the root climbs out of the scalp in the first quarter, then the lock lies on one smooth hair surface
        // (hairSurface, by position on the head, not by lock). Neighbouring locks then curve the same way at the same
        // place, so highlights run as broad bands across the clumps instead of a dash on every lock; spiked clump
        // tips leave the surface for the textured silhouette
        const rise = _ss(t / 0.25);
        const h = 0.0025 + (hairSurface(cu) * layerMul + order) * rise + sp * 0.02 * Math.pow(t, 3);
        const qh = quiffAt(cu) * layerMul * rise;
        const base = surf(cu, 0);
        const nrm = surf(cu, 1).sub(base).normalize();
        pts.push(base.addScaledVector(nrm, h).addScaledVector(quiffUp, qh));
      }
      specs.push({
        pointsLocal: pts,
        // front hairline locks are seen face on as they rise: a little wider so the front reads full, not as a comb
        width: Math.min(spacing * (o.clumpWidth ?? 0.65) * (1 + 0.4 * fk), realLen * 0.6) * (outer ? 1 : 1.3) * (0.9 + 0.2 * rnd()) * wMul * (1 - 0.45 * se),
        // the under layer is darker, except at the front hairline where it is seen face on beside the outer locks
        // (toward the fade the layers lie flat on the paint: no under-layer shadow, so the edge isn't a dark rim)
        thickness: 0.0025, stiffnessBias: 0.97, layerAO: THREE.MathUtils.lerp(outer ? 0.82 + 0.18 * rnd() : 0.8, 0.95, se), layerOrder: outer ? 3 : 2, smooth: 2,
        tipStart: outer ? 0.5 : 0.6, lockNormal: false,
        // full roots (>= 0.5): narrow ones make every lock a petal pointed at both ends
        // (at the front hairline the hair grows in from a point out of the painted edge, lighter, so the edge isn't a row
        // of dark rounded ends)
        scalpRoot: edgeK > 0.4 ? 0.3 : 0.55,
        // a crop is too short to move, and densely layered: kept exactly as built
        rigid: o.rigid ?? true,
        // each lock is a piece of longer hair: no light tip on every lock (that dots the surface)
        colorRange: o.colorRange ?? (outer || fk > 0.5 || se > 0.35 ? [0.3, 0.68] : [0.08, 0.4]),
      });
    });
  }
}

/**
 * Short side layer: flat, closely cut locks lying down the sides and back from under the top to where the painted fade
 * takes over (`endPhi`, signed azimuth). Gives the upper sides real texture so a textured top blends into a painted fade
 * instead of sitting on it like a cap. The forehead (|az| < 0.75) is skipped.
 */
export function sideLayerLocks(specs: LockBuildSpec[], o: { endPhi: (az: number) => number; topPhi?: number; count?: number; width?: number; seed?: number; wMul?: number; sweepBack?: number }): void {
  let st = ((o.seed ?? 4242) >>> 0) || 1;
  const rnd = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
  const n = o.count ?? 90;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < n; i++) {
      const az = -Math.PI + ((i + 0.5 + row * 0.5) / n) * Math.PI * 2 + (rnd() - 0.5) * 0.02;
      if (Math.abs(az) < 0.75) continue;
      const end = o.endPhi(az) - rnd() * 0.14; // ragged ends: no visible cut line
      const start = (o.topPhi ?? 0.85) + row * 0.12 + (rnd() - 0.5) * 0.05;
      if (end - start < 0.12) continue;
      const back = (o.sweepBack ?? 0.12) * Math.sign(az) * _ss((Math.abs(az) - 0.75) / 0.8) * (1 - _ss((Math.abs(az) - 2.6) / 0.5));
      const pts = buildSculptedLock({ thetaStart: az, thetaEnd: az + back, phiStart: start, phiEnd: end, baseLift: 0.003 - row * 0.001, midArch: 0.001, tipFlickOut: -0.002, napeHug: 1.4 });
      specs.push({ pointsLocal: pts, width: ((o.width ?? 0.04) + rnd() * 0.01) * (o.wMul ?? 1), thickness: 0.004, stiffnessBias: 0.99, layerAO: 0.78 + 0.1 * row, layerOrder: 1 + row, lockNormal: false, scalpRoot: 0.5, tipStart: 0.55, smooth: 2 });
    }
  }
}

export interface FadePaintOptions extends EarCutOptions {
  /** 0..1: fade band height as a share of (cut line at the ear - topPhi). 0 = a short band at the cut line. Default 0.4. */
  fadeHeight?: number;
  /** phi where the side hair begins (top of the side region). Default 1.0. */
  topPhi?: number;
  /** Paint density left at the cut line: 0 fades to skin, ~0.3 leaves visible stubble. Default 0.2. */
  stubble?: number;
  /** Softness of the final cut line (rad). Default 0.05. */
  feather?: number;
  /** Stipple of the partial-density band (0 smooth, 1 strongly dotted). Default 0.6. */
  grain?: number;
  /** 0..1: how much of the sideburn stays solid instead of fading (the fade band shrinks over the sideburn). Default 0.6. */
  sideburnSolid?: number;
  /**
   * Front hairline blend (rad): over the forehead the paint thins from full to its edge density across this band instead
   * of standing solid right up to the hairline, so the front edge is a soft gradient, not a dark painted brim. Default 0.
   */
  frontBlend?: number;
  /**
   * 0..1: fade blend width. Higher = a longer, smoother gradient from full side hair to the cut line and a softer last
   * edge, so the top length melts into the short sides; 0 = a tight band with a crisp edge. Default 0.5.
   */
  blend?: number;
}

/**
 * Painted fade (barber fade / taper) for any short-sided style: solid painted side hair down to the fade, a gradient to
 * `stubble` at the ear-aligned cut line (pointed sideburn in front of the ear, arch over the ear, curved nape), then a soft
 * edge. The front hairline gets no fade. Use it from SCALP_PAINT_BY_ARCHETYPE; it replaces modelled fade-cap locks.
 */
export function fadeScalpPaint(o: FadePaintOptions = {}): ScalpPaint {
  const h = THREE.MathUtils.clamp(o.fadeHeight ?? 0.4, 0, 1);
  const top = o.topPhi ?? 1.0;
  // fade band (rad) measured at the ear arch, kept the same all round so the sideburn and nape fade like the sides
  const archCut = earAlignedCutPhi(EAR_CENTER_THETA, o);
  const bl = THREE.MathUtils.clamp(o.blend ?? 0.5, 0, 1);
  const band = Math.max(0.04, h * (archCut - top) * (0.7 + 0.6 * bl));
  return makeScalpPaint({
    full: (az) => {
      const a = Math.abs(az);
      const cut = earAlignedCutPhi(a, o);
      const sideK = _ss((a - 0.75) / 0.6); // no fade on the forehead
      // over the sideburn (from the start of its taper to just past its tip) the band shrinks so the sideburn reads solid
      const tip = earSideburnTip(o);
      const a0 = tip.theta - (o.sideburnTaper ?? 0.4);
      const sb = _ss((a - a0) / 0.06) * (1 - _ss((a - tip.theta - 0.02) / 0.06));
      return Math.max(top, cut - sideK * band * (1 - (o.sideburnSolid ?? 0.6) * sb) - (1 - sideK) * (o.frontBlend ?? 0));
    },
    edge: (az) => earAlignedCutPhi(Math.abs(az), o),
    edgeDensity: (az) => THREE.MathUtils.lerp(0.55, o.stubble ?? 0.2, _ss((Math.abs(az) - 0.75) / 0.6)),
    feather: (o.feather ?? 0.05) * (0.6 + 0.8 * bl),
    grain: o.grain ?? 0.6,
  });
}

/**
 * Rounded front hairline for EarCutOptions.hairlinePhi: `centre` at the middle of the forehead, rising by `cornerLift`
 * (rad, toward the crown) as it rounds into the temples over `width` (rad of azimuth). Gives the soft curved hairline of
 * most men's cuts instead of a straight edge across the forehead; templeRecede then adds the temple dip.
 */
export function roundedHairline(centre = 1.28, cornerLift = 0.06, width = 0.7): (az: number) => number {
  return (az) => centre - cornerLift * Math.pow(Math.min(1, Math.abs(az) / width), 2);
}

/** Lowest natural hairline (phi by signed azimuth): automatic scalp paint never goes past it onto the face, ears or neck. */
export function naturalMaxHairlinePhi(az: number): number {
  return earAlignedCutPhi(az, { sideburnLength: 0.7, hairlinePhi: 1.3, templeRecede: 0.04, napePhi: 2.2 });
}

/**
 * Per-archetype scalp paint (see scalpPaint.ts). Styles that need painted short hair (fades, stubble sideburns, shaved
 * patterns) register a function here; it receives the automatic contact paint and returns the paint to use.
 */
export const SCALP_PAINT_BY_ARCHETYPE: Partial<Record<HairBuilderArchetype, (ctx: { config: HairBuilderConfig; specs: LockBuildSpec[]; auto: ScalpPaint }) => ScalpPaint>> = {};

/** Cut line of undercut-fade: sideLength sets the sideburn (upper third of the ear by default), backLength how low the nape goes. */
export function undercutFadeCut(config: HairBuilderConfig): EarCutOptions {
  return {
    hairlinePhi: roundedHairline(1.3, 0.1, 0.9), templeRecede: 0.06, sideburnLength: THREE.MathUtils.lerp(0.3, 0.65, config.sideLength), sideburnTaper: 0.3,
    earClearance: 0.03, napePhi: THREE.MathUtils.lerp(2.2, 2.4, config.backLength), napeCurve: 0.8,
  };
}
/** Painted sides of undercut-fade (also where its top hair drapes to). */
export function undercutFadePaint(config: HairBuilderConfig): ScalpPaint {
  // thin tapered sideburn (mostly faded), wide soft blend from the top length into the short sides
  return fadeScalpPaint({ ...undercutFadeCut(config), fadeHeight: config.fadeHeight ?? 0.4, topPhi: 1.0, stubble: 0.3, feather: 0.09, grain: 0.35, sideburnSolid: 0.25, frontBlend: 0.06, blend: config.fadeBlend ?? 0.75 });
}
SCALP_PAINT_BY_ARCHETYPE['undercut-fade'] = ({ config }) => undercutFadePaint(config);

/**
 * Scalp paint for a built style: automatic from the locks' scalp contact, or the archetype's own, then the shared hairline
 * look (config.hairlineSoftness, hairlineIrregularity, scalpColor) so every style gets the same soft, hair-coloured edge.
 */
export function scalpPaintForConfig(config: HairBuilderConfig, specs: LockBuildSpec[]): ScalpPaint {
  setEarLandmarks(config.earLandmarks);
  const auto = deriveScalpPaint(specs, naturalMaxHairlinePhi);
  const f = SCALP_PAINT_BY_ARCHETYPE[config.archetype];
  const base = f ? f({ config, specs, auto }) : auto;
  return applyHairlineLook(base, { softness: config.hairlineSoftness, irregularity: config.hairlineIrregularity, color: config.scalpColor });
}

function buildSculptedLock(params: {
  thetaStart: number;
  thetaEnd: number;
  phiStart: number;
  phiEnd: number;
  baseLift: number;
  midArch: number;
  tipFlickOut: number;
  tipDropExtra?: number;
  sCurveAmp?: number;
  napeHug?: number;
  rootOverride?: THREE.Vector3;
}): THREE.Vector3[] {
  const {
    thetaStart,
    thetaEnd,
    phiStart,
    phiEnd,
    baseLift,
    midArch,
    tipFlickOut,
    tipDropExtra = 0,
    sCurveAmp = 0,
    napeHug = 1.0,
    rootOverride,
  } = params;

  const eqPhi = 1.75;
  const pts: THREE.Vector3[] = [];

  // Anatomically seat rootOverride onto real skull dome without altering thetaStart (prevents cross-head wrap!)
  let seatedRoot: THREE.Vector3 | null = null;
  let effPhiStart = phiStart;
  if (rootOverride) {
    const dx = rootOverride.x - HEAD_CENTER_LOCAL.x;
    const dy = rootOverride.y - HEAD_CENTER_LOCAL.y;
    const dz = rootOverride.z - HEAD_CENTER_LOCAL.z;
    const nx = dx / SCALP_RX;
    const ny = dy / SCALP_RY;
    const nz = dz / SCALP_RZ;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nLen > 0.0001) {
      const ux = nx / nLen;
      const uy = THREE.MathUtils.clamp(ny / nLen, -1, 1);
      const uz = nz / nLen;
      const rPhi = Math.acos(uy);
      const rTheta = Math.atan2(ux, uz);
      const seatLift = THREE.MathUtils.clamp(baseLift * 0.72, 0.006, 0.022);
      seatedRoot = skullSurfacePoint(rTheta, rPhi, seatLift);
      effPhiStart = Math.min(phiEnd - 0.18, Math.max(phiStart, rPhi * 0.94));
    } else {
      seatedRoot = rootOverride.clone();
    }
  }

  for (let i = 0; i < NODES_PER_LOCK; i++) {
    const t = i / (NODES_PER_LOCK - 1);
    const smoothT = t * t * (3 - 2 * t);

    const theta =
      THREE.MathUtils.lerp(thetaStart, thetaEnd, smoothT) +
      Math.sin(t * Math.PI * 1.45) * sCurveAmp;
    const phi = THREE.MathUtils.lerp(effPhiStart, phiEnd, Math.pow(t, 0.94));

    const arch = Math.sin(t * Math.PI) * midArch;
    const rootSink = -0.004 * Math.pow(1.0 - Math.min(1.0, t * 4.5), 2.0);
    const flick = Math.pow(Math.max(0, (t - 0.62) / 0.38), 2.0) * tipFlickOut;
    const lift = baseLift + rootSink + arch + flick;

    let pt: THREE.Vector3;
    if (phi <= eqPhi) {
      pt = skullSurfacePoint(theta, phi, lift);
    } else {
      const eqPt = skullSurfacePoint(theta, eqPhi, baseLift + rootSink + arch);
      const extraPhi = phi - eqPhi;
      const dropDist = extraPhi * 0.325;
      const outX = Math.sin(theta);
      const outZ = Math.cos(theta);
      const isRearFactor = THREE.MathUtils.clamp((-outZ + 0.25) / 1.25, 0, 1);
      const inwardHug =
        napeHug *
        (isRearFactor * Math.min(0.115, extraPhi * 0.095) +
          (1 - isRearFactor) * Math.min(0.055, extraPhi * 0.042));

      pt = new THREE.Vector3(
        eqPt.x + outX * (flick - inwardHug),
        eqPt.y - dropDist,
        eqPt.z + outZ * (flick - inwardHug * (0.85 + 0.35 * isRearFactor))
      );
    }

    if (tipDropExtra !== 0) {
      pt.y -= Math.pow(t, 1.55) * tipDropExtra;
    }

    if (seatedRoot && i < 3) {
      const blend = Math.pow(1 - i / 3, 2.0);
      pt.lerp(seatedRoot, blend);
    }

    pts.push(pt);
  }
  return pts;
}

/**
 * Builds a graceful gathered tail lock (for Battle Ponytail, Dual Twin-Tails, or Half-Up Cascade)
 * rooted directly on the skull surface so rootClearM stays cleanly anchored with zero floating roots!
 */
function buildGatheredTailLock(params: {
  anchorTheta: number;
  anchorPhi: number;
  outDir: THREE.Vector3;
  spreadX: number;
  spreadZ: number;
  length: number;
  archOut: number;
  waveAmp: number;
  wavePhase: number;
}): THREE.Vector3[] {
  const { anchorTheta, anchorPhi, outDir, spreadX, spreadZ, length, archOut, waveAmp, wavePhase } = params;
  const root = skullSurfacePoint(anchorTheta, anchorPhi, 0.015);
  const pts: THREE.Vector3[] = [];
  const normOut = outDir.clone().normalize();

  for (let i = 0; i < NODES_PER_LOCK; i++) {
    const t = i / (NODES_PER_LOCK - 1);
    const bell = Math.sin(Math.min(1, t * 1.5) * Math.PI * 0.65);
    const drop = Math.pow(t, 1.28) * length;
    const outPush = bell * archOut + t * 0.05;
    const fan = Math.sin(t * Math.PI * 0.85);
    const wave = Math.sin(t * Math.PI * 2.1 + wavePhase) * waveAmp * t;

    pts.push(
      new THREE.Vector3(
        root.x + normOut.x * outPush + spreadX * fan + wave,
        root.y + Math.sin(t * Math.PI * 0.55) * (archOut * 0.34) - drop,
        root.z + normOut.z * outPush + spreadZ * fan
      )
    );
  }
  return pts;
}

// ---- Surface-arc + gravity-fall lock helpers (curtain-part, rope-locs, coily-afro) ----
// Locks are laid over the skull along a great-circle arc (root -> release direction), then fall under gravity with
// collision against the bust proxy (head lathe, ears, neck, shoulders; dimensions from bustModel.ts, head-pivot space).

/**
 * Reference haired region of the bust head (phi from the crown apex, by absolute azimuth from the front): 1.28 across the
 * forehead, 1.62 just behind the ear, 2.1 at the nape. The CPU preview paints this region magenta, so a style's shell and
 * edge locks should reach at least this far wherever its cut is meant to cover the head.
 */
export function scalpRegionPhi(azAbs: number): number {
  const a = Math.abs(azAbs);
  return a < 1.0 ? 1.28 : a < 1.9 ? 1.28 + ((a - 1.0) / 0.9) * 0.34 : 1.62 + ((a - 1.9) / (Math.PI - 1.9)) * 0.48;
}

/** Unit direction on the scalp sphere for (theta = azimuth from the front, phi = angle from the crown apex). */
function scalpDir(theta: number, phi: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(theta) * Math.sin(phi), Math.cos(phi), Math.cos(theta) * Math.sin(phi));
}

/** Unit direction in part-centred angles: alpha = sideways from the part plane (0 on the part, +-pi/2 at the ear axis),
 *  beta = along the part (0 apex, + toward the forehead, - toward the back), yaw = part offset around the vertical axis. */
function partDir(alpha: number, beta: number, yaw = 0): THREE.Vector3 {
  const ca = Math.cos(alpha);
  const x = Math.sin(alpha), z = ca * Math.sin(beta);
  return new THREE.Vector3(x * Math.cos(yaw) + z * Math.sin(yaw), ca * Math.cos(beta), -x * Math.sin(yaw) + z * Math.cos(yaw));
}

/** Point on the scalp ellipsoid along a unit direction, `lift` above the surface. */
function scalpDirPoint(dir: THREE.Vector3, lift: number): THREE.Vector3 {
  return new THREE.Vector3(
    HEAD_CENTER_LOCAL.x + dir.x * (SCALP_RX + lift),
    HEAD_CENTER_LOCAL.y + dir.y * (SCALP_RY + lift),
    HEAD_CENTER_LOCAL.z + dir.z * (SCALP_RZ + lift)
  );
}

function slerpDir(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const om = Math.acos(dot);
  if (om < 1e-4) return a.clone().lerp(b, t).normalize();
  const s = Math.sin(om);
  return a.clone().multiplyScalar(Math.sin((1 - t) * om) / s).addScaledVector(b, Math.sin(t * om) / s).normalize();
}

const _lerpProfile = (prof: number[][], y: number): number => {
  if (y <= prof[0][1]) return prof[0][0];
  for (let i = 1; i < prof.length; i++) {
    if (y <= prof[i][1]) {
      const f = (y - prof[i - 1][1]) / Math.max(1e-6, prof[i][1] - prof[i - 1][1]);
      return THREE.MathUtils.lerp(prof[i - 1][0], prof[i][0], f);
    }
  }
  return prof[prof.length - 1][0];
};
// [radius, y] in head-pivot space
const _FACE_PROFILE = [[0.0, 0.0], [0.052, 0.012], [0.122, 0.055], [0.192, 0.135], [0.244, 0.245], [0.272, 0.365], [0.28, 0.48]];
const _CRANIUM_PROFILE = [[0.28, 0.48], [0.264, 0.585], [0.208, 0.672], [0.115, 0.725], [0.0, 0.742]];
const _NECK_PROFILE = [[0.145, -0.21], [0.118, -0.11], [0.112, -0.01], [0.122, 0.09]];
const _TORSO_PROFILE = [[0.41, -0.24], [0.34, -0.175], [0.175, -0.125], [0.145, -0.09]];

/** Push a point out of the bust proxy (scalp ellipsoid, face lathe, ears, neck, shoulders) plus `margin`. Mutates and returns p. */
function clearOfBody(p: THREE.Vector3, margin: number): THREE.Vector3 {
  // skull
  {
    const dx = p.x - HEAD_CENTER_LOCAL.x, dy = p.y - HEAD_CENTER_LOCAL.y, dz = p.z - HEAD_CENTER_LOCAL.z;
    const r = Math.sqrt((dx / (SCALP_RX + margin)) ** 2 + (dy / (SCALP_RY + margin)) ** 2 + (dz / (SCALP_RZ + margin)) ** 2);
    if (r < 1 && p.y > 0.3) {
      p.set(HEAD_CENTER_LOCAL.x + dx / r, HEAD_CENTER_LOCAL.y + dy / r, HEAD_CENTER_LOCAL.z + dz / r);
    }
  }
  const pushRing = (rx: number, rz: number, cz: number) => {
    const dz = p.z - cz;
    const q = Math.sqrt((p.x / (rx + margin)) ** 2 + (dz / (rz + margin)) ** 2);
    if (q < 1 && q > 1e-6) { p.x /= q; p.z = cz + dz / q; }
  };
  if (p.y >= 0 && p.y <= 0.48) { const r = _lerpProfile(_FACE_PROFILE, p.y); pushRing(r * 0.97, r * 1.09, 0); }
  // upper head lathe (its forehead bulges past the scalp ellipsoid): push out radially from the head centre
  for (let it = 0; it < 24 && p.y > 0.48 && p.y < 0.742 + margin; it++) {
    const r = _lerpProfile(_CRANIUM_PROFILE, Math.min(0.742, p.y)) + margin;
    if ((p.x / (r * 0.97)) ** 2 + (p.z / (r * 1.09)) ** 2 >= 1 && p.y < 0.742) break;
    if (p.y >= 0.742) { if (Math.hypot(p.x, p.z) > 0.12 || p.y > 0.742 + margin) break; }
    p.set(p.x * 1.012, 0.42 + (p.y - 0.42) * 1.012, p.z * 1.012);
  }
  if (p.y >= -0.21 && p.y <= 0.09) { const r = _lerpProfile(_NECK_PROFILE, p.y); pushRing(r * 0.96, r * 1.04, -0.032); }
  if (p.y >= -0.4 && p.y <= -0.09) { const r = _lerpProfile(_TORSO_PROFILE, p.y); pushRing(r * 1.12, r * 0.56, -0.032); }
  // ears: short vertical capsule over each ear (bust ear + Tobin ear span)
  for (const sd of [-1, 1]) {
    const cy = THREE.MathUtils.clamp(p.y, 0.2, 0.36);
    const dx = p.x - sd * 0.258, dy = p.y - cy, dz = p.z + 0.03;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rr = 0.052 + margin;
    if (d < rr && d > 1e-6) { const k = rr / d; p.set(sd * 0.258 + dx * k, cy + dy * k, -0.03 + dz * k); }
  }
  return p;
}

/** Great-circle arc over the skull from `from` to `to` (unit dirs), `n` nodes, lift(u) above the scalp. */
function skullArc(from: THREE.Vector3, to: THREE.Vector3, n: number, lift: (u: number) => number, clear = 0.004): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1);
    pts.push(clearOfBody(scalpDirPoint(slerpDir(from, to, u), lift(u)), clear));
  }
  return pts;
}

/** Continue a lock with `count` gravity-fall nodes covering about `len`; `out` is a horizontal unit push, `flare` per step,
 *  `bend` how fast the direction turns downward (0..1), `margin` body clearance, `flick` outward kick on the last nodes. */
function gravityFall(pts: THREE.Vector3[], count: number, len: number, o: { out: THREE.Vector3; flare: number; bend?: number; margin: number; flick?: number; sway?: THREE.Vector3; swayAmp?: number; swayPhase?: number }): THREE.Vector3[] {
  const down = new THREE.Vector3(0, -1, 0);
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2] ?? last.clone().add(new THREE.Vector3(0, 0.01, 0));
  const d = last.clone().sub(prev).normalize();
  const step = len / Math.max(1, count);
  const bend = o.bend ?? 0.42;
  let p = last.clone();
  for (let j = 1; j <= count; j++) {
    const t = j / count;
    d.lerp(down, bend).addScaledVector(o.out, o.flare).normalize();
    p = p.clone().addScaledVector(d, step);
    if (o.flick) p.addScaledVector(o.out, o.flick * Math.max(0, (t - 0.6) / 0.4) ** 2);
    if (o.sway && o.swayAmp) p.addScaledVector(o.sway, Math.sin(t * Math.PI * 1.6 + (o.swayPhase ?? 0)) * o.swayAmp * t);
    clearOfBody(p, o.margin);
    pts.push(p);
  }
  return pts;
}

/** Resample a polyline to `n` points evenly spaced by arc length between fractions [s0, s1] (s1 may exceed 1: extrapolates the last segment). */
/**
 * Nodes for a blunt-ended lock (use with the tipWidth / tipStart spec fields): the mesh's last ring sits on node N-2 and
 * the single tip vertex on node N-1, so nodes 0..N-2 cover the whole path and node N-1 sits just past the end (capLen),
 * giving a short rounded cap instead of a long cone. Path is any polyline from root to end.
 */
export function bluntLockPoints(path: THREE.Vector3[], capLen: number): THREE.Vector3[] {
  const pts = resamplePolyline(densifyPath(path, 6), NODES_PER_LOCK - 1, 0, 1);
  const a = pts[pts.length - 1], b = pts[pts.length - 2];
  const dir = a.clone().sub(b);
  const L = dir.length();
  pts.push(a.clone().addScaledVector(dir, L > 1e-9 ? capLen / L : 0));
  return pts;
}

/**
 * Nodes for a coiled lock (coily / kinky curls, spiral curls, twists): nodes 0..N-2 sit exactly on a helix of `radius`
 * wound `turns` times around the centreline (parallel-transport frame, so the coil never flips), ramping in over the
 * first `rampIn` of the length; node N-1 is a short cap past the end as in bluntLockPoints. 12 nodes resolve about
 * 2.5 turns; use smooth 3-4 and the ripple field for finer kink texture.
 */
export function coilLockPoints(center: THREE.Vector3[], radius: number, turns: number, phase: number, capLen: number, rampIn = 0.2): THREE.Vector3[] {
  const n = NODES_PER_LOCK - 1;
  const fine = resamplePolyline(densifyPath(center, 6), 64, 0, 1);
  const tang = fine.map((p, i) => fine[Math.min(fine.length - 1, i + 1)].clone().sub(fine[Math.max(0, i - 1)]).normalize());
  const ref = Math.abs(tang[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const nrm = [ref.clone().sub(tang[0].clone().multiplyScalar(ref.dot(tang[0]))).normalize()];
  for (let i = 1; i < fine.length; i++) {
    const v = nrm[i - 1].clone().sub(tang[i].clone().multiplyScalar(nrm[i - 1].dot(tang[i])));
    nrm.push(v.lengthSq() > 1e-12 ? v.normalize() : nrm[i - 1].clone());
  }
  const out: THREE.Vector3[] = [];
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    const fi = Math.min(fine.length - 1, Math.round(u * (fine.length - 1)));
    const b = new THREE.Vector3().crossVectors(tang[fi], nrm[fi]);
    const a = phase + u * turns * Math.PI * 2;
    const r = radius * _ss(u / Math.max(1e-3, rampIn));
    out.push(fine[fi].clone().addScaledVector(nrm[fi], Math.cos(a) * r).addScaledVector(b, Math.sin(a) * r));
  }
  const e = out[n - 1], d = e.clone().sub(out[n - 2]);
  const L = d.length();
  out.push(e.clone().addScaledVector(d, L > 1e-9 ? capLen / L : 0));
  return out;
}

function resamplePolyline(src: THREE.Vector3[], n: number, s0 = 0, s1 = 1): THREE.Vector3[] {
  const cum = [0];
  for (let i = 1; i < src.length; i++) cum.push(cum[i - 1] + src[i].distanceTo(src[i - 1]));
  const total = cum[cum.length - 1] || 1;
  const at = (s: number) => {
    const L = s * total;
    let i = 1;
    while (i < src.length - 1 && cum[i] < L) i++;
    const f = (L - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
    return src[i - 1].clone().lerp(src[i], f);
  };
  const out: THREE.Vector3[] = [];
  for (let k = 0; k < n; k++) out.push(at(THREE.MathUtils.lerp(s0, s1, k / (n - 1))));
  return out;
}

/** Densify a 12-node lock path with Catmull-Rom so later resampling follows the curve, not its chords. */
function densifyPath(pts: THREE.Vector3[], per = 6): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  return curve.getPoints(Math.max(2, (pts.length - 1) * per));
}

/** Stylised clumping: greedily groups locks by tip position (within `radius`) and blends each lock's tail toward its
 *  clump's mean path (weight `strength` * t^2 from node `fromNode`), so tapered tips gather into soft points instead of comb teeth. */
function clumpTips(paths: THREE.Vector3[][], radius: number, strength: number, fromNode = 5): void {
  const clusters: { c: THREE.Vector3; members: number[] }[] = [];
  paths.forEach((pts, i) => {
    const tip = pts[pts.length - 1];
    let best = -1, bd = radius;
    clusters.forEach((cl, j) => { const d = cl.c.distanceTo(tip); if (d < bd) { bd = d; best = j; } });
    if (best < 0) clusters.push({ c: tip.clone(), members: [i] });
    else { const cl = clusters[best]; cl.members.push(i); cl.c.multiplyScalar(cl.members.length - 1).add(tip).divideScalar(cl.members.length); }
  });
  for (const cl of clusters) {
    if (cl.members.length < 2) continue;
    const n = paths[cl.members[0]].length;
    const mean: THREE.Vector3[] = [];
    for (let k = 0; k < n; k++) {
      const m = new THREE.Vector3();
      cl.members.forEach((i) => m.add(paths[i][k]));
      mean.push(m.divideScalar(cl.members.length));
    }
    for (const i of cl.members) {
      for (let k = fromNode; k < n; k++) {
        const t = (k - fromNode + 1) / (n - fromNode);
        paths[i][k].lerp(mean[k], strength * t * t);
      }
    }
  }
}

export const CURATED_HAIR_PALETTES: CuratedHairPalette[] = [
  {
    id: 'obsidian',
    label: 'Smoky Obsidian',
    shader: {
      rootColor: '#090a0c',
      baseColor: '#25272b',
      tipColor: '#4c5057',
      primarySpecColor: '#c8ccd2',
      secondarySpecColor: '#5c6068',
      primaryShift: 0.05,
      primaryPower: 68,
      primaryIntensity: 0.36,
      secondaryShift: -0.14,
      secondaryPower: 26,
      secondaryIntensity: 0.22,
      rimIntensity: 0.44,
      rimPower: 2.8,
      rootAO: 0.68,
      grooveDepth: 0.76,
      strandVariation: 0.25,
    },
  },
  {
    id: 'chestnut',
    label: 'Warm Chestnut',
    shader: {
      rootColor: '#26180f',
      baseColor: '#4c3322',
      tipColor: '#674730',
      primarySpecColor: '#d9ba9c',
      secondarySpecColor: '#8c5d3a',
      primaryShift: 0.08,
      primaryPower: 84,
      primaryIntensity: 0.34,
      secondaryShift: -0.15,
      secondaryPower: 32,
      secondaryIntensity: 0.2,
      rimIntensity: 0.28,
      rimPower: 3.4,
      rootAO: 0.46,
      grooveDepth: 0.68,
      strandVariation: 0.22,
    },
  },
  {
    id: 'gold',
    label: 'SOLDIER Gold',
    shader: {
      rootColor: '#5c401a',
      baseColor: '#b3893b',
      tipColor: '#d4b05d',
      primarySpecColor: '#fff0c7',
      secondarySpecColor: '#c48f2e',
      primaryShift: 0.09,
      primaryPower: 92,
      primaryIntensity: 0.36,
      secondaryShift: -0.14,
      secondaryPower: 34,
      secondaryIntensity: 0.22,
      rimIntensity: 0.3,
      rimPower: 3.3,
      rootAO: 0.44,
      grooveDepth: 0.66,
      strandVariation: 0.19,
    },
  },
  {
    id: 'platinum',
    label: 'Platinum Silver',
    shader: {
      rootColor: '#414957',
      baseColor: '#919cab',
      tipColor: '#c2ccd9',
      primarySpecColor: '#f2f6ff',
      secondarySpecColor: '#92a6c4',
      primaryShift: 0.06,
      primaryPower: 102,
      primaryIntensity: 0.36,
      secondaryShift: -0.16,
      secondaryPower: 38,
      secondaryIntensity: 0.2,
      rimIntensity: 0.32,
      rimPower: 3.2,
      rootAO: 0.42,
      grooveDepth: 0.64,
      strandVariation: 0.17,
    },
  },
  {
    id: 'crimson',
    label: 'Crimson Auburn',
    shader: {
      rootColor: '#2e100c',
      baseColor: '#69251c',
      tipColor: '#8f392a',
      primarySpecColor: '#ebbba0',
      secondarySpecColor: '#a33c24',
      primaryShift: 0.08,
      primaryPower: 84,
      primaryIntensity: 0.34,
      secondaryShift: -0.15,
      secondaryPower: 32,
      secondaryIntensity: 0.22,
      rimIntensity: 0.3,
      rimPower: 3.3,
      rootAO: 0.44,
      grooveDepth: 0.66,
      strandVariation: 0.2,
    },
  },
  {
    id: 'valkyrie-rose',
    label: 'Valkyrie Rose',
    shader: {
      rootColor: '#54313a',
      baseColor: '#b87b88',
      tipColor: '#dfabb5',
      primarySpecColor: '#fff0f3',
      secondarySpecColor: '#c77d90',
      primaryShift: 0.07,
      primaryPower: 94,
      primaryIntensity: 0.36,
      secondaryShift: -0.15,
      secondaryPower: 34,
      secondaryIntensity: 0.2,
      rimIntensity: 0.32,
      rimPower: 3.2,
      rootAO: 0.42,
      grooveDepth: 0.64,
      strandVariation: 0.18,
    },
  },
  {
    id: 'clive-charcoal',
    label: 'Rosaria Charcoal',
    shader: {
      rootColor: '#121010',
      baseColor: '#262120',
      tipColor: '#403633',
      primarySpecColor: '#cfc2b8',
      secondarySpecColor: '#594842',
      primaryShift: 0.06,
      primaryPower: 74,
      primaryIntensity: 0.35,
      secondaryShift: -0.14,
      secondaryPower: 28,
      secondaryIntensity: 0.22,
      rimIntensity: 0.38,
      rimPower: 3.0,
      rootAO: 0.62,
      grooveDepth: 0.74,
      strandVariation: 0.24,
    },
  },
  {
    id: 'tifa-jet',
    label: 'Seventh Jet Silk',
    shader: {
      rootColor: '#0b090a',
      baseColor: '#1c181a',
      tipColor: '#382d30',
      primarySpecColor: '#d9ccd0',
      secondarySpecColor: '#594148',
      primaryShift: 0.06,
      primaryPower: 96,
      primaryIntensity: 0.38,
      secondaryShift: -0.15,
      secondaryPower: 36,
      secondaryIntensity: 0.22,
      rimIntensity: 0.4,
      rimPower: 2.9,
      rootAO: 0.64,
      grooveDepth: 0.72,
      strandVariation: 0.2,
    },
  },
  {
    id: 'aerith-amber',
    label: 'Ancient Amber',
    shader: {
      rootColor: '#362112',
      baseColor: '#6e4528',
      tipColor: '#99643d',
      primarySpecColor: '#ffe0bd',
      secondarySpecColor: '#a66838',
      primaryShift: 0.08,
      primaryPower: 88,
      primaryIntensity: 0.36,
      secondaryShift: -0.15,
      secondaryPower: 32,
      secondaryIntensity: 0.21,
      rimIntensity: 0.3,
      rimPower: 3.3,
      rootAO: 0.44,
      grooveDepth: 0.66,
      strandVariation: 0.21,
    },
  },
  {
    id: 'tidus-sun',
    label: 'Zanarkand Blonde',
    shader: {
      rootColor: '#634d28',
      baseColor: '#bfa060',
      tipColor: '#e3ca8a',
      primarySpecColor: '#fff9e0',
      secondarySpecColor: '#cfb069',
      primaryShift: 0.08,
      primaryPower: 94,
      primaryIntensity: 0.36,
      secondaryShift: -0.14,
      secondaryPower: 36,
      secondaryIntensity: 0.2,
      rimIntensity: 0.3,
      rimPower: 3.3,
      rootAO: 0.4,
      grooveDepth: 0.64,
      strandVariation: 0.19,
    },
  },
  {
    id: 'dante-frost',
    label: 'Frost Ash-White',
    shader: {
      rootColor: '#656c78',
      baseColor: '#bcc4d0',
      tipColor: '#e0e6f0',
      primarySpecColor: '#ffffff',
      secondarySpecColor: '#b3c0d4',
      primaryShift: 0.05,
      primaryPower: 108,
      primaryIntensity: 0.36,
      secondaryShift: -0.16,
      secondaryPower: 40,
      secondaryIntensity: 0.18,
      rimIntensity: 0.3,
      rimPower: 3.3,
      rootAO: 0.38,
      grooveDepth: 0.62,
      strandVariation: 0.16,
    },
  },
  {
    id: 'riku-periwinkle',
    label: 'Dawn Periwinkle',
    shader: {
      rootColor: '#3d455e',
      baseColor: '#818ead',
      tipColor: '#b2bed9',
      primarySpecColor: '#edf2ff',
      secondarySpecColor: '#7f92bf',
      primaryShift: 0.06,
      primaryPower: 96,
      primaryIntensity: 0.36,
      secondaryShift: -0.15,
      secondaryPower: 36,
      secondaryIntensity: 0.2,
      rimIntensity: 0.34,
      rimPower: 3.1,
      rootAO: 0.44,
      grooveDepth: 0.65,
      strandVariation: 0.18,
    },
  },
  {
    id: 'yuna-espresso',
    label: 'Besaid Espresso',
    shader: {
      rootColor: '#1f1410',
      baseColor: '#3f2920',
      tipColor: '#5c3e30',
      primarySpecColor: '#d9bfb0',
      secondarySpecColor: '#734d3b',
      primaryShift: 0.07,
      primaryPower: 86,
      primaryIntensity: 0.34,
      secondaryShift: -0.15,
      secondaryPower: 32,
      secondaryIntensity: 0.2,
      rimIntensity: 0.3,
      rimPower: 3.3,
      rootAO: 0.5,
      grooveDepth: 0.68,
      strandVariation: 0.21,
    },
  },
  {
    id: 'cobalt',
    label: 'Midnight Cobalt',
    shader: {
      rootColor: '#0e1629',
      baseColor: '#22355c',
      tipColor: '#3d5c8f',
      primarySpecColor: '#b8d4ff',
      secondarySpecColor: '#496da8',
      primaryShift: 0.07,
      primaryPower: 88,
      primaryIntensity: 0.36,
      secondaryShift: -0.15,
      secondaryPower: 34,
      secondaryIntensity: 0.22,
      rimIntensity: 0.38,
      rimPower: 3.0,
      rootAO: 0.56,
      grooveDepth: 0.7,
      strandVariation: 0.22,
    },
  },
  {
    id: 'ash-violet',
    label: 'Ash Lavender',
    shader: {
      rootColor: '#241e33',
      baseColor: '#544a6e',
      tipColor: '#8378a3',
      primarySpecColor: '#e4dcf7',
      secondarySpecColor: '#75669c',
      primaryShift: 0.07,
      primaryPower: 94,
      primaryIntensity: 0.35,
      secondaryShift: -0.15,
      secondaryPower: 34,
      secondaryIntensity: 0.2,
      rimIntensity: 0.34,
      rimPower: 3.1,
      rootAO: 0.46,
      grooveDepth: 0.65,
      strandVariation: 0.2,
    },
  },
  {
    id: 'copper',
    label: 'Copper Ember',
    shader: {
      rootColor: '#38190d',
      baseColor: '#874122',
      tipColor: '#b86437',
      primarySpecColor: '#ffd7b5',
      secondarySpecColor: '#ba5a2c',
      primaryShift: 0.09,
      primaryPower: 86,
      primaryIntensity: 0.36,
      secondaryShift: -0.14,
      secondaryPower: 32,
      secondaryIntensity: 0.22,
      rimIntensity: 0.32,
      rimPower: 3.2,
      rootAO: 0.44,
      grooveDepth: 0.66,
      strandVariation: 0.21,
    },
  },
  {
    id: 'champagne',
    label: 'Champagne Ash',
    shader: {
      rootColor: '#4a4033',
      baseColor: '#9c8b75',
      tipColor: '#c7b8a3',
      primarySpecColor: '#fff7eb',
      secondarySpecColor: '#a89378',
      primaryShift: 0.07,
      primaryPower: 96,
      primaryIntensity: 0.35,
      secondaryShift: -0.15,
      secondaryPower: 36,
      secondaryIntensity: 0.2,
      rimIntensity: 0.3,
      rimPower: 3.3,
      rootAO: 0.42,
      grooveDepth: 0.64,
      strandVariation: 0.18,
    },
  },
  {
    id: 'raven-teal',
    label: 'Mako Emerald',
    shader: {
      rootColor: '#0c1c1c',
      baseColor: '#1d403e',
      tipColor: '#366b66',
      primarySpecColor: '#b5ede6',
      secondarySpecColor: '#3a756f',
      primaryShift: 0.06,
      primaryPower: 86,
      primaryIntensity: 0.36,
      secondaryShift: -0.14,
      secondaryPower: 32,
      secondaryIntensity: 0.22,
      rimIntensity: 0.36,
      rimPower: 3.0,
      rootAO: 0.56,
      grooveDepth: 0.72,
      strandVariation: 0.22,
    },
  },
  {
    id: 'burgundy-wine',
    label: 'Garlean Burgundy',
    shader: {
      rootColor: '#260b14',
      baseColor: '#591a2e',
      tipColor: '#822c47',
      primarySpecColor: '#f2c4d2',
      secondarySpecColor: '#8c2b4a',
      primaryShift: 0.08,
      primaryPower: 88,
      primaryIntensity: 0.35,
      secondaryShift: -0.15,
      secondaryPower: 32,
      secondaryIntensity: 0.21,
      rimIntensity: 0.34,
      rimPower: 3.1,
      rootAO: 0.5,
      grooveDepth: 0.68,
      strandVariation: 0.2,
    },
  },
  {
    id: 'sakura-silver',
    label: 'Sakura Mist',
    shader: {
      rootColor: '#5c4b54',
      baseColor: '#bfa4b1',
      tipColor: '#e6cfd9',
      primarySpecColor: '#fff5fa',
      secondarySpecColor: '#c99eb3',
      primaryShift: 0.06,
      primaryPower: 100,
      primaryIntensity: 0.35,
      secondaryShift: -0.16,
      secondaryPower: 36,
      secondaryIntensity: 0.19,
      rimIntensity: 0.32,
      rimPower: 3.2,
      rootAO: 0.4,
      grooveDepth: 0.63,
      strandVariation: 0.17,
    },
  },
];

const ARCHETYPE_LABELS: Record<HairBuilderArchetype, string> = ARCHETYPE_METADATA.reduce(
  (acc, item) => {
    acc[item.id] = item.label;
    return acc;
  },
  {} as Record<HairBuilderArchetype, string>
);

/**
 * Generates a cohesive, anatomically sealed, layered Final Fantasy / JRPG hairstyle directly
 * from parametric HairBuilderConfig controls across all 12 distinct archetypes.
 */
export function buildCustomHairSpecs(config: HairBuilderConfig): LockBuildSpec[] {
  setEarLandmarks(config.earLandmarks);
  const rand = seededRand(config.seed || 1337);
  const specs: LockBuildSpec[] = [];

  const arch = config.archetype;
  const density = THREE.MathUtils.clamp(config.density, 0.65, 1.25);
  const wMul = THREE.MathUtils.clamp(config.strandWidth, 0.75, 1.25);
  const partX = THREE.MathUtils.clamp(config.partPosition, -1, 1) * 0.095;
  const crownLift = 0.014 + config.crownVolume * 0.014;
  const shag = THREE.MathUtils.clamp(config.layerShag, 0, 1);
  const spikeAmt = THREE.MathUtils.clamp(config.spikeLift, 0, 1);
  const bangsLenPhi = THREE.MathUtils.lerp(1.48, 2.34, config.bangsLength);
  const isCrop = arch === 'short-crop';
  const sideLenPhi = isCrop ? THREE.MathUtils.lerp(1.45, 1.85, config.sideLength) : THREE.MathUtils.lerp(1.94, 3.04, config.sideLength);
  const backLenPhi = isCrop ? THREE.MathUtils.lerp(2.1, 2.7, config.backLength) : THREE.MathUtils.lerp(2.24, 3.48, config.backLength);

  const isBob = arch === 'sleek-bob';
  const isAsym = arch === 'asym-cascade';
  const isDolphin = arch === 'dolphin-long';
  const isHalfUp = arch === 'ribbon-halfup';
  const isSweptBack = arch === 'swept-back' || isCrop; // short-crop reuses the brushed-back crown with short length caps
  const isPonytail = arch === 'high-ponytail';
  const isTwinTails = arch === 'twin-tails';
  const isEmoSweep = arch === 'emo-sweep';
  const isLong = arch === 'long-cascade' || isDolphin || isHalfUp || config.backLength > 0.78;
  const isSpiky = arch === 'spiky-hero' || spikeAmt > 0.45;
  const isPulledScalp = isPonytail || isTwinTails;
  const napeHugBase = isBob || isPulledScalp ? 1.26 : isLong ? 0.84 : 1.06;

  // NEON-SEED samurai-topknot
  // ARCH-BEGIN samurai-topknot
  if (arch === 'samurai-topknot') {
    const V3 = THREE.Vector3;
    const knotTheta = Math.PI;
    const tkStart = specs.length;
    const KX = 0.72, KZ = 0.8;
    const knotPhi = 0.3;
    const knotAnchor = skullSurfacePoint(knotTheta, knotPhi, 0.012);
    // hairline: high forehead, receding temples, short sideburn in front of the ear, tapered nape
    const frontKnots: Array<[number, number]> = [[0, 1.24], [0.22, 1.14], [0.55, 1.12], [0.9, 1.26], [1.15, 1.40], [1.3, 1.50]];
    const frontHair = (a: number): number => {
      for (let k = 1; k < frontKnots.length; k++) {
        if (a <= frontKnots[k][0]) {
          const u = (a - frontKnots[k - 1][0]) / (frontKnots[k][0] - frontKnots[k - 1][0]);
          return THREE.MathUtils.lerp(frontKnots[k - 1][1], frontKnots[k][1], u * u * (3 - 2 * u));
        }
      }
      return frontKnots[frontKnots.length - 1][1];
    };
    const cutPhi = (th: number): number => {
      const v = earAlignedCutPhi(th, { hairlinePhi: frontHair, templeRecede: 0, sideburnLength: 0.5, sideburnGap: 0.12, sideburnTaper: 0.12, earClearance: 0.12, behindEarPhi: 1.95, napePhi: 2.5, napeCurve: 0.8 });
      const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
      // hair comes straight down right behind the ear (no bald patch between the ear and the back hair)
      const w = THREE.MathUtils.smoothstep(a, 1.9, 1.98);
      const tgt = THREE.MathUtils.lerp(1.92, 2.55, Math.pow(Math.max(0, a - 2.0) / (Math.PI - 2.0), 0.9)); // straight V down to the nape tip
      return a > 1.9 ? THREE.MathUtils.lerp(v, tgt, w) : v;
    };

    // Zone 1: scalp cover under the pulled strands (snug, no scalp showing)
    for (let tier = 0; tier < 2; tier++) {
      const count = 26;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2 + tier * 0.12;
        const pts = buildSculptedLock({
          thetaStart: theta, thetaEnd: theta, phiStart: 0.02 + tier * 0.4, phiEnd: Math.min(0.85 + tier * 0.3, cutPhi(theta) - 0.15),
          baseLift: 0.001, midArch: 0.001, tipFlickOut: 0.0, napeHug: 1.35,
        });
        specs.push({
          pointsLocal: pts, width: 0.07 * wMul, thickness: 0.006, stiffnessBias: 0.98, layerAO: 0.95,
          layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: 0.4,
        });
      }
    }

    // meridian cover from the temple down to the cut line: great-circle strands toward the knot leave a triangle behind the ear, this fills it
    for (let i = 0; i < 64; i++) {
      const theta = (i / 64) * Math.PI * 2 + 0.05;
      const endP = cutPhi(theta) - 0.1;
      if (endP < 1.2) continue;
      const pts = buildSculptedLock({
        thetaStart: theta, thetaEnd: theta, phiStart: 0.95, phiEnd: endP,
        baseLift: 0.001, midArch: 0.001, tipFlickOut: 0.0, napeHug: 1.35,
      });
      specs.push({
        pointsLocal: pts, width: 0.05 * wMul, thickness: 0.006, stiffnessBias: 0.98, layerAO: 0.95,
        layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: 0.4,
      });
    }

    // Zone 2: strands rooted on the cut line, combed back to the knot along the dome.
    const knotDir = new V3(Math.sin(knotTheta) * Math.sin(knotPhi), Math.cos(knotPhi), Math.cos(knotTheta) * Math.sin(knotPhi));
    const pullStrand = (theta: number, phi0: number, width: number, order: number, spread: number) => {
      const u0 = new V3(Math.sin(theta) * Math.sin(phi0), Math.cos(phi0), Math.cos(theta) * Math.sin(phi0));
      const end = knotDir.clone();
      end.x += (rand() - 0.5) * spread; end.z += (rand() - 0.5) * spread; end.normalize();
      const omega = Math.acos(THREE.MathUtils.clamp(u0.dot(end), -1, 1));
      const so = Math.max(Math.sin(omega), 1e-4);
      const lift0 = 0.0002 + rand() * 0.0006 + order * 0.0003;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < NODES_PER_LOCK; k++) {
        const t = Math.pow(k / (NODES_PER_LOCK - 1), 1.5);
        const w0 = Math.sin((1 - t) * omega) / so;
        const w1 = Math.sin(t * omega) / so;
        const u = u0.clone().multiplyScalar(w0).addScaledVector(end, w1);
        const ph = Math.acos(THREE.MathUtils.clamp(u.y, -1, 1));
        const th = Math.atan2(u.x, u.z);
        pts.push(skullSurfacePoint(th, ph, lift0 + Math.sin(t * Math.PI) * 0.001));
      }
      specs.push({
        pointsLocal: pts, width, thickness: 0.005, stiffnessBias: 0.97,
        layerAO: 0.97, layerOrder: order, lockNormal: Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta))) > 1.9 && phi0 > 1.85, scalpRoot: 0.35, smooth: 3,
      });
    };
    const pullCount = Math.round(540 * density);
    for (let i = 0; i < pullCount; i++) {
      const theta = (i / pullCount) * Math.PI * 2 + (rand() - 0.5) * 0.01;
      pullStrand(theta, cutPhi(theta) - 0.02 + (rand() - 0.5) * 0.006, (0.026 + rand() * 0.008) * wMul, 0, 0.1);
    }
    for (let i = 0; i < pullCount; i++) {
      const theta = ((i + 0.5) / pullCount) * Math.PI * 2;
      pullStrand(theta, cutPhi(theta) - 0.07 - rand() * 0.03, (0.026 + rand() * 0.008) * wMul, 1, 0.1);
    }

    // Zone 2b: soft hairline + tapered nape: isFadeCap stubble ribbons that dissolve into the skin
    for (let row = 0; row < 1; row++) {
      const cols = Math.round(190 * density);
      for (let i = 0; i < cols; i++) {
        const theta = (i / cols) * Math.PI * 2 + row * 0.5 * (Math.PI * 2 / cols) + (rand() - 0.5) * 0.01;
        const cosT = Math.cos(theta);
        if (Math.abs(Math.atan2(Math.sin(theta), cosT)) < 1.75) continue; // crisp front hairline: no stubble band
        const nz = Math.max(0, Math.abs(Math.atan2(Math.sin(theta), cosT)) - 2.2) / 0.94; // 0 behind the ear .. 1 at the nape centre
        const lim = cutPhi(theta) + 0.05 + row * 0.025 + 0.1 * nz;
        const top = lim - 0.22 - 0.03 * nz;
        const pts = buildSculptedLock({
          thetaStart: theta, thetaEnd: theta, phiStart: top, phiEnd: lim,
          baseLift: 0.0003, midArch: 0.0, tipFlickOut: 0.0, napeHug: 1.55,
        });
        specs.push({
          pointsLocal: pts, width: 0.03 * wMul, thickness: 0.003, stiffnessBias: 0.99,
          layerAO: 0.92, layerOrder: 1, isFadeCap: true, fadeStart: 0.3, lockNormal: true, scalpRoot: 0.35,
        });
      }
    }
    // snug the dome: the scalp ellipsoid is wider than the real cranium, pull the cover toward the head axis
    for (let si = tkStart; si < specs.length; si++) {
      for (const p of specs[si].pointsLocal) {
        const lowT = THREE.MathUtils.clamp((HEAD_CENTER_LOCAL.y - p.y) / 0.1, 0, 1);
        const nT = THREE.MathUtils.clamp((HEAD_CENTER_LOCAL.y - 0.1 - p.y) / 0.15, 0, 1); // nape tuck: the low back hair hugs the narrower neck
        p.x = HEAD_CENTER_LOCAL.x + (p.x - HEAD_CENTER_LOCAL.x) * (KX - 0.12 * lowT - 0.2 * nT);
        p.z = HEAD_CENTER_LOCAL.z + (p.z - HEAD_CENTER_LOCAL.z) * (KZ - 0.08 * lowT - 0.22 * nT);
      }
    }

    // soft sideburn edge: fine thin strands along the steep temple cut so the steps blend
    for (let sd = -1; sd <= 1; sd += 2) {
      for (let i = 0; i < 70; i++) {
        const theta = sd * (0.85 + (i / 69) * 0.8);
        pullStrand(theta, cutPhi(theta) - 0.01, 0.014 * wMul, 0, 0.1);
      }
    }
    // second cap tier around the knot base (scalp pinholes)
    for (let i = 0; i < 40; i++) {
      const theta = (i / 40) * Math.PI * 2 + 0.07;
      const pts = buildSculptedLock({
        thetaStart: theta, thetaEnd: theta, phiStart: 0.45, phiEnd: 1.2, baseLift: 0.005, midArch: 0.001, tipFlickOut: 0.0, napeHug: 1.35,
      });
      for (const p of pts) {
        p.x = HEAD_CENTER_LOCAL.x + (p.x - HEAD_CENTER_LOCAL.x) * KX;
        p.z = HEAD_CENTER_LOCAL.z + (p.z - HEAD_CENTER_LOCAL.z) * KZ;
      }
      specs.push({
        pointsLocal: pts, width: 0.07 * wMul, thickness: 0.006, stiffnessBias: 0.98, layerAO: 0.95,
        layerOrder: 1, lockNormal: false, scalpRoot: 0.4,
      });
    }
    // crown cap: radial cover strands around the knot so no scalp pinholes show where the pulled strands converge
    for (let i = 0; i < 28; i++) {
      const theta = (i / 28) * Math.PI * 2;
      const pts = buildSculptedLock({
        thetaStart: theta, thetaEnd: theta, phiStart: 0.3, phiEnd: 0.95, baseLift: 0.004, midArch: 0.001, tipFlickOut: 0.0, napeHug: 1.35,
      });
      for (const p of pts) {
        p.x = HEAD_CENTER_LOCAL.x + (p.x - HEAD_CENTER_LOCAL.x) * KX;
        p.z = HEAD_CENTER_LOCAL.z + (p.z - HEAD_CENTER_LOCAL.z) * KZ;
      }
      specs.push({
        pointsLocal: pts, width: 0.06 * wMul, thickness: 0.006, stiffnessBias: 0.98, layerAO: 0.95,
        layerOrder: 1, lockNormal: false, scalpRoot: 0.4,
      });
    }

    // Zone 3A: topknot bun as a coil: helical strands wound round a short vertical axis, swirling to a top whorl
    const bunR = 0.13;
    const bunC = knotAnchor.clone();
    bunC.z = HEAD_CENTER_LOCAL.z + (bunC.z - HEAD_CENTER_LOCAL.z) * KZ; bunC.x = HEAD_CENTER_LOCAL.x + (bunC.x - HEAD_CENTER_LOCAL.x) * KX; bunC.y += bunR * 0.2; bunC.z -= bunR * 0.25;
    const tilt = 0.45; // bun leans back: top shifts toward -z
    const coilCount = Math.round(54 * density);
    for (let i = 0; i < coilCount; i++) {
      const a0 = (i / coilCount) * Math.PI * 2;
      const pts: THREE.Vector3[] = [];
      const turns = 0.9 + rand() * 0.25;
      for (let k = 0; k < NODES_PER_LOCK; k++) {
        const t = k / (NODES_PER_LOCK - 1);
        const hh = THREE.MathUtils.lerp(-0.72, 0.9, Math.sin(t * Math.PI * 0.5)); // height fraction along the bun
        const prof = Math.sqrt(Math.max(0.2, 1 - hh * hh)) * (1 - 0.48 * Math.exp(-Math.pow((hh + 0.62) / 0.12, 2))) * (hh < -0.4 ? 0.9 : 1.0);
        const rr = bunR * (prof * 1.02 + 0.004);
        const a = a0 + turns * t * Math.PI * 1.2;
        pts.push(new V3(
          bunC.x + rr * Math.cos(a),
          bunC.y + bunR * 0.92 * hh,
          bunC.z + rr * Math.sin(a) * 1.1 - tilt * bunR * hh
        ));
      }
      specs.push({
        pointsLocal: pts, width: 0.04 * wMul, thickness: 0.01, stiffnessBias: 0.95, layerAO: 1.0,
        layerOrder: 2, lockNormal: false, scalpRoot: 0.5,
      });
    }

    // Tie band: three wound rings pinching the bun neck, proud of the surface, plus two hanging ends
    const tieR = (hh: number) => bunR * (Math.sqrt(Math.max(0.2, 1 - hh * hh)) * (1 - 0.38 * Math.exp(-Math.pow((hh + 0.62) / 0.12, 2))) * 1.02 + 0.004) * 1.2 + 0.016;
    for (let ring = 0; ring < 4; ring++) {
      const hh = -0.5 - ring * 0.08;
      const ty = bunC.y + bunR * hh;
      const rad = tieR(hh);
      for (let j = 0; j < 4; j++) {
        const a0 = (j / 4) * Math.PI * 2 + ring * 0.7;
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k < NODES_PER_LOCK; k++) {
          const t = k / (NODES_PER_LOCK - 1);
          const a = a0 + t * Math.PI * 0.9;
          pts.push(new V3(bunC.x + Math.cos(a) * rad, ty + (t - 0.5) * 0.004, bunC.z + Math.sin(a) * rad * 1.1 - tilt * bunR * hh));
        }
        specs.push({
          pointsLocal: pts, width: 0.04 * wMul, thickness: 0.03, stiffnessBias: 0.99, layerAO: 0.12,
          layerOrder: 3, lockNormal: false, scalpRoot: 0.5,
        });
      }
    }
    // hanging tie ends: two short ribbons draped over the back of the dome from the knot (hug the squeezed skull)
    for (let e = 0; e < 2; e++) {
      const side = e === 0 ? -1 : 1;
      for (let j = 0; j < 2; j++) {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k < NODES_PER_LOCK; k++) {
          const t = k / (NODES_PER_LOCK - 1);
          const th = Math.PI + side * (0.04 + 0.1 * t) + (j - 1) * 0.02;
          const ph = 0.72 + 0.55 * t;
          const q = skullSurfacePoint(th, ph, 0.002);
          const lowT = THREE.MathUtils.clamp((HEAD_CENTER_LOCAL.y - q.y) / 0.08, 0, 1);
          q.x = HEAD_CENTER_LOCAL.x + (q.x - HEAD_CENTER_LOCAL.x) * (KX - 0.08 * lowT);
          q.z = HEAD_CENTER_LOCAL.z + (q.z - HEAD_CENTER_LOCAL.z) * (KZ - 0.06 * lowT);
          q.addScaledVector(q.clone().sub(HEAD_CENTER_LOCAL).normalize(), 0.05 + 0.012 * t); // proud of the hair surface so the ends read
          pts.push(q);
        }
        specs.push({
          pointsLocal: pts, width: 0.075 * wMul, thickness: 0.02, stiffnessBias: 0.95, layerAO: 0.35, smooth: 2,
          layerOrder: 4, lockNormal: false, scalpRoot: 0.4,
        });
      }
    }

    // Zone 3B: short tapered tail bundle leaving the tie, dropping behind the bun
    const tailCount = 0;
    for (let i = 0; i < tailCount; i++) {
      const f = (i / (tailCount - 1)) * 2 - 1;
      const pts: THREE.Vector3[] = [];
      const len = 0.13 + rand() * 0.03 - Math.abs(f) * 0.04;
      for (let k = 0; k < NODES_PER_LOCK; k++) {
        const t = k / (NODES_PER_LOCK - 1);
        pts.push(new V3(
          bunC.x + f * (0.014 + 0.02 * t),
          bunC.y - bunR * 0.85 + 0.01 - len * Math.pow(t, 1.4),
          bunC.z - bunR * 0.6 - 0.045 * Math.sin(Math.min(1, t * 1.2) * Math.PI * 0.5) - 0.03 * t
        ));
      }
      specs.push({
        pointsLocal: pts, width: (0.04 - Math.abs(f) * 0.012) * wMul, thickness: 0.01, stiffnessBias: 0.8,
        layerAO: 0.9, layerOrder: 3, lockNormal: false, scalpRoot: 0.4,
      });
    }

    // Zone 3C: flared tuft tail rising out of the bun top (short narrow upward-flaring locks)
    const fanN = 13;
    for (let i = 0; i < fanN; i++) {
      const f = (i / (fanN - 1)) * 2 - 1;
      for (let j = 0; j < 3; j++) {
        const pts: THREE.Vector3[] = [];
        const len = 0.21 + rand() * 0.04 - Math.abs(f) * 0.07;
        const ang = f * 0.75 + (j - 1) * 0.05;
        const dir = new V3(Math.sin(ang) * 0.9, 0.35 + 0.15 * Math.cos(ang), -0.85).normalize();
        const base = new V3(bunC.x + f * 0.05, bunC.y + bunR * 0.45, bunC.z - bunR * 0.55 + (j - 1) * 0.008);
        for (let k = 0; k < NODES_PER_LOCK; k++) {
          const t = k / (NODES_PER_LOCK - 1);
          pts.push(new V3(
            base.x + dir.x * len * t * (1 + 0.5 * t),
            base.y + dir.y * len * t - 0.02 * t * t,
            base.z + dir.z * len * t
          ));
        }
        specs.push({
          pointsLocal: pts, width: (0.075 - Math.abs(f) * 0.015) * wMul, thickness: 0.014, stiffnessBias: 0.85, smooth: 2, roundness: 0.4,
          layerAO: 0.45, layerOrder: 3, lockNormal: false, scalpRoot: 0.5,
        });
      }
    }

    return specs;
  }
  // ARCH-END samurai-topknot

  // NEON-SEED braided-crown
  // ARCH-BEGIN braided-crown
  if (arch === 'braided-crown') {
    const V3 = THREE.Vector3;
    const braidPhiAt = (aTheta: number): number => {
      const u = THREE.MathUtils.clamp((aTheta - 0.5) / 2.45, 0, 1);
      return THREE.MathUtils.lerp(0.98, 2.2, u * u * (3 - 2 * u) * 0.35 + u * 0.65);
    };
    const hairlinePhiBase = (cosT: number): number => {
      if (cosT > 0.3) return 1.28;
      if (cosT > 0) return THREE.MathUtils.lerp(1.62, 1.28, cosT / 0.3);
      if (cosT > -0.5) return THREE.MathUtils.lerp(2.12, 1.62, (cosT + 0.5) / 0.5);
      return 2.12;
    };
    // hair ends under the braid line on the sides/back (tapered tips hide beneath the plait)
    const hairlinePhi = (cosT: number): number => {
      const aT = Math.acos(THREE.MathUtils.clamp(cosT, -1, 1));
      return aT > 0.5 ? Math.min(hairlinePhiBase(cosT), braidPhiAt(aT) + 0.11) : hairlinePhiBase(cosT);
    };

    // Zone 1: dense smooth base shell, two staggered rows so tips overlap (no triangular gaps)
    for (let tier = 0; tier < 4; tier++) {
      const count = 30;
      for (let i = 0; i < count; i++) {
        const theta = ((i + (tier % 2) * 0.5) / count) * Math.PI * 2;
        const cosT = Math.cos(theta);
        const lim = hairlinePhi(cosT) - (cosT > 0.2 ? 0.1 + (tier % 2) * 0.05 : 0.0);
        const phiStart = tier === 0 ? (i % 2 === 0 ? 0.01 : 0.14) : 0.15 + tier * 0.3;
        if (phiStart > lim - 0.25) continue;
        const pts = buildSculptedLock({
          thetaStart: theta, thetaEnd: theta, phiStart, phiEnd: lim,
          baseLift: 0.004 + (3 - tier) * 0.0025, midArch: 0.005, tipFlickOut: 0.0, napeHug: 0.96,
        });
        specs.push({
          pointsLocal: pts, width: 0.075 * wMul, thickness: 0.012, stiffnessBias: 0.9, layerAO: 0.8,
          layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: tier === 0 ? 0.48 : 0.25,
        });
      }
    }

    // Hairline row: dense short narrow locks so tapered tips do not leave sawteeth
    for (let i = 0; i < 90; i++) {
      const theta = (i / 90) * Math.PI * 2 + 0.017;
      const cosT = Math.cos(theta);
      if (cosT > 0.2) continue;
      const lim = hairlinePhi(cosT);
      const pts = buildSculptedLock({
        thetaStart: theta, thetaEnd: theta, phiStart: lim - 0.45, phiEnd: lim + 0.04,
        baseLift: 0.012 + 0.014 * Math.max(0, 1 - Math.abs(cosT) * 4), midArch: 0.004, tipFlickOut: 0.0, napeHug: 0.96,
      });
      specs.push({
        pointsLocal: pts, width: 0.034 * wMul, thickness: 0.01, stiffnessBias: 0.9, layerAO: 0.85,
        layerOrder: 1, lockNormal: false, scalpRoot: 0.3,
      });
    }

    // Front filler: locks reaching under the hairline band so no scalp shows between crown tips and the band
    for (let i = 0; i < 44; i++) {
      const th = ((i / 43) * 2 - 1) * 0.95;
      const pts = buildSculptedLock({
        thetaStart: th * 0.8, thetaEnd: th, phiStart: 0.75 + (i % 3) * 0.08, phiEnd: 1.2,
        baseLift: 0.01 + (i % 2) * 0.004, midArch: 0.004, tipFlickOut: 0.0, napeHug: 0.9,
      });
      specs.push({
        pointsLocal: pts, width: 0.05 * wMul, thickness: 0.01, stiffnessBias: 0.9, layerAO: 0.85,
        layerOrder: 1, lockNormal: false, scalpRoot: 0.3,
      });
    }

    // Temple filler: wide locks ending just under the braid's front end so no scalp shows above it
    for (const side of [-1, 1]) {
      for (let i = 0; i < 12; i++) {
        const th = 0.45 + i * 0.09;
        const pts = buildSculptedLock({
          thetaStart: side * (th - 0.15), thetaEnd: side * th,
          phiStart: 0.55 + (i % 3) * 0.06, phiEnd: braidPhiAt(th) + 0.1,
          baseLift: 0.022 + (i % 2) * 0.003, midArch: 0.003, tipFlickOut: 0.0, napeHug: 0.95,
        });
        specs.push({
          pointsLocal: pts, width: 0.06 * wMul, thickness: 0.009, stiffnessBias: 0.9, layerAO: 0.85,
          layerOrder: 2, lockNormal: false, scalpRoot: 0.3,
        });
      }
    }

    // Front hairline: soft isFadeCap ribbons (no bulky lip), swept back from the centre part
    for (let r = 0; r < 0; r++) { // replaced by the smooth hairline bands in the v4 block
      for (let i = 0; i < 64; i++) {
        const f = (i + r / 2) / 63 * 2 - 1;
        if (Math.abs(f) < 0.04) continue;
        const th = f * 1.25;
        const pts = buildSculptedLock({
          thetaStart: th * 0.9, thetaEnd: th,
          phiStart: 1.12 + r * 0.03, phiEnd: (r - 0.5) * 0.012 + Math.min(1.27 + 0.2 * f * f, Math.abs(th) > 0.5 ? braidPhiAt(Math.abs(th)) + 0.14 : 9),
          baseLift: 0.004, midArch: 0.0, tipFlickOut: 0.0, napeHug: 1.2,
        });
        specs.push({
          pointsLocal: pts, width: 0.04 * wMul, thickness: 0.005, stiffnessBias: 0.95, layerAO: 0.88,
          layerOrder: 3, isFadeCap: false, lockNormal: false, scalpRoot: 0.3,
        });
      }
    }

    // Zone 2: centre-parted front hair swept diagonally back from the part toward the braids
    for (const side of [-1, 1]) {
      const nFront = Math.round(15 * density);
      for (let i = 0; i < nFront; i++) {
        const f = i / (nFront - 1);
        const pts = buildSculptedLock({
          thetaStart: side * (0.05 + f * 0.1), thetaEnd: side * (0.35 + f * 0.75),
          phiStart: 0.2 + f * 0.3, phiEnd: 1.2 + f * f * 0.3,
          baseLift: 0.013, midArch: 0.008, tipFlickOut: 0.0, napeHug: 0.9,
        });
        specs.push({
          pointsLocal: pts, width: 0.05 * wMul, thickness: 0.011, stiffnessBias: 0.8, layerAO: 0.9,
          layerOrder: 2, lockNormal: false, scalpRoot: 0.3,
        });
      }
      // back/side hair gathered toward the nape join
      const nBack = Math.round(14 * density);
      for (let i = 0; i < nBack; i++) {
        const f = i / (nBack - 1);
        const th0 = side * (0.9 + f * 1.5);
        const pts = buildSculptedLock({
          thetaStart: th0, thetaEnd: side * (Math.PI - (Math.PI - Math.abs(th0)) * 0.45),
          phiStart: 0.4 + f * 0.2, phiEnd: hairlinePhi(Math.cos(th0)) - 0.05,
          baseLift: 0.013, midArch: 0.008, tipFlickOut: 0.0, napeHug: 0.9,
        });
        specs.push({
          pointsLocal: pts, width: 0.055 * wMul, thickness: 0.011, stiffnessBias: 0.8, layerAO: 0.88,
          layerOrder: 2, lockNormal: false, scalpRoot: 0.5,
        });
      }
      // fine loose wisps framing the face at the temples
      for (let k = 0; k < 1; k++) {
        const pts = buildSculptedLock({
          thetaStart: side * (0.6 + k * 0.1), thetaEnd: side * (0.78 + k * 0.1),
          phiStart: 1.0 + k * 0.04, phiEnd: 1.5 + k * 0.08,
          baseLift: 0.016, midArch: 0.012, tipFlickOut: 0.006, napeHug: 0.7, sCurveAmp: side * (0.1 + k * 0.03),
        });
        specs.push({
          pointsLocal: pts, width: 0.011 * wMul, thickness: 0.005, stiffnessBias: 0.4, layerAO: 0.95,
          layerOrder: 3, lockNormal: false, scalpRoot: 0.2,
        });
      }
    }

    // Front tip-cover rows: wide-bodied locks whose tips end under the hairline band (no scalp teeth above it)
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 36; i++) {
        const th = ((i + row * 0.5) / 35 * 2 - 1) * 0.98;
        const pts = buildSculptedLock({
          thetaStart: th * 0.9, thetaEnd: th * 1.04,
          phiStart: 0.85 + row * 0.05, phiEnd: 1.2 + row * 0.02,
          baseLift: 0.012 + row * 0.003, midArch: 0.003, tipFlickOut: 0.0, napeHug: 0.9,
        });
        specs.push({
          pointsLocal: pts, width: 0.045 * wMul, thickness: 0.008, stiffnessBias: 0.9, layerAO: 0.85,
          layerOrder: 2, lockNormal: false, scalpRoot: 0.3,
        });
      }
    }
    // Nape cover: staggered wide locks over the back hairline so no sawteeth show above the plait join
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 26; i++) {
        const th = Math.PI + ((i + row * 0.5) / 25 * 2 - 1) * 0.5;
        const pts = buildSculptedLock({
          thetaStart: th, thetaEnd: th + (Math.PI - th) * 0.15,
          phiStart: 1.85, phiEnd: 2.2 + row * 0.04,
          baseLift: 0.014 + row * 0.003, midArch: 0.003, tipFlickOut: 0.0, napeHug: 1.0,
        });
        specs.push({
          pointsLocal: pts, width: 0.05 * wMul, thickness: 0.009, stiffnessBias: 0.9, layerAO: 0.8,
          layerOrder: 2, lockNormal: false, scalpRoot: 0.3,
        });
      }
    }

    // Centre part filler (closes scalp slits) and soft wavy wisps in front of the ears
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const pts = buildSculptedLock({
          thetaStart: side * 0.03, thetaEnd: side * (0.1 + k * 0.03),
          phiStart: 0.45 + k * 0.1, phiEnd: 1.3,
          baseLift: 0.008 + k * 0.002, midArch: 0.003, tipFlickOut: 0.0, napeHug: 0.9,
        });
        specs.push({
          pointsLocal: pts, width: 0.034 * wMul, thickness: 0.008, stiffnessBias: 0.9, layerAO: 0.85,
          layerOrder: 1, lockNormal: false, scalpRoot: 0.3,
        });
      }
      for (let k = 0; k < 2; k++) {
        const pts = buildSculptedLock({
          thetaStart: side * (0.95 + k * 0.12), thetaEnd: side * (1.1 + k * 0.12),
          phiStart: 1.2, phiEnd: 1.62 + k * 0.08,
          baseLift: 0.02, midArch: 0.01, tipFlickOut: 0.01, napeHug: 0.6, sCurveAmp: side * 0.14,
        });
        specs.push({
          pointsLocal: pts, width: 0.015 * wMul, thickness: 0.006, stiffnessBias: 0.45, layerAO: 0.95,
          layerOrder: 5, lockNormal: false, scalpRoot: 0.2,
        });
      }
    }

    // Scalp underlayer for the sides and nape (hidden under the braids and curtains): extra skull-hugging base locks
    for (let i = 0; i < 150; i++) {
      const theta = Math.PI * 0.5 + (i / 150) * Math.PI * 1.0 + ((i % 3) - 1) * 0.01;
      const cosT = Math.cos(theta);
      const lim = hairlinePhi(cosT);
      const phiStart = 0.9 + (i % 4) * 0.12;
      if (phiStart > lim - 0.25) continue;
      const pts = buildSculptedLock({
        thetaStart: theta, thetaEnd: theta, phiStart, phiEnd: lim,
        baseLift: 0.006, midArch: 0.004, tipFlickOut: 0.0, napeHug: 0.96,
      });
      specs.push({
        pointsLocal: pts, width: 0.06 * wMul, thickness: 0.01, stiffnessBias: 0.9, layerAO: 0.7,
        layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: 0.25,
      });
    }

    // Smooth hairline bands: wide ribbons laid along the hairline arc, so the edge is a straight ribbon edge (no tapered teeth);
    // the two halves taper to nothing at the centre, which leaves a thin clean part
    for (const side of [-1, 1]) {
      for (let layer = 0; layer < 2; layer++) {
        const hw = layer === 0 ? 0.075 : 0.04;
        const off = layer === 0 ? 0.12 : 0.03;
        const pts: THREE.Vector3[] = [];
        for (let j = 0; j < NODES_PER_LOCK; j++) {
          const t = j / (NODES_PER_LOCK - 1);
          const th = 0.012 + t * 1.52;
          const fr = th / 1.25;
          const hl = Math.min(1.2 + 0.36 * fr * fr, th > 0.5 ? braidPhiAt(th) + 0.14 : 9);
          pts.push(skullSurfacePoint(side * th, hl - off, 0.012 + layer * 0.004));
        }
        specs.push({
          pointsLocal: pts, width: hw * wMul, thickness: 0.006, stiffnessBias: 0.95, layerAO: layer === 0 ? 0.8 : 0.9,
          layerOrder: 3 + layer, lockNormal: false, scalpRoot: 0.5,
        });
      }
    }

    // Temple cover: hair swept back from the part over the temples toward the ear and the crown braid
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const f = i / 8;
        const pts = buildSculptedLock({
          thetaStart: side * (0.9 + f * 0.3), thetaEnd: side * (1.25 + f * 0.3),
          phiStart: 0.95 + f * 0.1, phiEnd: 1.5 + f * 0.22,
          baseLift: 0.016, midArch: 0.004, tipFlickOut: 0.004, napeHug: 0.85,
        });
        specs.push({
          pointsLocal: pts, width: 0.05 * wMul, thickness: 0.009, stiffnessBias: 0.85, layerAO: 0.85,
          layerOrder: 2, lockNormal: false, scalpRoot: 0.3,
        });
      }
    }

    // Face-framing strands: hair falling in front of the ears from the temples
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const f = i / 5;
        const pts = buildSculptedLock({
          thetaStart: side * (1.28 + f * 0.1), thetaEnd: side * (1.4 + f * 0.1),
          phiStart: 1.5, phiEnd: 2.35 + 0.12 * Math.sin(i * 2.1),
          baseLift: 0.034, midArch: 0.006, tipFlickOut: 0.03, napeHug: 0.5, sCurveAmp: side * 0.08 * Math.sin(i * 1.9 + 0.5),
        });
        specs.push({
          pointsLocal: pts, width: 0.04 * wMul, thickness: 0.008, stiffnessBias: 0.5, layerAO: 0.85,
          layerOrder: 4, lockNormal: false, scalpRoot: 0.5,
        });
      }
    }

    // Apex fan: thin locks radiating from the crown part line so the apex reads as a swirl, not a star
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const pts = buildSculptedLock({
          thetaStart: side * 0.01, thetaEnd: side * (0.45 + k * 0.38),
          phiStart: 0.02, phiEnd: 0.72 + k * 0.06,
          baseLift: 0.011, midArch: 0.0, tipFlickOut: 0.0, napeHug: 0.95,
        });
        specs.push({
          pointsLocal: pts, width: 0.034 * wMul, thickness: 0.006, stiffnessBias: 0.95, layerAO: 0.9,
          layerOrder: 3, lockNormal: false, scalpRoot: 0.5,
        });
      }
    }

    // Loose lower hair: wavy, flared curtains of mixed length falling behind the ears toward the shoulders (under the braids)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 22; i++) {
        const f = i / 21;
        const len = 2.9 + 0.26 * Math.sin(i * 2.3 + (side > 0 ? 1.1 : 0)) + 0.12 * f;
        const pts = buildSculptedLock({
          thetaStart: side * (1.85 + f * 1.0), thetaEnd: side * (1.95 + f * 0.95 + 0.07 * Math.sin(i * 1.7)),
          phiStart: 1.75, phiEnd: len,
          baseLift: 0.032, midArch: 0.004, tipFlickOut: 0.03 * (1 - f * 0.5), napeHug: 0.7,
          sCurveAmp: side * 0.09 * Math.sin(i * 2.1 + 0.7),
        });
        specs.push({
          pointsLocal: pts, width: 0.045 * wMul, thickness: 0.01, stiffnessBias: 0.5, layerAO: 0.78 + 0.17 * (i % 2),
          layerOrder: 1 + (i % 3), lockNormal: false, scalpRoot: 0.3,
        });
      }
    }

    // v4 braid builder: three sine-weaving strands along ONE shared centreline, chevron lobes built from short overlapping ribbons
    const braid3 = (
      cl: (u: number) => THREE.Vector3, nrm: (p: THREE.Vector3) => THREE.Vector3,
      halfP: number, amp: number, lobeW: number, bulge: number, stiff: number,
      out?: THREE.Vector3, endScale = 1, coreAO = 0.45, hang = false, pin = hang,
    ) => {
      const N0 = 160;
      const cum: number[] = [0];
      let prevP = cl(0);
      for (let i = 1; i <= N0; i++) { const q = cl(i / N0); cum.push(cum[i - 1] + q.distanceTo(prevP)); prevP = q; }
      const total = cum[N0];
      const uOfS = (s0: number): number => {
        const s = THREE.MathUtils.clamp(s0, 0, total);
        let i = 1;
        while (i < N0 && cum[i] < s) i++;
        const f = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
        return (i - 1 + f) / N0;
      };
      const frame = (s: number) => {
        const u = uOfS(s);
        const p = cl(u);
        const T = cl(Math.min(1, u + 0.01)).sub(cl(Math.max(0, u - 0.01))).normalize();
        let N = nrm(p);
        const B = new V3().crossVectors(T, N).normalize();
        N = new V3().crossVectors(B, T).normalize();
        return { p, N, B };
      };
      const nHalf = Math.max(2, Math.round(total / halfP));
      const hp = total / nHalf;
      const ov = 0.3 * hp;
      const aAt = (s: number) => amp * THREE.MathUtils.lerp(1, endScale, THREE.MathUtils.clamp(s / total, 0, 1));
      // core body so no gap shows between lobes
      const nCore = Math.max(1, Math.ceil(total / (hang ? 0.2 : 0.07)));
      for (let c = 0; c < nCore; c++) {
        const pts: THREE.Vector3[] = [];
        for (let j = 0; j < NODES_PER_LOCK; j++) {
          const s = ((c + j / (NODES_PER_LOCK - 1) * 1.2) / nCore) * total;
          const f = frame(s);
          pts.push(f.p.clone().addScaledVector(f.N, 0.002));
        }
        specs.push({
          pointsLocal: pts, width: (aAt(c / nCore * total) * 2 + lobeW * 0.4) * wMul, thickness: 0.014, stiffnessBias: stiff, layerAO: coreAO,
          layerOrder: 3, lockNormal: pin, scalpRoot: 0.5, customOutDir: out,
        });
      }
      for (let r = 0; r < 3; r++) {
        const ph = r * Math.PI * 2 / 3;
        const span = 1; // plait pieces cover a full weave period each (fewer far-rooted locks)
        for (let m = -2; m <= nHalf + 1; m += span) {
          const s0 = hp * (m + 0.5 - ph / Math.PI) - ov;
          const s1 = s0 + span * hp + 2 * ov;
          if (s1 < 0 || s0 > total) continue;
          const pts: THREE.Vector3[] = [];
          for (let j = 0; j < NODES_PER_LOCK; j++) {
            const s = THREE.MathUtils.lerp(s0, s1, j / (NODES_PER_LOCK - 1));
            const f = frame(s);
            const ang = Math.PI * s / hp + ph;
            const lat = aAt(s) * Math.sin(ang);
            const dep = 0.004 + bulge * (0.5 + 0.5 * Math.cos(ang));
            pts.push(f.p.clone().addScaledVector(f.B, lat).addScaledVector(f.N, dep));
          }
          specs.push({
            pointsLocal: pts, width: lobeW * wMul, thickness: hang ? 0.028 : 0.014, stiffnessBias: stiff, layerAO: (hang ? 0.82 : 0.7) + (hang ? 0.18 : 0.3) * ((Math.round(m / span) + r) & 1),
            layerOrder: 4, lockNormal: pin, scalpRoot: 0.5, customOutDir: out,
          });
        }
      }
    };

    // Zone 3: twin side braids, temple hairline -> over the ear -> back-of-head join
    for (const side of [-1, 1]) {
      braid3(
        (u) => {
          const e = u * u * (3 - 2 * u) * 0.35 + u * 0.65;
          return skullSurfacePoint(side * THREE.MathUtils.lerp(0.5, 3.0, u), THREE.MathUtils.lerp(0.98, 2.2, e), 0.036 + 0.004 * u * u + 0.012 * Math.sin(Math.PI * Math.min(1, u * 1.15)));
        },
        (p) => p.clone().sub(HEAD_CENTER_LOCAL).normalize(),
        0.04, 0.018, 0.034, 0.014, 0.95, undefined, 1, 0.45, false, true,
      );
    }

    // Zone 4: one regular 3-strand plait down the back centre, tie near the end
    {
      const rootP = skullSurfacePoint(Math.PI, 2.05, 0.04);
      const plaitLen = 0.8;
      // web units are about 3x Tobin metres: 1.1 reaches the shoulder blades. Hang on the nape, then lean back to clear the upper back
      const plaitCl = (u: number) => {
        const d = plaitLen * u;
        const k = THREE.MathUtils.clamp(d / 0.8, 0, 1);
        const sm = k * k * k * (k * (6 * k - 15) + 10);
        return new V3(rootP.x + Math.sin(u * Math.PI * 1.2) * 0.004 * u,
          rootP.y - d,
          rootP.z - 0.012 - 0.2 * sm);
      };
      braid3(plaitCl, () => new V3(0, 0, -1), 0.075, 0.03, 0.046, 0.022, 0.97, new V3(0, 0.1, -1), 0.8, 0.6, true);
      const tp = plaitCl(0.96);
      // hair tie: two dark rings wrapped around the plait, then a short tapered tail
      for (let b2 = 0; b2 < 2; b2++) {
        const arc: THREE.Vector3[] = [];
        for (let j = 0; j < NODES_PER_LOCK; j++) {
          const ang = (j / (NODES_PER_LOCK - 1) * 2 - 1) * 1.35;
          arc.push(new V3(tp.x + 0.085 * Math.sin(ang), tp.y - b2 * 0.026, tp.z - 0.03 * Math.cos(ang) + 0.012));
        }
        specs.push({
          pointsLocal: arc, width: 0.036 * wMul, thickness: 0.034, stiffnessBias: 0.6, layerAO: 0.15,
          layerOrder: 6, lockNormal: true, scalpRoot: 0.5, customOutDir: new V3(0, 0.1, -1),
        });
      }
      for (let k = 0; k < 3; k++) {
        const pts: THREE.Vector3[] = [];
        for (let j = 0; j < NODES_PER_LOCK; j++) {
          const t = j / (NODES_PER_LOCK - 1);
          pts.push(new V3(tp.x + (k - 1) * 0.026 * (1 - t * 0.7), tp.y - 0.05 - t * 0.09, tp.z - 0.012 + t * 0.004));
        }
        specs.push({
          pointsLocal: pts, width: 0.036 * wMul, thickness: 0.012, stiffnessBias: 0.5, layerAO: 0.85,
          layerOrder: 5, lockNormal: true, scalpRoot: 0.5,
        });
      }
    }

    return specs;
  }
  // ARCH-END braided-crown

  // NEON-SEED undercut-fade
  // ARCH-BEGIN undercut-fade
  if (arch === 'undercut-fade') {
    const sweepSign = config.bangsSweep >= 0 ? 1 : -1;
    const seedU = (config.seed || 1337);
    // cut line phi(|theta|): shared ear-aligned helper (pointed sideburn in front of the ear, arch over the ear, curved nape)
    // the fade, sideburns and nape are painted (SCALP_PAINT_BY_ARCHETYPE['undercut-fade'] uses the same cut options)
    const cutPhi = (th: number): number => earAlignedCutPhi(th, undercutFadeCut(config));

    // Zone 1 (the old dark scalp shell) is gone: the scalp paint and the crop field's under layer cover the scalp, and the
    // shell's pointed ends showed as a row of dark teeth along the front hairline.

    // Zone 2: the short sides are painted (fadeScalpPaint with strand streaks), as games do; the top sits directly on the
    // paint. sideLayerLocks stays available for styles whose sides are long enough to need modelled hair.

    // Zone 3: the top as one combed field (shared cropFieldLocks): clumps out from the crown whorl, the front hairline
    // rising up and back, everything getting shorter and flatter down to where the painted fade takes over
    const undercutPaint = undercutFadePaint(config);
    cropFieldLocks(specs, {
      seed: seedU + 33, wMul, sweep: sweepSign * 0.3,
      // the top's short side hair runs a little into the fade band so the sides never read bare above the ear
      // (over the forehead the paint's front blend is a soft gradient: the hair reaches the hairline itself, edgePhi)
      hairPhi: (az) => THREE.MathUtils.lerp(sampleArr(undercutPaint.fullPhi, az) - 0.1 * _ss((Math.abs(az) - 0.9) / 0.5), sampleArr(undercutPaint.edgePhi, az), _ss((1.05 - Math.abs(az)) / 0.45)),
      clumpSpacing: 0.085, clump: 0.9, sideTaper: 0.75, frontInset: 0.015,
      length: 0.1 + 0.03 * config.crownVolume, volume: 0.02 + 0.016 * config.crownVolume,
      spike: 0.6 + 0.8 * config.spikeLift, stand: 0.55 + 0.3 * config.spikeLift,
    });

    // The front edge is the textured top meeting the painted hairline (forehead clear, tips lifted), as in the reference.

    return specs;
  }
  // ARCH-END undercut-fade

  // NEON elder-scholar (standalone, early return)
  // ARCH-BEGIN elder-scholar
  if (arch === 'elder-scholar') {
    const tieTheta = Math.PI;
    const tiePhi = 1.72; // low scholar tie at the nape
    const tieAnchor = skullSurfacePoint(tieTheta, tiePhi, 0.018).add(new THREE.Vector3(0, -0.012, -0.045));
    const clamp01 = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
    const randS = seededRand((config.seed || 1337) + 11);
    const randT = seededRand((config.seed || 1337) + 23);
    const randB = seededRand((config.seed || 1337) + 41);

    // receding M-shaped hairline: phi at which hair starts, as a function of |theta| (high forehead, temples recede)
    const hsKnots: Array<[number, number]> = [[0, 1.06], [0.4, 1.03], [0.8, 0.82], [1.1, 0.98], [1.3, 1.12], [1.6, 1.3], [Math.PI, 1.9]];
    const hs = (a: number) => {
      const x = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      for (let k = 1; k < hsKnots.length; k++) {
        if (x <= hsKnots[k][0]) {
          const u = clamp01((x - hsKnots[k - 1][0]) / (hsKnots[k][0] - hsKnots[k - 1][0]));
          return THREE.MathUtils.lerp(hsKnots[k - 1][1], hsKnots[k][1], u * u * (3 - 2 * u));
        }
      }
      return hsKnots[hsKnots.length - 1][1];
    };
    const cutOpts = { hairlinePhi: hs, templeRecede: 0, sideburnLength: 1.0, sideburnTaper: 0.34, earClearance: 0.06, napePhi: 2.0 };

    // unit direction on the skull (normalised ellipsoid space) and great-circle lock builder (crosses the apex safely)
    const dirOf = (th: number, ph: number) => new THREE.Vector3(Math.sin(th) * Math.sin(ph), Math.cos(ph), Math.cos(th) * Math.sin(ph));
    const slerpDir = (a: THREE.Vector3, b: THREE.Vector3, t: number) => {
      const d = THREE.MathUtils.clamp(a.dot(b), -1, 1);
      const om = Math.acos(d);
      if (om < 1e-4) return a.clone();
      const s = Math.sin(om);
      return a.clone().multiplyScalar(Math.sin((1 - t) * om) / s).add(b.clone().multiplyScalar(Math.sin(t * om) / s));
    };
    const arcLock = (dS: THREE.Vector3, dE: THREE.Vector3, f0: number, f1: number, lift: number, arch: number, jitter = 0) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < NODES_PER_LOCK; i++) {
        const t = i / (NODES_PER_LOCK - 1);
        const f = THREE.MathUtils.lerp(f0, f1, t);
        const v = slerpDir(dS, dE, f);
        if (jitter) {
          v.x += Math.sin(t * 4.1 + jitter * 7) * jitter * 0.03 * Math.sin(t * Math.PI);
          v.normalize();
        }
        const th = Math.atan2(v.x, v.z);
        const ph = Math.acos(THREE.MathUtils.clamp(v.y, -1, 1));
        const rootSink = -0.004 * Math.pow(1.0 - Math.min(1.0, t * 4.5), 2.0);
        pts.push(skullSurfacePoint(th, ph, lift + rootSink + Math.sin(t * Math.PI) * arch));
      }
      return pts;
    };
    const tieDir = dirOf(tieTheta, tiePhi);
    const gatherTip = (pts: THREE.Vector3[]) => {
      pts[NODES_PER_LOCK - 1].lerp(tieAnchor, 0.92);
      pts[NODES_PER_LOCK - 2].lerp(tieAnchor, 0.62);
      pts[NODES_PER_LOCK - 3].lerp(tieAnchor, 0.28);
      pts[NODES_PER_LOCK - 4].lerp(tieAnchor, 0.08);
    };

    // Zone 1a: front-top base shell, rooted at the receding hairline and flowing back over the crown
    const nF = 30;
    for (let i = 0; i < nF; i++) {
      const u = i / (nF - 1);
      const th0 = THREE.MathUtils.lerp(-1.3, 1.3, u);
      const dS = dirOf(th0, hs(th0) + 0.02);
      const dE = dirOf(th0 + Math.PI, 0.30 + 0.12 * randS());
      const pts = arcLock(dS, dE, 0, 1, 0.004 + 0.0006 * (i % 4), 0.003);
      specs.push({
        pointsLocal: pts, width: 0.068 * wMul * (0.55 + 0.45 * Math.min(1, Math.min(u, 1 - u) / 0.15)), thickness: 0.008,
        stiffnessBias: 0.96, layerAO: 0.74, layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: 0.4,
      });
    }

    // Zone 1b: side/rear base shell from the crown down to the ear-aligned cut and nape
    const shellCount = 60;
    const thLo = 0.95;
    const thHi = Math.PI * 2 - 0.95;
    for (let i = 0; i < shellCount; i++) {
      const u = i / (shellCount - 1);
      const theta = THREE.MathUtils.lerp(thLo, thHi, u);
      const isRear = Math.cos(theta) < -0.40;
      const earCut = earAlignedCutPhi(theta, cutOpts);
      const pts = buildSculptedLock({
        thetaStart: theta,
        thetaEnd: Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta))) < 1.5 ? theta : (theta > Math.PI ? Math.min(thHi, theta + 0.45) : Math.max(thLo, theta - 0.45)),
        phiStart: 0.26 + 0.1 * randS(),
        phiEnd: isRear ? 2.12 : Math.min(earCut, Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta))) < 1.35 ? hs(theta) - 0.14 : 9),
        baseLift: 0.0045 + 0.0006 * (i % 4),
        midArch: 0.003,
        tipFlickOut: 0.0,
        napeHug: 1.35,
      });
      specs.push({
        pointsLocal: pts, width: 0.075 * wMul * (0.4 + 0.6 * Math.min(1, Math.min(u, 1 - u) / 0.10)), thickness: 0.008,
        stiffnessBias: 0.96, layerAO: 0.74, layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: 0.4,
      });
    }

    // Zone 2: swept-back top, SHORT-to-MEDIUM locks in overlapping tiers (front tiers lie over the next), gathered at the tie
    const tierStart = [0.0, 0.2, 0.42, 0.62];
    const tierLen = 0.36;
    const tierCount = [Math.round(40 * density), Math.round(36 * density), Math.round(30 * density), Math.round(24 * density)];
    for (let t = 0; t < 4; t++) {
      const n = tierCount[t];
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const th0 = THREE.MathUtils.lerp(-1.28, 1.28, u) + (randS() - 0.5) * 0.05;
        const dS = dirOf(th0, hs(th0) + 0.02);
        const f0 = tierStart[t] + (randS() - 0.5) * 0.04;
        const f1 = Math.min(1, f0 + tierLen + (randS() - 0.5) * 0.05);
        const kEnd = [0.7, 0.55, 0.4, 0.1][t];
        const dT = dirOf(Math.PI - th0 * kEnd, tiePhi - 0.12 + 0.12 * (t / 3));
        const pts = arcLock(dS, dT, f0, f1, 0.014 - 0.0033 * t + randS() * 0.0010, 0.008, (randS() - 0.5) * 0.9);
        if (f1 >= 0.99 && t === 3) gatherTip(pts);
        specs.push({
          pointsLocal: pts, width: (0.042 + randS() * 0.010) * wMul, thickness: 0.012, stiffnessBias: 0.9,
          layerAO: 0.9, layerOrder: t < 2 ? 3 : 2, lockNormal: false, scalpRoot: 0.55, smooth: 3, roundness: 0.4,
        });
      }
    }

    // Zone 2b: side and behind-the-ear hair, longer, sweeping back and up into the tie
    for (const sd of [-1, 1]) {
      const nS = Math.round(22 * density);
      for (let i = 0; i < nS; i++) {
        const u = (i + 0.5) / nS;
        const th0 = sd * THREE.MathUtils.lerp(1.15, 2.7, u);
        const startPhi = hs(th0) + 0.02 + randS() * 0.22 - (u > 0.5 ? 0.2 : 0);
        const dS = dirOf(th0, Math.max(0.5, Math.min(startPhi, 1.8)));
        const f0 = randS() * 0.08;
        const pts = arcLock(dS, tieDir, f0, 1, 0.010 + randS() * 0.003, 0.008, (randS() - 0.5) * 1.2);
        gatherTip(pts);
        specs.push({
          pointsLocal: pts, width: (0.050 + randS() * 0.012) * wMul, thickness: 0.012, stiffnessBias: 0.92,
          layerAO: 0.88, layerOrder: 2, lockNormal: false, scalpRoot: 0.55, smooth: 3, roundness: 0.4,
        });
      }
    }
    // nape: lower hair under the ear line feeding up/in to the tie
    const lowCount = Math.round(30 * density);
    for (let i = 0; i < lowCount; i++) {
      const u = i / (lowCount - 1);
      const theta = THREE.MathUtils.lerp(Math.PI - 1.35, Math.PI + 1.35, u);
      const pts = buildSculptedLock({
        thetaStart: theta,
        thetaEnd: THREE.MathUtils.lerp(theta, Math.PI, 0.9),
        phiStart: 1.35 + randS() * 0.25,
        phiEnd: tiePhi,
        baseLift: 0.010,
        midArch: 0.008,
        tipFlickOut: 0.0,
        napeHug: 1.30,
      });
      gatherTip(pts);
      specs.push({
        pointsLocal: pts, width: (0.045 + randS() * 0.012) * wMul, thickness: 0.011, stiffnessBias: 0.92,
        layerAO: 0.86, layerOrder: 2, lockNormal: false, scalpRoot: 0.38, smooth: 3, roundness: 0.4,
      });
    }
    // soft fade along the lower nape edge
    const napeCount = 30;
    for (let i = 0; i < napeCount; i++) {
      const u = i / (napeCount - 1);
      const theta = THREE.MathUtils.lerp(Math.PI - 1.1, Math.PI + 1.1, u);
      const pts = buildSculptedLock({
        thetaStart: theta, thetaEnd: THREE.MathUtils.lerp(theta, Math.PI, 0.35),
        phiStart: 1.7, phiEnd: 2.14, baseLift: 0.006, midArch: 0.004, tipFlickOut: 0.0, napeHug: 1.35,
      });
      specs.push({
        pointsLocal: pts, width: 0.05 * wMul, thickness: 0.005, stiffnessBias: 0.95, layerAO: 0.85,
        layerOrder: 1, isFadeCap: true, fadeStart: 0.35, lockNormal: false, scalpRoot: 0.42,
      });
    }

    // nape curtain: short locks hanging below the tie line either side of the tail (V-shaped lower edge)
    for (let i = 0; i < 34; i++) {
      const u = i / 33;
      const dth = (u - 0.5) * 2.2;
      const theta = Math.PI + dth;
      const endPhi = 2.42 - 0.34 * Math.pow(Math.abs(dth) / 1.1, 1.3);
      const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: THREE.MathUtils.lerp(theta, Math.PI, 0.25), phiStart: 1.5 + randS() * 0.1, phiEnd: endPhi, baseLift: 0.014, midArch: 0.006, tipFlickOut: 0.0, napeHug: 1.3 });
      specs.push({
        pointsLocal: pts, width: (0.07 + randS() * 0.012) * wMul, thickness: 0.011, stiffnessBias: 0.92,
        layerAO: 0.86, layerOrder: 1, lockNormal: false, scalpRoot: 0.55, smooth: 3, roundness: 0.4,
      });
    }

    // Zone 3: real silver sideburns in front of the ears: wide, dense wedge of tapered locks down to the lobe line
    const sbTip = earSideburnTip({ sideburnLength: 1.0 });
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 30; i++) {
        const u = i / 29; // 0 front edge .. 1 ear side
        const th = sd * (sbTip.theta - 0.17 * (1 - u) + (randS() - 0.5) * 0.012);
        const endPhi = THREE.MathUtils.lerp(sbTip.phi - 0.42, sbTip.phi + 0.24, Math.pow(u, 0.9)) + (randS() - 0.5) * 0.08;
        const pts = buildSculptedLock({ thetaStart: th, thetaEnd: th + sd * 0.03, phiStart: 0.7 + randS() * 0.15, phiEnd: endPhi, baseLift: 0.012 + 0.0012 * (i % 3), midArch: 0.003, tipFlickOut: 0.0, napeHug: 1.4 });
        specs.push({
          pointsLocal: pts, width: (0.028 + 0.006 * u) * wMul, thickness: 0.012, stiffnessBias: 0.97, layerAO: 0.45,
          layerOrder: 3, lockNormal: false, scalpRoot: 0.8, smooth: 3, roundness: 0.5, isFadeCap: true, fadeStart: 0.55,
        });
      }
    }

    // Zone 4: thick tied tail: parallel tapered bundle (no fray), swelling then tapering to a rounded point
    const tailN = Math.round(34 * density);
    const ringR = 0.068; // dark tie ring radius
    const tailTop = tieAnchor.clone().add(new THREE.Vector3(0, 0.02, 0));
    const tailL = 0.36 + config.backLength * 0.04;
    const radius = (t: number) => ringR * (0.55 + 0.85 * Math.sin(Math.PI * Math.pow(t, 1.45))) * (1 - Math.pow(t, 3.2));
    for (let i = 0; i < tailN; i++) {
      const rho = Math.sqrt((i + 0.5) / tailN);
      const ang = i * 2.39996;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < NODES_PER_LOCK; k++) {
        const t = k / (NODES_PER_LOCK - 1);
        const R = Math.max(0.003, radius(t));
        const cy = tailTop.y - 0.012 - tailL * Math.pow(t, 1.12);
        const cz = tailTop.z - 0.01 - 0.05 * Math.sin(Math.min(1, t * 1.5) * Math.PI * 0.5) - 0.02 * t;
        pts.push(new THREE.Vector3(tailTop.x + Math.cos(ang) * rho * R, cy, cz + Math.sin(ang) * rho * R * 0.8));
      }
      specs.push({
        pointsLocal: pts, width: (0.034 + randT() * 0.008) * wMul, thickness: 0.026, stiffnessBias: 0.8, layerAO: 0.9,
        layerOrder: 3, lockNormal: true, scalpRoot: 0.4, smooth: 3, roundness: 0.6,
      });
    }

    // Zone 5: dark hair-tie ring: wound spiral of short locks (the shader's root colour is dark, so each piece shows its dark root)
    const ringN = 36;
    for (let j = 0; j < ringN; j++) {
      const a0 = (j / ringN) * Math.PI * 2;
      const rr = ringR * 1.08 + 0.0007 * j;
      const ty = tailTop.y - 0.028 + 0.0006 * j;
      const cz = tailTop.z - 0.01;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < NODES_PER_LOCK; k++) {
        const t = k / (NODES_PER_LOCK - 1);
        const a = a0 + t * 0.62;
        pts.push(new THREE.Vector3(tailTop.x + Math.cos(a) * rr, ty + (t - 0.5) * 0.002, cz + Math.sin(a) * rr * 0.85));
      }
      specs.push({
        pointsLocal: pts, width: 0.05 * wMul, thickness: 0.032, stiffnessBias: 0.99, layerAO: 0.2,
        layerOrder: 4, lockNormal: false, scalpRoot: 1.0, isFadeCap: true, fadeStart: 0.1,
      });
    }

    // Zone 6: no facial hair (a clean game-style beard could not be built with tapered locks; none is the safe default)

    return specs;
  }
  // ARCH-END elder-scholar
  // NEON round11 short-crop (standalone, early return)
  // ARCH-BEGIN short-crop
  if (arch === 'short-crop') {
    const sideEndBase = THREE.MathUtils.lerp(1.55, 1.68, config.sideLength); // down to the ear top
    const napeEndBase = THREE.MathUtils.lerp(2.05, 2.28, config.backLength);
    const sweepX = THREE.MathUtils.clamp(config.bangsSweep, -1, 1) * 0.045;
    const topVol = 0.016 + config.crownVolume * 0.020;
    const mkR = (sd: number) => { let st = (sd >>> 0) || 1; return () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; }; };
    const rZ1 = mkR((config.seed || 1337) + 101), rZ2 = mkR((config.seed || 1337) + 202), rZ3 = mkR((config.seed || 1337) + 303);

    // Helper: map upper-dome (x, z) directly onto skull surface with custom radial lift
    const domePt = (x: number, z: number, lift: number): THREE.Vector3 => {
      const nx = x / SCALP_RX;
      const nz = z / SCALP_RZ;
      const r2 = nx * nx + nz * nz;
      const scale = r2 > 0.88 ? Math.sqrt(0.88 / r2) : 1.0;
      const cx = nx * scale;
      const cz = nz * scale;
      const cy = Math.sqrt(Math.max(0.04, 1.0 - cx * cx - cz * cz));
      return new THREE.Vector3(
        HEAD_CENTER_LOCAL.x + cx * (SCALP_RX + lift),
        HEAD_CENTER_LOCAL.y + cy * (SCALP_RY + lift),
        HEAD_CENTER_LOCAL.z + cz * (SCALP_RZ + lift)
      );
    };

    // Hairline phi(|theta|): curved male hairline, receding temples, sideburn down to the ear top
    const hairKnots: Array<[number, number]> = [[0, THREE.MathUtils.lerp(1.42, 1.48, config.bangsLength)], [0.2, 1.37], [0.4, 1.31], [0.62, 1.30], [0.9, 1.06], [1.15, 1.16], [1.4, 1.32], [1.6, 1.50]];
    const hairPhi = (th: number): number => {
      const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
      if (a >= hairKnots[hairKnots.length - 1][0]) return 1.6;
      for (let k = 1; k < hairKnots.length; k++) {
        if (a <= hairKnots[k][0]) {
          const f = (a - hairKnots[k - 1][0]) / (hairKnots[k][0] - hairKnots[k - 1][0]);
          return THREE.MathUtils.lerp(hairKnots[k - 1][1], hairKnots[k][1], f);
        }
      }
      return 1.6;
    };

    // Cut line end phi by |theta|: sideburn over the ear top, arch behind the ear, curved nape (lowest at centre)
    const cropEndPhi = (th: number, napeEnd: number): number =>
      earAlignedCutPhi(th, { hairlinePhi: (x: number) => hairPhi(x) + 0.05, templeRecede: 0, sideburnLength: THREE.MathUtils.lerp(0.2, 0.35, config.sideLength), sideburnTaper: 0.10, earClearance: 0.05, napePhi: napeEnd + 0.02, napeCurve: 1.3 });

    // Zone 1: visible short dome fill (normal locks, solid for the first 58%, staggered tiers so there is no bare scalp)
    for (let tier = 0; tier < 8; tier++) {
      const cnt = tier === 0 ? 0 : 48;
      for (let i = 0; i < cnt; i++) {
        const theta = (i / cnt) * Math.PI * 2 + tier * 0.21 + (rZ1() - 0.5) * 0.03;
        const cosT = Math.cos(theta);
        const lim = cosT > 0.5 ? hairPhi(theta) : cosT > 0.0 ? THREE.MathUtils.lerp(0.82, hairPhi(theta), Math.pow(cosT / 0.5, 1.5)) : THREE.MathUtils.lerp(0.78, 0.92, THREE.MathUtils.smoothstep(-cosT, 0.0, 0.6));
        const phiStart = tier === 0 ? 0.01 : 0.12 + tier * 0.19;
        if (phiStart >= lim - 0.12) continue;
        const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: theta, phiStart, phiEnd: Math.min(lim - 0.02 - 0.07 * THREE.MathUtils.smoothstep(cosT, 0.2, 0.6), phiStart + 0.62), baseLift: 0.0025, midArch: 0.000, tipFlickOut: 0.0, napeHug: 1.4 });
        specs.push({ pointsLocal: pts, width: 0.034 * wMul, thickness: 0.005, stiffnessBias: 0.99, layerAO: 0.97, layerOrder: 0, lockNormal: false, scalpRoot: 0.5 });
      }
    }

    // Zone 1b: front hairline edge (narrow fade-cap band only at the very edge)
    for (let i = 0; i < Math.round(0 * density); i++) {
      const theta = (i / Math.round(420 * density)) * Math.PI * 2;
      if (Math.cos(theta) < 0.3) continue;
      const hp = hairPhi(theta);
      const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: theta, phiStart: hp - 0.12, phiEnd: hp + 0.07, baseLift: 0.0035, midArch: 0.000, tipFlickOut: 0.0, napeHug: 1.2 });
      specs.push({ pointsLocal: pts, width: 0.04 * wMul, thickness: 0.004, stiffnessBias: 0.99, layerAO: 0.97, layerOrder: 1, isFadeCap: true, fadeStart: 0.1, lockNormal: false, scalpRoot: 0.4 });
    }

    // Zone 2: stubble fade cap (isFadeCap): five staggered rows of narrow ribbons from the upper side to cut line - s*band. Each ribbon is dark
    // first, the shader gradient dissolves it; staggered ends make the union a wide gradual fade (about 40% of the cut height).
    const FADE_TOP = 0.78;
    const fadeCols = Math.round(130 * density);
    for (let r = 0; r < 5; r++) {
      const sr = r / 4;
      for (let i = 0; i < fadeCols; i++) {
        const theta = (i / fadeCols) * Math.PI * 2 + r * 0.37 * (Math.PI * 2 / fadeCols) + (rZ2() - 0.5) * 0.02;
        const cosT = Math.cos(theta);
        if (cosT > 0.72) continue; // forehead stays bare below curved hairline
        const cut = cropEndPhi(theta, napeEndBase);
        const end = cut - sr * 0.55 * (cut - FADE_TOP) + (rZ2() - 0.5) * 0.03;
        const top = FADE_TOP - 0.02 + rZ2() * 0.04;
        if (top >= end - 0.15) continue;
        const a2 = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta)));
        const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: theta, phiStart: top, phiEnd: end, baseLift: 0.0016 + 0.0004 * r, midArch: 0.000, tipFlickOut: 0.0, napeHug: 1.55 });
        // taper the fade toward the skull so the nape and sides do not flare into a helmet
        for (let n = 0; n < pts.length; n++) {
          const f = 0.26 * Math.pow(n / (pts.length - 1), 1.5);
          pts[n].x = HEAD_CENTER_LOCAL.x + (pts[n].x - HEAD_CENTER_LOCAL.x) * (1 - f);
          pts[n].z = HEAD_CENTER_LOCAL.z + (pts[n].z - HEAD_CENTER_LOCAL.z) * (1 - f);
        }
        specs.push({ pointsLocal: pts, width: 0.05 * wMul * (a2 > 1.5 && a2 < 1.68 ? 0.6 : 1), thickness: 0.0035, stiffnessBias: 0.99, layerAO: 0.86, layerOrder: 1, isFadeCap: true, fadeStart: 0.30 + rZ2() * 0.12, lockNormal: false, scalpRoot: 0.4 });
      }
    }
    // narrow pointed sideburns in front of each ear (opaque, tapered, tip at about mid-ear height)
    sideburnLocks(specs, { sideburnLength: 0.85, sideburnGap: 0.08, count: 4, width: 0.016, layerOrder: 2, baseLift: 0.004, rootPhi: 1.12 });

    // front hairline in dome (x, z): z of the cut line at |x| (so the dense top ends on the soft M hairline, not a flat bar)
    const hairTab: Array<[number, number]> = [];
    for (let th = 0; th <= 1.5; th += 0.04) {
      const hp = hairPhi(th);
      hairTab.push([Math.sin(hp) * Math.sin(th) * SCALP_RX, Math.sin(hp) * Math.cos(th) * SCALP_RZ]);
    }
    const hairZ = (ax: number): number => {
      let best = hairTab[hairTab.length - 1][1];
      for (let k = 1; k < hairTab.length; k++) {
        if (ax <= hairTab[k][0]) {
          const f = (ax - hairTab[k - 1][0]) / Math.max(1e-6, hairTab[k][0] - hairTab[k - 1][0]);
          best = THREE.MathUtils.lerp(hairTab[k - 1][1], hairTab[k][1], THREE.MathUtils.clamp(f, 0, 1));
          break;
        }
      }
      return best;
    };

    // Zone 3: dense short top, many narrow locks lying forward-up in one direction
    {
      const dx = 0.0105 / Math.sqrt(density), dz = 0.0145 / Math.sqrt(density);
      for (let zc = -0.30; zc <= 0.26; zc += dz) {
        for (let xc = -0.24; xc <= 0.24; xc += dx) {
          const x0 = xc + (rZ3() - 0.5) * dx * 0.9;
          const z0 = zc + (rZ3() - 0.5) * dz * 0.9;
          const rr = (x0 / 0.25) * (x0 / 0.25) + ((z0 + 0.0) / 0.30) * ((z0 + 0.0) / 0.30);
          if (rr > 1.0) continue;
          const zFrac = THREE.MathUtils.clamp((z0 + 0.27) / 0.53, 0, 1);
          const crownR = Math.sqrt(x0 * x0 + z0 * z0);
          const crownK = crownR < 0.13 ? 0.72 + 0.28 * crownR / 0.13 : 1;
          const len = (0.10 - 0.03 * zFrac + config.bangsLength * 0.03 * zFrac) * (0.7 + rZ3() * 0.6) * (1 - 0.3 * Math.pow(zFrac, 1.5)) * crownK;
          const zEnd = z0 + len;
          const zCap = Math.min(0.262 - 0.06 * Math.pow(Math.abs(x0) / 0.25, 2), hairZ(Math.abs(x0))) - rZ3() * 0.022;
          const lenEff = Math.min(len, Math.max(0.05, zCap - z0));
          if (z0 > zCap - 0.01) continue;
          const jx = (rZ3() - 0.5) * 0.03;
          const upQuiff = (0.006 + config.crownVolume * 0.014) * (0.4 + 0.6 * zFrac);
          const pts: THREE.Vector3[] = [];
          for (let n = 0; n < NODES_PER_LOCK; n++) {
            const t = n / (NODES_PER_LOCK - 1);
            const x = x0 + (sweepX * 0.5 + jx) * t;
            const z = z0 + lenEff * t;
            const lift = 0.0016 + 0.0059 * THREE.MathUtils.clamp(zFrac * 2.2, 0, 1) + (0.0012 + upQuiff * 0.6) * Math.pow(t, 0.9);
            pts.push(domePt(x, z, lift));
          }
          void zEnd;
          specs.push({ pointsLocal: pts, width: (0.012 + rZ3() * 0.006) * wMul, thickness: 0.006, stiffnessBias: 0.97, layerAO: 0.985 + rZ3() * 0.015, layerOrder: 3, lockNormal: false, scalpRoot: 0.45 });
        }
      }
    }

    // Zone 3b: slightly spiky top. Distinct pointed clumps of 3-5 narrow locks converging on a raised tip (8-15 mm lift), clear gaps
    // between clumps, varied lengths; front clumps point forward as short spikes on the hairline.
    {
      const smoothS = (x: number) => { const c = THREE.MathUtils.clamp(x, 0, 1); return c * c * (3 - 2 * c); };
      const dxC = 0.075, dzC = 0.08;
      for (let layer = 0; layer < 2; layer++) {
        for (let zc = -0.25; zc <= 0.22; zc += dzC) {
          for (let xc = -0.2; xc <= 0.2; xc += dxC) {
            const x0 = xc + (rZ3() - 0.5) * dxC * 0.8 + layer * dxC * 0.5;
            const z0 = zc + (rZ3() - 0.5) * dzC * 0.8 + layer * dzC * 0.4;
            if ((x0 / 0.235) * (x0 / 0.235) + (z0 / 0.275) * (z0 / 0.275) > 1.0) continue;
            const zf = THREE.MathUtils.clamp((z0 + 0.28) / 0.56, 0, 1);
            const fwdAng = Math.sign(config.bangsSweep || 1) * 0.3 + (rZ3() - 0.5) * 0.7;
            const backAng = Math.PI + (rZ3() - 0.5) * 0.5;
            let ang = zf > 0.4 ? fwdAng : THREE.MathUtils.lerp(backAng, fwdAng, smoothS(zf / 0.4));
            ang += Math.sign(x0 || 1) * 0.5 * smoothS((Math.abs(x0) - 0.08) / 0.1);
            const sA = Math.sin(ang), cA = Math.cos(ang);
            const len = (layer === 0 ? 0.075 + 0.08 * zf : 0.05 + 0.045 * zf) * (0.7 + rZ3() * 0.6);
            const nL = 3 + Math.floor(rZ3() * 3);
            const tl = (0.045 + 0.03 * rZ3()) * (0.85 + 0.5 * config.crownVolume) * (0.75 + 0.4 * zf) * (layer === 0 ? 1 : 0.65);
            const zCap = Math.min(0.262 - 0.06 * Math.pow(Math.abs(x0) / 0.25, 2), hairZ(Math.abs(x0)) + 0.03 * smoothS((zf - 0.7) / 0.2)) - 0.012;
            const lenK = z0 + cA * len > zCap ? Math.max(0.3, (zCap - z0) / Math.max(1e-4, cA * len)) : 1;
            if (z0 > zCap - 0.015) continue;
            for (let k = 0; k < nL; k++) {
              const off = (k - (nL - 1) / 2) / Math.max(1, nL - 1) * 0.05 + (rZ3() - 0.5) * 0.005;
              const rx = x0 + cA * off - sA * 0.02 * rZ3();
              const rz = z0 - sA * off - cA * 0.02 * rZ3();
              const mid = 1 - 0.3 * Math.abs(off) / 0.025;
              const tx = x0 + sA * len * lenK * mid + cA * off * 0.15;
              const tz = z0 + cA * len * lenK * mid - sA * off * 0.15;
              const pts: THREE.Vector3[] = [];
              for (let n = 0; n < NODES_PER_LOCK; n++) {
                const t = n / (NODES_PER_LOCK - 1);
                const lift = 0.006 + tl * Math.pow(t, 1.9) + 0.006 * Math.pow(t, 6);
                pts.push(domePt(THREE.MathUtils.lerp(rx, tx, t), THREE.MathUtils.lerp(rz, tz, t), lift));
              }
              specs.push({ pointsLocal: pts, width: (0.032 + rZ3() * 0.012) * wMul, thickness: 0.008, stiffnessBias: 0.96, layerAO: 0.9 + rZ3() * 0.1, layerOrder: layer === 0 ? 4 : 3, smooth: 2, roundness: 0.4, lockNormal: false, scalpRoot: 0.45 });
            }
          }
        }
      }
    }
    return specs;
  }
  // ARCH-END short-crop

  // =========================================================================
  // NEON-SEED wavy-bard
  // ARCH-BEGIN wavy-bard
  if (arch === 'wavy-bard') {
    // WB-BEGIN wavy-bard: shoulder-length full waves; many narrow round locks in 3 depth layers, S-wave bundles share phase
    const partTheta = THREE.MathUtils.clamp(config.partPosition, -1, 1) * 0.42;
    const backEnd = THREE.MathUtils.lerp(2.75, 3.65, config.backLength);
    const sideEnd = THREE.MathUtils.lerp(2.7, 3.45, config.sideLength);
    const TAU = Math.PI * 2;
    const wrap = (a: number) => { let x = a % TAU; if (x > Math.PI) x -= TAU; if (x < -Math.PI) x += TAU; return x; };
    const eqY = HEAD_CENTER_LOCAL.y + Math.cos(1.75) * SCALP_RY;
    // coherent wave: phase is a smooth function of theta and rank, so neighbours form S bundles
    const wavify = (pts: THREE.Vector3[], th: number, amp: number, phase: number, curl: number) => {
      const tx = Math.cos(th), tz = -Math.sin(th);
      const last = pts.length - 1;
      for (let n = 2; n <= last; n++) {
        const t = n / last;
        const w = (Math.sin(t * TAU * 2.2 + phase) * amp + Math.sin(t * TAU * 0.8 + phase * 0.7 + 1.3) * amp * 0.4 * Math.pow(t, 2.0)) * Math.pow(t, 0.8) * (1 - 0.6 * Math.pow(t, 2.5));
        const c = n >= last - 3 ? Math.pow((n - (last - 3)) / 3, 2) : 0;
        pts[n].x += tx * (w + curl * c * 0.05);
        pts[n].z += tz * (w + curl * c * 0.05);
      }
    };
    // push every node outward from the head (horizontal below the equator): layered parallax
    const radialPush = (pts: THREE.Vector3[], dr: number) => {
      for (let n = 1; n < pts.length; n++) {
        const p = pts[n];
        const dx = p.x - HEAD_CENTER_LOCAL.x, dz = p.z - HEAD_CENTER_LOCAL.z;
        const below = THREE.MathUtils.clamp((eqY - p.y) / 0.25, 0, 1);
        const dy = (p.y - HEAD_CENTER_LOCAL.y) * (1 - below);
        const len = Math.max(1e-4, Math.sqrt(dx * dx + dy * dy + dz * dz));
        const k = dr * Math.min(1, n / 7) / len;
        p.x += dx * k; p.y += dy * k; p.z += dz * k;
      }
    };
    // lift the hair clear of neck and shoulders so the waves sit on the body, widest at the shoulders
    const drape = (pts: THREE.Vector3[], amt: number) => {
      for (let n = 1; n < pts.length; n++) {
        const p = pts[n];
        const dx = p.x - HEAD_CENTER_LOCAL.x, dz = p.z - HEAD_CENTER_LOCAL.z;
        const len = Math.max(1e-4, Math.sqrt(dx * dx + dz * dz));
        const d = THREE.MathUtils.clamp((eqY - p.y - 0.2) / 0.45, 0, 1);
        const k = amt * d * d * (3 - 2 * d) / len;
        p.x += dx * k * 0.6; p.z += dz * k;
      }
    };
    const rMid = seededRand((config.seed || 1) + 23);
    const rFr = seededRand((config.seed || 1) + 51);

    // Zone 1: inner shell, seals the scalp (hidden fill)
    for (let tier = 0; tier < 3; tier++) {
      const count = 22;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * TAU + tier * 0.21;
        const cosT = Math.cos(theta);
        if (tier >= 1 && cosT > 0.3) continue;
        const isBack = cosT < -0.15;
        const phiStart = tier === 0 ? 0.02 : 0.30 + tier * 0.42;
        const pts = buildSculptedLock({
          thetaStart: theta, thetaEnd: theta, phiStart,
          phiEnd: Math.min(isBack ? backEnd - 0.5 : sideEnd - 0.6, phiStart + 1.45, cosT > 0.3 ? 1.2 : 9),
          baseLift: 0.008, midArch: 0.010, tipFlickOut: 0.006, napeHug: 0.8,
        });
        specs.push({
          smooth: 3,
          pointsLocal: pts, width: 0.09 * wMul, thickness: 0.012,
          stiffnessBias: 0.8, layerAO: 0.7, layerOrder: 0, isBaseShell: true,
          lockNormal: false, scalpRoot: tier === 0 ? 0.45 : 0.22,
        });
      }
    }

    // Zone 1a: swept-back crown. Locks root on the hairline (phi ~1.15-1.3, no bare forehead) and flow over the apex to the back of the head.
    for (let row = 0; row < 3; row++) {
      const nS = 64;
      for (let i = 0; i < nS; i++) {
        const a = -1.05 + ((i + row * 0.35) / (nS - 1)) * 2.1;
        const dPart = a - partTheta;
        if (Math.abs(dPart) < 0.035) continue;
        const sd = dPart >= 0 ? 1 : -1;
        const aa = Math.abs(a) / 1.05;
        const phiF = 1.27 + 0.14 * aa * aa + row * 0.06 + (rFr() - 0.5) * 0.2;
        const phiB = 1.9 + rFr() * 0.4;
        const pts: THREE.Vector3[] = [];
        for (let n = 0; n < NODES_PER_LOCK; n++) {
          const u = n / (NODES_PER_LOCK - 1);
          const sPar = THREE.MathUtils.lerp(-phiF, phiB, u);
          const front = sPar < 0;
          const phi = Math.abs(sPar);
          const sway = Math.sin(u * Math.PI * 2.2 + a * 3 + row) * 0.035 * Math.sin(u * Math.PI);
          const th = front ? a * (1 + (1 - Math.abs(sPar) / phiF) * 0.25) + sd * sway : Math.PI - a * 0.85 - sd * 0.1 + sd * sway;
          pts.push(skullSurfacePoint(th, phi, 0.005 + row * 0.003 + Math.sin(u * Math.PI) * 0.004));
        }
        radialPush(pts, 0.0 + row * 0.003);
        specs.push({
          smooth: 3, roundness: 0.65,
          pointsLocal: pts, width: (0.034 + row * 0.004) * wMul, thickness: 0.012,
          stiffnessBias: 0.7, layerAO: 0.86, layerOrder: 3 + row, lockNormal: false, scalpRoot: 0.45,
        });
      }
    }

    // Zone 1b: face-framing locks from the part. Sweep-back pieces end behind the ear, framing pieces fall in front of it.
    for (let row = 0; row < 3; row++) {
      const nR = 34;
      for (let i = 0; i < nR; i++) {
        const th = -0.85 + ((i + row * 0.33) / nR) * 1.7 + (rFr() - 0.5) * 0.02;
        const dPart = th - partTheta;
        const side = dPart >= 0 ? 1 : -1;
        const nearPart = Math.abs(dPart) < 0.06;
        const framing = Math.abs(th) > 0.5 && (i % 3 === 0);
        if (Math.abs(th) < 0.5) continue;
        const thEnd = framing ? side * (1.5 + rFr() * 0.22) : side * (2.0 + row * 0.1 + rFr() * 0.25);
        const phiEnd = framing ? 3.05 + rFr() * 0.35 : 2.5 + row * 0.2 + rFr() * 0.3;
        const pts = buildSculptedLock({
          thetaStart: th, thetaEnd: thEnd,
          phiStart: nearPart ? 0.28 : 0.18 + row * 0.07 + rFr() * 0.08,
          phiEnd,
          baseLift: 0.012 + row * 0.004, midArch: 0.012, tipFlickOut: 0.008, napeHug: 0.7,
        });
        wavify(pts, thEnd, 0.1, TAU * th * 0.55 + row * 0.1, side);
        radialPush(pts, 0.006 + row * 0.008);
        drape(pts, 0.1);
        specs.push({
          smooth: 3, roundness: 0.65,
          pointsLocal: pts, width: (0.032 + row * 0.004) * wMul, thickness: 0.012,
          stiffnessBias: 0.7, layerAO: 0.86, layerOrder: 4 + row, lockNormal: false, scalpRoot: 0.4,
        });
      }
    }

    // Zone 1c: a few face-framing strands falling forward from the part
    for (const side of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        const th = side * (0.3 + k * 0.1 + rFr() * 0.04);
        const pts = buildSculptedLock({
          thetaStart: th, thetaEnd: side * (0.75 + k * 0.1),
          phiStart: 1.2 + rFr() * 0.08, phiEnd: 2.45 + (k % 2) * 0.25 + rFr() * 0.2,
          baseLift: 0.02, midArch: 0.02, tipFlickOut: 0.012, napeHug: 0.6,
        });
        wavify(pts, th, 0.07, k * 1.3 + side, -side);
        radialPush(pts, 0.03 + k * 0.004);
        specs.push({
          smooth: 3, roundness: 0.7,
          pointsLocal: pts, width: 0.034 * wMul, thickness: 0.012,
          stiffnessBias: 0.7, layerAO: 0.9, layerOrder: 7, lockNormal: false, scalpRoot: 0.4,
        });
      }
    }

    // Zone 2: three depth layers of narrow round wavy locks; hem follows the wave phase so neighbours share S bundles
    const L = [
      { n: 70, w: 0.09, dr: 0.004, amp: 0.2, ord: 1 },   // hidden under-fill
      { n: 110, w: 0.075, dr: 0.025, amp: 0.215, ord: 2 },
      { n: 130, w: 0.07, dr: 0.04, amp: 0.23, ord: 3 },
    ];
    for (let layer = 0; layer < 3; layer++) {
      const cfg = L[layer];
      const count = Math.round(cfg.n * density / 1.15);
      for (let i = 0; i < count; i++) {
        const th = wrap((i / count) * TAU + layer * 0.04 + (rMid() - 0.5) * 0.02);
        const cosT = Math.cos(th);
        if (cosT > 0.3) continue;                         // front handled by zone 1b
        const isBack = cosT < -0.2;
        const side = th >= 0 ? 1 : -1;
        const phase = TAU * (th * 0.55 + layer * 0.02);
        const bundle = 0.5 + 0.5 * Math.sin(phase);       // 0..1, shared by neighbours: coherent hem
        let thEnd = th;
        let phiEnd: number;
        if (!isBack) {
          thEnd = Math.abs(th) < 2.05 ? side * (2.1 + bundle * 0.2) : th;
          phiEnd = sideEnd - bundle * 0.3 - rMid() * 0.02;
        } else {
          thEnd = th + (rMid() - 0.5) * 0.04;
          phiEnd = backEnd - bundle * 0.35 - rMid() * 0.02;
        }
        const phiStart = layer * 0.03 + rMid() * 0.06;
        const pts = buildSculptedLock({
          thetaStart: th, thetaEnd: thEnd, phiStart, phiEnd,
          baseLift: 0.014 + layer * 0.004 + config.crownVolume * 0.008,
          midArch: 0.012 + layer * 0.004, tipFlickOut: 0.01 + layer * 0.004,
          napeHug: 0.45,
        });
        wavify(pts, thEnd, cfg.amp, phase, Math.sin(phase * 0.5 + 0.7) >= 0 ? 1 : -1);
        radialPush(pts, cfg.dr);
        drape(pts, 0.14 + layer * 0.01);
        specs.push({
          smooth: 3, roundness: 0.6,
          pointsLocal: pts,
          width: cfg.w * wMul * (0.85 + rMid() * 0.3),
          thickness: 0.013,
          stiffnessBias: 0.7 - layer * 0.06, layerAO: 0.78 + layer * 0.06, layerOrder: cfg.ord,
          lockNormal: false, scalpRoot: 0.3 + 0.03 * (2 - layer),
        });
      }
    }
    return specs;
    // WB-END
  }
  // ARCH-END wavy-bard


  // ARCH-BEGIN messy-mage
  if (arch === 'messy-mage') {
    // Messy Mage v3 (video-game cut): ~30 large layered pointed clumps (bundles of locks), soft hairline, sheen-friendly per-clump AO, thin wisps.
    // theta 0 = front, +-PI/2 = ear sides, PI = back.
    const mkR = (sd: number) => { let st = (sd >>> 0) || 1; return () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; }; };
    const sd0 = config.seed || 1337;
    const rB = mkR(sd0 + 22), rC = mkR(sd0 + 33), rD = mkR(sd0 + 44), rE = mkR(sd0 + 55), rF = mkR(sd0 + 66);
    const sideEnd = THREE.MathUtils.lerp(2.0, 2.5, config.sideLength);
    const backEnd = THREE.MathUtils.lerp(2.4, 2.9, config.backLength);
    const browPhi = THREE.MathUtils.lerp(1.8, 2.05, config.bangsLength);
    const sweep = THREE.MathUtils.clamp(config.bangsSweep, -1, 1);
    const dir = sweep >= 0 ? 1 : -1;
    const aT = (th: number) => Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
    // shell hairline phi by |theta|: forehead, receding temple, ear, behind ear, nape
    const hk: Array<[number, number]> = [[0, 1.34], [0.4, 1.38], [0.7, 1.52], [0.95, 1.78], [1.2, 1.84], [1.4, 1.62], [1.9, 1.55], [2.2, 1.95], [2.7, 2.05], [3.2, 2.08]];
    const hairline = (th: number): number => {
      const a = aT(th);
      for (let k = 1; k < hk.length; k++) {
        if (a <= hk[k][0]) {
          const f = (a - hk[k - 1][0]) / (hk[k][0] - hk[k - 1][0]);
          return THREE.MathUtils.lerp(hk[k - 1][1], hk[k][1], f);
        }
      }
      return hk[hk.length - 1][1];
    };
    const lenAt = (th: number): number => {
      const a = aT(th);
      if (a < 1.0) return browPhi;
      if (a < 1.3) return THREE.MathUtils.lerp(browPhi + 0.1, sideEnd - 0.1, (a - 1.0) / 0.3);
      if (a < 1.9) return 1.5;
      if (a < 2.3) return THREE.MathUtils.lerp(sideEnd - 0.1, backEnd - 0.1, (a - 1.9) / 0.4);
      return backEnd;
    };
    type CO = { th: number; thEnd: number; p0: number; p1: number; n: number; spread: number; w: number; lift: number; arch: number; flick: number; s: number; layer: number; root: number; ao: number; r: () => number; len?: number; fade?: boolean; thick?: number };
    // a clump = bundle of locks converging to a pointed tip, S-curved
    const clump = (o: CO) => {
      for (let k = 0; k < o.n; k++) {
        const u = o.n > 1 ? (k / (o.n - 1)) * 2 - 1 : 0;
        const jit = (o.r() - 0.5);
        const th = o.th + u * o.spread + jit * 0.02;
        const thEnd = o.thEnd + u * o.spread * 0.12 + jit * 0.03;
        const p1 = o.p1 - Math.abs(u) * (o.len ?? 0.07) - o.r() * 0.035;
        const pts = buildSculptedLock({
          thetaStart: th, thetaEnd: thEnd, phiStart: o.p0, phiEnd: Math.max(o.p0 + 0.3, p1),
          baseLift: o.lift, midArch: o.arch * (0.85 + o.r() * 0.3), tipFlickOut: o.flick * (0.7 + o.r() * 0.6),
          sCurveAmp: o.s * (0.8 + 0.4 * o.r()), napeHug: 0.9,
        });
        const sp: any = {
          pointsLocal: pts, width: o.w * wMul * (0.85 + 0.3 * o.r()), thickness: o.thick ?? 0.013, stiffnessBias: 0.8,
          layerAO: THREE.MathUtils.clamp(o.ao + (o.r() - 0.5) * 0.04, 0.5, 1), layerOrder: o.layer, lockNormal: false, scalpRoot: o.root, smooth: 3, roundness: 0.35,
        };
        specs.push(sp);
      }
    };

    // Zone 1: foundation shell. Opaque crown, soft faded hairline on the front half.
    for (let tier = 0; tier < 2; tier++) {
      const count = 34;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2 + tier * 0.09;
        const end = hairline(theta);
        const phiStart = tier === 0 ? 0.01 : 0.55;
        if (end - phiStart < 0.25) continue;
        const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: theta, phiStart, phiEnd: end, baseLift: 0.008, midArch: 0.01, tipFlickOut: 0.01, napeHug: 1.05 });
        const front = aT(theta) < 1.25;
        const sp: any = { pointsLocal: pts, width: 0.095 * wMul, thickness: 0.010, stiffnessBias: 0.92, layerAO: 0.7, layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: 0.4 };
        if (front && tier === 1) { sp.isFadeCap = true; sp.fadeStart = 0.6; }
        specs.push(sp);
      }
    }
    // soft hairline: thin fade-cap ribbons riding the hairline (forehead + receding temples)
    for (let i = 0; i < 22; i++) {
      const frac = (i / 21) * 2 - 1;
      const th = frac * 1.15;
      const hp = hairline(th);
      const pts = buildSculptedLock({ thetaStart: th, thetaEnd: th, phiStart: hp - 0.5, phiEnd: hp + 0.045, baseLift: 0.008, midArch: 0.004, tipFlickOut: 0.002, napeHug: 1.0 });
      specs.push({ pointsLocal: pts, width: 0.07 * wMul, thickness: 0.010, stiffnessBias: 0.9, layerAO: 0.75, layerOrder: 1, isFadeCap: true, fadeStart: 0.55, lockNormal: false, scalpRoot: 0.4, smooth: 2 });
    }
    // baby hairs: tiny fine locks along forehead and temples
    for (let i = 0; i < 30; i++) {
      const frac = (i / 29) * 2 - 1;
      const th = frac * 1.1 + (rF() - 0.5) * 0.06;
      const hp = hairline(th);
      const side = th >= 0 ? 1 : -1;
      const pts = buildSculptedLock({ thetaStart: th, thetaEnd: th + side * (0.03 + rF() * 0.08), phiStart: hp - 0.07, phiEnd: hp + 0.05 + rF() * 0.05, baseLift: 0.008, midArch: 0.01, tipFlickOut: 0.012, sCurveAmp: (rF() - 0.5) * 0.08, napeHug: 1.0 });
      specs.push({ pointsLocal: pts, width: (0.006 + rF() * 0.004) * wMul, thickness: 0.006, stiffnessBias: 0.7, layerAO: 0.8, layerOrder: 5, lockNormal: false, scalpRoot: 0.3, smooth: 3 });
    }

    // Zone 2: back and side tiers. Three tiers (top short, mid, long under-layer), gaps between clumps.
    const tierDefs = [
      { tag: 0, lenOff: 0.36, p0: 0.3, lift: 0.014, arch: 0.04, layer: 2, ao: 1.0, n: 6 },
      { tag: 1, lenOff: 0.16, p0: 0.5, lift: 0.012, arch: 0.05, layer: 3, ao: 1.0, n: 6 },
      { tag: 2, lenOff: 0.0, p0: 0.8, lift: 0.01, arch: 0.04, layer: 4, ao: 0.96, n: 5 },
    ];
    for (const td of tierDefs) {
      const step = td.tag === 1 ? 0.5 : 0.46;
      const off = td.tag * 0.19;
      // right side then back then left side (skip the ear zone)
      for (let a0 = 1.0; a0 < Math.PI * 2 - 0.9; a0 += step) {
        const theta = a0 + off + (rB() - 0.5) * 0.08;
        const a = aT(theta);
        if (a > 1.3 && a < 1.88) continue; // leave the ear clear
        const target = lenAt(theta);
        const mid = a > 1.9;
        const end = target - td.lenOff * (mid ? 1 : 0.8) + (rB() - 0.5) * 0.14;
        clump({
          th: theta, thEnd: theta + (rB() - 0.5) * 0.12, p0: td.p0, p1: end, n: td.n, spread: 0.12 + rB() * 0.04, w: 0.06 + rB() * 0.02,
          lift: td.lift + (mid ? 0.014 : 0.024), arch: td.arch + (mid ? 0.025 : 0.02), flick: mid ? 0.1 + 0.04 * rB() : 0.07, s: (rB() - 0.5) * 0.2, layer: td.layer, root: 0.3, ao: td.ao + (rB() - 0.5) * 0.3, r: rB,
        });
      }
    }
    // temple clumps: cover the gap between fringe and ear, tucked close, receding hairline at the temple
    for (const side of [-1, 1]) {
      for (let j = 0; j < 4; j++) {
        const th0 = side * (0.55 + j * 0.15);
        clump({
          th: th0, thEnd: th0 + side * (0.08 + rB() * 0.05), p0: 0.35, p1: 1.5 + j * 0.03 + rB() * 0.06, n: 6, spread: 0.1, w: 0.055,
          lift: 0.03, arch: 0.04, flick: 0.04, s: side * (rB() - 0.3) * 0.12, layer: 3 + (j % 2), root: 0.3, ao: 0.86 - (j % 2) * 0.08, r: rB,
        });
      }
    }
    // over-ear clumps: hair rests on the top of the ear (ear stays visible below)
    for (const side of [-1, 1]) {
      for (let j = 0; j < 3; j++) {
        const th0 = side * (1.38 + j * 0.2);
        clump({
          th: th0, thEnd: th0 + side * 0.04, p0: 0.5, p1: 1.55 + 0.04 * (j % 2), n: 5, spread: 0.1, w: 0.055,
          lift: 0.05, arch: 0.04, flick: 0.03, s: side * 0.04, layer: 3 + (j % 2), root: 0.3, ao: 0.84 - (j % 2) * 0.06, r: rB,
        });
      }
    }
    // sideburn clumps in front of the ear, tucked close
    for (const side of [-1, 1]) {
      for (let j = 0; j < 3; j++) {
        const th0 = side * (1.12 + j * 0.15);
        clump({
          th: th0, thEnd: th0 + side * (0.05 + 0.04 * j), p0: 0.9, p1: THREE.MathUtils.lerp(sideEnd - 0.3, sideEnd - 0.1, j / 2), n: 7, spread: 0.08, w: 0.055,
          lift: 0.05, arch: 0.05, flick: 0.04, s: side * 0.06, layer: 3 + j, root: 0.3, ao: 0.84 - j * 0.06, r: rB,
        });
      }
      // one thin wisp in front of the ear
      const wp = buildSculptedLock({ thetaStart: side * 1.22, thetaEnd: side * 1.3, phiStart: 0.9, phiEnd: 1.9, baseLift: 0.008, midArch: 0.012, tipFlickOut: 0.03, sCurveAmp: side * 0.05, napeHug: 0.95 });
      specs.push({ pointsLocal: wp, width: 0.011 * wMul, thickness: 0.007, stiffnessBias: 0.75, layerAO: 0.9, layerOrder: 5, lockNormal: false, scalpRoot: 0.3, smooth: 3 });
    }

    // Zone 3: crown clumps radiating from a whorl, volume concentrated here
    const whorl = 2.6;
    const crownN = 9;
    for (let i = 0; i < crownN; i++) {
      const theta = (i / crownN) * Math.PI * 2 + (rC() - 0.5) * 0.2;
      const a = aT(theta);
      const phiStart = 0.04 + rC() * 0.2;
      let end = Math.min(hairline(theta) + 0.1, phiStart + 0.95 + rC() * 0.3);
      if (a < 0.9) end = Math.min(end, 1.0 + rC() * 0.25);
      const twist = 0.35 + 0.35 * Math.cos(theta - whorl) + (rC() - 0.5) * 0.3;
      clump({
        th: theta, thEnd: theta + twist, p0: phiStart, p1: end, n: 6, spread: 0.2, w: 0.04 + rC() * 0.015,
        lift: 0.024, arch: 0.07 + config.crownVolume * 0.04 + spikeAmt * 0.03, flick: 0.035 + spikeAmt * 0.05, s: (rC() - 0.5) * 0.26, layer: 4, root: 0.34, ao: 0.92 + (rC() - 0.5) * 0.1, r: rC,
      });
    }

    // Zone 4: soft side-swept fringe: 7 pointed clumps falling over the brow to one side
    const bangN = 9;
    for (let i = 0; i < bangN; i++) {
      const u = i / (bangN - 1);
      const theta = (u * 2 - 1) * 0.8;
      const edge = 1 - Math.abs(u * 2 - 1);
      const sideBias = 0.5 + 0.5 * dir * (u * 2 - 1);
      const end = browPhi - 0.02 + (rD() - 0.4) * 0.14 - Math.pow(edge, 1.2) * 0.2 * (1 - 0.5 * sideBias) + sideBias * 0.06 + (i % 3 === 0 ? 0.08 : 0);
      clump({
        th: theta, thEnd: theta + dir * (0.28 + rD() * 0.2) * (0.5 + 0.8 * sideBias) + (theta > 0 ? 0.1 : -0.1) * (1 - edge), p0: 0.3 + rD() * 0.2, p1: end, n: 6, spread: 0.12, w: 0.05 + rD() * 0.012,
        lift: 0.02, arch: 0.04 + rD() * 0.015, flick: 0.035 + rD() * 0.03, s: (rD() - 0.5) * 0.18, layer: 6 + (i % 2), root: 0.34, ao: 0.92 - (i % 3) * 0.05, r: rD, len: 0.09,
      });
    }

    // Zone 5: thin wisps flicking off the crown and falling over the fringe, plus two cowlicks
    for (let i = 0; i < 16; i++) {
      let theta: number, phiStart: number, end: number, thEnd: number, arch: number, flick: number;
      if (i < 6) { // flick up from the crown
        theta = 0.2 + i * 0.55 + (rE() - 0.5) * 0.3; phiStart = 0.06 + rE() * 0.2; end = phiStart + 0.45 + rE() * 0.25; thEnd = theta + (rE() - 0.5) * 0.9; arch = 0.13 + rE() * 0.05; flick = 0.08 + rE() * 0.04;
      } else if (i < 11) { // fall over the fringe
        theta = (rE() - 0.5) * 1.3; phiStart = 0.2 + rE() * 0.2; end = browPhi + 0.05 + rE() * 0.1; thEnd = theta + dir * (0.2 + rE() * 0.25); arch = 0.05 + rE() * 0.03; flick = 0.04;
      } else { // back and side flyaways
        theta = (i % 2 ? 1 : -1) * (1.9 + rE() * 1.1); phiStart = 0.3 + rE() * 0.3; end = phiStart + 0.7 + rE() * 0.4; thEnd = theta + (rE() - 0.5) * 0.6; arch = 0.06 + rE() * 0.04; flick = 0.06;
      }
      const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: thEnd, phiStart, phiEnd: end, baseLift: 0.04 + rE() * 0.02, midArch: arch, tipFlickOut: flick, sCurveAmp: (rE() - 0.5) * 0.4, napeHug: 1.0 });
      specs.push({ pointsLocal: pts, width: (0.014 + rE() * 0.005) * wMul, thickness: 0.009, stiffnessBias: 0.6, layerAO: 0.95, layerOrder: 8, lockNormal: false, scalpRoot: 0.4, smooth: 3 });
    }

    return specs;
  }
  // ARCH-END messy-mage

  // ARCH-BEGIN noble-hime
  if (arch === 'noble-hime') {
    // NH-BEGIN noble-hime (long straight sleek, skull-hugging crown, blunt flat fringe, hime panels)
    // Visible hair = many narrow round locks layered inner/mid/outer with 2-4 mm radial offsets.
    const backEnd = THREE.MathUtils.lerp(3.6, 4.6, config.backLength);
    const himeEnd = THREE.MathUtils.lerp(2.35, 2.55, config.sideLength);
    const bluntBrowPhi = THREE.MathUtils.lerp(1.7, 1.9, config.bangsLength);
    const nhRand = seededRand(config.seed * 7 + 11);
    const nhEqY = HEAD_CENTER_LOCAL.y + Math.cos(1.75) * SCALP_RY;
    // push every node outward from the head (horizontal below the equator) so layers stack with parallax
    const radialPush = (pts: THREE.Vector3[], dr: number) => {
      for (let n = 1; n < pts.length; n++) {
        const p = pts[n];
        const dx = p.x - HEAD_CENTER_LOCAL.x, dz = p.z - HEAD_CENTER_LOCAL.z;
        const below = THREE.MathUtils.clamp((nhEqY - p.y) / 0.25, 0, 1);
        const dy = (p.y - HEAD_CENTER_LOCAL.y) * (1 - below);
        const len = Math.max(1e-4, Math.sqrt(dx * dx + dy * dy + dz * dz));
        const k = dr * Math.min(1, n / 3) / len;
        p.x += dx * k; p.y += dy * k; p.z += dz * k;
      }
    };
    // lift the hair clear of the shoulders: below chin depth push outward so it drapes over the body, not into it
    const drape = (pts: THREE.Vector3[], amt: number) => {
      for (let n = 1; n < pts.length; n++) {
        const p = pts[n];
        const dx = p.x - HEAD_CENTER_LOCAL.x, dz = p.z - HEAD_CENTER_LOCAL.z;
        const len = Math.max(1e-4, Math.sqrt(dx * dx + dz * dz));
        const d = THREE.MathUtils.clamp((nhEqY - p.y - 0.28) / 0.5, 0, 1);
        const k = amt * d * d * (3 - 2 * d) / len;
        p.x += dx * k * 0.5; p.z += dz * k;
      }
    };
    // round strand-flow wobble: tiny coherent sideways drift so strands read as individual flow, no hard angles
    const drift = (pts: THREE.Vector3[], th: number, amp: number, ph: number) => {
      const tx = Math.cos(th), tz = -Math.sin(th), last = pts.length - 1;
      for (let n = 3; n <= last; n++) {
        const t = n / last;
        const w = Math.sin(t * Math.PI * 1.2 + ph) * amp * t;
        pts[n].x += tx * w; pts[n].z += tz * w;
      }
    };

    // Zone 1: thin skull-hugging base shell (hidden fill)
    for (let tier = 0; tier < 2; tier++) {
      const count = 24;
      for (let i = 0; i < count; i++) {
        const theta = ((i + 0.5) / count) * Math.PI * 2 + tier * 0.13;
        const aT = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta)));
        const earGap = aT > 1.15 && aT < 1.5;
        if (tier >= 1 && (Math.cos(theta) > 0.6 || earGap)) continue;
        const phiStart = tier === 0 ? 0.12 : 0.5;
        const pts = buildSculptedLock({
          thetaStart: theta, thetaEnd: theta, phiStart,
          phiEnd: Math.min(backEnd - 0.10, phiStart + 1.6, Math.cos(theta) > 0.3 ? 1.25 : earGap ? 1.35 : 9),
          baseLift: 0.002, midArch: 0.002, tipFlickOut: 0.0, napeHug: 0.9,
        });
        specs.push({
          smooth: 3,
          pointsLocal: pts, width: 0.09 * wMul, thickness: 0.01, stiffnessBias: 0.8, layerAO: 0.9,
          layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: tier === 0 ? 0.5 : 0.3,
        });
      }
    }

    // Zone 2: back + rear-side curtain, behind the ears; 3 depth layers, V-ish clean hem
    const earBack = 1.98;
    const layers = [
      { n: 60, w: 0.06, dr: 0.004, ord: 1, round: 0.5 },   // hidden under-fill
      { n: 100, w: 0.04, dr: 0.011, ord: 2, round: 0.65 },  // mid
      { n: 120, w: 0.036, dr: 0.019, ord: 3, round: 0.7 },   // outer
    ];
    for (const L of layers) {
      const cnt = Math.round(L.n * density);
      for (let i = 0; i < cnt; i++) {
        const u = (i + (nhRand() - 0.5) * 0.3) / (cnt - 1);
        const theta = THREE.MathUtils.lerp(earBack, Math.PI * 2 - earBack, THREE.MathUtils.clamp(u, 0, 1));
        const dV = Math.abs(theta - Math.PI) / (Math.PI - earBack);
        const hemEnd = backEnd - 0.2 * Math.pow(dV, 1.4) + (nhRand() - 0.5) * 0.012 - L.ord * 0.012;
        const pts = buildSculptedLock({
          thetaStart: theta, thetaEnd: theta + (nhRand() - 0.5) * 0.02,
          phiStart: 0.12 + L.ord * 0.08 + nhRand() * 0.05, phiEnd: hemEnd,
          baseLift: 0.004 + L.ord * 0.002, midArch: 0.002, tipFlickOut: 0.0, napeHug: 0.35,
        });
        drift(pts, theta, 0.012, nhRand() * 6.28);
        radialPush(pts, L.dr);
        drape(pts, 0.34 + L.ord * 0.012);
        specs.push({
          smooth: 3, roundness: L.round,
          pointsLocal: pts, width: L.w * wMul * (0.85 + nhRand() * 0.3), thickness: 0.011,
          stiffnessBias: 0.8, layerAO: 0.82 + L.ord * 0.04, layerOrder: L.ord, lockNormal: false, scalpRoot: 0.4,
        });
      }
    }

    // Zone 2b: side-crown strands sweeping over and behind the ear (ear tucked, peeking)
    for (const side of [-1, 1]) {
      for (let k = 0; k < 14; k++) {
        const s0 = 1.0 + (k / 13) * 0.5;
        const pts = buildSculptedLock({
          thetaStart: side * s0, thetaEnd: side * (2.4 + (s0 - 1.0) * 0.4),
          phiStart: 0.1 + nhRand() * 0.1, phiEnd: 2.9 - (k % 3) * 0.08 - nhRand() * 0.06,
          baseLift: 0.012, midArch: 0.003, tipFlickOut: 0.0, napeHug: 0.9,
        });
        radialPush(pts, 0.014 + (k % 2) * 0.006);
        drape(pts, 0.3);
        specs.push({
          smooth: 3, roundness: 0.7,
          pointsLocal: pts, width: 0.034 * wMul, thickness: 0.011,
          stiffnessBias: 0.8, layerAO: 0.9, layerOrder: 3 + (k % 2), lockNormal: false, scalpRoot: 0.3,
        });
      }
    }

    // Zone 3: hime panels (jaw length), two layers of straight parallel narrow locks starting behind the fringe
    for (const side of [-1, 1]) {
      for (let layer = 0; layer < 2; layer++) {
        const n = layer === 0 ? 12 : 13;
        for (let k = 0; k < n; k++) {
          const f = k / (n - 1);
          const theta = side * (0.66 + f * 0.78 + layer * 0.03);
          const pts = buildSculptedLock({
            thetaStart: theta * 0.96, thetaEnd: theta,
            phiStart: 0.3 + f * 0.05, phiEnd: himeEnd - f * f * 0.16 - layer * 0.03,
            baseLift: 0.008 + layer * 0.002, midArch: 0.002, tipFlickOut: 0.006, napeHug: 1.0,
          });
          radialPush(pts, 0.006 + layer * 0.012);
          specs.push({
            smooth: 3, roundness: 0.65,
            pointsLocal: pts, width: (layer === 0 ? 0.06 : 0.04) * wMul, thickness: 0.011,
            stiffnessBias: 0.85, layerAO: 0.88, layerOrder: 4 + layer, lockNormal: false, scalpRoot: 0.34,
            ...(layer === 0 ? { isFadeCap: true, fadeStart: 0.97 } : {}),
          });
        }
      }
    }

    // Zone 4: blunt fringe lying flat on the forehead, temple to temple, seam at the centre, equal-length rounded locks
    for (let layer = 0; layer < 2; layer++) {
      const bangCount = Math.round((layer === 0 ? 34 : 56) * density);
      for (let i = 0; i < bangCount; i++) {
        const frac = (i / (bangCount - 1)) * 2 - 1;
        if (Math.abs(frac) < 0.025) continue;
        const theta = frac * 0.6;
        const pts = buildSculptedLock({
          thetaStart: theta * 0.5, thetaEnd: theta,
          phiStart: 0.16 + Math.abs(frac) * 0.05, phiEnd: bluntBrowPhi - frac * frac * 0.2 - layer * 0.03 - (nhRand() - 0.5) * 0.01 * layer,
          baseLift: 0.003 + layer * 0.004, midArch: 0.0, tipFlickOut: 0.0, napeHug: 1.0,
        });
        specs.push({
          smooth: 3, roundness: 0.6,
          pointsLocal: pts, width: (layer === 0 ? 0.05 : 0.032) * wMul, thickness: 0.011,
          stiffnessBias: 0.9, layerAO: 0.9, layerOrder: 6 + layer, lockNormal: false, scalpRoot: 0.36,
          ...(layer === 0 ? { isFadeCap: true, fadeStart: 0.97 } : {}),
        });
      }
    }

    return specs;
    // NH-END
  }
  // ARCH-END noble-hime

  // ARCH-BEGIN low-side-ponytail
if (arch === 'low-side-ponytail') {
  // LP-BEGIN low-side-ponytail: everything sweeps diagonally to a low gather point behind one ear; the tail falls forward over that shoulder
  const tailSide = config.bangsSweep >= 0 ? 1 : -1; // +1 = tail over +X shoulder
  const TAU = Math.PI * 2;
  const lpRand = seededRand((config.seed || 1) * 5 + 17);
  const sm = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const TIE_TH = 2.35, TIE_PHI = 2.0; // in mirrored space (tail side positive)
  const PART_TH = -0.55;              // side part, opposite the tail
  // mirrored-space surface point: thm positive = tail side
  const sp = (thm: number, phi: number, lift: number) => skullSurfacePoint(tailSide * thm, phi, lift);
  const tieAnchor = sp(TIE_TH, TIE_PHI, 0.02);
  const browPhi = THREE.MathUtils.lerp(1.30, 1.46, config.bangsLength);
  const lpEqY = HEAD_CENTER_LOCAL.y + Math.cos(1.75) * SCALP_RY;
  // ear guard: above/over the ear (|theta| 1.5..2.0) the hair stays above the ear top; behind the ear it drops
  const earCap = (thm: number, phi: number) => {
    const a = Math.abs(thm);
    if (a > 1.45 && a < 2.02) return Math.min(phi, EAR_TOP_PHI - 0.07 + 0.5 * sm(1.95, 2.02, a));
    return phi;
  };
  const radialPush = (pts: THREE.Vector3[], dr: number) => {
    for (let n = 1; n < pts.length; n++) {
      const p = pts[n];
      const dx = p.x - HEAD_CENTER_LOCAL.x, dz = p.z - HEAD_CENTER_LOCAL.z;
      const below = THREE.MathUtils.clamp((lpEqY - p.y) / 0.25, 0, 1);
      const dy = (p.y - HEAD_CENTER_LOCAL.y) * (1 - below);
      const len = Math.max(1e-4, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const k = dr * Math.min(1, n / 4) / len;
      p.x += dx * k; p.y += dy * k; p.z += dz * k;
    }
  };

  // quadratic Bezier on the scalp in (theta, phi) space, 12 nodes, last nodes pinned onto the gather disc
  const sweep = (th0: number, ph0: number, th1: number, ph1: number, kth: number, kph: number, lift: number, arch: number, pin?: THREE.Vector3) => {
    const pts: THREE.Vector3[] = [];
    const tm = th0 + (th1 - th0) * kth, pm = ph0 + (ph1 - ph0) * kph;
    for (let n = 0; n < NODES_PER_LOCK; n++) {
      const t = n / (NODES_PER_LOCK - 1), u = 1 - t;
      const th = u * u * th0 + 2 * u * t * tm + t * t * th1;
      let ph = u * u * ph0 + 2 * u * t * pm + t * t * ph1;
      ph = earCap(th, ph);
      pts.push(sp(th, ph, lift + Math.sin(t * Math.PI) * arch));
    }
    if (pin) { pts[NODES_PER_LOCK - 1].copy(pin); pts[NODES_PER_LOCK - 2].lerp(pin, 0.45); }
    return pts;
  };
  const gatherPin = (k: number) => {
    const a = k * 2.39996;
    const r = 0.016 + 0.020 * Math.sqrt(((k * 0.618) % 1));
    return tieAnchor.clone().add(new THREE.Vector3(Math.cos(a) * r * 0.6 * tailSide, Math.sin(a) * r, -Math.abs(Math.cos(a)) * r * 0.5));
  };

  // Layer 0: sealing shell, hugs the scalp (hidden fill), keeps clear of the ears
  for (let tier = 0; tier < 3; tier++) {
    const count = 20;
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * TAU + tier * 0.21;
      const cosT = Math.cos(theta);
      if (tier >= 1 && cosT > 0.6) continue;
      const phiStart = tier === 0 ? 0.01 : 0.24 + tier * 0.36;
      const maxPhi = cosT < -0.20 ? 1.94 : 1.56;
      if (phiStart >= maxPhi - 0.14) continue;
      const pts = buildSculptedLock({
        thetaStart: theta, thetaEnd: theta, phiStart, phiEnd: Math.min(maxPhi, phiStart + 0.9),
        baseLift: 0.002, midArch: 0.002, tipFlickOut: 0.0, napeHug: 1.32,
      });
      specs.push({
        smooth: 2, pointsLocal: pts, width: 0.08 * wMul, thickness: 0.01,
        stiffnessBias: 0.96, layerAO: 0.78, layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: 0.4,
      });
    }
  }

  // Layer 1-2: swept scalp hair. Roots in rows; each sweeps to the gather disc. Left of the part goes round the back, right of it over the tail-side ear.
  const rows: { ph0: number; n: number; lo: number; hi: number; ord: number; lift: number; w: number }[] = [
    { ph0: 0.10, n: 22, lo: 0, hi: TAU, ord: 1, lift: 0.010, w: 0.045 },
    { ph0: 0.55, n: 44, lo: 0, hi: TAU, ord: 1, lift: 0.014, w: 0.040 },
    { ph0: 1.00, n: 64, lo: 0, hi: TAU, ord: 2, lift: 0.018, w: 0.038 },
    { ph0: 1.55, n: 36, lo: 2.2, hi: 4.3, ord: 2, lift: 0.020, w: 0.036 },  // back-of-head low roots (outside ear range)
    { ph0: 1.90, n: 26, lo: 2.6, hi: 3.9, ord: 3, lift: 0.024, w: 0.034 },
  ];
  let kk = 0;
  for (const row of rows) {
    const cnt = Math.round(row.n * density);
    for (let i = 0; i < cnt; i++) {
      let th0 = PART_TH + THREE.MathUtils.lerp(row.lo, row.hi, (i + (lpRand() - 0.5) * 0.6) / cnt);
      if (row.hi - row.lo >= TAU - 0.01 && Math.abs(th0 - PART_TH) < 0.03) continue; // keep the parting line open
      const wrapT = ((th0 + Math.PI) % TAU + TAU) % TAU - Math.PI; // -pi..pi
      const ph0 = row.ph0 + (lpRand() - 0.5) * 0.08;
      // phi cap for roots at the sides so they start above the ear
      const a = Math.abs(wrapT);
      if (a > 1.45 && a < 2.05 && ph0 > 1.45) continue;
      const startTh = wrapT < PART_TH ? wrapT + TAU : wrapT; // start in [PART_TH, PART_TH+TAU)
      const endPhi = TIE_PHI + (lpRand() - 0.5) * 0.04;
      const pts = sweep(startTh, ph0, TIE_TH, endPhi, 0.62, 0.10, row.lift, 0.006, gatherPin(kk++));
      radialPush(pts, 0.002 * row.ord);
      specs.push({
        smooth: 3, roundness: 0.6, pointsLocal: pts, width: (row.w + lpRand() * 0.008) * wMul, thickness: 0.011,
        stiffnessBias: 0.9, layerAO: 0.86, layerOrder: row.ord, lockNormal: false, scalpRoot: 0.38,
      });
    }
  }

  // Layer 3: hairline row, rooted at the hairline (phi ~1.27) and swept over the temple (the side-swept bangs + sides)
  {
    const nH = Math.round(70 * density);
    for (let i = 0; i < nH; i++) {
      const th0 = -1.75 + ((i + (lpRand() - 0.5) * 0.5) / (nH - 1)) * 3.5;
      if (Math.abs(th0 - PART_TH) < 0.03) continue;
      const aa = Math.abs(th0) / 1.75;
      const ph0 = 1.25 + 0.2 * aa * aa + (lpRand() - 0.5) * 0.06;
      const startTh = th0 < PART_TH ? th0 + TAU : th0;
      const pts = sweep(startTh, ph0, TIE_TH, TIE_PHI, 0.66, -0.06, 0.020, 0.004, gatherPin(kk++));
      radialPush(pts, 0.004);
      specs.push({
        smooth: 3, roundness: 0.6, pointsLocal: pts, width: (0.034 + lpRand() * 0.008) * wMul, thickness: 0.011,
        stiffnessBias: 0.86, layerAO: 0.9, layerOrder: 4, lockNormal: false, scalpRoot: 0.35,
      });
    }
  }

  // Layer 4: side-swept bangs rooted at the part, sweeping across the forehead toward the tail side and tucking behind the ear
  {
    const nB = Math.round(26 * density);
    for (let i = 0; i < nB; i++) {
      const f = i / (nB - 1);
      const th0 = PART_TH + 0.04 + f * 0.34 + (lpRand() - 0.5) * 0.04;
      const thMid = 0.55 + f * 0.65;
      const thEnd = 1.35 + f * 0.35;
      const pts: THREE.Vector3[] = [];
      const ph0 = 0.34 + f * 0.1;
      const phEnd = 1.50 + f * 0.04;
      const phMid = browPhi - 0.02 + (lpRand() - 0.5) * 0.04 - 0.05 * f;
      for (let n = 0; n < NODES_PER_LOCK; n++) {
        const t = n / (NODES_PER_LOCK - 1), u = 1 - t;
        const th = u * u * th0 + 2 * u * t * thMid + t * t * thEnd;
        const ph = u * u * ph0 + 2 * u * t * (phMid * 1.45 - 0.45 * ph0 * 0.5) + t * t * phEnd;
        pts.push(sp(th, Math.min(earCap(th, ph), ph), 0.026 + Math.sin(t * Math.PI) * 0.010 + f * 0.003));
      }
      specs.push({
        smooth: 3, roundness: 0.65, pointsLocal: pts, width: (0.032 + lpRand() * 0.008) * wMul, thickness: 0.011,
        stiffnessBias: 0.8, layerAO: 0.94, layerOrder: 5, lockNormal: false, scalpRoot: 0.35,
      });
    }
  }

  // Layer 5: the tail. Axis over the shoulder (mirrored space x>0), bundle of narrow tapered locks around it.
  const axisCtrl = [
    tieAnchor.clone().multiply(new THREE.Vector3(tailSide, 1, 1)),
    new THREE.Vector3(0.25, 0.17, -0.23),
    new THREE.Vector3(0.31, 0.02, -0.15),
    new THREE.Vector3(0.34, -0.10, -0.03),
    new THREE.Vector3(0.34, -0.20, 0.10),
    new THREE.Vector3(0.32, -0.32, 0.20),
    new THREE.Vector3(0.30, -0.45, 0.25),
    new THREE.Vector3(0.29, -0.56, 0.27),
  ].map((v) => new THREE.Vector3(v.x * tailSide, v.y, v.z));
  const curve = new THREE.CatmullRomCurve3(axisCtrl, false, 'catmullrom', 0.5);
  const axisAt = (s: number) => curve.getPointAt(THREE.MathUtils.clamp(s, 0, 1));
  const frame = (s: number) => {
    const T = curve.getTangentAt(THREE.MathUtils.clamp(s, 0, 1)).normalize();
    const N = new THREE.Vector3().crossVectors(T, new THREE.Vector3(0, 0, 1)).normalize();
    const B = new THREE.Vector3().crossVectors(T, N).normalize();
    return { T, N, B };
  };
  const radius = (s: number) => 0.034 + 0.030 * sm(0.0, 0.35, s) - 0.008 * sm(0.6, 1.0, s);
  const lenMul = 0.80 + 0.20 * config.backLength;
  const nT = Math.round(40 * density);
  for (let i = 0; i < nT; i++) {
    const ang0 = i * 2.39996;
    const rr = Math.sqrt((i + 0.5) / nT);
    const sEnd = lenMul * (1 - 0.26 * Math.pow(rr, 1.5) - 0.06 * lpRand());
    const ph = 0.9 + rr * 0.8 + lpRand() * 0.3;
    const pts: THREE.Vector3[] = [];
    for (let n = 0; n < NODES_PER_LOCK; n++) {
      const t = n / (NODES_PER_LOCK - 1);
      const s = t * sEnd;
      const { N, B } = frame(s);
      const taper = 1 - 0.55 * sm(0.55, 1.0, t);
      const R = radius(s) * rr * taper * (n === 0 ? 0.6 : 1);
      const a = ang0 + s * 1.1;
      const wave = Math.sin(TAU * 1.35 * s + ph) * 0.03 * sm(0.08, 0.5, s) * (0.8 + 0.4 * rr);
      const c = axisAt(s);
      const du = Math.cos(a) * R * 1.3 + wave, dv = Math.sin(a) * R * 0.8;
      pts.push(c.clone().addScaledVector(N, du).addScaledVector(B, dv));
    }
    pts[0].copy(tieAnchor).add(new THREE.Vector3((lpRand() - 0.5) * 0.03, (lpRand() - 0.5) * 0.03, (lpRand() - 0.5) * 0.02));
    specs.push({
      smooth: 3, roundness: 0.6, pointsLocal: pts, width: (0.036 + lpRand() * 0.012) * wMul, thickness: 0.014,
      stiffnessBias: 0.6, layerAO: 0.86 + rr * 0.1, layerOrder: 3 + (i % 3), lockNormal: true, scalpRoot: 0.4,
    });
  }
  // tie: two thin rings wrapped round the bundle just below the gather point
  for (let r = 0; r < 2; r++) {
    const s = 0.075 + r * 0.03;
    const c = axisAt(s);
    const { N, B } = frame(s);
    const R = radius(s) * 1.25;
    const pts: THREE.Vector3[] = [];
    for (let n = 0; n < NODES_PER_LOCK; n++) {
      const a = (n / (NODES_PER_LOCK - 1)) * TAU * 0.95 + r;
      pts.push(c.clone().addScaledVector(N, Math.cos(a) * R * 1.3).addScaledVector(B, Math.sin(a) * R * 0.85));
    }
    specs.push({
      smooth: 3, roundness: 1, pointsLocal: pts, width: 0.026 * wMul, thickness: 0.026,
      stiffnessBias: 0.99, layerAO: 0.45, layerOrder: 7, lockNormal: false, scalpRoot: 0.0,
    });
  }
  return specs;
  // LP-END
}
  // ARCH-END low-side-ponytail

  // ARCH-BEGIN mohawk-warrior
if (arch === 'mohawk-warrior') {
  // Shaved sides (wide stubble fade, sharp boundary along the ridge), dense tall clumped ridge from the front hairline over the crown
  // to the nape, optional braided warrior tail. Everything is rooted on the skull midline strip (no cross-head locks).
  const mkU = (sd: number) => { let st = (sd >>> 0) || 1; return () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; }; };
  const seedU = config.seed || 1337;
  const rF = mkU(seedU + 11), rR = mkU(seedU + 22), rT = mkU(seedU + 33), rB = mkU(seedU + 44);
  const ridgeHW = 0.082 + config.layerShag * 0.03; // half width of the ridge strip at the crown (web units)
  const ridgeH = 0.15 + config.crownVolume * 0.12 + spikeAmt * 0.06; // peak lock length (web units, about 50-90 mm Tobin)
  const frontPhi = 1.12; // ridge front hairline
  const backPhi = 2.0; // ridge end at the nape
  const cutPhi = (th: number): number => earAlignedCutPhi(th, { hairlinePhi: 1.25, templeRecede: 0.1, sideburnLength: THREE.MathUtils.lerp(1.1, 1.5, config.sideLength), sideburnTaper: 0.16, earClearance: 0.06, napePhi: 2.12, napeCurve: 1.4 });
  const sm = (x: number) => { const c = THREE.MathUtils.clamp(x, 0, 1); return c * c * (3 - 2 * c); };

  // surface point on the midline strip: s > 0 = front half (theta 0, phi = s), s < 0 = back half (theta pi, phi = -s), xo = lateral offset
  const ellipsoidPt = (p: THREE.Vector3, lift: number): THREE.Vector3 => {
    const q = new THREE.Vector3((p.x - HEAD_CENTER_LOCAL.x) / SCALP_RX, (p.y - HEAD_CENTER_LOCAL.y) / SCALP_RY, (p.z - HEAD_CENTER_LOCAL.z) / SCALP_RZ).normalize();
    return new THREE.Vector3(HEAD_CENTER_LOCAL.x + q.x * (SCALP_RX + lift), HEAD_CENTER_LOCAL.y + q.y * (SCALP_RY + lift), HEAD_CENTER_LOCAL.z + q.z * (SCALP_RZ + lift));
  };
  const stripPt = (s: number, xo: number, lift: number): THREE.Vector3 => {
    const base = s >= 0 ? skullSurfacePoint(0, s, 0) : skullSurfacePoint(Math.PI, -s, 0);
    base.x += xo;
    return ellipsoidPt(base, lift);
  };
  // s runs front hairline (+frontPhi) -> crown (0) -> nape (-backPhi); u = 0..1 along it
  const sOf = (u: number): number => frontPhi - u * (frontPhi + backPhi);
  const hwAt = (u: number): number => ridgeHW * (0.78 + 0.22 * Math.sin(Math.min(1, u * 1.15) * Math.PI)) * (1 - 0.35 * sm((u - 0.7) / 0.3));

  // Layer 0: dark solid shell on the shaved sides (dark stubble above the fade gradient), boundary just outside the ridge
  for (let tier = 0; tier < 3; tier++) {
    const cnt = 34;
    for (let i = 0; i < cnt; i++) {
      const theta = (i / cnt) * Math.PI * 2 + tier * 0.11;
      const sTh = Math.abs(Math.sin(theta));
      if (sTh < 0.3) continue;
      const top = Math.asin(Math.min(1, (ridgeHW * 1.0 + 0.012) / (SCALP_RX * sTh)));
      const end = Math.min(cutPhi(theta) - 0.30, 1.35);
      if (top >= end - 0.05) continue;
      const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: theta, phiStart: top, phiEnd: end, baseLift: 0.0018, midArch: 0.0, tipFlickOut: 0.0, napeHug: 1.4 });
      specs.push({ pointsLocal: pts, width: 0.10 * wMul, thickness: 0.006, stiffnessBias: 0.99, layerAO: 0.7, layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: 0.4 });
    }
  }

  // Layer 1: stubble fade (isFadeCap), 5 staggered rows, wide band, sharp boundary along the ridge edge
  {
    const cols = Math.round(120 * density);
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const sr = r / (rows - 1);
      for (let i = 0; i < cols; i++) {
        const theta = (i / cols) * Math.PI * 2 + r * 0.37 * (Math.PI * 2 / cols) + (rF() - 0.5) * 0.015;
        const sTh = Math.abs(Math.sin(theta));
        if (sTh < 0.3) continue;
        const top = Math.asin(Math.min(1, (ridgeHW * 1.0 + 0.012) / (SCALP_RX * sTh))) + rF() * 0.03;
        const cutL = cutPhi(theta);
        const band = 0.55 * (cutL - top);
        const end = cutL - sr * band + (rF() - 0.5) * 0.03;
        if (top >= end - 0.15) continue;
        const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: theta, phiStart: top, phiEnd: end, baseLift: 0.0016 + 0.0004 * r, midArch: 0.0, tipFlickOut: 0.0, napeHug: 1.55 });
        specs.push({ pointsLocal: pts, width: 0.05 * wMul, thickness: 0.004, stiffnessBias: 0.99, layerAO: 0.8, layerOrder: 1, isFadeCap: true, fadeStart: 0.3 + rF() * 0.2, lockNormal: false, scalpRoot: 0.35 });
      }
    }
    sideburnLocks(specs, { sideburnLength: 1.5, sideburnGap: 0.08, count: 4, width: 0.014, layerOrder: 2, baseLift: 0.004, rootPhi: 1.35 });
  }

  // Layer 2: base strip under the ridge (seals the centre scalp, follows the midline, no wrapping)
  for (let c = 0; c < 3; c++) {
    const cf = c - 1;
    const pts: THREE.Vector3[] = [];
    for (let n = 0; n < NODES_PER_LOCK; n++) {
      const u = n / (NODES_PER_LOCK - 1);
      pts.push(stripPt(sOf(u * 0.93), cf * hwAt(u) * 0.55, 0.006));
    }
    specs.push({ pointsLocal: pts, width: hwAt(0.4) * 0.9 * wMul, thickness: 0.008, stiffnessBias: 0.98, layerAO: 0.75, layerOrder: 1, isBaseShell: true, lockNormal: false, scalpRoot: 0.45 });
  }

  // Layer 3: the ridge. Rows along the midline, narrow tapered locks across the width, grouped into spiky clumps (sawtooth length profile)
  const nClumps = 4;
  const rows = Math.round(26 * density);
  const colsR = 7;
  for (let r = 0; r < rows; r++) {
    const u = 0.01 + (r / (rows - 1)) * 0.9;
    const s = sOf(u);
    const hw = hwAt(u);
    // clump profile: position inside the clump 0..1 (tips at 1), sawtooth with a soft peak
    const cu = u * nClumps;
    const ci = Math.floor(cu);
    const cph = cu - ci;
    const clumpPeak = Math.pow(Math.sin(Math.min(1, cph * 1.25) * Math.PI * 0.5), 1.4) * (1 - 0.25 * sm((cph - 0.85) / 0.15));
    // overall height envelope: low at front hairline, tall over forehead/crown, falling toward the nape
    const env = 0.5 + 0.5 * Math.sin(Math.PI * Math.pow(Math.min(1, u * 1.1), 0.75));
    const tailEnv = 1 - 0.7 * sm((u - 0.62) / 0.36);
    for (let c = 0; c < colsR; c++) {
      const cf = c / (colsR - 1) * 2 - 1; // -1..1
      const xo = cf * hw + (rT() - 0.5) * 0.012;
      const rootLift = 0.006;
      const root = stripPt(s, xo, rootLift);
      const nrm = root.clone().sub(HEAD_CENTER_LOCAL).normalize();
      const side = new THREE.Vector3(Math.sign(cf || 1), 0, 0);
      const backDir = new THREE.Vector3(0, 0.1, -1).normalize();
      const upDir = new THREE.Vector3(0, 1, 0);
      const inFront = s > 0;
      // stand-up direction: on the crown straight up and slightly back, front half tilts forward-up, nape half lies back-down
      let dir = nrm.clone().lerp(upDir, inFront ? 0.55 : THREE.MathUtils.lerp(0.55, 0.1, sm(-s / 1.2))).normalize();
      dir.addScaledVector(backDir, 0.22 + 0.5 * sm(u - 0.35));
      dir.addScaledVector(side, 0.18 * cf * (1 - Math.abs(cf) * 0.2));
      dir.normalize();
      const centreK = 1 - 0.35 * Math.abs(cf);
      const lenMul = (0.52 + 0.48 * clumpPeak) * (0.82 + 0.36 * rT()) * centreK;
      const L = ridgeH * env * Math.max(0.28, tailEnv) * lenMul;
      const pts: THREE.Vector3[] = [];
      const flick = 0.05 + 0.06 * clumpPeak;
      for (let n = 0; n < NODES_PER_LOCK; n++) {
        const t = n / (NODES_PER_LOCK - 1);
        const p = root.clone().addScaledVector(dir, L * t);
        p.addScaledVector(backDir, flick * Math.pow(t, 2.2) * (L / ridgeH + 0.3));
        p.y -= 0.02 * Math.pow(t, 3) * (1 - 0.6 * (config.spikeLift));
        p.x *= 1 - 0.1 * t * Math.abs(cf);
        pts.push(p);
      }
      specs.push({ pointsLocal: pts, width: (0.030 - 0.007 * Math.abs(cf)) * wMul, thickness: 0.013, stiffnessBias: 0.92, layerAO: 0.86 + 0.08 * clumpPeak, layerOrder: 2 + ((r + c) % 3), lockNormal: true, customOutDir: nrm, scalpRoot: 0.45, smooth: 2, roundness: 0.4 });
    }
  }

  // Layer 4: braided warrior tail from the nape (3 interwoven strands, each a few narrow locks), tied at the end
  if (config.backLength > 0.1) {
    const tailLen = 0.22 + config.backLength * 0.5;
    const anchor = skullSurfacePoint(Math.PI, 1.95, 0.012);
    const strands = 3, per = 4;
    for (let sidx = 0; sidx < strands; sidx++) {
      for (let k = 0; k < per; k++) {
        const ph0 = (sidx / strands) * Math.PI * 2;
        const lockOff = (k - (per - 1) / 2) * 0.007;
        const pts: THREE.Vector3[] = [];
        for (let n = 0; n < NODES_PER_LOCK; n++) {
          const t = n / (NODES_PER_LOCK - 1);
          const drop = tailLen * Math.pow(t, 1.1);
          const out = 0.055 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) + 0.035 * t;
          const weave = Math.sin(t * Math.PI * 5.2 + ph0) * 0.02 * Math.min(1, t * 3) * (1 - 0.7 * sm((t - 0.85) / 0.15));
          const weaveZ = Math.cos(t * Math.PI * 5.2 + ph0) * 0.012 * Math.min(1, t * 3);
          pts.push(new THREE.Vector3(anchor.x + weave + lockOff * (1 - t * 0.7), anchor.y - drop * 0.95 + 0.01, anchor.z - out + weaveZ));
        }
        specs.push({ pointsLocal: pts, width: 0.026 * wMul, thickness: 0.016, stiffnessBias: 0.7, layerAO: 0.92, layerOrder: 5, lockNormal: true, scalpRoot: 0.5, smooth: 2, roundness: 0.5 });
      }
    }
  }

  return specs;
}
  // ARCH-END mohawk-warrior

  // ARCH-BEGIN pixie-cut
  if (arch === 'pixie-cut') {
    const sideEndBase = THREE.MathUtils.lerp(1.55, 1.68, config.sideLength); // down to the ear top
    const napeEndBase = THREE.MathUtils.lerp(2.05, 2.28, config.backLength);
    const sweepX = THREE.MathUtils.clamp(config.bangsSweep, -1, 1) * 0.045;
    const topVol = 0.016 + config.crownVolume * 0.020;
    const mkR = (sd: number) => { let st = (sd >>> 0) || 1; return () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; }; };
    const rZ1 = mkR((config.seed || 1337) + 101), rZ2 = mkR((config.seed || 1337) + 202), rZ3 = mkR((config.seed || 1337) + 303);

    // Helper: map upper-dome (x, z) directly onto skull surface with custom radial lift
    const domePt = (x: number, z: number, lift: number): THREE.Vector3 => {
      const nx = x / SCALP_RX;
      const nz = z / SCALP_RZ;
      const r2 = nx * nx + nz * nz;
      const scale = r2 > 0.88 ? Math.sqrt(0.88 / r2) : 1.0;
      const cx = nx * scale;
      const cz = nz * scale;
      const cy = Math.sqrt(Math.max(0.04, 1.0 - cx * cx - cz * cz));
      return new THREE.Vector3(
        HEAD_CENTER_LOCAL.x + cx * (SCALP_RX + lift),
        HEAD_CENTER_LOCAL.y + cy * (SCALP_RY + lift),
        HEAD_CENTER_LOCAL.z + cz * (SCALP_RZ + lift)
      );
    };

    // Hairline phi(|theta|): curved male hairline, receding temples, sideburn down to the ear top
    const hairKnots: Array<[number, number]> = [[0, THREE.MathUtils.lerp(1.42, 1.48, config.bangsLength)], [0.2, 1.37], [0.4, 1.31], [0.62, 1.30], [0.9, 1.06], [1.15, 1.16], [1.4, 1.32], [1.6, 1.50]];
    const hairPhi = (th: number): number => {
      const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
      if (a >= hairKnots[hairKnots.length - 1][0]) return 1.6;
      for (let k = 1; k < hairKnots.length; k++) {
        if (a <= hairKnots[k][0]) {
          const f = (a - hairKnots[k - 1][0]) / (hairKnots[k][0] - hairKnots[k - 1][0]);
          return THREE.MathUtils.lerp(hairKnots[k - 1][1], hairKnots[k][1], f);
        }
      }
      return 1.6;
    };

    // Cut line end phi by |theta|: sideburn over the ear top, arch behind the ear, curved nape (lowest at centre)
    const cropEndPhi = (th: number, napeEnd: number): number =>
      earAlignedCutPhi(th, { hairlinePhi: (x: number) => hairPhi(x) + 0.05, templeRecede: 0, sideburnLength: THREE.MathUtils.lerp(0.2, 0.35, config.sideLength), sideburnTaper: 0.10, earClearance: 0.05, napePhi: napeEnd + 0.02, napeCurve: 1.3 });

    // Zone 1: visible short dome fill (normal locks, solid for the first 58%, staggered tiers so there is no bare scalp)
    for (let tier = 0; tier < 8; tier++) {
      const cnt = tier === 0 ? 0 : 48;
      for (let i = 0; i < cnt; i++) {
        const theta = (i / cnt) * Math.PI * 2 + tier * 0.21 + (rZ1() - 0.5) * 0.03;
        const cosT = Math.cos(theta);
        const lim = cosT > 0.5 ? hairPhi(theta) : cosT > 0.0 ? THREE.MathUtils.lerp(0.82, hairPhi(theta), Math.pow(cosT / 0.5, 1.5)) : THREE.MathUtils.lerp(0.78, 0.92, THREE.MathUtils.smoothstep(-cosT, 0.0, 0.6));
        const phiStart = tier === 0 ? 0.01 : 0.12 + tier * 0.19;
        if (phiStart >= lim - 0.12) continue;
        const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: theta, phiStart, phiEnd: Math.min(lim - 0.02 - 0.07 * THREE.MathUtils.smoothstep(cosT, 0.2, 0.6), phiStart + 0.62), baseLift: 0.0025, midArch: 0.000, tipFlickOut: 0.0, napeHug: 1.4 });
        specs.push({ pointsLocal: pts, width: 0.034 * wMul, thickness: 0.005, stiffnessBias: 0.99, layerAO: 0.97, layerOrder: 0, lockNormal: false, scalpRoot: 0.5 });
      }
    }

    // Zone 1b: front hairline edge (narrow fade-cap band only at the very edge)
    for (let i = 0; i < Math.round(0 * density); i++) {
      const theta = (i / Math.round(420 * density)) * Math.PI * 2;
      if (Math.cos(theta) < 0.3) continue;
      const hp = hairPhi(theta);
      const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: theta, phiStart: hp - 0.12, phiEnd: hp + 0.07, baseLift: 0.0035, midArch: 0.000, tipFlickOut: 0.0, napeHug: 1.2 });
      specs.push({ pointsLocal: pts, width: 0.04 * wMul, thickness: 0.004, stiffnessBias: 0.99, layerAO: 0.97, layerOrder: 1, isFadeCap: true, fadeStart: 0.1, lockNormal: false, scalpRoot: 0.4 });
    }

    // Zone 2: stubble fade cap (isFadeCap): five staggered rows of narrow ribbons from the upper side to cut line - s*band. Each ribbon is dark
    // first, the shader gradient dissolves it; staggered ends make the union a wide gradual fade (about 40% of the cut height).
    const FADE_TOP = 0.78;
    const fadeCols = Math.round(130 * density);
    for (let r = 0; r < 5; r++) {
      const sr = r / 4;
      for (let i = 0; i < fadeCols; i++) {
        const theta = (i / fadeCols) * Math.PI * 2 + r * 0.37 * (Math.PI * 2 / fadeCols) + (rZ2() - 0.5) * 0.02;
        const cosT = Math.cos(theta);
        if (cosT > 0.72) continue; // forehead stays bare below curved hairline
        const cut = cropEndPhi(theta, napeEndBase);
        const end = cut - sr * 0.55 * (cut - FADE_TOP) + (rZ2() - 0.5) * 0.03;
        const top = FADE_TOP - 0.02 + rZ2() * 0.04;
        if (top >= end - 0.15) continue;
        const a2 = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta)));
        const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: theta, phiStart: top, phiEnd: end, baseLift: 0.0016 + 0.0004 * r, midArch: 0.000, tipFlickOut: 0.0, napeHug: 1.55 });
        // taper the fade toward the skull so the nape and sides do not flare into a helmet
        for (let n = 0; n < pts.length; n++) {
          const f = 0.26 * Math.pow(n / (pts.length - 1), 1.5);
          pts[n].x = HEAD_CENTER_LOCAL.x + (pts[n].x - HEAD_CENTER_LOCAL.x) * (1 - f);
          pts[n].z = HEAD_CENTER_LOCAL.z + (pts[n].z - HEAD_CENTER_LOCAL.z) * (1 - f);
        }
        specs.push({ pointsLocal: pts, width: 0.05 * wMul * (a2 > 1.5 && a2 < 1.68 ? 0.6 : 1), thickness: 0.0035, stiffnessBias: 0.99, layerAO: 0.86, layerOrder: 1, isFadeCap: true, fadeStart: 0.30 + rZ2() * 0.12, lockNormal: false, scalpRoot: 0.4 });
      }
    }
    // narrow pointed sideburns in front of each ear (opaque, tapered, tip at about mid-ear height)
    sideburnLocks(specs, { sideburnLength: 0.85, sideburnGap: 0.08, count: 4, width: 0.016, layerOrder: 2, baseLift: 0.004, rootPhi: 1.12 });

    // front hairline in dome (x, z): z of the cut line at |x| (so the dense top ends on the soft M hairline, not a flat bar)
    const hairTab: Array<[number, number]> = [];
    for (let th = 0; th <= 1.5; th += 0.04) {
      const hp = hairPhi(th);
      hairTab.push([Math.sin(hp) * Math.sin(th) * SCALP_RX, Math.sin(hp) * Math.cos(th) * SCALP_RZ]);
    }
    const hairZ = (ax: number): number => {
      let best = hairTab[hairTab.length - 1][1];
      for (let k = 1; k < hairTab.length; k++) {
        if (ax <= hairTab[k][0]) {
          const f = (ax - hairTab[k - 1][0]) / Math.max(1e-6, hairTab[k][0] - hairTab[k - 1][0]);
          best = THREE.MathUtils.lerp(hairTab[k - 1][1], hairTab[k][1], THREE.MathUtils.clamp(f, 0, 1));
          break;
        }
      }
      return best;
    };

    // Zone 3: dense short top, many narrow locks lying forward-up in one direction
    {
      const dx = 0.0105 / Math.sqrt(density), dz = 0.0145 / Math.sqrt(density);
      for (let zc = -0.30; zc <= 0.26; zc += dz) {
        for (let xc = -0.24; xc <= 0.24; xc += dx) {
          const x0 = xc + (rZ3() - 0.5) * dx * 0.9;
          const z0 = zc + (rZ3() - 0.5) * dz * 0.9;
          const rr = (x0 / 0.25) * (x0 / 0.25) + ((z0 + 0.0) / 0.30) * ((z0 + 0.0) / 0.30);
          if (rr > 1.0) continue;
          const zFrac = THREE.MathUtils.clamp((z0 + 0.27) / 0.53, 0, 1);
          const crownR = Math.sqrt(x0 * x0 + z0 * z0);
          const crownK = crownR < 0.13 ? 0.72 + 0.28 * crownR / 0.13 : 1;
          const len = (0.10 - 0.03 * zFrac + config.bangsLength * 0.03 * zFrac) * (0.7 + rZ3() * 0.6) * (1 - 0.3 * Math.pow(zFrac, 1.5)) * crownK;
          const zEnd = z0 + len;
          const zCap = Math.min(0.262 - 0.06 * Math.pow(Math.abs(x0) / 0.25, 2), hairZ(Math.abs(x0))) - rZ3() * 0.022;
          const lenEff = Math.min(len, Math.max(0.05, zCap - z0));
          if (z0 > zCap - 0.01) continue;
          const jx = (rZ3() - 0.5) * 0.03;
          const upQuiff = (0.006 + config.crownVolume * 0.014) * (0.4 + 0.6 * zFrac);
          const pts: THREE.Vector3[] = [];
          for (let n = 0; n < NODES_PER_LOCK; n++) {
            const t = n / (NODES_PER_LOCK - 1);
            const x = x0 + (sweepX * 0.5 + jx) * t;
            const z = z0 + lenEff * t;
            const lift = 0.0016 + 0.0059 * THREE.MathUtils.clamp(zFrac * 2.2, 0, 1) + (0.0012 + upQuiff * 0.6) * Math.pow(t, 0.9);
            pts.push(domePt(x, z, lift));
          }
          void zEnd;
          specs.push({ pointsLocal: pts, width: (0.012 + rZ3() * 0.006) * wMul, thickness: 0.006, stiffnessBias: 0.97, layerAO: 0.985 + rZ3() * 0.015, layerOrder: 3, lockNormal: false, scalpRoot: 0.45 });
        }
      }
    }

    // Zone 3b: slightly spiky top. Distinct pointed clumps of 3-5 narrow locks converging on a raised tip (8-15 mm lift), clear gaps
    // between clumps, varied lengths; front clumps point forward as short spikes on the hairline.
    {
      const smoothS = (x: number) => { const c = THREE.MathUtils.clamp(x, 0, 1); return c * c * (3 - 2 * c); };
      const dxC = 0.075, dzC = 0.08;
      for (let layer = 0; layer < 2; layer++) {
        for (let zc = -0.25; zc <= 0.22; zc += dzC) {
          for (let xc = -0.2; xc <= 0.2; xc += dxC) {
            const x0 = xc + (rZ3() - 0.5) * dxC * 0.8 + layer * dxC * 0.5;
            const z0 = zc + (rZ3() - 0.5) * dzC * 0.8 + layer * dzC * 0.4;
            if ((x0 / 0.235) * (x0 / 0.235) + (z0 / 0.275) * (z0 / 0.275) > 1.0) continue;
            const zf = THREE.MathUtils.clamp((z0 + 0.28) / 0.56, 0, 1);
            const fwdAng = Math.sign(config.bangsSweep || 1) * 0.3 + (rZ3() - 0.5) * 0.7;
            const backAng = Math.PI + (rZ3() - 0.5) * 0.5;
            let ang = zf > 0.4 ? fwdAng : THREE.MathUtils.lerp(backAng, fwdAng, smoothS(zf / 0.4));
            ang += Math.sign(x0 || 1) * 0.5 * smoothS((Math.abs(x0) - 0.08) / 0.1);
            const sA = Math.sin(ang), cA = Math.cos(ang);
            const len = (layer === 0 ? 0.075 + 0.08 * zf : 0.05 + 0.045 * zf) * (0.7 + rZ3() * 0.6);
            const nL = 3 + Math.floor(rZ3() * 3);
            const tl = (0.045 + 0.03 * rZ3()) * (0.85 + 0.5 * config.crownVolume) * (0.75 + 0.4 * zf) * (layer === 0 ? 1 : 0.65);
            const zCap = Math.min(0.262 - 0.06 * Math.pow(Math.abs(x0) / 0.25, 2), hairZ(Math.abs(x0)) + 0.03 * smoothS((zf - 0.7) / 0.2)) - 0.012;
            const lenK = z0 + cA * len > zCap ? Math.max(0.3, (zCap - z0) / Math.max(1e-4, cA * len)) : 1;
            if (z0 > zCap - 0.015) continue;
            for (let k = 0; k < nL; k++) {
              const off = (k - (nL - 1) / 2) / Math.max(1, nL - 1) * 0.05 + (rZ3() - 0.5) * 0.005;
              const rx = x0 + cA * off - sA * 0.02 * rZ3();
              const rz = z0 - sA * off - cA * 0.02 * rZ3();
              const mid = 1 - 0.3 * Math.abs(off) / 0.025;
              const tx = x0 + sA * len * lenK * mid + cA * off * 0.15;
              const tz = z0 + cA * len * lenK * mid - sA * off * 0.15;
              const pts: THREE.Vector3[] = [];
              for (let n = 0; n < NODES_PER_LOCK; n++) {
                const t = n / (NODES_PER_LOCK - 1);
                const lift = 0.006 + tl * Math.pow(t, 1.9) + 0.006 * Math.pow(t, 6);
                pts.push(domePt(THREE.MathUtils.lerp(rx, tx, t), THREE.MathUtils.lerp(rz, tz, t), lift));
              }
              specs.push({ pointsLocal: pts, width: (0.032 + rZ3() * 0.012) * wMul, thickness: 0.008, stiffnessBias: 0.96, layerAO: 0.9 + rZ3() * 0.1, layerOrder: layer === 0 ? 4 : 3, smooth: 2, roundness: 0.4, lockNormal: false, scalpRoot: 0.45 });
            }
          }
        }
      }
    }
    return specs;
  }
  // ARCH-END pixie-cut

  // ARCH-BEGIN twin-buns
if (arch === 'twin-buns') {
  const V3 = THREE.Vector3;
  const tbStart = specs.length;
  const KX = 0.74, KZ = 0.82;
  const snugP = (p: THREE.Vector3, kx = KX, kz = KZ) => {
    const lowT = THREE.MathUtils.clamp((HEAD_CENTER_LOCAL.y - p.y) / 0.1, 0, 1);
    const nT = THREE.MathUtils.clamp((HEAD_CENTER_LOCAL.y - 0.1 - p.y) / 0.15, 0, 1);
    p.x = HEAD_CENTER_LOCAL.x + (p.x - HEAD_CENTER_LOCAL.x) * (kx - 0.12 * lowT - 0.12 * nT);
    p.z = HEAD_CENTER_LOCAL.z + (p.z - HEAD_CENTER_LOCAL.z) * (kz - 0.08 * lowT - 0.08 * nT);
    return p;
  };
  // hairline: high forehead, hair covers the temples, short sideburn in front of the ear, tapered nape
  const frontKnots: Array<[number, number]> = [[0, 1.24], [0.3, 1.2], [0.6, 1.2], [0.9, 1.3], [1.15, 1.42], [1.3, 1.5]];
  const frontHair = (a: number): number => {
    for (let k = 1; k < frontKnots.length; k++) {
      if (a <= frontKnots[k][0]) {
        const u = (a - frontKnots[k - 1][0]) / (frontKnots[k][0] - frontKnots[k - 1][0]);
        return THREE.MathUtils.lerp(frontKnots[k - 1][1], frontKnots[k][1], u * u * (3 - 2 * u));
      }
    }
    return frontKnots[frontKnots.length - 1][1];
  };
  const cutPhi = (th: number): number => {
    const v = earAlignedCutPhi(th, { hairlinePhi: frontHair, templeRecede: 0, sideburnLength: 0.3, sideburnGap: 0.12, sideburnTaper: 0.12, earClearance: 0.12, behindEarPhi: 1.95, napePhi: 2.4, napeCurve: 0.8 });
    const a = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
    const w = THREE.MathUtils.smoothstep(a, 1.9, 1.98);
    const tgt = THREE.MathUtils.lerp(1.92, 2.4, Math.pow(Math.max(0, a - 2.0) / (Math.PI - 2.0), 0.9));
    return a > 1.9 ? Math.max(v, THREE.MathUtils.lerp(v, tgt, w)) : v;
  };

  // ---- bun geometry (snugged space) ----
  const bunR = 0.07 + config.crownVolume * 0.03;
  const bunTheta = 1.5, bunPhi = 0.72;
  const buns = [-1, 1].map((side) => {
    const surf = snugP(skullSurfacePoint(side * bunTheta, bunPhi, 0.0));
    const A = new V3(side * 0.7, 0.62, -0.38).normalize();
    const C = surf.clone().addScaledVector(A, bunR * 0.55);
    const U = new V3().crossVectors(A, new V3(0, 0, 1)).normalize();
    const W = new V3().crossVectors(A, U).normalize();
    return { side, A, C, U, W };
  });

  // Zone 1: snug scalp cover under the pulled strands
  for (let tier = 0; tier < 2; tier++) {
    const count = 26;
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2 + tier * 0.12;
      const pts = buildSculptedLock({
        thetaStart: theta, thetaEnd: theta, phiStart: 0.02 + tier * 0.4, phiEnd: Math.min(0.85 + tier * 0.3, cutPhi(theta) - 0.15),
        baseLift: 0.001, midArch: 0.001, tipFlickOut: 0.0, napeHug: 1.35,
      });
      specs.push({
        pointsLocal: pts, width: 0.07 * wMul, thickness: 0.006, stiffnessBias: 0.98, layerAO: 0.95,
        layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: 0.4,
      });
    }
  }
  for (let i = 0; i < 64; i++) {
    const theta = (i / 64) * Math.PI * 2 + 0.05;
    const endP = cutPhi(theta) - 0.1;
    if (endP < 1.2) continue;
    const pts = buildSculptedLock({
      thetaStart: theta, thetaEnd: theta, phiStart: 0.95, phiEnd: endP,
      baseLift: 0.001, midArch: 0.001, tipFlickOut: 0.0, napeHug: 1.35,
    });
    specs.push({
      pointsLocal: pts, width: 0.05 * wMul, thickness: 0.006, stiffnessBias: 0.98, layerAO: 0.95,
      layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: 0.4,
    });
  }

  // Zone 2: strands rooted on the cut line, combed up along the dome into the nearer bun neck
  const bunDirs = buns.map((b) => {
    const N = b.C.clone().addScaledVector(b.A, -bunR * 0.6);
    const d = new V3((N.x - HEAD_CENTER_LOCAL.x) / KX / SCALP_RX, (N.y - HEAD_CENTER_LOCAL.y) / SCALP_RY, (N.z - HEAD_CENTER_LOCAL.z) / KZ / SCALP_RZ);
    return d.normalize();
  });
  const pullStrand = (theta: number, phi0: number, width: number, order: number, spread: number, side: number) => {
    const u0 = new V3(Math.sin(theta) * Math.sin(phi0), Math.cos(phi0), Math.cos(theta) * Math.sin(phi0));
    const end = bunDirs[side > 0 ? 1 : 0].clone();
    end.x += (rand() - 0.5) * spread; end.y += (rand() - 0.5) * spread * 0.6; end.z += (rand() - 0.5) * spread; end.normalize();
    const omega = Math.acos(THREE.MathUtils.clamp(u0.dot(end), -1, 1));
    const so = Math.max(Math.sin(omega), 1e-4);
    const lift0 = 0.0002 + rand() * 0.0006 + order * 0.0003;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < NODES_PER_LOCK; k++) {
      const t = Math.pow(k / (NODES_PER_LOCK - 1), 1.3);
      const w0 = Math.sin((1 - t) * omega) / so;
      const w1 = Math.sin(t * omega) / so;
      const u = u0.clone().multiplyScalar(w0).addScaledVector(end, w1);
      const ph = Math.acos(THREE.MathUtils.clamp(u.y, -1, 1));
      const th = Math.atan2(u.x, u.z);
      pts.push(skullSurfacePoint(th, ph, lift0 + Math.sin(t * Math.PI) * 0.001));
    }
    specs.push({
      pointsLocal: pts, width, thickness: 0.005, stiffnessBias: 0.97,
      layerAO: 0.97, layerOrder: order, lockNormal: Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta))) > 1.9 && phi0 > 1.85, scalpRoot: 0.35, smooth: 3, roundness: 0.5,
    });
  };
  const sideOf = (th: number) => (Math.sin(th) >= 0 ? 1 : -1);
  const pullCount = Math.round(440 * density);
  for (let i = 0; i < pullCount; i++) {
    const theta = ((i + 0.5) / pullCount) * Math.PI * 2 + (rand() - 0.5) * 0.01;
    pullStrand(theta, cutPhi(theta) - 0.02 + (rand() - 0.5) * 0.006, (0.026 + rand() * 0.008) * wMul, 0, 0.14, sideOf(theta));
  }
  for (let i = 0; i < pullCount; i++) {
    const theta = ((i + 1) / pullCount) * Math.PI * 2;
    pullStrand(theta, cutPhi(theta) - 0.07 - rand() * 0.03, (0.026 + rand() * 0.008) * wMul, 1, 0.14, sideOf(theta));
  }

  // Zone 2b: tapered nape, soft stubble fade caps
  {
    const cols = Math.round(190 * density);
    for (let i = 0; i < cols; i++) {
      const theta = (i / cols) * Math.PI * 2 + (rand() - 0.5) * 0.01;
      const cosT = Math.cos(theta);
      const aa = Math.abs(Math.atan2(Math.sin(theta), cosT));
      if (aa < 1.75) continue;
      const nz = Math.max(0, aa - 2.2) / 0.94;
      const lim = cutPhi(theta) + 0.05 + 0.1 * nz;
      const top = lim - 0.22 - 0.03 * nz;
      const pts = buildSculptedLock({
        thetaStart: theta, thetaEnd: theta, phiStart: top, phiEnd: lim,
        baseLift: 0.0003, midArch: 0.0, tipFlickOut: 0.0, napeHug: 1.55,
      });
      specs.push({
        pointsLocal: pts, width: 0.03 * wMul, thickness: 0.003, stiffnessBias: 0.99,
        layerAO: 0.92, layerOrder: 1, isFadeCap: true, fadeStart: 0.3, lockNormal: true, scalpRoot: 0.35,
      });
    }
  }
  // snug the dome cover
  for (let si = tbStart; si < specs.length; si++) {
    if (specs[si].isFadeCap) {
      for (const p of specs[si].pointsLocal) snugP(p);
      continue;
    }
    for (const p of specs[si].pointsLocal) snugP(p);
  }

  // cover caps around the bun bases (no scalp pinholes where strands converge)
  for (let i = 0; i < 28; i++) {
    const theta = (i / 28) * Math.PI * 2 + 0.03;
    const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: theta, phiStart: 0.3, phiEnd: 1.0, baseLift: 0.004, midArch: 0.001, tipFlickOut: 0.0, napeHug: 1.35 });
    for (const p of pts) snugP(p);
    specs.push({ pointsLocal: pts, width: 0.06 * wMul, thickness: 0.006, stiffnessBias: 0.98, layerAO: 0.95, layerOrder: 1, lockNormal: false, scalpRoot: 0.4 });
  }

  // Zone 3: the two buns, helical coils around the bun axis, pinched neck, tie rings
  for (const b of buns) {
    const coilCount = Math.round(54 * density);
    for (let i = 0; i < coilCount; i++) {
      const a0 = (i / coilCount) * Math.PI * 2;
      const pts: THREE.Vector3[] = [];
      const turns = 0.9 + rand() * 0.25;
      for (let k = 0; k < NODES_PER_LOCK; k++) {
        const t = k / (NODES_PER_LOCK - 1);
        const hh = THREE.MathUtils.lerp(-0.72, 0.9, Math.sin(t * Math.PI * 0.5));
        const prof = Math.sqrt(Math.max(0.2, 1 - hh * hh)) * (1 - 0.48 * Math.exp(-Math.pow((hh + 0.62) / 0.12, 2))) * (hh < -0.4 ? 0.9 : 1.0);
        const rr = bunR * (prof * 1.02 + 0.004);
        const a = a0 + turns * t * Math.PI * 1.2 * b.side;
        pts.push(b.C.clone().addScaledVector(b.A, bunR * 0.92 * hh).addScaledVector(b.U, Math.cos(a) * rr).addScaledVector(b.W, Math.sin(a) * rr * 1.1));
      }
      specs.push({ pointsLocal: pts, width: 0.04 * wMul, thickness: 0.01, stiffnessBias: 0.95, layerAO: 1.0, layerOrder: 2, lockNormal: false, scalpRoot: 0.5, smooth: 2 });
    }
    const tieR = (hh: number) => bunR * (Math.sqrt(Math.max(0.2, 1 - hh * hh)) * (1 - 0.38 * Math.exp(-Math.pow((hh + 0.62) / 0.12, 2))) * 1.02 + 0.004) * 1.2 + 0.012;
    for (let ring = 0; ring < 3; ring++) {
      const hh = -0.5 - ring * 0.08;
      const rad = tieR(hh);
      for (let j = 0; j < 4; j++) {
        const a0 = (j / 4) * Math.PI * 2 + ring * 0.7;
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k < NODES_PER_LOCK; k++) {
          const t = k / (NODES_PER_LOCK - 1);
          const a = a0 + t * Math.PI * 0.9;
          pts.push(b.C.clone().addScaledVector(b.A, bunR * hh + (t - 0.5) * 0.004).addScaledVector(b.U, Math.cos(a) * rad).addScaledVector(b.W, Math.sin(a) * rad * 1.1));
        }
        specs.push({ pointsLocal: pts, width: 0.035 * wMul, thickness: 0.025, stiffnessBias: 0.99, layerAO: 0.12, layerOrder: 3, lockNormal: false, scalpRoot: 0.5 });
      }
    }
  }

  // Zone 4: loose short tendrils in front of the ears and at the nape (thin wavy locks)
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const pts = buildSculptedLock({
        thetaStart: side * (1.28 + k * 0.06), thetaEnd: side * (1.4 + k * 0.05),
        phiStart: 1.2, phiEnd: 2.25 + k * 0.1 + config.bangsLength * 0.2,
        baseLift: 0.012, midArch: 0.012, tipFlickOut: 0.01, sCurveAmp: side * 0.03, napeHug: 0.95,
      });
      for (const p of pts) snugP(p, 0.84, 0.9);
      specs.push({
        pointsLocal: pts, width: (0.02 - k * 0.003) * wMul, thickness: 0.008, stiffnessBias: 0.7, layerAO: 0.94,
        layerOrder: 4, lockNormal: true, scalpRoot: 0.25, smooth: 3, roundness: 0.5,
      });
    }
    for (let k = 0; k < 2; k++) {
      const pts = buildSculptedLock({
        thetaStart: side * (2.15 + k * 0.08), thetaEnd: side * (2.2 + k * 0.1),
        phiStart: 1.95, phiEnd: 2.6 + k * 0.12,
        baseLift: 0.012, midArch: 0.008, tipFlickOut: 0.01, sCurveAmp: side * 0.03, napeHug: 0.9,
      });
      for (const p of pts) snugP(p);
      specs.push({
        pointsLocal: pts, width: 0.018 * wMul, thickness: 0.008, stiffnessBias: 0.7, layerAO: 0.94,
        layerOrder: 4, lockNormal: true, scalpRoot: 0.25, smooth: 3, roundness: 0.5,
      });
    }
  }

  return specs;
}
  // ARCH-END twin-buns

  // ARCH-BEGIN curtain-part
  if (arch === 'curtain-part') {
    // CP: centre-parted curtain fringe, medium layered length. Top hair is combed sideways off the part along
    // part-centred meridians (lifted at the root for the curtain arch), released near the temple/ear and dropped with
    // gravity + body collision. Back hair is a 3-layer layered curtain to the nape. Narrow round smoothed locks throughout.
    const partYaw = THREE.MathUtils.clamp(config.partPosition, -1, 1) * 0.1;
    const curtainY = THREE.MathUtils.lerp(0.3, 0.08, config.bangsLength);
    const sideY = THREE.MathUtils.lerp(0.14, -0.04, config.sideLength);
    const backY = THREE.MathUtils.lerp(0.0, -0.2, config.backLength);
    const cpRand = seededRand((config.seed || 1) * 3 + 17);
    const eqY = HEAD_CENTER_LOCAL.y + Math.cos(1.75) * SCALP_RY;
    const phiForY = (y: number) => 1.75 + Math.max(0, eqY - y) / 0.325;
    const jag = 0.02 + shag * 0.05;

    // Zone 1: hidden skull-hugging shell (3 staggered tiers), ends under the hairline at the front and above the ears
    for (let tier = 0; tier < 3; tier++) {
      const count = 26;
      for (let i = 0; i < count; i++) {
        const theta = ((i + tier * 0.33) / count) * Math.PI * 2;
        const aT = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta)));
        const lim = aT < 0.9 ? 1.2 : aT < 1.95 ? THREE.MathUtils.lerp(1.3, 1.58, (aT - 0.9) / 1.05) : THREE.MathUtils.lerp(1.7, 2.05, (aT - 1.95) / (Math.PI - 1.95));
        const phiStart = tier === 0 ? 0.02 : 0.25 + tier * 0.35;
        if (phiStart > lim - 0.2) continue;
        const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: theta, phiStart, phiEnd: lim, baseLift: 0.003, midArch: 0.003, tipFlickOut: 0, napeHug: 1.0 });
        pts.forEach((p, n) => n > 0 && clearOfBody(p, 0.003));
        specs.push({ smooth: 3, pointsLocal: pts, width: 0.085 * wMul, thickness: 0.01, stiffnessBias: 0.85, layerAO: 0.7, layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: tier === 0 ? 0.48 : 0.25 });
      }
    }

    // Zone 2: back + behind-ear layers (crown whorl -> nape), outer layers shorter for a soft layered hem
    const backLayers = [
      { n: 64, w: 0.05, dr: 0.004, ord: 1 },
      { n: 92, w: 0.04, dr: 0.012, ord: 2 },
      { n: 104, w: 0.034, dr: 0.02, ord: 3 },
    ];
    const z2Start = specs.length;
    // hem clumps: neighbouring locks share a length and pull their tips together (soft anime points, no comb teeth)
    const nClumps = 15;
    const clumpLen = Array.from({ length: nClumps + 1 }, () => (cpRand() - 0.5) * jag * 2.2);
    for (const L of backLayers) {
      const cnt = Math.round(L.n * density);
      for (let i = 0; i < cnt; i++) {
        const u = THREE.MathUtils.clamp((i + (cpRand() - 0.5) * 0.4) / (cnt - 1), 0, 1);
        const theta = THREE.MathUtils.lerp(1.5, Math.PI * 2 - 1.5, u);
        const cu = (u * nClumps + L.ord * 0.31) % (nClumps + 1);
        const ci = Math.floor(cu);
        const cIn = cu - ci - 0.5; // -0.5..0.5 inside its clump
        const aT = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta)));
        const k = THREE.MathUtils.clamp((aT - 1.5) / (Math.PI - 1.5), 0, 1);
        const endY = THREE.MathUtils.lerp(sideY + 0.03, backY, k * k * (3 - 2 * k)) + (L.ord - 1) * 0.03 + clumpLen[ci] + Math.abs(cIn) * 0.05 + (cpRand() - 0.5) * 0.01;
        const tipPull = -cIn * (Math.PI * 2 - 3) / nClumps * 0.55;
        const pts = buildSculptedLock({
          thetaStart: theta, thetaEnd: theta + tipPull + (cpRand() - 0.5) * 0.01 - Math.sign(Math.sin(theta)) * (1 - k) * 0.06,
          phiStart: 0.04 + (L.ord - 1) * 0.07 + cpRand() * 0.06, phiEnd: phiForY(endY),
          baseLift: 0.004 + L.ord * 0.003, midArch: 0.004 + config.crownVolume * 0.006, tipFlickOut: 0.004, napeHug: 0.7,
        });
        // radial layering, then keep clear of ears, neck and face
        for (let n = 1; n < pts.length; n++) {
          const p = pts[n];
          const dx = p.x - HEAD_CENTER_LOCAL.x, dz = p.z - HEAD_CENTER_LOCAL.z;
          const len = Math.max(1e-4, Math.hypot(dx, dz));
          const kk = L.dr * Math.min(1, n / 4) / len;
          p.x += dx * kk; p.z += dz * kk;
          clearOfBody(p, 0.006 + L.ord * 0.003);
        }
        specs.push({
          smooth: 3, roundness: 0.65, tipStart: 0.66, tipWidth: 0.12, pointsLocal: pts, width: L.w * wMul * (0.85 + cpRand() * 0.3), thickness: 0.012,
          stiffnessBias: 0.78, layerAO: 0.8 + L.ord * 0.05, layerOrder: L.ord, lockNormal: false, scalpRoot: 0.4,
        });
      }
    }

    clumpTips(specs.slice(z2Start).filter((sp) => sp.layerOrder >= 2).map((sp) => sp.pointsLocal), 0.045, 0.5);

    // Zone 3: top hair combed off the centre part; front locks become the curtains framing the face
    const z3Start = specs.length;
    for (const sd of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        const n = Math.round(46 * density);
        for (let i = 0; i < n; i++) {
          const f = (i + row * 0.33 + (cpRand() - 0.5) * 0.3) / (n - 1);
          const b0 = THREE.MathUtils.lerp(-0.65, 1.31, THREE.MathUtils.clamp(f, 0, 1));
          const ff = _ss((b0 - 0.55) / 0.6); // 1 at the hairline (curtain), 0 at the crown
          const ffc = _ss((b0 - 0.92) / 0.3); // front-most: the curtain wings that arch over the forehead corners
          const aR = THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.24, 0.9, ff), 0.74 + row * 0.04, ffc) + (cpRand() - 0.5) * 0.06;
          const bR = b0 + ff * 0.14 + ffc * 0.16 - (1 - ff) * 0.06;
          const from = partDir(sd * (0.01 + row * 0.008), b0, partYaw);
          const to = partDir(sd * aR, bR, partYaw);
          const bump = (0.01 + 0.022 * config.crownVolume) * (0.12 + 0.88 * ff) * (row === 0 ? 0.6 : 1);
          const lift0 = 0.004 + row * 0.003, lift1 = 0.012 + row * 0.008 + ffc * 0.012;
          const pts = skullArc(from, to, 7, (u) => THREE.MathUtils.lerp(lift0, lift1, u) + bump * Math.sin(Math.PI * Math.min(1, u * 1.35)));
          const rel = pts[pts.length - 1];
          const endY = THREE.MathUtils.lerp(sideY, curtainY, ff) + row * 0.02 * (1 - ff) + (cpRand() - 0.5) * jag * (1 - 0.5 * ff);
          const out = new THREE.Vector3(rel.x - HEAD_CENTER_LOCAL.x, 0, rel.z - HEAD_CENTER_LOCAL.z).normalize().lerp(new THREE.Vector3(sd, 0, 0), ffc * 0.5).normalize();
          gravityFall(pts, 5, Math.max(0.04, (rel.y - endY) * (1.06 + ffc * 0.1)), {
            out, flare: 0.03 + 0.025 * ff + 0.02 * ffc, bend: 0.42, margin: 0.008 + row * 0.006 + ffc * 0.01, flick: 0.01 * ff + 0.004,
          });
          specs.push({
            smooth: 3, roundness: 0.65, tipStart: 0.68, tipWidth: 0.12, pointsLocal: pts, width: (0.034 - row * 0.002) * wMul * (0.85 + cpRand() * 0.3), thickness: 0.012,
            stiffnessBias: 0.8, layerAO: 0.84 + row * 0.05, layerOrder: 4 + row, lockNormal: false, scalpRoot: 0.42,
          });
        }
      }
    }

    clumpTips(specs.slice(z3Start).map((sp) => sp.pointsLocal), 0.05, 0.72);

    // Zone 3b: temple + sideburn cover in front of the ear, tucked under the curtains
    sideburnLocks(specs, { sideburnLength: 0.8, count: 8, width: 0.028 * wMul, layerOrder: 2, baseLift: 0.006 });
    for (const sd of [-1, 1]) {
      for (let k = 0; k < 14; k++) {
        const th = sd * (0.82 + (k / 13) * 0.85);
        const from = scalpDir(th * 0.9, 0.85 + (k % 3) * 0.1);
        const to = scalpDir(th, 1.45);
        const pts = skullArc(from, to, 6, (u) => 0.008 + 0.006 * u);
        const rel = pts[pts.length - 1];
        const out = new THREE.Vector3(rel.x, 0, rel.z - HEAD_CENTER_LOCAL.z).normalize();
        gravityFall(pts, 6, Math.max(0.04, rel.y - (sideY + 0.04 + (cpRand() - 0.5) * jag)), { out, flare: 0.04, bend: 0.5, margin: 0.01 });
        specs.push({
          smooth: 3, roundness: 0.6, tipStart: 0.66, tipWidth: 0.12, pointsLocal: pts, width: 0.04 * wMul, thickness: 0.011,
          stiffnessBias: 0.8, layerAO: 0.8, layerOrder: 2, lockNormal: false, scalpRoot: 0.4,
        });
      }
    }

    // Zone 4: a few fine face-framing strands at the inner curtain edge (realism accent)
    for (const sd of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const b0 = 1.0 + k * 0.05;
        const from = partDir(sd * 0.04, b0, partYaw);
        const to = partDir(sd * (0.72 + k * 0.06), b0 + 0.28, partYaw);
        const pts = skullArc(from, to, 6, (u) => 0.026 + 0.03 * Math.sin(Math.PI * Math.min(1, u * 1.2)));
        const rel = pts[pts.length - 1];
        const out = new THREE.Vector3(rel.x, 0, rel.z - HEAD_CENTER_LOCAL.z).normalize();
        gravityFall(pts, 6, Math.max(0.05, rel.y - curtainY - 0.02 + k * 0.03), { out, flare: 0.1, bend: 0.3, margin: 0.03, flick: 0.012 });
        specs.push({
          smooth: 3, roundness: 0.7, pointsLocal: pts, width: 0.016 * wMul, thickness: 0.007,
          stiffnessBias: 0.6, layerAO: 0.95, layerOrder: 7, lockNormal: false, scalpRoot: 0.3,
        });
      }
    }
    return specs;
  }
  // ARCH-END curtain-part

  // ARCH-BEGIN rope-locs
  if (arch === 'rope-locs') {
    // RL: shoulder-length locs. Each loc is a thick round rope, rooted on a jittered sphere grid inside the hairline,
    // laid over the skull (front/top ones parted off the centre, back ones down the back), then dropped with gravity.
    // Each loc is one round lock (roundness 1) with the per-lock tip shape (tipStart / tipWidth): full width almost to the
    // end, then a rounded cap, instead of the default pointed hair tip; ripple adds the knotted rope texture of a loc.
    const partYaw = THREE.MathUtils.clamp(config.partPosition, -1, 1) * 0.1;
    const rlRand = seededRand((config.seed || 1) * 13 + 5);
    const frontY = THREE.MathUtils.lerp(0.06, -0.12, config.bangsLength);
    const sideY = THREE.MathUtils.lerp(-0.06, -0.22, config.sideLength);
    const backY = THREE.MathUtils.lerp(-0.14, -0.38, config.backLength);
    const hairCut = (th: number) => earAlignedCutPhi(th, { hairlinePhi: 1.3, sideburnLength: 0.55, napePhi: 2.06, templeRecede: 0 });
    const locW = 0.034 * wMul;

    // Zone 1: dense hidden shell, so the partings between loc roots never show bare scalp
    for (let tier = 0; tier < 4; tier++) {
      const count = 28;
      for (let i = 0; i < count; i++) {
        const theta = ((i + tier * 0.25) / count) * Math.PI * 2;
        const aT = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta)));
        // temples: the face lathe's hairline sits lower than the cut curve between brow and ear, so the shell runs further down
        const lim = hairCut(theta) + 0.06 + 0.16 * Math.exp(-(((aT - 1.35) / 0.35) ** 2));
        const phiStart = tier === 0 ? 0.02 : 0.2 + tier * 0.3;
        if (phiStart > lim - 0.18) continue;
        const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: theta, phiStart, phiEnd: lim, baseLift: 0.003, midArch: 0.003, tipFlickOut: 0, napeHug: 1.1 });
        pts.forEach((p, n) => n > 0 && clearOfBody(p, 0.003));
        specs.push({ smooth: 3, pointsLocal: pts, width: (aT > 1.4 && aT < 2.1 ? 0.06 : 0.085) * wMul, thickness: 0.01, stiffnessBias: 0.9, layerAO: 0.6, layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: tier === 0 ? 0.48 : 0.25 });
      }
    }

    // Zone 1b: temple and sideburn cover, so the locs falling past the face never show scalp in front of the ear
    sideburnLocks(specs, { sideburnLength: 0.8, count: 9, width: 0.03 * wMul, layerOrder: 1, baseLift: 0.006 });

    // Zone 2: the locs
    const total = Math.round(330 * density); // sphere samples; about 40% land inside the hairline
    const golden = Math.PI * (3 - Math.sqrt(5));
    const locPaths: { pts: THREE.Vector3[]; depth: number; w: number }[] = [];
    const roots: [number, number][] = [];
    for (let i = 0; i < total; i++) {
      const yN = 1 - (i + 0.5) / total * 2;
      const phi0 = Math.acos(yN) + (rlRand() - 0.5) * 0.05;
      const theta0 = i * golden + (rlRand() - 0.5) * 0.08;
      if (phi0 > hairCut(theta0) - 0.16 || phi0 < 0.03) continue;
      roots.push([theta0, phi0]);
    }
    // hairline row: locs rooted right on the hairline so the edge reads as locs, not shell
    for (let a = -Math.PI; a < Math.PI; a += 0.115) {
      const th = a + (rlRand() - 0.5) * 0.03;
      roots.push([th, hairCut(th) - 0.025 + (rlRand() - 0.5) * 0.02]);
    }
    for (const [theta0, phi0] of roots) {
      const d0 = scalpDir(theta0, phi0);
      // part-centred coordinates of the root (rotated by the part yaw)
      const c = Math.cos(partYaw), s = Math.sin(partYaw);
      const px = d0.x * c - d0.z * s, pz = d0.x * s + d0.z * c;
      const alpha0 = Math.asin(THREE.MathUtils.clamp(px, -1, 1));
      const beta0 = Math.atan2(pz, d0.y);
      const sd = alpha0 >= 0 ? 1 : -1;
      const ff = _ss((beta0 - 0.5) / 0.8);
      const partTo = partDir(sd * Math.max(Math.abs(alpha0) + 0.15, THREE.MathUtils.lerp(1.2, 0.95, ff)), beta0 + ff * 0.12, partYaw);
      const backTo = scalpDir(theta0, Math.max(phi0 + 0.1, 1.72));
      const wBack = _ss((-beta0 - 0.05) / 0.45);
      const to = slerpDir(partTo, backTo, wBack);
      const arcAng = Math.acos(THREE.MathUtils.clamp(d0.dot(to), -1, 1));
      // locs rooted higher lie on top of the ones they pass over
      const depth = THREE.MathUtils.clamp(arcAng / 1.1, 0, 1.4);
      const lift0 = locW * 0.42, lift1 = locW * 0.5 + 0.034 * depth + config.crownVolume * 0.012 * depth;
      const pts = skullArc(d0, to, 5, (u) => THREE.MathUtils.lerp(lift0, lift1, _ss(u * 1.3)), 0.004);
      const rel = pts[pts.length - 1];
      const aT = Math.abs(Math.atan2(rel.x, rel.z - HEAD_CENTER_LOCAL.z));
      const kSide = _ss((aT - 0.6) / 1.2), kBack = _ss((aT - 1.9) / 1.0);
      const endY = THREE.MathUtils.lerp(THREE.MathUtils.lerp(frontY, sideY, kSide), backY, kBack) + (rlRand() - 0.5) * (0.04 + shag * 0.08);
      const out = new THREE.Vector3(rel.x - HEAD_CENTER_LOCAL.x, 0, rel.z - HEAD_CENTER_LOCAL.z).normalize();
      const sway = new THREE.Vector3(-out.z, 0, out.x);
      gravityFall(pts, 7, Math.max(0.06, rel.y - endY), {
        out, flare: 0.025 + 0.015 * depth, bend: 0.42, margin: lift1 * 0.8 + 0.006,
        sway, swayAmp: 0.012 + rlRand() * 0.012, swayPhase: rlRand() * 6.28,
      });
      locPaths.push({ pts, depth, w: locW * (0.86 + rlRand() * 0.28) });
    }
    // temple locs: rooted above the temple and hugging the side of the face, so no scalp shows between brow and ear
    for (const sd of [-1, 1]) {
      for (let k = 0; k < 10; k++) {
        const th = sd * (0.85 + (k / 9) * 0.8);
        const from = scalpDir(th * 0.92, 0.95 + (k % 3) * 0.1);
        const to = scalpDir(th, 1.5);
        const pts = skullArc(from, to, 5, (u) => locW * 0.45 + 0.006 * u);
        const rel = pts[pts.length - 1];
        const out = new THREE.Vector3(rel.x, 0, rel.z - HEAD_CENTER_LOCAL.z).normalize();
        gravityFall(pts, 7, Math.max(0.05, rel.y - (sideY + 0.03 + (rlRand() - 0.5) * 0.06)), { out, flare: 0.02, bend: 0.5, margin: locW * 0.5 + 0.004 });
        locPaths.push({ pts, depth: 0.15, w: locW * (0.8 + rlRand() * 0.2) });
      }
    }
    // deeper (higher-rooted) locs render on top
    for (const L of locPaths) {
      const pts = bluntLockPoints(L.pts, L.w * 0.3);
      let len = 0;
      for (let n = 1; n < pts.length; n++) len += pts[n].distanceTo(pts[n - 1]);
      specs.push({
        smooth: 4, roundness: 1.0, tipStart: 0.86, tipWidth: 0.62 + rlRand() * 0.1,
        ripple: 0.16 + rlRand() * 0.1, rippleFreq: THREE.MathUtils.clamp(len / 0.032, 5, 12),
        pointsLocal: pts, width: L.w, thickness: L.w * 0.9,
        stiffnessBias: 0.92, layerAO: 0.7 + 0.25 * Math.min(1, L.depth), layerOrder: 1 + Math.min(4, Math.round(L.depth * 3)),
        lockNormal: false, scalpRoot: 0.6,
      });
    }
    return specs;
  }
  // ARCH-END rope-locs

  // ARCH-BEGIN coily-afro
  if (arch === 'coily-afro') {
    // CC: a rounded coily afro. The silhouette is a volume (an offset of the scalp, thickest on top), filled with
    // round coiled clumps: each rises from its root out through the volume, then runs a few cm along the outer surface
    // (back and down, away from the face). coilLockPoints winds each clump into a helix, ripple adds the kink texture,
    // and the tip shape gives round clump ends instead of points, so the surface reads dense and soft, never spiky.
    const caRand = seededRand((config.seed || 1) * 17 + 3);
    const hairCut = (th: number) => earAlignedCutPhi(th, { hairlinePhi: 1.26, sideburnLength: 0.45, napePhi: 2.0, templeRecede: 0.04 });
    const vol = THREE.MathUtils.lerp(0.8, 1.2, config.crownVolume);
    const clumpW = 0.032 * wMul;
    const up = new THREE.Vector3(0, 1, 0);
    // afro thickness above the scalp along a direction: thick on top, less at the sides, thin at the nape and the hairline
    const thickAt = (dir: THREE.Vector3) => {
      const phi = Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1));
      const theta = Math.atan2(dir.x, dir.z);
      const aT = Math.abs(theta);
      const top = THREE.MathUtils.lerp(0.125, 0.085, _ss((phi - 0.5) / 1.0));
      const nape = 1 - 0.45 * _ss((phi - 1.6) / 0.4) * _ss((aT - 1.8) / 0.8);
      const edge = THREE.MathUtils.lerp(0.45, 1, _ss((hairCut(theta) - phi) / 0.4));
      return top * nape * edge * vol;
    };
    const dirOf = (p: THREE.Vector3) => new THREE.Vector3((p.x - HEAD_CENTER_LOCAL.x) / SCALP_RX, (p.y - HEAD_CENTER_LOCAL.y) / SCALP_RY, (p.z - HEAD_CENTER_LOCAL.z) / SCALP_RZ).normalize();

    // Zone 1: hidden shell on the scalp
    for (let tier = 0; tier < 4; tier++) {
      const count = 28;
      for (let i = 0; i < count; i++) {
        const theta = ((i + tier * 0.25) / count) * Math.PI * 2;
        const aT = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta)));
        const lim = Math.max(hairCut(theta) + 0.1 + 0.22 * Math.exp(-(((aT - 1.3) / 0.6) ** 2)), scalpRegionPhi(aT) + 0.1); // down to the ear top
        const phiStart = tier === 0 ? 0.02 : 0.2 + tier * 0.3;
        if (phiStart > lim - 0.18) continue;
        const pts = buildSculptedLock({ thetaStart: theta, thetaEnd: theta, phiStart, phiEnd: lim, baseLift: 0.003, midArch: 0.003, tipFlickOut: 0, napeHug: 1.1 });
        pts.forEach((p, n) => n > 0 && clearOfBody(p, 0.003));
        specs.push({ smooth: 3, tipStart: 0.8, tipWidth: 0.6, pointsLocal: pts, width: 0.085 * wMul, thickness: 0.01, stiffnessBias: 0.95, layerAO: 0.5, layerOrder: 0, isBaseShell: true, lockNormal: false, scalpRoot: tier === 0 ? 0.48 : 0.25 });
      }
    }

    // Zone 2: coiled clumps through the volume. Fibonacci roots inside the hairline; depth decides inner filler vs surface
    const total = Math.round(920 * density);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < total; i++) {
      const yN = 1 - (i + 0.5) / total * 2;
      const phi0 = Math.acos(yN) + (caRand() - 0.5) * 0.03;
      const theta0 = i * golden + (caRand() - 0.5) * 0.05;
      if (phi0 > hairCut(theta0) - 0.03 || phi0 < 0.02) continue;
      const d0 = scalpDir(theta0, phi0);
      const T = thickAt(d0);
      const depthF = 0.55 + 0.47 * Math.pow(caRand(), 0.6); // most clumps reach the outer surface
      // rise: out of the scalp. Upper clumps lean up (afros lift off the head); low ones (temples, over the ears, nape)
      // lean down and run further down so the volume wraps the lower head instead of stopping at a ledge
      const low = _ss((phi0 - 1.3) / 0.4);
      const lean = 0.3 * (1 - _ss((phi0 - 1.0) / 0.5)) - 0.35 * _ss((phi0 - 1.45) / 0.35);
      const outDir = d0.clone().addScaledVector(up, lean).normalize();
      const center: THREE.Vector3[] = [scalpDirPoint(d0, 0.004)];
      const riseEnd = clearOfBody(scalpDirPoint(d0, 0).addScaledVector(outDir, T * depthF), 0.01);
      for (let k = 1; k <= 3; k++) center.push(clearOfBody(center[0].clone().lerp(riseEnd, k / 3), 0.006));
      // run along the outer surface, back and down (away from the face)
      const dEnd = dirOf(riseEnd);
      const flowW = new THREE.Vector3(0, -1, -0.7 * (1 - low));
      const flow = flowW.sub(dEnd.clone().multiplyScalar(flowW.dot(dEnd)));
      if (flow.lengthSq() < 1e-6) flow.set(0, 0, -1);
      flow.normalize().applyAxisAngle(dEnd, (caRand() - 0.5) * 1.6 * (1 - 0.6 * low));
      const runAng = (0.1 + caRand() * 0.16) * (0.7 + 0.3 * vol) * (1 + 0.8 * low);
      for (let k = 1; k <= 4; k++) {
        const u = k / 4;
        const dir = dEnd.clone().applyAxisAngle(new THREE.Vector3().crossVectors(dEnd, flow).normalize(), runAng * u);
        const lift = thickAt(dir) * Math.min(1.02, depthF + 0.06 * u) + 0.004;
        center.push(clearOfBody(scalpDirPoint(dir, lift), 0.01));
      }
      let len = 0;
      for (let k = 1; k < center.length; k++) len += center[k].distanceTo(center[k - 1]);
      const w = clumpW * (0.8 + caRand() * 0.4);
      const pts = coilLockPoints(center, 0.006 + caRand() * 0.006, Math.min(2.5, len / 0.045), caRand() * 6.28, w * 0.3, 0.25);
      pts.forEach((p, n) => n > 0 && clearOfBody(p, 0.004));
      const surf = depthF > 0.85;
      specs.push({
        smooth: 3, roundness: 1.0, tipStart: 0.8, tipWidth: 0.55 + caRand() * 0.15,
        ripple: 0.22 + caRand() * 0.14, rippleFreq: THREE.MathUtils.clamp(len / 0.022, 5, 11),
        pointsLocal: pts, width: surf ? w : w * 1.2, thickness: (surf ? w : w * 1.2) * 0.9,
        stiffnessBias: 1.0, layerAO: surf ? 0.75 + caRand() * 0.25 : 0.45, layerOrder: surf ? 2 + Math.round(depthF * 2) : 1,
        lockNormal: false, scalpRoot: 0.55,
      });
    }
    // Zone 3: temple and over-ear wrap. Short coils hugging the side of the head from the temple back over the ear,
    // where the head mesh sits outside the scalp shell and the volume clumps lift away
    for (const sd of [-1, 1]) {
      for (let row = 0; row < 2; row++) {
        const n = 18;
        for (let k = 0; k < n; k++) {
          const th = sd * (0.6 + (k / (n - 1)) * 1.4 + row * 0.04);
          const cut = hairCut(th);
          const from = scalpDir(th, cut - 0.32 + row * 0.12);
          const to = scalpDir(th * 1.03, Math.min(1.9, cut + 0.24 + row * 0.04 + 0.18 * Math.exp(-(((Math.abs(th) - 1.3) / 0.6) ** 2))));
          const lift0 = 0.01 + row * 0.006, lift1 = 0.02 + row * 0.012 + caRand() * 0.01;
          const center = skullArc(from, to, 6, (u) => THREE.MathUtils.lerp(lift0, lift1, u), 0.008);
          let len = 0;
          for (let q = 1; q < center.length; q++) len += center[q].distanceTo(center[q - 1]);
          const w = clumpW * (0.75 + caRand() * 0.3);
          const pts = coilLockPoints(center, 0.005 + caRand() * 0.004, Math.min(2.5, len / 0.04), caRand() * 6.28, w * 0.3, 0.2);
          pts.forEach((p, q) => q > 0 && clearOfBody(p, 0.006));
          specs.push({
            smooth: 3, roundness: 1.0, tipStart: 0.8, tipWidth: 0.55 + caRand() * 0.15,
            ripple: 0.25, rippleFreq: THREE.MathUtils.clamp(len / 0.022, 4, 10),
            pointsLocal: pts, width: w, thickness: w * 0.9,
            stiffnessBias: 1.0, layerAO: 0.7 + caRand() * 0.2, layerOrder: 2 + row, lockNormal: false, scalpRoot: 0.5,
          });
        }
      }
    }
    return specs;
  }
  // ARCH-END coily-afro

  // ZONE A: Seamless 360° Inner Foundation Shell (phiStart = 0.01 seals crown apex 100%)
  // =========================================================================
  for (let tier = 0; tier < 4; tier++) {
    const count = tier === 0 ? 18 : 15;
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2 + tier * 0.24 + (rand() - 0.5) * 0.04;
      const cosT = Math.cos(theta);
      const phiStart = tier === 0 ? 0.01 : 0.14 + tier * 0.36;
      // Anatomical facial hairline cutout: keep bare forehead, brow corners, and cheeks 100% clear of base-shell slabs
      if (tier >= 1) {
        const maxCosT = phiStart < 0.72 ? 0.62 : phiStart < 1.12 ? 0.42 : 0.20;
        if (cosT > maxCosT) continue;
      }
      const isBack = cosT < -0.12;
      const shellCap = isPulledScalp ? 2.18 : isBack ? backLenPhi - 0.14 : sideLenPhi - 0.14;
      const targetEnd = Math.min(shellCap, phiStart + (isBack ? 1.18 : 0.96) + tier * 0.16);

      const pts = buildSculptedLock({
        thetaStart: theta,
        thetaEnd: theta + (isBack ? (Math.sin(theta) > 0 ? -0.08 : 0.08) : 0),
        phiStart,
        phiEnd: Math.max(phiStart + 0.65, targetEnd),
        baseLift: 0.004 + tier * 0.0015,
        midArch: 0.008,
        tipFlickOut: 0.003,
        napeHug: isBack ? napeHugBase : 0.92,
      });

      specs.push({
        pointsLocal: pts,
        width: 0.092 * wMul,
        thickness: 0.013,
        stiffnessBias: isLong && isBack ? 0.72 : 0.94,
        layerAO: 0.82,
        layerOrder: 0,
        isBaseShell: true,
        lockNormal: false,
        scalpRoot: tier === 0 ? 0.48 : 0.2,
      });
    }
  }

  // =========================================================================
  // ZONE B: Crown Canopy (Archetype-Aware: Pulled-Back, Swept-Back, Asym, or Parted)
  // =========================================================================
  if (isPonytail || isTwinTails) {
    // Sleek pulled-back scalp strands converging neatly toward rear ponytail or dual side-rear twin-tail ties
    const wrapCount = Math.round(44 * density);
    for (let i = 0; i < wrapCount; i++) {
      const frac = i / (wrapCount - 1);
      const thetaStart = (frac - 0.5) * Math.PI * 1.92;
      const side = thetaStart < 0 ? -1 : 1;
      const targetTheta = isPonytail ? (side < 0 ? -Math.PI : Math.PI) : side * 1.98;
      const thetaEnd = THREE.MathUtils.lerp(thetaStart, targetTheta, 0.72);
      const phiStart = 0.03 + (i % 3) * 0.08;
      const phiEnd = isPonytail ? 1.56 + (i % 2) * 0.22 : 1.72 + (i % 2) * 0.22;

      const pts = buildSculptedLock({
        thetaStart,
        thetaEnd,
        phiStart,
        phiEnd,
        baseLift: 0.014 + (i % 2) * 0.004,
        midArch: 0.011 + config.crownVolume * 0.006,
        tipFlickOut: 0.003,
        napeHug: 1.18,
      });
      specs.push({
        pointsLocal: pts,
        width: 0.062 * wMul,
        thickness: 0.012,
        stiffnessBias: 0.94,
        layerAO: 0.86 + (i % 2) * 0.06,
        layerOrder: 2,
        scalpRoot: 0.78,
      });
    }
  } else if (isSweptBack) {
    // Clive / Vergil windswept brushed-back forehead & crown waves flowing seamlessly over the occiput
    const waveCount = Math.round(52 * density * (isCrop ? 1.25 : 1));
    for (let i = 0; i < waveCount; i++) {
      const u = i / (waveCount - 1);
      const side = u < 0.5 ? -1 : 1;
      const distCenter = Math.abs(u - 0.5) * 2.0; // 0 = center forehead, 1 = temples
      const subRow = i % 2;
      const thetaStart = (u - 0.5) * Math.PI * 1.18 + (rand() - 0.5) * 0.04;
      // Sweep decisively backward toward the occiput!
      const thetaEnd = side * THREE.MathUtils.lerp(Math.PI * 0.76, Math.PI * 0.98, 1 - distCenter * 0.45) * (isCrop ? 0.65 : 1); // crop: 35% less side-to-rear wrap
      const phiStart = 0.04 + subRow * 0.1 + distCenter * 0.14;
      const phiEnd = Math.min(3.05, backLenPhi - 0.18 + (i % 3) * 0.14);

      const pts = buildSculptedLock({
        thetaStart,
        thetaEnd,
        phiStart,
        phiEnd,
        baseLift: isCrop ? Math.min(0.008, crownLift + 0.004 + subRow * 0.005) : crownLift + 0.004 + subRow * 0.005,
        midArch: isCrop ? 0.008 : 0.02 + config.crownVolume * 0.012,
        tipFlickOut: isCrop ? 0.008 : 0.018 + shag * 0.026,
        sCurveAmp: side * 0.045 * (isCrop ? 0.65 : 1),
        napeHug: 1.06,
      });
      specs.push({
        pointsLocal: pts,
        width: (0.054 + rand() * 0.008) * wMul * (isCrop ? 1.15 : 1),
        thickness: 0.013,
        stiffnessBias: 0.88,
        layerAO: 0.88 + subRow * 0.08,
        layerOrder: 3,
        scalpRoot: 0.84,
      });
    }
  } else {
    // Parted Left & Right Crown Canopy Cascades (adapts cleanly for Asym, Dolphin, Half-Up, Emo-Sweep, Shag, Wolf, Bob, Long)
    const leftCount = Math.round(30 * density);
    const rightCount = Math.round(30 * density);
    const effPartX = isEmoSweep ? (partX >= 0 ? Math.max(0.068, partX) : Math.min(-0.068, partX)) : partX;

    for (const side of [-1, 1] as const) {
      const count = side === -1 ? leftCount : rightCount;
      for (let i = 0; i < count; i++) {
        const u = count > 1 ? i / (count - 1) : 0.5;
        const subRow = i % 2;
        const zPart = THREE.MathUtils.lerp(0.142, -0.17, u);
        const partRoot = new THREE.Vector3(
          effPartX + side * (0.004 + subRow * 0.005),
          0.744 - Math.pow(u - 0.22, 2) * 0.1,
          zPart
        );

        const thetaStart = side * THREE.MathUtils.lerp(0.14, Math.PI * 0.72, u);
        const sweepOffset = side * THREE.MathUtils.lerp(0.24, 0.28, u) + (rand() - 0.5) * 0.06;
        const thetaEnd = THREE.MathUtils.clamp(thetaStart + sweepOffset, -Math.PI * 0.98, Math.PI * 0.98);
        const isRear = u > 0.52;

        // Valkyrie Asym (Lightning): viewer's left (-1) cascades long past shoulder, viewer's right (+1) is cropped & feathered!
        let sideTargetPhi = sideLenPhi;
        if (isAsym) {
          sideTargetPhi = side === -1 ? Math.max(3.12, sideLenPhi + 0.45) : Math.min(2.12, sideLenPhi * 0.82);
        }

        const basePhiEnd = isRear
          ? THREE.MathUtils.lerp(sideTargetPhi, backLenPhi, (u - 0.52) / 0.48)
          : THREE.MathUtils.lerp(bangsLenPhi + 0.08, sideTargetPhi, u / 0.52);

        const isFrontCrown = u < 0.28;
        const pts = buildSculptedLock({
          thetaStart,
          thetaEnd,
          phiStart: 0.06 + u * 0.06,
          phiEnd: Math.min(3.52, basePhiEnd + (i % 3) * 0.1 * shag + rand() * 0.08),
          baseLift: (isFrontCrown ? crownLift * 0.82 : crownLift) + subRow * 0.004,
          midArch: (isFrontCrown ? 0.014 : 0.018) + config.crownVolume * 0.01,
          tipFlickOut: isBob ? -0.008 : isAsym && side === 1 ? 0.036 : 0.01 + shag * 0.028 + subRow * 0.006,
          sCurveAmp: side * (0.032 + shag * 0.032),
          napeHug: isRear ? napeHugBase : 0.86,
          rootOverride: partRoot,
        });

        specs.push({
          pointsLocal: pts,
          width: (isFrontCrown ? 0.048 : 0.054 + rand() * 0.008) * wMul,
          thickness: isFrontCrown ? 0.012 : 0.014,
          stiffnessBias: isLong ? 0.62 : 0.86,
          layerAO: 0.88 + subRow * 0.07,
          layerOrder: subRow === 1 ? 3 : 2,
          scalpRoot: 0.78,
        });
      }
    }
  }

  // =========================================================================
  // ZONE C: Sculpted Forehead Bangs & Temple Seal (Archetype-Specialized)
  // =========================================================================
  const bangCount = Math.round((isSweptBack ? 34 : isEmoSweep ? 42 : 36) * density);
  const sweepDir = isEmoSweep
    ? config.bangsSweep >= 0
      ? Math.max(0.75, config.bangsSweep)
      : Math.min(-0.75, config.bangsSweep)
    : isAsym
      ? -0.68
      : config.bangsSweep;

  for (let i = 0; i < bangCount; i++) {
    const frac = bangCount > 1 ? i / (bangCount - 1) : 0.5;
    const isOuter = i % 2 === 1;
    const isRightOfPart = (frac - 0.5) * 0.34 > partX;

    const rootX = THREE.MathUtils.lerp(-0.15, 0.15, frac) + partX * 0.22;
    const rootY = 0.734 - Math.abs(frac - 0.5) * 0.044;
    const rootZ = 0.144 + (1 - Math.abs(frac - 0.5) * 1.3) * 0.022;
    const root = new THREE.Vector3(THREE.MathUtils.clamp(rootX, -0.17, 0.17), rootY, rootZ);

    const thetaStart = THREE.MathUtils.lerp(-0.88, 0.88, frac);
    let thetaEnd: number;
    let phiEnd: number;

    if (isSweptBack) {
      // Clive / Vergil sleek swept-back hairline: full widow's-peak coverage parting smoothly toward temples without bare forehead triangles
      const sideSign = frac < 0.5 ? -1 : 1;
      const distMid = Math.abs(frac - 0.5) * 2.0;
      const centerVeil = distMid < 0.28;
      thetaEnd = centerVeil
        ? thetaStart + sideSign * (0.14 + distMid * 0.42)
        : thetaStart + sideSign * (0.34 + distMid * 0.42);
      phiEnd = centerVeil
        ? 1.72 + (i % 3) * 0.08
        : 1.82 + distMid * 0.48 + (i % 3) * 0.08;
      if (isCrop) phiEnd = Math.min(phiEnd, 1.18 + config.bangsLength * 0.2 + (i % 3) * 0.04); // and fall nearly straight (no centre V) cropped hairline: bangs stop at the forehead edge
      if (isCrop) thetaEnd = thetaStart + sideSign * (0.22 + distMid * 0.18); // brushed up-and-back, lateral sweep
    } else if (isEmoSweep) {
      // Dramatic Riku / Dante long angled fringe sweeping across one eye
      const longSideFactor = sweepDir < 0 ? frac : 1 - frac;
      thetaEnd = thetaStart + sweepDir * (0.48 + longSideFactor * 0.28);
      phiEnd = Math.min(2.58, bangsLenPhi + longSideFactor * 0.48 + (i % 3) * 0.07);
    } else if (isHalfUp || isDolphin) {
      // Aerith / Tifa delicate center-parted curtain tendrils framing brow & cheeks
      const sideSign = frac < 0.5 ? -1 : 1;
      const distMid = Math.abs(frac - 0.5) * 2.0;
      thetaEnd = thetaStart + sideSign * (0.28 + (1 - distMid) * 0.16);
      phiEnd = Math.min(2.74, bangsLenPhi + distMid * 0.65 + (i % 2) * 0.1);
    } else {
      const curtainBias = isRightOfPart ? 0.22 : -0.22;
      const sweepTerm = sweepDir * 0.36 + curtainBias * (1.0 - Math.min(1.0, Math.abs(sweepDir) * 1.15));
      thetaEnd = thetaStart + sweepTerm + (rand() - 0.5) * 0.05;
      const edgeDrop = Math.abs(frac - 0.5) * 0.42;
      const stagger = (i % 3) * (0.06 + shag * 0.07);
      phiEnd = Math.min(2.42, bangsLenPhi + edgeDrop + stagger - (isOuter ? 0.06 : 0));
    }

    const pts = buildSculptedLock({
      thetaStart,
      thetaEnd,
      phiStart: 0.14 + (isOuter ? 0.03 : 0),
      phiEnd,
      baseLift: crownLift * 0.85 + (isOuter ? 0.005 : 0.001),
      midArch: 0.014 + config.crownVolume * 0.008,
      tipFlickOut: isOuter ? 0.004 + shag * 0.008 : -0.006,
      sCurveAmp: (thetaEnd - thetaStart) * 0.16,
      napeHug: 0.58,
      rootOverride: root,
    });

    specs.push({
      pointsLocal: pts,
      width: (isOuter ? 0.044 : 0.05) * wMul + rand() * 0.005,
      thickness: isOuter ? 0.012 : 0.013,
      stiffnessBias: 0.84,
      layerAO: isOuter ? 0.94 : 0.88,
      layerOrder: isOuter ? 3 : 2,
      customOutDir: new THREE.Vector3(Math.sin(thetaEnd) * 0.35, 0.2, 0.94),
      scalpRoot: 0.88,
    });
  }

  // =========================================================================
  // ZONE D: Shingled Side Tiers & Face-Framing Sideburns
  // =========================================================================
  const sideTiers = isPulledScalp ? 3 : Math.max(3, Math.round(3.5 * density));
  for (const side of [-1, 1] as const) {
    // Valkyrie Asym: left side (-1) flows long over the shoulder, right side (+1) stays cropped & edgy!
    const effSideLenPhi = isAsym
      ? side === -1
        ? Math.max(3.16, sideLenPhi + 0.5)
        : Math.min(2.04, sideLenPhi * 0.78)
      : isPulledScalp
        ? 2.28
        : sideLenPhi;

    for (let tier = 0; tier < sideTiers; tier++) {
      const locksInTier = Math.max(5, Math.round((isPulledScalp ? 7 : 6) * density));
      for (let j = 0; j < locksInTier; j++) {
        const v = locksInTier > 1 ? j / (locksInTier - 1) : 0.5;
        const thetaStart = side * THREE.MathUtils.lerp(0.84, 2.04, v) + (rand() - 0.5) * 0.05;
        const backSweep = side * (0.18 + (1 - v) * 0.18) * (isBob ? 0.45 : isPulledScalp ? 1.45 : 1.0);
        const thetaEnd = thetaStart + backSweep;
        const phiStart = 0.3 + tier * 0.26 + (rand() - 0.5) * 0.03;
        const phiEnd = isPulledScalp
          ? THREE.MathUtils.lerp(2.14, 2.34, v) + tier * 0.04
          : Math.min(
              Math.max(effSideLenPhi, backLenPhi * 0.88),
              phiStart + 0.9 + tier * 0.14 + Math.max(0, effSideLenPhi - 2.05) * 0.65 + rand() * 0.08
            );
        const isOuterTier = tier >= Math.floor(sideTiers / 2);

        const pts = buildSculptedLock({
          thetaStart,
          thetaEnd,
          phiStart,
          phiEnd,
          baseLift: isPulledScalp ? 0.011 + tier * 0.003 : 0.014 + tier * 0.004,
          midArch: isPulledScalp ? 0.009 : 0.013 + config.crownVolume * 0.005,
          tipFlickOut: isBob || isPulledScalp ? -0.006 : isOuterTier ? 0.014 + shag * 0.03 : 0.008,
          sCurveAmp: side * (isPulledScalp ? 0.014 : 0.028 + shag * 0.026),
          napeHug: isPulledScalp ? 1.24 : v > 0.5 ? napeHugBase : 0.86,
        });

        specs.push({
          pointsLocal: pts,
          width: (isPulledScalp ? 0.062 : 0.05 + rand() * 0.008) * wMul,
          thickness: 0.013,
          stiffnessBias: isPulledScalp ? 0.9 : isLong ? 0.64 : 0.84,
          layerAO: 0.84 + (tier % 2) * 0.07,
          layerOrder: isOuterTier ? 2 : 1,
          scalpRoot: tier === 0 ? 0.48 : 0.18,
        });
      }
    }

    // Cheek-Framing Tendrils / Sideburns (extra lush on Valkyrie Left, Aerith Half-Up & Tifa Dolphin!)
    const tendrilCount = isAsym && side === -1 ? 7 : isHalfUp || isDolphin ? 5 : 4;
    for (let k = 0; k < tendrilCount; k++) {
      const frac = tendrilCount > 1 ? k / (tendrilCount - 1) : 0;
      const thetaS = side * (0.84 + frac * 0.32);
      const thetaE = side * (isAsym && side === -1 ? 0.56 + frac * 0.24 : 0.66 + frac * 0.28);
      const phiS = 0.56 + frac * 0.18;
      const phiE = Math.min(
        3.35,
        isAsym && side === -1
          ? 3.24 - frac * 0.28
          : isHalfUp
            ? 2.86 - frac * 0.22
            : isPonytail || isTwinTails
              ? 2.48 - frac * 0.25
              : effSideLenPhi + (k < 2 ? 0.1 : -0.12)
      );

      const pts = buildSculptedLock({
        thetaStart: thetaS,
        thetaEnd: thetaE,
        phiStart: phiS,
        phiEnd: phiE,
        baseLift: 0.014 + (k % 2) * 0.004,
        midArch: 0.014,
        tipFlickOut: isBob ? -0.014 : k < 2 ? -0.006 : 0.01 * shag,
        tipDropExtra: isAsym && side === -1 ? 0.045 : config.sideLength > 0.65 ? 0.018 : 0.006,
        sCurveAmp: side * (isHalfUp ? -0.065 : -0.032),
        napeHug: 0.78,
      });

      specs.push({
        pointsLocal: pts,
        width: (0.044 - frac * 0.008) * wMul,
        thickness: 0.012,
        stiffnessBias: isAsym && side === -1 ? 0.58 : 0.74,
        layerAO: 0.92 + (k % 2) * 0.04,
        layerOrder: 2,
        scalpRoot: 0.24,
      });
    }
  }

  // =========================================================================
  // ZONE E: Multi-Tier Back Canopy + Special Archetype Sculptures
  // =========================================================================
  if (isPonytail) {
    // Sleek overlapping rear cap & tucked nape smoothly gathering into the ponytail tie
    for (let tier = 0; tier < 2; tier++) {
      for (let i = 0; i < 18; i++) {
        const u = i / 17;
        const theta = Math.PI * 0.58 + u * Math.PI * 0.84;
        const pts = buildSculptedLock({
          thetaStart: theta,
          thetaEnd: Math.PI + (theta - Math.PI) * 0.38,
          phiStart: tier === 0 ? 0.68 : 1.16,
          phiEnd: tier === 0 ? 2.18 : 2.38,
          baseLift: 0.012 + tier * 0.002,
          midArch: 0.009,
          tipFlickOut: -0.004,
          napeHug: 1.28,
        });
        specs.push({
          pointsLocal: pts,
          width: 0.062 * wMul,
          thickness: 0.012,
          stiffnessBias: 0.92,
          layerAO: 0.84 + tier * 0.04,
          layerOrder: 1,
          scalpRoot: tier === 0 ? 0.42 : 0.2,
        });
      }
    }

    // Dynamic High Battle Ponytail Fountain (28 lush flowing strands rooted on upper-rear skull!)
    const tailCount = Math.round(28 * density);
    const tailLen = THREE.MathUtils.lerp(0.46, 0.74, config.backLength);
    for (let i = 0; i < tailCount; i++) {
      const u = i / (tailCount - 1);
      const ring = i % 3;
      const angle = (u - 0.5) * Math.PI * 1.1;
      const anchorTheta = Math.PI + Math.sin(angle) * 0.14;
      const anchorPhi = 0.84 + ring * 0.07;
      const spreadX = Math.sin(angle) * (0.08 + ring * 0.032);
      const spreadZ = -Math.cos(angle) * (0.045 + ring * 0.02);

      const pts = buildGatheredTailLock({
        anchorTheta,
        anchorPhi,
        outDir: new THREE.Vector3(Math.sin(angle) * 0.28, 0.12 - ring * 0.08, -0.96),
        spreadX,
        spreadZ,
        length: tailLen + (ring === 0 ? 0.06 : -ring * 0.04) + rand() * 0.04,
        archOut: 0.13 + ring * 0.025,
        waveAmp: 0.02 + shag * 0.025,
        wavePhase: i * 0.7,
      });

      specs.push({
        pointsLocal: pts,
        width: (0.052 + (ring === 0 ? 0.008 : 0)) * wMul,
        thickness: 0.013,
        stiffnessBias: 0.48,
        layerAO: 0.88 + ring * 0.04,
        layerOrder: ring === 2 ? 3 : 2,
        scalpRoot: 0.35,
      });
    }
  } else if (isTwinTails) {
    // Sleek overlapping rear cap & tucked nape parting cleanly toward both twin-tail ties
    for (let tier = 0; tier < 2; tier++) {
      for (let i = 0; i < 18; i++) {
        const u = i / 17;
        const theta = Math.PI * 0.58 + u * Math.PI * 0.84;
        const pts = buildSculptedLock({
          thetaStart: theta,
          thetaEnd: theta,
          phiStart: tier === 0 ? 0.64 : 1.12,
          phiEnd: tier === 0 ? 2.16 : 2.38,
          baseLift: 0.012 + tier * 0.002,
          midArch: 0.009,
          tipFlickOut: -0.004,
          napeHug: 1.28,
        });
        specs.push({
          pointsLocal: pts,
          width: 0.062 * wMul,
          thickness: 0.012,
          stiffnessBias: 0.92,
          layerAO: 0.84 + tier * 0.04,
          layerOrder: 1,
          scalpRoot: tier === 0 ? 0.42 : 0.2,
        });
      }
    }

    // Dual Sculpted Twin-Tail Cascades (16 lush flowing ribbons per side = 32 strands!)
    const perSide = Math.round(16 * density);
    const tailLen = THREE.MathUtils.lerp(0.44, 0.72, config.backLength);
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < perSide; i++) {
        const u = i / (perSide - 1);
        const ring = i % 3;
        const spreadAngle = (u - 0.5) * Math.PI * 0.9;
        // tie roots +30 mm up and ~25 mm further back, root bundle radius -30% (Neon round 4)
        const anchorTheta = side * (2.08 + (u - 0.5) * 0.16 * 0.7);
        const anchorPhi = 0.71 + ring * 0.07 * 0.7;

        const pts = buildGatheredTailLock({
          anchorTheta,
          anchorPhi,
          outDir: new THREE.Vector3(side * 0.84, 0.08 - ring * 0.06, -0.52),
          spreadX: (side * (0.07 + ring * 0.025) + Math.sin(spreadAngle) * 0.04) * 0.7,
          spreadZ: -0.05 + Math.cos(spreadAngle) * 0.045,
          length: tailLen + (ring === 0 ? 0.05 : -ring * 0.03) + rand() * 0.04,
          archOut: 0.11 + ring * 0.02,
          waveAmp: 0.022 + shag * 0.024,
          wavePhase: i * 0.8 + (side > 0 ? 1.5 : 0),
        });

        specs.push({
          pointsLocal: pts,
          width: (0.048 + (ring === 0 ? 0.006 : 0)) * wMul,
          thickness: 0.013,
          stiffnessBias: 0.5,
          layerAO: 0.88 + ring * 0.04,
          layerOrder: ring === 2 ? 3 : 2,
          scalpRoot: 0.32,
        });
      }
    }
  } else {
    // Full Multi-Tier Shingled Back Cascade (adapts for Dolphin-Tail, Half-Up, Wolf-Cut, Bob, Swept-Back, Asym, Long, Shag)
    const backTiers = 4;
    const backPerTier = Math.round(16 * density);
    for (let tier = 0; tier < backTiers; tier++) {
      for (let i = 0; i < backPerTier; i++) {
        const u = backPerTier > 1 ? i / (backPerTier - 1) : 0.5;
        const thetaStart = Math.PI * 0.56 + u * Math.PI * 0.88 + (rand() - 0.5) * 0.05;
        const sideSign = u < 0.5 ? 1 : -1;
        const crossBias = tier % 2 === 0 ? 1 : -0.55;

        // Tifa Dolphin-Tail: lower back locks converge slightly then split outward into twin curved dolphin-tail wings!
        let thetaEnd = thetaStart + sideSign * crossBias * (0.14 + shag * 0.12);
        let tipFlick = isBob ? -0.01 : tier >= 2 ? 0.014 + shag * 0.03 : 0.008;
        let centerV =
          arch === 'wolf-cut'
            ? Math.exp(-Math.pow((u - 0.5) * 2.0, 2)) * 0.32
            : isBob
              ? -0.06
              : Math.exp(-Math.pow((u - 0.5) * 2.2, 2)) * 0.14;

        if (isDolphin) {
          const distFromCenter = Math.abs(u - 0.5);
          // Dolphin-tail twin-wing flare near tips + central V-notch
          thetaEnd = thetaStart - sideSign * (0.08 + (0.5 - distFromCenter) * 0.16);
          centerV = -0.08 + Math.sin(distFromCenter * Math.PI * 2.0) * 0.24;
          tipFlick = tier >= 2 ? 0.036 + distFromCenter * 0.025 : 0.012;
        } else if (isAsym) {
          // Asymmetric back bias: longer on left (u > 0.5 is viewer's left rear when theta > PI)
          centerV = (u - 0.5) * 0.42;
        }

        const phiStart = 0.24 + tier * 0.36 + (i % 3) * 0.06;
        const phiEnd = Math.min(
          3.56,
          Math.max(phiStart + 0.92, backLenPhi - (3 - tier) * 0.14 + centerV + rand() * 0.09)
        );

        const pts = buildSculptedLock({
          thetaStart,
          thetaEnd,
          phiStart,
          phiEnd,
          baseLift: 0.013 + tier * 0.005,
          midArch: 0.014 + config.crownVolume * 0.007,
          tipFlickOut: tipFlick,
          sCurveAmp: sideSign * (isDolphin ? -0.048 : 0.024 + shag * 0.022),
          napeHug: tier < 2 ? napeHugBase + 0.08 : napeHugBase,
        });

        specs.push({
          pointsLocal: pts,
          width: (0.058 + rand() * 0.008) * wMul,
          thickness: 0.014,
          stiffnessBias: isLong ? 0.52 : 0.78,
          layerAO: 0.84 + tier * 0.04,
          layerOrder: tier < 2 ? 1 : 2,
          scalpRoot: tier === 0 ? 0.42 : 0.14,
        });
      }
    }

    // Half-Up Cascade (Aerith / Jill): add signature gathered upper-rear half-up waterfall plume!
    if (isHalfUp) {
      const halfTailCount = Math.round(18 * density);
      const halfLen = THREE.MathUtils.lerp(0.42, 0.66, config.backLength);
      for (let i = 0; i < halfTailCount; i++) {
        const u = i / (halfTailCount - 1);
        const angle = (u - 0.5) * Math.PI * 0.85;
        const pts = buildGatheredTailLock({
          anchorTheta: Math.PI + Math.sin(angle) * 0.16,
          anchorPhi: 0.96 + (i % 2) * 0.06,
          outDir: new THREE.Vector3(Math.sin(angle) * 0.22, 0.04, -0.98),
          spreadX: Math.sin(angle) * 0.11,
          spreadZ: -Math.cos(angle) * 0.05,
          length: halfLen + (i % 3) * 0.03,
          archOut: 0.1,
          waveAmp: 0.024,
          wavePhase: i * 0.65,
        });
        specs.push({
          pointsLocal: pts,
          width: 0.052 * wMul,
          thickness: 0.013,
          stiffnessBias: 0.54,
          layerAO: 0.92 + (i % 2) * 0.05,
          layerOrder: 3,
          scalpRoot: 0.34,
        });
      }
    }
  }

  // =========================================================================
  // ZONE F: Sculpted Hero Spikes / Crown Crest (Driven by spikeLift)
  // =========================================================================
  if (spikeAmt > 0.12 && !isPulledScalp) {
    const spikeCount = Math.round((10 + spikeAmt * 30) * density);
    for (let i = 0; i < spikeCount; i++) {
      const ring = i % 3;
      const u = Math.floor(i / 3) / Math.max(1, Math.ceil(spikeCount / 3));
      const theta = isAsym
        ? THREE.MathUtils.lerp(0.15, Math.PI * 1.15, u) + ring * 0.18
        : u * Math.PI * 2 + ring * 0.34 + (rand() - 0.5) * 0.08;
      const phi = 0.24 + ring * 0.24 + (i % 2) * 0.04;
      const root = skullSurfacePoint(theta, phi, 0.012);
      const radial = root.clone().sub(HEAD_CENTER_LOCAL).normalize();

      const horizX = Math.sin(theta);
      const horizZ = Math.cos(theta);
      const fanOut = new THREE.Vector3(
        horizX * (0.78 + ring * 0.14) + config.bangsSweep * 0.22,
        0.38 + spikeAmt * 0.34 - ring * 0.22,
        horizZ * 0.72 - (horizZ < -0.1 || isSweptBack ? 0.22 : 0)
      ).normalize();

      const dir = radial.clone().multiplyScalar(0.32).addScaledVector(fanOut, 0.68).normalize();
      if (dir.dot(radial) < 0.55) {
        dir.addScaledVector(radial, 0.55 - dir.dot(radial)).normalize();
      }

      const len = 0.11 + spikeAmt * 0.095 + (i % 3 === 0 ? 0.024 : 0) + rand() * 0.014;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < NODES_PER_LOCK; k++) {
        const t = k / (NODES_PER_LOCK - 1);
        const arc = Math.sin(t * Math.PI) * 0.014;
        const sweep = t * t * 0.022;
        pts.push(
          root
            .clone()
            .addScaledVector(dir, t * len)
            .add(new THREE.Vector3(horizX * sweep, arc - t * t * (0.022 - spikeAmt * 0.012), horizZ * sweep * 0.5))
        );
      }

      const bladeN = new THREE.Vector3(horizX * 0.5, 0.45, horizZ >= 0 ? 0.74 : -0.74).normalize();
      specs.push({
        pointsLocal: pts,
        width: (0.046 + (i % 3 === 0 ? 0.01 : 0)) * wMul,
        thickness: 0.011,
        stiffnessBias: isSpiky ? 0.96 : 0.9,
        layerAO: 0.92,
        layerOrder: 4,
        customOutDir: bladeN,
        lockNormal: true,
        scalpRoot: 0.36,
      });
    }
  }

  // =========================================================================
  // ZONE G: Tasteful Canopy-Tucked Silhouette Flyaways (Driven by layerShag)
  // =========================================================================
  if (shag > 0.22 && !isPulledScalp) {
    const wispCount = Math.round(14 * shag * density);
    for (let i = 0; i < wispCount; i++) {
      const u = wispCount > 1 ? i / (wispCount - 1) : 0.5;
      const theta = Math.PI * 0.34 + u * Math.PI * 1.32 + (rand() - 0.5) * 0.1;
      const rawPhiStart = 0.34 + (i % 4) * 0.28;
      // Keep lower wisps strictly behind the temple hairline so none root on bare temple/cheek skin
      const phiStart = Math.cos(theta) > 0.32 ? Math.min(rawPhiStart, 0.88) : rawPhiStart;
      const phiEnd = Math.min(backLenPhi, phiStart + 0.72 + rand() * 0.26);

      const pts = buildSculptedLock({
        thetaStart: theta,
        thetaEnd: theta + (rand() - 0.5) * 0.2,
        phiStart,
        phiEnd,
        baseLift: 0.018 + (i % 2) * 0.004,
        midArch: 0.015,
        tipFlickOut: 0.036 + shag * 0.024 + rand() * 0.014,
        sCurveAmp: (i % 2 === 0 ? 1 : -1) * 0.036,
        napeHug: 0.9,
      });

      specs.push({
        pointsLocal: pts,
        width: (0.025 + rand() * 0.007) * wMul,
        thickness: 0.009,
        stiffnessBias: 0.74,
        layerAO: 0.96,
        layerOrder: 4,
        scalpRoot: 0.18,
      });
    }
  }

  return specs;
}

const ARCHETYPE_PRESET_MAP: Record<HairBuilderArchetype, HairPresetId> = {
  'noble-hime': 'silver',
  'spiky-hero': 'soldier',
  'long-cascade': 'silver',
  'wolf-cut': 'noctis',
  'sleek-bob': 'crimson',
  'layered-shag': 'leon',
  'asym-cascade': 'crimson',
  'dolphin-long': 'silver',
  'ribbon-halfup': 'silver',
  'swept-back': 'noctis',
  'high-ponytail': 'silver',
  'twin-tails': 'crimson',
  'emo-sweep': 'leon',
  'short-crop': 'silver',
  'messy-mage': 'leon',
  'elder-scholar': 'silver',
  'low-side-ponytail': 'silver',
  'mohawk-warrior': 'noctis',
  'twin-buns': 'crimson',
  'pixie-cut': 'leon',
  'undercut-fade': 'silver',
  'braided-crown': 'crimson',
  'wavy-bard': 'crimson',
  'samurai-topknot': 'noctis',
  'curtain-part': 'leon',
  'rope-locs': 'noctis',
  'coily-afro': 'noctis',
};

function buildArchetypeParameters(archetype: HairBuilderArchetype, rand: () => number, seed: number): HairBuilderConfig {
  const rRange = (lo: number, hi: number) => Number((lo + rand() * (hi - lo)).toFixed(2));

  switch (archetype) {
    case 'spiky-hero':
      return {
        archetype,
        partPosition: rRange(-0.45, 0.45),
        bangsLength: rRange(0.48, 0.74),
        bangsSweep: rRange(-0.65, 0.65),
        crownVolume: rRange(0.55, 0.88),
        spikeLift: rRange(0.58, 0.96),
        sideLength: rRange(0.44, 0.72),
        backLength: rRange(0.46, 0.74),
        layerShag: rRange(0.62, 0.92),
        density: rRange(0.95, 1.12),
        strandWidth: rRange(0.92, 1.08),
        seed,
      };
    case 'long-cascade':
      return {
        archetype,
        partPosition: rand() < 0.45 ? 0 : rRange(-0.55, 0.55),
        bangsLength: rRange(0.62, 0.9),
        bangsSweep: rRange(-0.4, 0.4),
        crownVolume: rRange(0.32, 0.62),
        spikeLift: rRange(0.0, 0.14),
        sideLength: rRange(0.76, 0.98),
        backLength: rRange(0.82, 1.0),
        layerShag: rRange(0.24, 0.54),
        density: rRange(0.96, 1.12),
        strandWidth: rRange(0.96, 1.12),
        seed,
      };
    case 'noble-hime':
      return {
        archetype,
        partPosition: rRange(-0.06, 0.06),
        bangsLength: rRange(0.28, 0.46),
        bangsSweep: rRange(-0.08, 0.08),
        crownVolume: rRange(0.18, 0.36),
        spikeLift: rRange(0.0, 0.02),
        sideLength: rRange(0.42, 0.62),
        backLength: rRange(0.84, 1.00),
        layerShag: rRange(0.02, 0.12),
        density: rRange(1.06, 1.22),
        strandWidth: rRange(0.96, 1.14),
        seed,
      };
    case 'wolf-cut':
      return {
        archetype,
        partPosition: rRange(-0.58, 0.58),
        bangsLength: rRange(0.52, 0.78),
        bangsSweep: rRange(-0.6, 0.6),
        crownVolume: rRange(0.42, 0.72),
        spikeLift: rRange(0.14, 0.42),
        sideLength: rRange(0.56, 0.8),
        backLength: rRange(0.74, 0.95),
        layerShag: rRange(0.65, 0.95),
        density: rRange(0.95, 1.12),
        strandWidth: rRange(0.9, 1.06),
        seed,
      };
    case 'sleek-bob':
      return {
        archetype,
        partPosition: rRange(-0.65, 0.65),
        bangsLength: rRange(0.46, 0.76),
        bangsSweep: rRange(-0.7, 0.7),
        crownVolume: rRange(0.22, 0.48),
        spikeLift: rRange(0.0, 0.1),
        sideLength: rRange(0.42, 0.66),
        backLength: rRange(0.36, 0.56),
        layerShag: rRange(0.08, 0.3),
        density: rRange(0.98, 1.14),
        strandWidth: rRange(0.96, 1.14),
        seed,
      };
    case 'asym-cascade':
      return {
        archetype,
        partPosition: rRange(0.32, 0.72),
        bangsLength: rRange(0.58, 0.82),
        bangsSweep: rRange(-0.85, -0.45),
        crownVolume: rRange(0.44, 0.74),
        spikeLift: rRange(0.18, 0.48),
        sideLength: rRange(0.66, 0.92),
        backLength: rRange(0.46, 0.74),
        layerShag: rRange(0.54, 0.84),
        density: rRange(0.96, 1.12),
        strandWidth: rRange(0.92, 1.08),
        seed,
      };
    case 'dolphin-long':
      return {
        archetype,
        partPosition: rRange(-0.18, 0.18),
        bangsLength: rRange(0.52, 0.78),
        bangsSweep: rRange(-0.25, 0.25),
        crownVolume: rRange(0.3, 0.54),
        spikeLift: rRange(0.0, 0.08),
        sideLength: rRange(0.68, 0.9),
        backLength: rRange(0.84, 1.0),
        layerShag: rRange(0.26, 0.52),
        density: rRange(0.98, 1.14),
        strandWidth: rRange(0.96, 1.12),
        seed,
      };
    case 'ribbon-halfup':
      return {
        archetype,
        partPosition: rRange(-0.2, 0.2),
        bangsLength: rRange(0.56, 0.8),
        bangsSweep: rRange(-0.35, 0.35),
        crownVolume: rRange(0.44, 0.74),
        spikeLift: rRange(0.0, 0.1),
        sideLength: rRange(0.62, 0.86),
        backLength: rRange(0.76, 0.98),
        layerShag: rRange(0.32, 0.62),
        density: rRange(0.96, 1.12),
        strandWidth: rRange(0.94, 1.1),
        seed,
      };
    case 'samurai-topknot':
      return {
        archetype,
        partPosition: rRange(-0.1, 0.1),
        bangsLength: rRange(0.05, 0.25),
        bangsSweep: rRange(-0.15, 0.15),
        crownVolume: rRange(0.25, 0.5),
        spikeLift: rRange(0.05, 0.25),
        sideLength: rRange(0.15, 0.35),
        backLength: rRange(0.25, 0.55),
        layerShag: rRange(0.15, 0.4),
        density: rRange(1.0, 1.16),
        strandWidth: rRange(0.9, 1.08),
        seed,
      };
    case 'wavy-bard':
      return {
        archetype,
        partPosition: rRange(-0.28, 0.28),
        bangsLength: rRange(0.32, 0.56),
        bangsSweep: rRange(-0.45, 0.45),
        crownVolume: rRange(0.58, 0.86),
        spikeLift: rRange(0.0, 0.08),
        sideLength: rRange(0.68, 0.90),
        backLength: rRange(0.72, 0.94),
        layerShag: rRange(0.45, 0.72),
        density: rRange(1.06, 1.24),
        strandWidth: rRange(0.88, 1.06),
        seed,
      };
    case 'braided-crown':
      return {
        archetype,
        partPosition: rRange(-0.12, 0.12),
        bangsLength: rRange(0.28, 0.52),
        bangsSweep: rRange(-0.25, 0.25),
        crownVolume: rRange(0.35, 0.6),
        spikeLift: rRange(0, 0.06),
        sideLength: rRange(0.45, 0.7),
        backLength: rRange(0.62, 0.88),
        layerShag: rRange(0.18, 0.42),
        density: rRange(1.0, 1.16),
        strandWidth: rRange(0.92, 1.1),
        seed,
      };
    case 'undercut-fade':
      return {
        archetype,
        partPosition: rRange(-0.65, -0.25),
        bangsLength: rRange(0.28, 0.55),
        bangsSweep: rRange(0.45, 0.9),
        crownVolume: rRange(0.48, 0.8),
        spikeLift: rRange(0.12, 0.42),
        sideLength: rRange(0.05, 0.22),
        backLength: rRange(0.08, 0.26),
        layerShag: rRange(0.45, 0.78),
        density: rRange(0.98, 1.16),
        strandWidth: rRange(0.86, 1.04),
        seed,
      };
    case 'messy-mage':
      return {
        archetype,
        partPosition: rRange(-0.35, 0.35),
        bangsLength: rRange(0.28, 0.50),
        bangsSweep: rRange(-0.45, 0.45),
        crownVolume: rRange(0.46, 0.74),
        spikeLift: rRange(0.08, 0.28),
        sideLength: rRange(0.32, 0.56),
        backLength: rRange(0.38, 0.62),
        layerShag: rRange(0.62, 0.90),
        density: rRange(1.02, 1.20),
        strandWidth: rRange(0.84, 1.02),
        seed,
      };
    case 'pixie-cut':
      return {
        archetype,
        partPosition: rRange(-0.55, -0.25),
        bangsLength: rRange(0.24, 0.44),
        bangsSweep: rRange(0.45, 0.85),
        crownVolume: rRange(0.24, 0.48),
        spikeLift: rRange(0.0, 0.12),
        sideLength: rRange(0.18, 0.36),
        backLength: rRange(0.22, 0.42),
        layerShag: rRange(0.35, 0.62),
        density: rRange(1.04, 1.20),
        strandWidth: rRange(0.84, 1.00),
        seed,
      };
    case 'twin-buns':
      return {
        archetype,
        partPosition: rRange(-0.06, 0.06),
        bangsLength: rRange(0.28, 0.52),
        bangsSweep: rRange(-0.15, 0.15),
        crownVolume: rRange(0.32, 0.58),
        spikeLift: rRange(0.0, 0.05),
        sideLength: rRange(0.25, 0.48),
        backLength: rRange(0.20, 0.40),
        layerShag: rRange(0.08, 0.25),
        density: rRange(1.02, 1.18),
        strandWidth: rRange(0.90, 1.08),
        seed,
      };
    case 'mohawk-warrior':
      return {
        archetype,
        partPosition: 0.0,
        bangsLength: rRange(0.22, 0.45),
        bangsSweep: rRange(-0.10, 0.10),
        crownVolume: rRange(0.62, 0.92),
        spikeLift: rRange(0.45, 0.85),
        sideLength: rRange(0.05, 0.18),
        backLength: rRange(0.25, 0.72),
        layerShag: rRange(0.45, 0.75),
        density: rRange(1.04, 1.22),
        strandWidth: rRange(0.86, 1.04),
        seed,
      };
    case 'low-side-ponytail':
      return {
        archetype,
        partPosition: rRange(-0.45, -0.18),
        bangsLength: rRange(0.28, 0.48),
        bangsSweep: rRange(0.35, 0.72),
        crownVolume: rRange(0.26, 0.48),
        spikeLift: rRange(0.0, 0.04),
        sideLength: rRange(0.45, 0.68),
        backLength: rRange(0.72, 0.96),
        layerShag: rRange(0.16, 0.36),
        density: rRange(1.02, 1.18),
        strandWidth: rRange(0.92, 1.10),
        seed,
      };
    case 'elder-scholar':
      return {
        archetype,
        partPosition: 0.0,
        bangsLength: rRange(0.0, 0.10),
        bangsSweep: rRange(0.0, 0.15),
        crownVolume: rRange(0.18, 0.36),
        spikeLift: rRange(0.0, 0.04),
        sideLength: rRange(0.45, 0.68),
        backLength: rRange(0.45, 0.72),
        layerShag: rRange(0.18, 0.38),
        density: rRange(0.95, 1.12),
        strandWidth: rRange(0.90, 1.06),
        seed,
      };
    case 'short-crop':
      return {
        archetype,
        partPosition: rRange(-0.2, 0.2),
        bangsLength: rRange(0.1, 0.3),
        bangsSweep: rRange(-0.4, 0.1),
        crownVolume: rRange(0.2, 0.4),
        spikeLift: rRange(0, 0.1),
        sideLength: rRange(0.05, 0.25),
        backLength: rRange(0.05, 0.25),
        layerShag: rRange(0.2, 0.45),
        density: rRange(1.0, 1.15),
        strandWidth: rRange(0.8, 1.0),
        seed,
      };
    case 'swept-back':
      return {
        archetype,
        partPosition: rRange(-0.25, 0.25),
        bangsLength: rRange(0.34, 0.58),
        bangsSweep: rRange(-0.3, 0.3),
        crownVolume: rRange(0.54, 0.86),
        spikeLift: rRange(0.16, 0.46),
        sideLength: rRange(0.44, 0.72),
        backLength: rRange(0.54, 0.82),
        layerShag: rRange(0.56, 0.88),
        density: rRange(0.96, 1.12),
        strandWidth: rRange(0.92, 1.08),
        seed,
      };
    case 'high-ponytail':
      return {
        archetype,
        partPosition: rRange(-0.35, 0.35),
        bangsLength: rRange(0.48, 0.74),
        bangsSweep: rRange(-0.55, 0.55),
        crownVolume: rRange(0.24, 0.52),
        spikeLift: 0.0,
        sideLength: rRange(0.42, 0.68),
        backLength: rRange(0.62, 0.98),
        layerShag: rRange(0.22, 0.56),
        density: rRange(0.96, 1.12),
        strandWidth: rRange(0.94, 1.1),
        seed,
      };
    case 'twin-tails':
      return {
        archetype,
        partPosition: rRange(-0.25, 0.25),
        bangsLength: rRange(0.48, 0.74),
        bangsSweep: rRange(-0.4, 0.4),
        crownVolume: rRange(0.24, 0.5),
        spikeLift: 0.0,
        sideLength: rRange(0.44, 0.68),
        backLength: rRange(0.58, 0.96),
        layerShag: rRange(0.2, 0.52),
        density: rRange(0.96, 1.12),
        strandWidth: rRange(0.94, 1.1),
        seed,
      };
    case 'emo-sweep':
      return {
        archetype,
        partPosition: rand() < 0.5 ? rRange(0.55, 0.8) : rRange(-0.8, -0.55),
        bangsLength: rRange(0.66, 0.94),
        bangsSweep: rand() < 0.5 ? rRange(-0.95, -0.68) : rRange(0.68, 0.95),
        crownVolume: rRange(0.36, 0.66),
        spikeLift: rRange(0.08, 0.34),
        sideLength: rRange(0.56, 0.84),
        backLength: rRange(0.52, 0.82),
        layerShag: rRange(0.48, 0.82),
        density: rRange(0.96, 1.12),
        strandWidth: rRange(0.92, 1.08),
        seed,
      };
    case 'curtain-part':
      return {
        archetype,
        partPosition: rRange(-0.12, 0.12),
        bangsLength: rRange(0.32, 0.72),
        bangsSweep: 0,
        crownVolume: rRange(0.35, 0.75),
        spikeLift: 0,
        sideLength: rRange(0.3, 0.7),
        backLength: rRange(0.3, 0.7),
        layerShag: rRange(0.25, 0.6),
        density: rRange(1.0, 1.15),
        strandWidth: rRange(0.92, 1.06),
        seed,
      };
    case 'rope-locs':
      return {
        archetype,
        partPosition: rRange(-0.15, 0.15),
        bangsLength: rRange(0.4, 0.8),
        bangsSweep: 0,
        crownVolume: rRange(0.4, 0.8),
        spikeLift: 0,
        sideLength: rRange(0.45, 0.9),
        backLength: rRange(0.5, 0.95),
        layerShag: rRange(0.3, 0.7),
        density: rRange(0.95, 1.12),
        strandWidth: rRange(0.92, 1.08),
        seed,
      };
    case 'coily-afro':
      return {
        archetype,
        partPosition: 0,
        bangsLength: rRange(0.2, 0.5),
        bangsSweep: 0,
        crownVolume: rRange(0.45, 0.9),
        spikeLift: 0,
        sideLength: rRange(0.3, 0.7),
        backLength: rRange(0.3, 0.7),
        layerShag: rRange(0.3, 0.7),
        density: rRange(1.0, 1.15),
        strandWidth: rRange(0.92, 1.08),
        seed,
      };
    default:
      // layered-shag
      return {
        archetype: 'layered-shag',
        partPosition: rRange(-0.6, 0.6),
        bangsLength: rRange(0.54, 0.78),
        bangsSweep: rRange(-0.65, 0.65),
        crownVolume: rRange(0.36, 0.64),
        spikeLift: rRange(0.08, 0.32),
        sideLength: rRange(0.54, 0.78),
        backLength: rRange(0.52, 0.78),
        layerShag: rRange(0.52, 0.84),
        density: rRange(0.95, 1.12),
        strandWidth: rRange(0.9, 1.06),
        seed,
      };
  }
}

export function calibratePhysicsForBuilder(
  builder: HairBuilderConfig,
  windAzimuth = 30
): Omit<PhysicsConfig, 'showColliders' | 'showBones'> {
  const longFactor = (builder.backLength + builder.sideLength) * 0.5;
  const stiffness = Number(
    THREE.MathUtils.clamp(0.76 - longFactor * 0.24 + builder.spikeLift * 0.18, 0.52, 0.86).toFixed(2)
  );
  const gravity = Number(
    THREE.MathUtils.clamp(3.0 + longFactor * 2.4 - builder.spikeLift * 1.1, 2.4, 5.4).toFixed(1)
  );
  const damping = Number(THREE.MathUtils.clamp(0.105 + longFactor * 0.022, 0.1, 0.13).toFixed(3));

  return {
    stiffness,
    gravity,
    windStrength: 0.48,
    windTurbulence: 0.16,
    windAzimuth,
    damping,
    inertia: Number(THREE.MathUtils.clamp(0.76 + longFactor * 0.14, 0.74, 0.9).toFixed(2)),
    bendingSmoothness: Number(THREE.MathUtils.clamp(0.52 + builder.spikeLift * 0.14, 0.5, 0.68).toFixed(2)),
    collisionMarginMm: 9,
    rootAnchor: 0.64,
    solverSubsteps: 1,
    strandWidthScale: 1.0,
    collisionEnabled: true,
  };
}

export function pickRandomPalette(excludeId?: string): CuratedHairPalette {
  const pool = excludeId ? CURATED_HAIR_PALETTES.filter((p) => p.id !== excludeId) : CURATED_HAIR_PALETTES;
  return pool[Math.floor(Math.random() * pool.length)] ?? CURATED_HAIR_PALETTES[0];
}

export function generateRandomShape(
  currentArchetype?: HairBuilderArchetype,
  customSeed?: number
): { name: string; basePreset: HairPresetId; builder: HairBuilderConfig; physics: Omit<PhysicsConfig, 'showColliders' | 'showBones'> } {
  const seed =
    customSeed !== undefined && Number.isFinite(customSeed)
      ? Math.abs(Math.floor(customSeed)) % 999999 || 42
      : Math.floor(Math.random() * 899999) + 100000;
  const rand = seededRand(seed);
  const pool = currentArchetype ? ALL_ARCHETYPES.filter((a) => a !== currentArchetype) : ALL_ARCHETYPES;
  const archetype = pool[Math.floor(rand() * pool.length)] ?? ALL_ARCHETYPES[0];
  const builder = buildArchetypeParameters(archetype, rand, seed);
  const physics = calibratePhysicsForBuilder(builder, Math.round(rand() * 12) * 30);
  const shortId = String(seed % 1000).padStart(3, '0');
  return {
    name: `${ARCHETYPE_LABELS[archetype]} #${shortId}`,
    basePreset: ARCHETYPE_PRESET_MAP[archetype],
    builder,
    physics,
  };
}

/**
 * Generates a cohesive, artistically balanced Final Fantasy / JRPG hairstyle with matched
 * silhouette archetype (12 archetypes), curated character palette (20 palettes), and calibrated physics!
 */
export function generateRandomHairstyle(
  customSeed?: number,
  forcedArchetype?: HairBuilderArchetype
): RandomizedHairstyleResult {
  const seed =
    customSeed !== undefined && Number.isFinite(customSeed)
      ? Math.abs(Math.floor(customSeed)) % 999999 || 42
      : Math.floor(Math.random() * 899999) + 100000;
  const rand = seededRand(seed);

  const archetype = forcedArchetype ?? ALL_ARCHETYPES[Math.floor(rand() * ALL_ARCHETYPES.length)];
  const palette = CURATED_HAIR_PALETTES[Math.floor(rand() * CURATED_HAIR_PALETTES.length)];
  const builder = buildArchetypeParameters(archetype, rand, seed);
  const physics = calibratePhysicsForBuilder(builder, Math.round(rand() * 12) * 30);

  const shortId = String(seed % 1000).padStart(3, '0');
  const name = `${palette.label} ${ARCHETYPE_LABELS[archetype]} #${shortId}`;

  return {
    name,
    paletteLabel: palette.label,
    basePreset: ARCHETYPE_PRESET_MAP[archetype],
    builder,
    shader: { ...palette.shader },
    physics,
  };
}
