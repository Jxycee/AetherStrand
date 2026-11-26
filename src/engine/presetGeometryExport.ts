// Full-precision PresetGeometry.json (schema 2.1: plugin format + solver extras) from a live HairPhysicsSystem.
// One code path for the web generator's Unity ZIP and the headless parity tool (tools/unity-parity/web_geometry.ts),
// so both write the same file: per-lock mesh extras, the hybridMass block and the scalpPaint block when present.
// No DOM use: safe to run headless.
import type { HairPhysicsSystem } from './hairPhysics';

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
/** Web (x, y, z) triples -> the file's Blender axes (x, -z, y), rounded to a micrometre. */
function blender3(a: ArrayLike<number>): number[] {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i += 3) { out[i] = r6(a[i]); out[i + 1] = r6(-a[i + 2]); out[i + 2] = r6(a[i + 1]); }
  return out;
}
const flat = (a: ArrayLike<number>, round = false) => Array.from(a, (x) => (round ? r6(x) : x));

/** The hybridMass block of PresetGeometry.json: see AetherStrandWebData.LoadMass for the reader. */
export function exportMass(m: any): any {
  const g = m.geometry;
  const attr = (n: string) => g.attributes[n].array as ArrayLike<number>;
  return {
    version: 1,
    vertexCount: m.vertexCount,
    nodesPerLock: m.nodesPerLock,
    bindCount: m.bindCount,
    followShare: m.followShare,
    followSmooth: m.followSmooth,
    blockCount: m.blockCount,
    rest: blender3(m.rest),
    restHeadNormal: blender3(m.restHeadNormals),
    restTangent: blender3(m.restTangents),
    uv: flat(attr('uv'), true),
    seed: flat(attr('aStrandSeed'), true),
    layerAO: flat(attr('aLayerAO'), true),
    scalpRoot: flat(attr('aScalpRoot'), true),
    gradT: flat(attr('aGradT'), true),
    indices: flat(g.index.array),
    bindNode: flat(m.bindNode),
    bindW: flat(m.bindW, true),
    restHeight: flat(m.restHeight, true),
    adjStart: flat(m.adjStart),
    adjIdx: flat(m.adjIdx),
    vBlock: flat(m.vBlock),
    vInterpB: flat(m.vInterpB),
    vInterpW: flat(m.vInterpW, true),
    bAdjStart: flat(m.bAdjStart),
    bAdjIdx: flat(m.bAdjIdx),
  };
}

/** PresetGeometry.json content for a hair system already built and snapped to its head (rest pose, not the simulated one). */
export function buildPresetGeometry(hairSystem: HairPhysicsSystem, widthScale: number, presetId: string, presetName: string): any {
  const hair: any = hairSystem;
  const w = widthScale;
  const locks: any[] = hair.locks;
  const exported: any[] = hair.exportLockGeometry(w);
  exported.forEach((e: any, i: number) => {
    const lk = locks[i];
    e.points = lk.particles.map((p: any) => [p.restLocal.x, -p.restLocal.z, p.restLocal.y]);
    e.rootNormal = [lk.rootNormalLocal.x, -lk.rootNormalLocal.z, lk.rootNormalLocal.y];
    e.width = lk.baseWidth * w;
    e.thickness = lk.baseThickness * (0.65 + 0.35 * w);
    e.seed = lk.seed;
    e.scalpRoot = lk.scalpRoot;
    e.lockNormal = lk.lockNormal;
    e.layerOrder = lk.layerOrder;
    e.mass = lk.mass;
    e.restMidR = lk.restMidR;
    e.rootRawY = lk.particles[0].rawRestLocal.y;
    e.stiffnessWeight = lk.particles.map((p: any) => p.stiffnessWeight);
    // Mesh-shape fields the plugin reads (AetherStrandWebData.cs); written only when set so legacy exports are unchanged.
    if (lk.isFadeCap) e.isFadeCap = true;
    if (lk.strandCard) e.strandCard = true;
    if (lk.fadeStart !== undefined) e.fadeStart = lk.fadeStart;
    if (lk.smooth !== undefined && lk.smooth > 1) e.smooth = lk.smooth;
    if (lk.roundness !== undefined && lk.roundness > 0) e.roundness = lk.roundness;
    if (lk.tipStart !== undefined) e.tipStart = lk.tipStart;
    if (lk.tipWidth !== undefined && lk.tipWidth > 0) e.tipWidth = lk.tipWidth;
    if (lk.ripple !== undefined && lk.ripple > 0) { e.ripple = lk.ripple; e.rippleFreq = lk.rippleFreq ?? 9; }
    if (lk.colorRange) { e.colorFrom = lk.colorRange[0]; e.colorTo = lk.colorRange[1]; }
    if (lk.rigid) e.rigid = true;
    if (lk.surfaceShine) e.surfaceShine = lk.surfaceShine;
    if (lk.shadeDir) e.shadeDir = [lk.shadeDir.x, -lk.shadeDir.z, lk.shadeDir.y];
    if (lk.rootWidth !== undefined) e.rootWidth = lk.rootWidth;
  });
  return {
    schemaVersion: '2.1',
    // Hybrid inner mass (hairMass.ts), when the recipe turns it on: the built mesh and its follow data, so the plugin only
    // runs the deform (AetherStrandWebMass.cs) and builds nothing. Unconformed web space like the locks (the plugin maps it
    // through its head fit). Lock indices in bindNode are into `locks` below.
    ...(hair.mass ? { hybridMass: exportMass(hair.mass) } : {}),
    sourcePivot: [0, 0.44, 0],
    strandWidthScale: w,
    presetId,
    presetName,
    coordinateSystem: 'blender_z_up_neg_y_front',
    solverExtras: 'hybridMass block when built; layerOrder,mass,restMidR,rootRawY,stiffnessWeight,rigid per lock; mesh: isFadeCap,fadeStart,strandCard,smooth,roundness,tipStart,tipWidth,ripple,rippleFreq,colorFrom,colorTo,surfaceShine,shadeDir,rootWidth when set',
    lockCount: exported.length,
    // Painted short-hair layer under the locks (scalpPaint.ts); the plugin builds a scalp shell from the character's head.
    ...(hair.scalpPaint ? { scalpPaint: hair.scalpPaint } : {}),
    locks: exported,
  };
}
