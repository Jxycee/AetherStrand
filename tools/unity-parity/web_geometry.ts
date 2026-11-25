// Shared: full-precision PresetGeometry (schema 2.1, plugin format + solver extras) from the LIVE web HairPhysicsSystem.
// Mirrors HairPhysicsSystem.loadCustomBuilder (collision-free bake included), so it equals what the web viewport renders and simulates.
import * as THREE from 'three';
import { HairPhysicsSystem } from '../../src/engine/hairPhysics';

export function exportGeometry(recipe: any): any {
  const hair: any = new HairPhysicsSystem(new THREE.ShaderMaterial(), recipe.presetId);
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.44, 0);
  const root = new THREE.Group();
  root.add(headPivot);
  hair.loadCustomBuilder(recipe.builder, recipe.presetId);
  const w = recipe.physics?.strandWidthScale ?? 1;
  hair.snapToHead(headPivot, w);
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
    sourcePivot: [0, 0.44, 0],
    strandWidthScale: w,
    presetId: recipe.presetId,
    presetName: recipe.customName ?? recipe.presetId,
    coordinateSystem: 'blender_z_up_neg_y_front',
    solverExtras: 'layerOrder,mass,restMidR,rootRawY,stiffnessWeight,rigid per lock; mesh: isFadeCap,fadeStart,smooth,roundness,tipStart,tipWidth,ripple,rippleFreq,colorFrom,colorTo,surfaceShine,shadeDir,rootWidth when set',
    lockCount: exported.length,
    // Painted short-hair layer under the locks (scalpPaint.ts); the plugin builds a scalp shell from the character's head.
    ...(hair.scalpPaint ? { scalpPaint: hair.scalpPaint } : {}),
    locks: exported,
  };
}
