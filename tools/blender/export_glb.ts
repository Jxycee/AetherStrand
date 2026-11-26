// Headless: writes a hair recipe's exact web meshes to a .glb for Blender (issue #9, plan row 2b "minimal Blender bridge").
//   npx tsx tools/blender/export_glb.ts <recipe.json> <out.glb> [--mass] [--edge-cards N]
// The meshes are the ones the web viewport draws (HairPhysicsSystem after loadCustomBuilder + snapToHead, rest pose), so
// Blender gets the real geometry instead of a Python rebuild of it. Objects, split by the per-lock card mask:
//   Hair_Mass (hybrid inner mass), Hair_Locks (mask 1), Hair_StrandCards (0.5-0.9: fine strands, edge cards),
//   Hair_FadeCaps (0.15-0.45), Hair_BaseShell (0).
// COLOR_0 uses the Unity plugin's vertex colour layout (AetherStrandWebMesh): r = seed fraction, g = layer AO,
// b = seed high byte / 255, a = card mask; linear. Web space, metres, Y up (Blender's glTF importer turns it Z up).
// Custom attributes ride along as _AHEADNORMAL, _AHAIRTANGENT, _ASCALPROOT, _AGRADT.
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { HairPhysicsSystem } from '../../src/engine/hairPhysics';

// GLTFExporter reads its binary output through FileReader, which Node lacks.
if (!(globalThis as any).FileReader) {
  (globalThis as any).FileReader = class {
    result: any = null;
    onload: any = null;
    onloadend: any = null;
    readAsArrayBuffer(b: Blob) { b.arrayBuffer().then((r) => { this.result = r; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }); }
    readAsDataURL(b: Blob) {
      b.arrayBuffer().then((r) => {
        this.result = `data:${b.type || 'application/octet-stream'};base64,${Buffer.from(r).toString('base64')}`;
        this.onload?.({ target: this }); this.onloadend?.({ target: this });
      });
    }
  };
}

const argv = process.argv.slice(2);
const at = (f: string) => argv.indexOf(f);
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--edge-cards');
const [recipePath, outPath = 'hair.glb'] = positional;
const recipe: any = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
if (at('--mass') >= 0) recipe.builder.hybrid = { ...(recipe.builder.hybrid ?? {}), mass: true };
if (at('--edge-cards') >= 0) recipe.builder.hybrid = { ...(recipe.builder.hybrid ?? {}), edgeCards: Number(argv[at('--edge-cards') + 1]) };

const hair: any = new HairPhysicsSystem(new THREE.ShaderMaterial(), recipe.presetId);
const root = new THREE.Group();
const headPivot = new THREE.Group();
headPivot.position.set(0, 0.44, 0);
root.add(headPivot);
hair.loadCustomBuilder(recipe.builder, recipe.presetId);
hair.snapToHead(headPivot, recipe.physics?.strandWidthScale ?? 1);

const KEEP: [string, string, number][] = [
  ['position', 'position', 3], ['normal', 'normal', 3], ['uv', 'uv', 2],
  ['aHeadNormal', 'aHeadNormal', 3], ['aHairTangent', 'aHairTangent', 3], ['aScalpRoot', 'aScalpRoot', 1], ['aGradT', 'aGradT', 1],
];

/** A sub-mesh of g holding the triangles whose first vertex passes keep(mask), with the Unity vertex colour layout. */
function subMesh(g: THREE.BufferGeometry, keep: (mask: number) => boolean, fixedMask?: number): THREE.BufferGeometry | null {
  const idx = g.index!.array as ArrayLike<number>;
  const maskA = g.attributes.aCardMask?.array as ArrayLike<number> | undefined;
  const maskOf = (v: number) => fixedMask ?? (maskA ? maskA[v] : 1);
  const remap = new Int32Array(g.attributes.position.count).fill(-1);
  const verts: number[] = [], tris: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    if (!keep(maskOf(idx[t]))) continue;
    for (let c = 0; c < 3; c++) {
      const v = idx[t + c];
      if (remap[v] < 0) { remap[v] = verts.length; verts.push(v); }
      tris.push(remap[v]);
    }
  }
  if (!tris.length) return null;
  const out = new THREE.BufferGeometry();
  for (const [src, dst, n] of KEEP) {
    const a = g.attributes[src];
    if (!a) continue;
    const arr = new Float32Array(verts.length * n);
    verts.forEach((v, i) => { for (let k = 0; k < n; k++) arr[i * n + k] = (a.array as ArrayLike<number>)[v * n + k]; });
    out.setAttribute(dst, new THREE.BufferAttribute(arr, n));
  }
  const seed = g.attributes.aStrandSeed?.array as ArrayLike<number> | undefined, ao = g.attributes.aLayerAO?.array as ArrayLike<number> | undefined;
  const col = new Float32Array(verts.length * 4);
  verts.forEach((v, i) => {
    const sd = Math.min(1, Math.max(0, seed ? seed[v] : 0)) * 255, sh = Math.floor(sd);
    col[i * 4] = sd - sh; col[i * 4 + 1] = ao ? ao[v] : 1; col[i * 4 + 2] = sh / 255; col[i * 4 + 3] = maskOf(v);
  });
  out.setAttribute('color', new THREE.BufferAttribute(col, 4));
  out.setIndex(tris);
  return out;
}

const scene = new THREE.Scene();
scene.name = recipe.customName ?? recipe.presetId;
const counts: Record<string, { vertices: number; triangles: number }> = {};
const add = (name: string, g: THREE.BufferGeometry | null) => {
  if (!g) return;
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: `AS_${name}`, vertexColors: true, side: THREE.DoubleSide }));
  m.name = name;
  scene.add(m);
  counts[name] = { vertices: g.attributes.position.count, triangles: g.index!.count / 3 };
};
const lg: THREE.BufferGeometry = hair.geometry;
add('Hair_Locks', subMesh(lg, (k) => k > 0.9));
add('Hair_StrandCards', subMesh(lg, (k) => k >= 0.5 && k <= 0.9));
add('Hair_FadeCaps', subMesh(lg, (k) => k > 0 && k < 0.5));
add('Hair_BaseShell', subMesh(lg, (k) => k === 0));
if (hair.mass) add('Hair_Mass', subMesh(hair.mass.geometry, () => true));

const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
fs.writeFileSync(outPath, Buffer.from(glb as ArrayBuffer));
console.log(JSON.stringify({ out: outPath, name: scene.name, meshes: counts }));
