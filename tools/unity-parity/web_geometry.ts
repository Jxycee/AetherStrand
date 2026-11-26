// Shared: full-precision PresetGeometry (schema 2.1, plugin format + solver extras) from the LIVE web HairPhysicsSystem.
// Mirrors HairPhysicsSystem.loadCustomBuilder (collision-free bake included), so it equals what the web viewport renders and simulates.
// The file itself is written by src/engine/presetGeometryExport.ts, the same code the web generator's Unity ZIP uses.
import * as THREE from 'three';
import { HairPhysicsSystem } from '../../src/engine/hairPhysics';
import { buildPresetGeometry, exportMass } from '../../src/engine/presetGeometryExport';

export { exportMass };

export function exportGeometry(recipe: any): any {
  const hair: any = new HairPhysicsSystem(new THREE.ShaderMaterial(), recipe.presetId);
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.44, 0);
  const root = new THREE.Group();
  root.add(headPivot);
  hair.loadCustomBuilder(recipe.builder, recipe.presetId);
  const w = recipe.physics?.strandWidthScale ?? 1;
  hair.snapToHead(headPivot, w);
  return buildPresetGeometry(hair, w, recipe.presetId, recipe.customName ?? recipe.presetId);
}
