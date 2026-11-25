// Round trip of the hybrid mass through PresetGeometry.json (hybrid plan phase 2). Run with cwd = AetherStrand clone:
//   npx tsx tools/unity-parity/mass_roundtrip.ts <recipe.json> [--vectors out.json]
// Builds the hair with the mass, exports it (web_geometry.ts), rebuilds a mass from the exported block alone, then moves
// the lock nodes through a set test motion and checks that the exported mass deforms to the same positions as the live
// one. --vectors writes the node motion and the expected positions, for the plugin's C# port test (mass_test/).
import fs from 'node:fs';
import * as THREE from 'three';
import { exportGeometry } from './web_geometry';
import { deformHairMass } from '../../src/engine/hairMass';
import { HairPhysicsSystem } from '../../src/engine/hairPhysics';

const argv = process.argv.slice(2);
const recipe: any = JSON.parse(fs.readFileSync(argv[0], 'utf8'));
recipe.builder.hybrid = { ...(recipe.builder.hybrid ?? {}), mass: true, edgeCards: recipe.builder.hybrid?.edgeCards ?? 24 };
const vecOut = argv.includes('--vectors') ? argv[argv.indexOf('--vectors') + 1] : null;

// live mass: the same build the exporter does
const live: any = new HairPhysicsSystem(new THREE.ShaderMaterial(), recipe.presetId);
live.loadCustomBuilder(recipe.builder, recipe.presetId);
const geo = JSON.parse(JSON.stringify(exportGeometry(recipe)));
const b = geo.hybridMass;
if (!b) throw new Error('no hybridMass block');

const web3 = (a: number[]) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i += 3) { o[i] = a[i]; o[i + 1] = a[i + 2]; o[i + 2] = -a[i + 1]; } return o; };
const V = b.vertexCount;
// rest nodes from the exported lock points, as the plugin's solver holds them
const restNodes = new Float32Array(geo.locks.length * b.nodesPerLock * 3);
geo.locks.forEach((l: any, s: number) => l.points.forEach((p: number[], k: number) => { const o = (s * b.nodesPerLock + k) * 3; restNodes[o] = p[0]; restNodes[o + 1] = p[2]; restNodes[o + 2] = -p[1]; }));
const index = new THREE.BufferAttribute(new Uint32Array(b.indices), 1);
const g = new THREE.BufferGeometry();
const positions = new Float32Array(V * 3), normals = new Float32Array(V * 3), headNormals = new Float32Array(V * 3), tangents = new Float32Array(V * 3);
g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
g.setAttribute('aHeadNormal', new THREE.BufferAttribute(headNormals, 3));
g.setAttribute('aHairTangent', new THREE.BufferAttribute(tangents, 3));
g.setIndex(index);
const restHN = web3(b.restHeadNormal);
headNormals.set(restHN);
const fromBlock: any = {
  vertexCount: V, rest: web3(b.rest), geometry: g, positions, normals, headNormals, tangents,
  restHeadNormals: restHN, restTangents: web3(b.restTangent),
  bindNode: Int32Array.from(b.bindNode), bindW: Float32Array.from(b.bindW), restHeight: Float32Array.from(b.restHeight),
  followShare: b.followShare, followSmooth: b.followSmooth,
  adjStart: Int32Array.from(b.adjStart), adjIdx: Int32Array.from(b.adjIdx), offA: new Float32Array(V * 3), offB: new Float32Array(V * 3),
  vBlock: Int32Array.from(b.vBlock), vInterpB: Int32Array.from(b.vInterpB), vInterpW: Float32Array.from(b.vInterpW), blockCount: b.blockCount,
  bAdjStart: Int32Array.from(b.bAdjStart), bAdjIdx: Int32Array.from(b.bAdjIdx),
  bA: new Float32Array(b.blockCount * 3), bB: new Float32Array(b.blockCount * 3), bN: new Float32Array(b.blockCount),
  bindCount: b.bindCount, nodesPerLock: b.nodesPerLock, restNodes,
};

// test motion: every node swings sideways and back by an amount growing toward the tip (like a head turn), plus a
// per-lock wobble, so neighbouring locks move apart and the block smoothing and the limit both do work
const motion = (rest: Float32Array) => {
  const n = new Float32Array(rest.length);
  for (let i = 0; i < rest.length / 3; i++) {
    const k = i % b.nodesPerLock, s = Math.floor(i / b.nodesPerLock), f = (k / (b.nodesPerLock - 1)) ** 1.3;
    n[i * 3] = rest[i * 3] + f * (0.03 + 0.012 * Math.sin(s * 1.7));
    n[i * 3 + 1] = rest[i * 3 + 1] + f * 0.008 * Math.cos(s * 0.9);
    n[i * 3 + 2] = rest[i * 3 + 2] - f * 0.015;
  }
  return n;
};
const m = live.mass;
const nodesLive = motion(m.restNodes), nodesBlock = motion(restNodes);
const hq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.4, -0.06)), hp = new THREE.Vector3(0.01, 0.44, 0);
deformHairMass(m, nodesLive, hq, hp);
deformHairMass(fromBlock, nodesBlock, hq, hp);
let maxErr = 0, maxNErr = 0, maxMove = 0;
for (let i = 0; i < V * 3; i++) maxErr = Math.max(maxErr, Math.abs(m.positions[i] - fromBlock.positions[i]));
for (let i = 0; i < V * 3; i++) maxNErr = Math.max(maxNErr, Math.abs(m.normals[i] - fromBlock.normals[i]));
for (let i = 0; i < V; i++) {
  // how far the vertices moved from rest (in the head frame), so the test shows the motion was not trivial
  const p = new THREE.Vector3(fromBlock.positions[i * 3], fromBlock.positions[i * 3 + 1], fromBlock.positions[i * 3 + 2]).sub(hp).applyQuaternion(hq.clone().invert());
  maxMove = Math.max(maxMove, p.distanceTo(new THREE.Vector3(fromBlock.rest[i * 3], fromBlock.rest[i * 3 + 1], fromBlock.rest[i * 3 + 2])));
}
const ok = maxErr < 2e-5 && maxNErr < 1e-3;
console.log(JSON.stringify({ vertices: V, maxPosErrMm: +(maxErr * 1000).toFixed(4), maxNormalErr: +maxNErr.toFixed(5), maxMoveMm: +(maxMove * 1000).toFixed(2), ok }));
if (vecOut) {
  fs.writeFileSync(vecOut, JSON.stringify({
    note: 'mass_roundtrip.ts test vectors: nodes (web head-pivot space, 3 per node, lock-major) and the expected world positions and normals for head pose (hp, hq)',
    hp: hp.toArray(), hq: hq.toArray(), nodes: Array.from(nodesBlock), positions: Array.from(fromBlock.positions), normals: Array.from(fromBlock.normals),
  }));
}
if (!ok) process.exit(1);
