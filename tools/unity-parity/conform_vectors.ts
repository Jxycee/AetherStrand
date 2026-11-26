// Vectors for the plugin's head conform port test (Runtime/AetherStrandHeadConform.cs). Run with cwd = AetherStrand clone:
//   npx tsx tools/unity-parity/conform_vectors.ts <recipe.json> <Head.obj> out/conform.json
// Builds the hybrid mass without a head, loads the character head as the web does (characterHead.ts), and writes the head
// points, the mass rest positions and the move conformPoint gives each one (no hairline cap: the mass stays above it).
import fs from 'node:fs';
import * as THREE from 'three';
import { HairPhysicsSystem } from '../../src/engine/hairPhysics';
import { conformPoint, loadCharacterHead, parseObj } from '../../src/engine/characterHead';

const [recipePath, headPath, outPath] = process.argv.slice(2);
const recipe: any = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
recipe.builder.hybrid = { ...(recipe.builder.hybrid ?? {}), mass: true, edgeCards: recipe.builder.hybrid?.edgeCards ?? 24 };
const sys: any = new HairPhysicsSystem(new THREE.ShaderMaterial(), recipe.presetId);
sys.loadCustomBuilder(recipe.builder, recipe.presetId);
const pos = sys.mass.geometry.getAttribute('position');
const head = loadCharacterHead(fs.readFileSync(headPath, 'utf8'), headPath);
const query: number[] = [], move: number[] = [];
const p = new THREE.Vector3(), q = new THREE.Vector3();
let moved = 0, outMax = 0, inMax = 0;
const HC = new THREE.Vector3(0, 0.425, -0.01);
for (let i = 0; i < pos.count; i++) {
  p.fromBufferAttribute(pos, i); q.copy(p);
  conformPoint(head.conform, q, () => 99, true);
  query.push(p.x, p.y, p.z); move.push(q.x - p.x, q.y - p.y, q.z - p.z);
  const d = q.clone().sub(p), len = d.length() * 1000;
  if (len > 0.2) moved++;
  if (d.dot(p.clone().sub(HC)) >= 0) outMax = Math.max(outMax, len); else inMax = Math.max(inMax, len);
}
// the map is built from the head's unique vertices in web space (loadCharacterHead's `web`), not its triangle corners
const obj = parseObj(fs.readFileSync(headPath, 'utf8')), points: number[] = [];
for (let i = 0; i < obj.positions.length; i += 3)
  points.push((obj.positions[i] - head.fit.offset.x) / head.fit.scale.x, (obj.positions[i + 1] - head.fit.offset.y) / head.fit.scale.y, (obj.positions[i + 2] - head.fit.offset.z) / head.fit.scale.z);
fs.writeFileSync(outPath, JSON.stringify({ points, query, move }));
console.log(`mass ${pos.count} vertices, ${moved} moved over 0.2 web-mm; largest push out ${outMax.toFixed(1)} web-mm, in ${inMax.toFixed(1)} web-mm`);
