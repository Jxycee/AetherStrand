// Hair shading, written once in TypeScript: the reference for the viewport's GLSL (hairShaders.ts) and the Unity URP
// shader (Shaders/AetherStrand_Hair.shader, ForwardLit pass). The CPU preview shades every hair pixel with
// shadeHairPixel(), so a render from tools/preview/cpu_preview.ts shows the same highlights the app and Unity draw.
// When you change the shading, change it here first, then mirror the same lines in both shaders (search "SHEEN v2").
import * as THREE from 'three';
import type { ShaderConfig } from '../types/hair';
import type { HairTextureData } from './hairTextures';
import { LIGHTING_RIGS } from './hairShaders';
import type { LightingPresetId } from '../types/hair';

/**
 * The look settings of the hair highlights and shadows. All optional in a recipe's "shader" block; missing ones take
 * SHEEN_DEFAULTS. See docs/SHARED_TOOLS.md "Hair sheen".
 */
export interface HairSheenSettings {
  /** How much the sharp primary highlight takes the hair colour (0 = pure primarySpecColor, 1 = hair colour). */
  primaryTint: number;
  /** How much the wide secondary highlight takes the hair colour. */
  secondaryTint: number;
  /** Soft wide band under the two lobes: strength, power (low = wider), shift along the strand, hair-colour tint. */
  sheenStrength: number;
  sheenPower: number;
  sheenShift: number;
  sheenTint: number;
  /** Per-strand highlight shift noise (0 = one clean band per lock, 1 = the old speckled look). */
  shiftJitter: number;
  /** How much the strand grooves and glints break the highlight up (0 = smooth band, 1 = the old crest-masked look). */
  specBreakup: number;
  /** How far the baked strand directions (flow map) bend the highlight tangent (0 = straight along the lock). */
  flowStrength: number;
  /** AO only partly darkens; shaded hair keeps its colour (0 = full AO). */
  shadowLift: number;
  /** Per-lock brightness / warmth variation. */
  clumpVariation: number;
  /** Tips a little lighter than the body. */
  tipLighten: number;
}

/**
 * Defaults for every style. Picked from before/after renders (docs/SHARED_TOOLS.md "Hair sheen"):
 * a near-white primary band and a hair-coloured secondary, one clean band per lock broken up by the baked strands rather
 * than by noise.
 */
export const SHEEN_DEFAULTS: HairSheenSettings = {
  primaryTint: 0.2,
  secondaryTint: 0.8,
  sheenStrength: 0.4,
  sheenPower: 10,
  sheenShift: 0.02,
  sheenTint: 0.7,
  shiftJitter: 0.35,
  specBreakup: 0.4,
  flowStrength: 0.6,
  shadowLift: 0.3,
  clumpVariation: 0.2,
  tipLighten: 0.12,
};

/** The settings as the shaders shaded before SHEEN v2 (for A/B renders: --sheen legacy). */
export const SHEEN_LEGACY: HairSheenSettings = {
  primaryTint: 0.52,
  secondaryTint: 0.52,
  sheenStrength: 0.3,
  sheenPower: 14,
  sheenShift: 0.02,
  sheenTint: 0.6,
  shiftJitter: 1,
  specBreakup: 1,
  flowStrength: 0,
  shadowLift: 0.3,
  clumpVariation: 0.2,
  tipLighten: 0.12,
};

export const SHEEN_KEYS = Object.keys(SHEEN_DEFAULTS) as (keyof HairSheenSettings)[];

/** The recipe's sheen settings with defaults filled in. */
export function resolveSheen(shader: Partial<ShaderConfig> | undefined, base: HairSheenSettings = SHEEN_DEFAULTS): HairSheenSettings {
  const out = { ...base };
  const s = (shader ?? {}) as Record<string, unknown>;
  for (const k of SHEEN_KEYS) if (typeof s[k] === 'number' && Number.isFinite(s[k] as number)) out[k] = s[k] as number;
  return out;
}

/** The light rig as the shaders receive it (directions normalised, colours scaled as createHairShaderMaterial does). */
export interface ShadeLights {
  keyDir: THREE.Vector3; keyColor: THREE.Color;
  fillDir: THREE.Vector3; fillColor: THREE.Color;
  rimDir: THREE.Vector3; rimColor: THREE.Color;
  ambient: THREE.Color;
}

export function rigLights(lightingId: LightingPresetId, rotate?: THREE.Matrix4): ShadeLights {
  const rig = LIGHTING_RIGS[lightingId];
  const dir = (d: [number, number, number]) => { const v = new THREE.Vector3(...d).normalize(); if (rotate) v.applyMatrix4(rotate).normalize(); return v; };
  return {
    keyDir: dir(rig.keyDir), keyColor: new THREE.Color(rig.keyColor).multiplyScalar(rig.keyIntensity * 0.42),
    fillDir: dir(rig.fillDir), fillColor: new THREE.Color(rig.fillColor).multiplyScalar(rig.fillIntensity * 0.38),
    rimDir: dir(rig.rimDir), rimColor: new THREE.Color(rig.rimColor).multiplyScalar(rig.rimIntensity * 0.42),
    ambient: new THREE.Color(rig.hemiSky).multiplyScalar(rig.hemiIntensity * 0.48),
  };
}

/** Everything that is constant over a draw: colours, lobe settings, maps, lights. */
export interface ShadeEnv {
  root: THREE.Color; base: THREE.Color; tip: THREE.Color; spec1: THREE.Color; spec2: THREE.Color;
  primaryShift: number; primaryPower: number; primaryIntensity: number;
  secondaryShift: number; secondaryPower: number; secondaryIntensity: number;
  rimIntensity: number; rimPower: number; rootAO: number; grooveDepth: number; strandVariation: number;
  sheen: HairSheenSettings;
  tex: HairTextureData;
  lights: ShadeLights;
  /** pre-v2 lobe weights (primary x0.56, secondary x0.44); only for --sheen legacy A/B renders, the shaders draw v2 */
  legacyWeights: boolean;
}

export function makeShadeEnv(shader: ShaderConfig, tex: HairTextureData, lights: ShadeLights, sheenBase?: HairSheenSettings): ShadeEnv {
  return {
    root: new THREE.Color(shader.rootColor), base: new THREE.Color(shader.baseColor), tip: new THREE.Color(shader.tipColor),
    spec1: new THREE.Color(shader.primarySpecColor), spec2: new THREE.Color(shader.secondarySpecColor),
    primaryShift: shader.primaryShift, primaryPower: shader.primaryPower, primaryIntensity: shader.primaryIntensity,
    secondaryShift: shader.secondaryShift, secondaryPower: shader.secondaryPower, secondaryIntensity: shader.secondaryIntensity,
    rimIntensity: shader.rimIntensity, rimPower: shader.rimPower, rootAO: shader.rootAO, grooveDepth: shader.grooveDepth,
    strandVariation: shader.strandVariation,
    sheen: resolveSheen(shader, sheenBase),
    tex, lights,
    legacyWeights: sheenBase === SHEEN_LEGACY,
  };
}

/** One hair pixel's interpolated vertex data (world space; N already flipped to face the viewer like gl_FrontFacing). */
export interface ShadeInput {
  u: number; t: number; seed: number; layerAO: number; cardMask: number; scalpRoot: number; gradT: number;
  N: THREE.Vector3; headN: THREE.Vector3; T: THREE.Vector3; V: THREE.Vector3;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (e0: number, e1: number, x: number) => { const c = clamp01((x - e0) / (e1 - e0)); return c * c * (3 - 2 * c); };
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const fract = (x: number) => x - Math.floor(x);

/** Strand card coverage (hybrid fine strands): a few separate hairs across the lock instead of the dense alpha card.
 * u runs round the lens profile (hairPhysics PROFILE_U: top centre 0, side 0.34, bottom centre 0.5, side 0.66), so u is first
 * turned back into the lateral position across the lock, which puts each hair on both faces at the same place. 3 hairs
 * per card (a baby-hair card is 6-10 mm wide, so a hair is about one preview pixel at the close-up), each with its own
 * offset, sway, taper and length from the lock seed.
 *  Mirrors strandCardAlpha in hairShaders.ts and AetherStrandCardAlpha in AetherStrand_Hair.shader. */
export function strandCardAlpha(u: number, t: number, seed: number): number {
  const x = u < 0.17 ? (u / 0.17) * 0.76 : u < 0.34 ? mix(0.76, 1, (u - 0.17) / 0.17) : u < 0.5 ? mix(1, 0, (u - 0.34) / 0.16)
    : u < 0.66 ? mix(0, -1, (u - 0.5) / 0.16) : u < 0.83 ? mix(-1, -0.76, (u - 0.66) / 0.17) : mix(-0.76, 0, (u - 0.83) / 0.17);
  const sn = (x * 0.5 + 0.5) * 3;
  const cell = Math.min(Math.floor(sn), 2);
  const f = sn - cell;
  const h1 = fract(Math.sin(cell * 12.9898 + seed * 78.233) * 43758.5453);
  const h2 = fract(Math.sin(cell * 39.3468 + seed * 11.135) * 24634.6345);
  const len = 0.7 + 0.3 * h2;
  if (t > len) return 0;
  const c = 0.5 + (h1 - 0.5) * 0.4 + Math.sin(t * (4 + 4 * h2) + h1 * 6.2832) * 0.12;
  const wd = 0.13 * (1 - 0.7 * sstep(0.4, len, t));
  return 1 - sstep(wd * 0.6, wd, Math.abs(f - c));
}

/**
 * Bilinear sample of an RGBA8 strand map, GL convention (v = 0 is the BOTTOM image row; three.js flipY and Unity both
 * sample that way). U repeats, V clamps. Writes 0..1 values into out.
 */
export function sampleMap(px: Uint8ClampedArray, w: number, h: number, u: number, v: number, out: number[]): number[] {
  const x = fract(u) * w - 0.5;
  const y = (1 - clamp01(v)) * (h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const xa = ((x0 % w) + w) % w, xb = (xa + 1) % w, ya = y0, yb = Math.min(h - 1, y0 + 1);
  for (let c = 0; c < 4; c++) {
    const a = px[(ya * w + xa) * 4 + c], b = px[(ya * w + xb) * 4 + c], d = px[(yb * w + xa) * 4 + c], e = px[(yb * w + xb) * 4 + c];
    out[c] = ((a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy) / 255;
  }
  return out;
}

/** Kajiya-Kay strand highlight (as strandSpecular in the shaders). */
export function strandSpecular(T: THREE.Vector3, V: THREE.Vector3, L: THREE.Vector3, exponent: number): number {
  const hx = L.x + V.x, hy = L.y + V.y, hz = L.z + V.z, hl = Math.hypot(hx, hy, hz) || 1;
  const dotTH = (T.x * hx + T.y * hy + T.z * hz) / hl;
  const sinTH = Math.sqrt(Math.max(0.0001, 1 - dotTH * dotTH));
  return sstep(-1, 0, dotTH) * Math.pow(sinTH, exponent);
}

const _tmp = { g: [0, 0, 0, 0], f: [0, 0, 0, 0], n: [0, 0, 0, 0], a: [0, 0, 0, 0], fl: [0, 0, 0, 0] };
const _v = { baseN: new THREE.Vector3(), B: new THREE.Vector3(), pN: new THREE.Vector3(), Tb: new THREE.Vector3(), t1: new THREE.Vector3(), t2: new THREE.Vector3(), tS: new THREE.Vector3() };
const shiftTangent = (out: THREE.Vector3, T: THREE.Vector3, N: THREE.Vector3, s: number) => out.copy(T).addScaledVector(N, s).normalize();

/**
 * Shades one hair pixel exactly as the viewport fragment shader (mode "shaded"). Returns linear RGB in out, or null when
 * the pixel is cut away (frayed tip). Fade caps' screen dither is left to the caller (it needs the pixel position).
 */
export function shadeHairPixel(p: ShadeInput, e: ShadeEnv, out: number[]): number[] | null {
  const S = e.sheen, tex = e.tex, w = tex.width, h = tex.height;
  const t = clamp01(p.t);
  const isFadeCap = p.cardMask > 0.15 && p.cardMask < 0.45;
  let fadeU0 = 0;
  if (isFadeCap) {
    const a = p.cardMask;
    let fs = Math.abs(a - 0.25) < 0.002 ? 0.25 : clamp01((a - 0.16) / 0.28);
    fs = fs < 0.9 ? Math.min(fs, 0.45) : fs;
    fadeU0 = sstep(fs, 1, t);
  }
  const su = p.u * 0.92 + p.seed * 3.13;
  if (p.cardMask > 0.5 && p.cardMask < 0.9) {
    // strand card (hybrid fine strands): same cut as hairShaders.ts strandCardAlpha
    if (strandCardAlpha(p.u, t, p.seed) < 0.36) return null;
  } else if (p.cardMask > 0.5 && t > 0.58) {
    const strandAlpha = sampleMap(tex.alphaCard, w, h, su, t, _tmp.a)[0];
    const edgeDist = Math.min(Math.abs(p.u - 0.34), Math.abs(p.u - 0.66));
    const lateralFray = sstep(0, 0.075, edgeDist);
    const tipRamp = sstep(0.58, 0.98, t);
    if (strandAlpha * mix(1, 0.44 + 0.56 * lateralFray, tipRamp) < 0.36) return null;
  }
  const lockN = p.N, headN = p.headN;
  const baseN = _v.baseN.copy(lockN).lerp(headN, 0.42).normalize();
  const grooveAo = sampleMap(tex.grooveAo, w, h, su, t, _tmp.g)[0];
  const flowId = sampleMap(tex.flowId, w, h, su, t, _tmp.f);
  const nt = sampleMap(tex.normal, w, h, su, t, _tmp.n);
  const fl = sampleMap(tex.flow, w, h, su, t, _tmp.fl);
  const ntx = nt[0] * 2 - 1, nty = nt[1] * 2 - 1;
  const T = p.T, V = p.V;
  const B = _v.B.crossVectors(baseN, T).normalize();
  const pN = _v.pN.copy(baseN).addScaledVector(B, ntx * 0.32 * e.grooveDepth).addScaledVector(T, nty * 0.05).normalize();

  const gt = clamp01(p.gradT);
  const er = e.base.clone().lerp(e.root, p.scalpRoot);
  const grad = gt < 0.28 ? er.lerp(e.base, sstep(0, 0.28, gt)) : e.base.clone().lerp(e.tip, sstep(0.28, 1, gt));
  const fiberTone = (flowId[0] - 0.5) * 0.92 + (p.seed - 0.5) * 0.32;
  let al = [grad.r, grad.g, grad.b].map((c) => Math.min(1.2, Math.max(0, c * (1 + fiberTone * e.strandVariation))));
  const fadeMask = isFadeCap ? sstep(0, 0.3, fadeU0) : 0;
  if (fadeMask > 0) {
    const fd = [0, 1, 2].map((k) => mix([e.root.r, e.root.g, e.root.b][k], [e.base.r, e.base.g, e.base.b][k], 0.5));
    const grey = ((fd[0] + fd[1] + fd[2]) / 3) * 1.15;
    const st = fd.map((c) => mix(c, grey, 0.35));
    const k2 = sstep(0.35, 1, t);
    al = al.map((c, k) => mix(c, mix(fd[k], st[k], k2) * (1 + fiberTone * e.strandVariation * 0.5), fadeMask));
  }
  const clumpTone = fract(p.seed * 41.7 + 0.31) * 2 - 1;
  const cv = S.clumpVariation * (1 - fadeMask);
  const warm = clamp01(clumpTone * 0.5 + 0.5) * cv;
  al = al.map((c, k) => c * (1 + clumpTone * cv) * mix(1, [1.07, 1, 0.93][k], warm) * (1 + S.tipLighten * sstep(0.5, 1, t) * (1 - fadeMask)));

  const rootOcc = mix(1 - e.rootAO * 0.72 * p.scalpRoot, 1, sstep(0, 0.22, t));
  const groove = mix(1, grooveAo, e.grooveDepth * 0.68);
  const dome = mix(0.84, 1.08, sstep(-0.55, 0.68, headN.y));
  let totalAO = rootOcc * groove * mix(0.72, 1.04, p.layerAO) * dome;
  totalAO *= mix(1, 0.9, t * fadeMask);

  const L = e.lights;
  const ndlKey = clamp01((pN.dot(L.keyDir) + 0.46) / 1.46);
  const ndlFill = clamp01((pN.dot(L.fillDir) + 0.48) / 1.48);
  const ndlBack = clamp01((pN.dot(L.rimDir) + 0.46) / 1.46);
  const skyLift = clamp01(baseN.y * 0.5 + 0.5);
  const aoD = mix(totalAO, 1, S.shadowLift * (1 - fadeMask));
  const ambK = 0.42 + 0.24 * skyLift + 0.16 * S.shadowLift * (1 - fadeMask);
  const lc = (c: THREE.Color, k: 0 | 1 | 2) => [c.r, c.g, c.b][k];

  // ---- SHEEN v2 (mirrored in hairShaders.ts and AetherStrand_Hair.shader) ----
  // the highlight runs along the baked strand direction: flow.rg = (across, along) in card space
  const fx = fl[0] * 2 - 1, fy = Math.max(0.05, fl[1] * 2 - 1);
  const Tb = _v.Tb.copy(T).multiplyScalar(fy).addScaledVector(B, fx * S.flowStrength).normalize();
  const shiftTex = ((flowId[2] - 0.5) * 0.38 + (p.seed - 0.5) * 0.12) * S.shiftJitter;
  const t1 = shiftTangent(_v.t1, Tb, pN, e.primaryShift + shiftTex);
  const t2 = shiftTangent(_v.t2, Tb, pN, e.secondaryShift + shiftTex * 1.2);
  const fiberCrest = sstep(0.42, 0.92, grooveAo);
  const microGlint = 0.74 + 0.26 * sstep(0.28, 0.86, flowId[0]);
  const breakup = mix(1, (0.24 + 0.76 * fiberCrest) * microGlint, S.specBreakup);
  const specMask = mix(1, sstep(0.08, 0.24, t), sstep(0, 0.5, p.scalpRoot)) * breakup * mix(0.62, 1, p.layerAO) * mix(1, 0.35, fadeMask);
  const keyFacing = sstep(-0.14, 0.48, baseN.dot(L.keyDir));
  const backFacing = sstep(-0.14, 0.48, baseN.dot(L.rimDir));
  const spec1 = strandSpecular(t1, V, L.keyDir, e.primaryPower) * e.primaryIntensity;
  const spec2 = strandSpecular(t2, V, L.keyDir, e.secondaryPower) * e.secondaryIntensity;
  const backSpec = strandSpecular(t1, V, L.rimDir, e.primaryPower * 0.78) * e.primaryIntensity * 0.54;
  const tS = shiftTangent(_v.tS, Tb, pN, S.sheenShift + shiftTex * 0.5);
  const sheenMask = sstep(0.08, 0.3, t) * mix(1, 0.7 + 0.3 * fiberCrest, S.specBreakup) * mix(0.6, 1, p.layerAO) * (1 - fadeMask);
  const sheenKey = strandSpecular(tS, V, L.keyDir, S.sheenPower) * keyFacing;
  const sheenRim = strandSpecular(tS, V, L.rimDir, S.sheenPower) * backFacing * 0.6;

  const fresnel = Math.pow(1 - Math.max(0, baseN.dot(V)), e.rimPower);
  const backGate = Math.pow(Math.max(0, -V.dot(L.rimDir)), 1.4) * 0.45 + 0.55;
  const tipWeight = mix(0.22, 1, sstep(0.28, 0.94, t));
  const rimK = fresnel * backGate * tipWeight * e.rimIntensity * 0.42 * mix(0.72, 1, p.layerAO) * mix(1, 0.3, fadeMask);

  for (const k of [0, 1, 2] as const) {
    const a = al[k];
    const diffuse = a * (lc(L.ambient, k) * ambK + lc(L.keyColor, k) * ndlKey * 0.88 + lc(L.fillColor, k) * ndlFill * 0.4 + lc(L.rimColor, k) * ndlBack * 0.56) * aoD;
    const s1t = mix(lc(e.spec1, k), a * 1.55, S.primaryTint);
    const s2t = mix(lc(e.spec2, k), a * 1.35, S.secondaryTint);
    const w1 = e.legacyWeights ? 0.56 : 1, w2 = e.legacyWeights ? 0.44 : 1;
    let spec = ((s1t * spec1 * w1 + s2t * spec2 * w2) * lc(L.keyColor, k) * keyFacing + s1t * backSpec * lc(L.rimColor, k) * backFacing) * specMask * rootOcc;
    const sht = mix(lc(e.spec1, k), a * 2.4, S.sheenTint);
    spec += sht * sheenMask * S.sheenStrength * (sheenKey * lc(L.keyColor, k) + sheenRim * lc(L.rimColor, k));
    const rimTint = mix(a * 1.65, lc(L.rimColor, k), 0.3);
    out[k] = diffuse + spec + rimTint * rimK;
  }
  return out;
}

/** three.js ACESFilmicToneMapping (exposure 1.16) then linear -> sRGB, as the viewport displays. Returns 0..255. */
export function displaySRGB(c: number[], exposure = 1.16): number[] {
  // three.js ACESFilmicToneMapping (RRT+ODT fit), same constants as AS_WebDisplay in the Unity shader
  const x = c.map((v) => (v * exposure) / 0.6);
  const a = [
    x[0] * 0.59719 + x[1] * 0.35458 + x[2] * 0.04823,
    x[0] * 0.076 + x[1] * 0.90834 + x[2] * 0.01566,
    x[0] * 0.0284 + x[1] * 0.13383 + x[2] * 0.83777,
  ].map((v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081));
  const o = [
    a[0] * 1.60475 - a[1] * 0.53108 - a[2] * 0.07367,
    -a[0] * 0.10208 + a[1] * 1.10813 - a[2] * 0.00605,
    -a[0] * 0.00327 - a[1] * 0.07276 + a[2] * 1.07602,
  ];
  return o.map((v) => {
    v = clamp01(v);
    v = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(v * 255);
  });
}
