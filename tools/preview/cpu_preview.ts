// Headless CPU preview of a web hairstyle: front, 3/4, left profile, back and top views in one PNG,
// plus the web quality audit (scalp coverage, floating roots, penetration, inter-lock clipping).
// No browser or GPU needed: builds the hair through the live HairPhysicsSystem (same path as web_export.ts),
// rebuilds the bust proxy from bustModel.ts dimensions and rasterises everything with a small z-buffer renderer.
// The inner scalp is drawn MAGENTA on purpose so any bare-scalp gap is obvious (the web tints it to the root colour).
// This is a review aid, not the web shader: colours, sheen and AO are approximations.
//
// Usage (repo root):
//   npx tsx tools/preview/cpu_preview.ts --arch curtain-part [--seed 7001] [--out preview.png]
//   npx tsx tools/preview/cpu_preview.ts --recipe recipe.json [--out preview.png]
//   Close-up: add --views back,3q --zoom 2.5 --cy 0.42  (views: front,3q,left,back,top; cy = centre height in metres)
//   Character head: add --head path/to/Head.obj [--chin-y 1.5855]  (fitted like the Unity plugin; replaces the web bust head,
//   ears and neck; no scalp core, so gaps show skin as they do in Unity)
//   Scalp paint (the painted short-hair layer, scalpPaint.ts) is drawn on the head. --no-paint hides it; --magenta paints the
//   bust's haired region magenta instead (old gap check).
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { HairPhysicsSystem } from '../../src/engine/hairPhysics';
import { generateRandomHairstyle, scalpRegionPhi } from '../../src/engine/hairBuilder';
import { loadCharacterHead } from '../../src/engine/characterHead';
import { evalScalpPaint, paintStreak, scalpAngles, scalpPaintAlpha, scalpPaintColor, type ScalpPaint } from '../../src/engine/scalpPaint';

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};

let recipe: any;
if (arg('--recipe')) {
  recipe = JSON.parse(fs.readFileSync(arg('--recipe')!, 'utf8'));
} else {
  const r: any = generateRandomHairstyle(Number(arg('--seed', '7001')), arg('--arch') as any);
  recipe = { presetId: r.basePreset, customName: r.name, builder: r.builder, shader: r.shader, physics: r.physics };
}
const outPath = arg('--out', 'preview.png')!;

// ---------- hair, exactly as the viewport loads it ----------
const hair: any = new HairPhysicsSystem(new THREE.ShaderMaterial(), recipe.presetId);
const rootGroup = new THREE.Group();
const headPivot = new THREE.Group();
headPivot.position.set(0, 0.44, 0);
rootGroup.add(headPivot);
rootGroup.updateMatrixWorld(true);
hair.loadCustomBuilder(recipe.builder, recipe.presetId);
// --head: fit the hair to that skull as the plugin does (characterHead.ts conform map); --no-conform shows it unfitted
const headArg = arg('--head');
if (headArg && !args.includes('--no-conform')) {
  hair.conformToHead(loadCharacterHead(fs.readFileSync(headArg, 'utf8'), headArg, arg('--chin-y') ? Number(arg('--chin-y')) : undefined).conform);
}
const wScale = recipe.physics?.strandWidthScale ?? 1;
hair.snapToHead(headPivot, wScale);
const audit = hair.auditQuality(headPivot, 'rest');
const geo: THREE.BufferGeometry = hair.geometry;

// ---------- bust proxy (dimensions copied from src/engine/bustModel.ts) ----------
type Mesh = { geo: THREE.BufferGeometry; color: THREE.Color; flat?: boolean; scalpMask?: boolean; paint?: boolean };
const meshes: Mesh[] = [];
const add = (g: THREE.BufferGeometry, m: THREE.Matrix4, hex: string, flat = false, scalpMask = false, paint = false) => {
  const gg = g.toNonIndexed();
  gg.applyMatrix4(m);
  gg.computeVertexNormals();
  meshes.push({ geo: gg, color: new THREE.Color(hex), flat, scalpMask, paint });
};
// The head lathe pokes through the scalp dome at the crown, so its haired region is painted magenta too:
// hairline phi (from the crown apex, head-pivot space) by azimuth, front 1.28 -> above the ear 1.62 -> nape 2.1.
const MAGENTA = new THREE.Color('#ff00ff');
const WHITE = new THREE.Color(1, 1, 1);
const isScalpRegion = (x: number, y: number, z: number) => {
  const lx = x, ly = y - 0.44 - 0.425, lz = z + 0.01;
  const phi = Math.acos(Math.max(-1, Math.min(1, (ly / 0.318) / Math.hypot(lx / 0.282, ly / 0.318, lz / 0.31))));
  return phi < scalpRegionPhi(Math.atan2(lx, lz));
};
const M = (pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scl: [number, number, number] = [1, 1, 1], parent?: THREE.Matrix4) => {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scl));
  return parent ? parent.clone().multiply(m) : m;
};
const P = M([0, 0.44, 0]);
const V2 = (a: number, b: number) => new THREE.Vector2(a, b);
const headPath = arg('--head');
let scalpCoreMesh: Mesh | null = null;
if (headPath) {
  const ch = loadCharacterHead(fs.readFileSync(headPath, 'utf8'), headPath, arg('--chin-y') ? Number(arg('--chin-y')) : undefined);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(ch.positions, 3));
  add(g, P, '#b8b2ae', false, false, true);
  console.error('head fit', JSON.stringify({ scale: ch.fit.scale, offset: ch.fit.offset, chinY: ch.fit.chinY, landmarks: ch.landmarks }));
} else {
  const headGeo = new THREE.LatheGeometry([V2(0, 0), V2(0.052, 0.012), V2(0.122, 0.055), V2(0.192, 0.135), V2(0.244, 0.245), V2(0.272, 0.365), V2(0.28, 0.48), V2(0.264, 0.585), V2(0.208, 0.672), V2(0.115, 0.725), V2(0, 0.742)], 48);
  headGeo.scale(0.97, 1.0, 1.09);
  add(headGeo, P, '#9c8678', false, true, true);
  const scalp = new THREE.SphereGeometry(0.286, 48, 32);
  scalp.scale(0.96, 1.08, 1.07);
  // The scalp core pokes slightly out of the face lathe beside the temples. The web tints it to the root colour x0.55,
  // so only the part inside the haired region is painted magenta; outside it is drawn as the web shows it.
  add(scalp, M([0, 0.425, -0.015], [0, 0, 0], [1, 1, 1], P), '#000000', true, true, true);
  scalpCoreMesh = meshes[meshes.length - 1];
  for (const side of [-1, 1]) {
    const earM = M([side * 0.256, 0.242, -0.028], [0, side * -0.26, side * -0.1], [1, 1, 1], P);
    const outer = new THREE.SphereGeometry(0.062, 18, 14);
    outer.scale(0.28, 1.15, 0.68);
    add(outer, earM, '#b49482');
    const helix = new THREE.TorusGeometry(0.04, 0.01, 10, 20, Math.PI * 1.48);
    add(helix, M([side * 0.008, 0.004, -0.004], [0, side * Math.PI * 0.44, side * -0.42], [1, 1, 1], earM), '#b49482');
  }
  const neck = new THREE.LatheGeometry([V2(0.145, -0.22), V2(0.118, -0.12), V2(0.112, -0.02), V2(0.122, 0.08)], 28);
  neck.scale(0.96, 1.0, 1.04);
  add(neck, M([0, 0.01, -0.032], [0, 0, 0], [1, 1, 1], P), '#9c8678');
}
const torso = new THREE.LatheGeometry([V2(0, 0), V2(0.24, 0), V2(0.36, 0.14), V2(0.41, 0.24), V2(0.34, 0.305), V2(0.175, 0.355), V2(0.145, 0.39), V2(0.132, 0.39), V2(0.12, 0.32)], 40);
torso.scale(1.12, 1.0, 0.56);
add(torso, M([0, -0.04, -0.032]), '#454955');

// ---------- rasteriser ----------
const sh = recipe.shader ?? {};
const cRoot = new THREE.Color(sh.rootColor ?? '#2a1e18');
const cBase = new THREE.Color(sh.baseColor ?? '#5a4030');
const cTip = new THREE.Color(sh.tipColor ?? '#7a5a40');
const cSpec = new THREE.Color(sh.primarySpecColor ?? '#ffe8d0');
const cSpec2 = new THREE.Color(sh.secondarySpecColor ?? '#a07050');
[cRoot, cBase, cTip, cSpec, cSpec2].forEach((c) => c.convertSRGBToLinear());
if (scalpCoreMesh) scalpCoreMesh.color.copy(cRoot).multiplyScalar(0.55);
const usePaint = !args.includes('--no-paint') && !args.includes('--magenta') && !!hair.scalpPaint;
const useMagenta = args.includes('--magenta');
const paint: ScalpPaint | null = usePaint ? hair.scalpPaint : null;
// painted short hair: the paint's colour override, else the hair's own colour (same rule as the web app and Unity)
const cPaint = scalpPaintColor(hair.scalpPaint, sh.rootColor ?? '#2a1e18', sh.baseColor ?? '#5a4030', sh.tipColor ?? '#7a5a40').convertSRGBToLinear();
const grainAt = (az: number, phi: number) => {
  const a = Math.floor(az / 0.011), b = Math.floor(phi / 0.011);
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
};
/** paint alpha at a head-pivot-local point */
const paintAlpha = (x: number, y: number, z: number) => {
  if (!paint) return 0;
  const a = scalpAngles(x, y, z);
  const dens = evalScalpPaint(paint, a.az, a.phi);
  return scalpPaintAlpha(dens, paint.grain, grainAt(a.az, a.phi));
};

const W = 440, H = 480;
const views: { name: string; d: THREE.Vector3; up: THREE.Vector3; c: THREE.Vector3; ext: number }[] = [];
for (const [name, yaw] of [['front', 0], ['3q', Math.PI / 4], ['left', -Math.PI / 2], ['back', Math.PI]] as const) {
  views.push({ name, d: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), up: new THREE.Vector3(0, 1, 0), c: new THREE.Vector3(0, 0.66, 0), ext: 0.78 });
}
views.push({ name: 'top', d: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1), c: new THREE.Vector3(0, 0.0, -0.01), ext: 0.5 });
// --views front,back  picks views; --zoom 2 --cy 0.5 frames a close-up (centre height in world metres) for checking tips and partings
{
  const pickViews = arg('--views');
  const zoom = Number(arg('--zoom', '1'));
  const cy = arg('--cy');
  const keep = pickViews ? views.filter((v) => pickViews.split(',').includes(v.name)) : views.slice();
  views.length = 0;
  for (const v of keep) {
    v.ext /= zoom;
    if (cy !== undefined && v.name !== 'top') v.c.y = Number(cy);
    views.push(v);
  }
}

const sheet = new Uint8Array(W * views.length * H * 3);
const bg = [32, 35, 43];

function renderView(vi: number) {
  const v = views[vi];
  const d = v.d.clone().normalize();
  const up = v.up.clone();
  const r = new THREE.Vector3().crossVectors(up, d).normalize();
  const u = new THREE.Vector3().crossVectors(d, r).normalize();
  const scale = (H * 0.5) / v.ext;
  const key = r.clone().multiplyScalar(-0.45).addScaledVector(u, 0.62).addScaledVector(d, 0.64).normalize();
  const fill = r.clone().multiplyScalar(0.7).addScaledVector(u, -0.1).addScaledVector(d, 0.7).normalize();
  const zbuf = new Float32Array(W * H).fill(-1e9);
  const col = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) { col[i * 3] = bg[0] / 255; col[i * 3 + 1] = bg[1] / 255; col[i * 3 + 2] = bg[2] / 255; }
  const proj = (x: number, y: number, z: number) => {
    const dx = x - v.c.x, dy = y - v.c.y, dz = z - v.c.z;
    return [W * 0.5 + (dx * r.x + dy * r.y + dz * r.z) * scale, H * 0.5 - (dx * u.x + dy * u.y + dz * u.z) * scale, dx * d.x + dy * d.y + dz * d.z];
  };
  const tri = (p: number[][], c: number[][], wp?: number[][], skin?: number[]) => {
    const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    if (minX > maxX || minY > maxY) return;
    const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (Math.abs(area) < 1e-9) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((p[1][0] - px) * (p[2][1] - py) - (p[2][0] - px) * (p[1][1] - py)) / area;
        const w1 = ((p[2][0] - px) * (p[0][1] - py) - (p[0][0] - px) * (p[2][1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * p[0][2] + w1 * p[1][2] + w2 * p[2][2];
        const idx = y * W + x;
        if (z <= zbuf[idx]) continue;
        zbuf[idx] = z;
        if (wp && skin) {
          // c holds the lighting factor; blend skin and painted hair per pixel
          const k = w0 * c[0][0] + w1 * c[1][0] + w2 * c[2][0];
          const lx = w0 * wp[0][0] + w1 * wp[1][0] + w2 * wp[2][0], ly = w0 * wp[0][1] + w1 * wp[1][1] + w2 * wp[2][1] - 0.44, lz = w0 * wp[0][2] + w1 * wp[1][2] + w2 * wp[2][2];
          const al = paintAlpha(lx, ly, lz);
          let st = 1;
          if (al > 0) { const sa = scalpAngles(lx, ly, lz); st = 0.82 + 0.36 * paintStreak(sa.az, sa.phi); }
          col[idx * 3] = k * (skin[0] + (cPaint.r * st - skin[0]) * al);
          col[idx * 3 + 1] = k * (skin[1] + (cPaint.g * st - skin[1]) * al);
          col[idx * 3 + 2] = k * (skin[2] + (cPaint.b * st - skin[2]) * al);
          continue;
        }
        col[idx * 3] = w0 * c[0][0] + w1 * c[1][0] + w2 * c[2][0];
        col[idx * 3 + 1] = w0 * c[0][1] + w1 * c[1][1] + w2 * c[2][1];
        col[idx * 3 + 2] = w0 * c[0][2] + w1 * c[1][2] + w2 * c[2][2];
      }
    }
  };
  const N = new THREE.Vector3();
  const shadeBody = (nx: number, ny: number, nz: number, c: THREE.Color, flat: boolean) => {
    N.set(nx, ny, nz).normalize();
    if (N.dot(d) < 0) N.negate();
    if (flat) return [c.r * 0.85, c.g * 0.85, c.b * 0.85];
    const k = 0.3 + 0.62 * Math.max(0, N.dot(key)) + 0.18 * Math.max(0, N.dot(fill));
    return [c.r * k * 0.8, c.g * k * 0.8, c.b * k * 0.8];
  };
  for (const m of meshes) {
    const pos = m.geo.attributes.position.array as Float32Array;
    const nor = m.geo.attributes.normal.array as Float32Array;
    for (let i = 0; i < pos.length; i += 9) {
      const p: number[][] = [], c: number[][] = [];
      if (paint && m.paint) {
        const wp: number[][] = [];
        for (let j = 0; j < 3; j++) {
          const o = i + j * 3;
          p.push(proj(pos[o], pos[o + 1], pos[o + 2]));
          wp.push([pos[o], pos[o + 1], pos[o + 2]]);
          const k = shadeBody(nor[o], nor[o + 1], nor[o + 2], WHITE, !!m.flat)[0];
          c.push([k, k, k]);
        }
        tri(p, c, wp, [m.color.r, m.color.g, m.color.b]);
        continue;
      }
      for (let j = 0; j < 3; j++) {
        const o = i + j * 3;
        p.push(proj(pos[o], pos[o + 1], pos[o + 2]));
        const scalpHere = useMagenta && !!m.scalpMask && isScalpRegion(pos[o], pos[o + 1], pos[o + 2]);
        c.push(shadeBody(nor[o], nor[o + 1], nor[o + 2], scalpHere ? MAGENTA : m.color, !!m.flat || scalpHere));
      }
      tri(p, c);
    }
  }
  // hair: per-vertex Kajiya-style shading (root->base->tip gradient, layer AO, two sheen lobes, rim)
  const pos = geo.attributes.position.array as Float32Array;
  const nor = geo.attributes.normal.array as Float32Array;
  const tan = geo.attributes.aHairTangent.array as Float32Array;
  const uv = geo.attributes.uv.array as Float32Array;
  const ao = geo.attributes.aLayerAO.array as Float32Array;
  const card = geo.attributes.aCardMask.array as Float32Array;
  const index = geo.index!.array as Uint32Array;
  const nV = pos.length / 3;
  const vp: number[][] = new Array(nV);
  const vc: number[][] = new Array(nV);
  const T = new THREE.Vector3(), Hh = new THREE.Vector3().addVectors(key, d).normalize();
  for (let i = 0; i < nV; i++) {
    vp[i] = proj(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    N.set(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]).normalize();
    const facing = N.dot(d);
    if (facing < 0) N.negate();
    T.set(tan[i * 3], tan[i * 3 + 1], tan[i * 3 + 2]).normalize();
    const t = uv[i * 2 + 1];
    const a = t < 0.3 ? t / 0.3 : 1;
    const b = t > 0.55 ? (t - 0.55) / 0.45 : 0;
    const base = cRoot.clone().lerp(cBase, a).lerp(cTip, b * 0.8);
    const isShell = card[i] === 0;
    const aoK = (isShell ? 0.55 : 0.62 + 0.38 * ao[i]) * (0.72 + 0.28 * a);
    const diff = 0.34 + 0.58 * Math.max(0, (N.dot(key) + 0.25) / 1.25) + 0.16 * Math.max(0, N.dot(fill));
    const th = T.dot(Hh);
    const sinTH = Math.sqrt(Math.max(0, 1 - th * th));
    const spec1 = Math.pow(sinTH, 90) * 0.55 * Math.max(0, N.dot(key) + 0.2);
    const th2 = T.dot(Hh) + 0.25;
    const spec2 = Math.pow(Math.sqrt(Math.max(0, 1 - th2 * th2)), 30) * 0.18;
    const rim = Math.pow(1 - Math.abs(facing), 3) * 0.12;
    vc[i] = [0, 1, 2].map((k) => {
      const bc = [base.r, base.g, base.b][k];
      const s1 = [cSpec.r, cSpec.g, cSpec.b][k];
      const s2 = [cSpec2.r, cSpec2.g, cSpec2.b][k];
      return bc * diff * aoK + s1 * spec1 * aoK + s2 * spec2 * aoK + rim * bc * 2;
    });
  }
  for (let i = 0; i < index.length; i += 3) {
    tri([vp[index[i]], vp[index[i + 1]], vp[index[i + 2]]], [vc[index[i]], vc[index[i + 1]], vc[index[i + 2]]]);
  }
  // linear -> sRGB with a soft ACES-like shoulder
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = (y * W * views.length + vi * W + x) * 3;
      for (let k = 0; k < 3; k++) {
        let c = col[i * 3 + k];
        if (zbuf[i] > -1e8) {
          c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
          c = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
          sheet[o + k] = Math.max(0, Math.min(255, Math.round(c * 255)));
        } else {
          sheet[o + k] = bg[k];
        }
      }
    }
  }
}
views.forEach((_, i) => renderView(i));

// ---------- PNG ----------
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const SW = W * views.length;
const raw = Buffer.alloc((SW * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (SW * 3 + 1)] = 0;
  Buffer.from(sheet.buffer, y * SW * 3, SW * 3).copy(raw, y * (SW * 3 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SW, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
fs.writeFileSync(outPath, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))]));

const pick = (k: string) => (typeof audit[k] === 'number' ? Number(audit[k].toFixed(2)) : audit[k]);
console.log(JSON.stringify({
  name: recipe.customName, out: outPath,
  locks: hair.locks.length, triangles: (geo.index!.count / 3) | 0,
  scalpCoveragePct: pick('scalpCoveragePct'), floatingRootCount: pick('floatingRootCount'), penetratingNodes: pick('penetratingNodes'),
  crownHookCount: pick('crownHookCount'), interLockClipPct: pick('interLockClipPct'), score: pick('score'), verdict: audit.verdict,
}));
