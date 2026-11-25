// Reference outline score for cpu_preview.ts (--ref): lines a reference image up with each preview view and measures how
// far the hair's outline is from the reference's.
//
// Why: styles were tuned by eye from a rough render, one number at a time. This gives each view a measurable target: the
// reference's hair mask, scaled and placed by matching landmarks (chin, ear top, ear lobe) on the reference and on the
// character head, then compared with the rendered hair mask. Humans and AI read the same numbers and the same overlay.
//
// Reference sidecar (JSON, given with --ref or found next to the image as <image>.json):
//   { "image": "undercut-fade_views.png",           // relative to the JSON file
//     "views": { "front": { "crop": [x, y, w, h],     // the panel for this view, in image pixels
//                           "landmarks": { "chin": [x, y], "earTopL": [x, y], "earTopR": [x, y] },  // crop pixels
//                           "mirror": false,          // flip the panel left-right first (a profile facing the other way)
//                           "hairLumMax": 95,         // optional: pixels darker than this (0-255) can be hair
//                           "hairRowsBelowLobe": 0.3  // optional: hair may reach this far below the ear lobe (x ear height)
//                         }, "3q": {...}, "left": {...}, "back": {...} } }
// Landmark names: chin; earTop / earLobe (the ear nearest the camera); earTopL / earTopR / earLobeL / earLobeR (the ear on
// the image's left / right). At least two per view.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as THREE from 'three';

export interface RefView {
  crop: [number, number, number, number];
  landmarks: Record<string, [number, number]>;
  mirror?: boolean;
  hairLumMax?: number;
  hairRowsBelowLobe?: number;
  /** Fit this view's own scale instead of the shared head size (see cpu_preview.ts). */
  ownScale?: boolean;
}
export interface RefSheet { image: string; views: Record<string, RefView> }
export interface Img { w: number; h: number; rgb: Uint8Array }
export interface OutlineResult { iou: number; over: number; under: number; scale: number }

/** Minimal PNG decoder (8-bit greyscale, RGB, RGBA, grey+alpha; non-interlaced): enough for reference sheets. */
export function decodePng(buf: Buffer): Img {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let o = 8, w = 0, h = 0, depth = 0, ct = 0, inter = 0;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ct = d[9]; inter = d[12]; }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8 || inter !== 0 || ![0, 2, 4, 6].includes(ct)) throw new Error(`unsupported PNG (depth ${depth}, colour type ${ct}, interlace ${inter})`);
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct as 0 | 2 | 4 | 6];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp, px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y > 0 ? px[dst - stride + x] : 0, c = x >= bpp && y > 0 ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    if (ct === 0 || ct === 4) { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = px[i * bpp]; }
    else { rgb[i * 3] = px[i * bpp]; rgb[i * 3 + 1] = px[i * bpp + 1]; rgb[i * 3 + 2] = px[i * bpp + 2]; }
  }
  return { w, h, rgb };
}

/** Loads a reference sidecar: path to the JSON, or to the image with <image>.json beside it. */
export function loadRefSheet(p: string): { sheet: RefSheet; img: Img } {
  const jsonPath = p.endsWith('.json') ? p : p.replace(/\.png$/i, '.json');
  const sheet: RefSheet = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const img = decodePng(fs.readFileSync(path.resolve(path.dirname(jsonPath), sheet.image)));
  return { sheet, img };
}

/**
 * Hair mask of one reference panel (crop pixels, after `mirror`): dark pixels above a row a little below the ear lobe,
 * kept only where they join the largest dark region (the hair), so eyes, brows and the shirt drop out.
 */
export function refHairMask(img: Img, v: RefView): { w: number; h: number; mask: Uint8Array } {
  const [cx, cy, w, h] = v.crop;
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(img.w - 1, Math.max(0, cx + (v.mirror ? w - 1 - x : x))), sy = Math.min(img.h - 1, Math.max(0, cy + y));
    const i = (sy * img.w + sx) * 3;
    lum[y * w + x] = 0.299 * img.rgb[i] + 0.587 * img.rgb[i + 1] + 0.114 * img.rgb[i + 2];
  }
  const lm = v.landmarks;
  const ys = (k: string) => Object.entries(lm).filter(([n]) => n.startsWith(k)).map(([, p]) => p[1]);
  const tops = ys('earTop'), lobes = ys('earLobe');
  const earH = tops.length && lobes.length ? Math.max(...lobes) - Math.min(...tops) : h * 0.1;
  const lowRow = lobes.length ? Math.max(...lobes) + (v.hairRowsBelowLobe ?? 0.3) * earH : lm.chin ? lm.chin[1] - 0.6 * earH : h * 0.6;
  const thr = v.hairLumMax ?? 95;
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < Math.min(h, lowRow); y++) for (let x = 0; x < w; x++) if (lum[y * w + x] < thr) dark[y * w + x] = 1;
  // largest 4-connected dark region
  const lab = new Int32Array(w * h).fill(-1);
  let best = -1, bestN = 0, n = 0;
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!dark[s] || lab[s] >= 0) continue;
    let cnt = 0; stack.push(s); lab[s] = n;
    while (stack.length) {
      const q = stack.pop()!; cnt++;
      const qx = q % w, qy = (q / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (dark[k] && lab[k] < 0) { lab[k] = n; stack.push(k); }
      }
    }
    if (cnt > bestN) { bestN = cnt; best = n; }
    n++;
  }
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = lab[i] === best ? 1 : 0;
  // close small holes (highlights inside the hair): a pixel with dark neighbours on both sides in a row or column
  const out = mask.slice();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (mask[i]) continue;
    const span = (dx: number, dy: number) => { for (let k = 1; k <= 4; k++) { const xx = x + dx * k, yy = y + dy * k; if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false; if (mask[yy * w + xx]) return true; } return false; };
    if ((span(1, 0) && span(-1, 0)) || (span(0, 1) && span(0, -1))) out[i] = 1;
  }
  return { w, h, mask: out };
}

/** Least-squares scale + translation (no rotation) taking reference points p to render points q: q = s p + t. */
export function fitSimilarity(p: [number, number][], q: [number, number][]): { s: number; tx: number; ty: number } {
  const n = p.length;
  const pm = [0, 0], qm = [0, 0];
  for (let i = 0; i < n; i++) { pm[0] += p[i][0] / n; pm[1] += p[i][1] / n; qm[0] += q[i][0] / n; qm[1] += q[i][1] / n; }
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const ax = p[i][0] - pm[0], ay = p[i][1] - pm[1];
    num += ax * (q[i][0] - qm[0]) + ay * (q[i][1] - qm[1]);
    den += ax * ax + ay * ay;
  }
  const s = den > 1e-9 ? num / den : 1;
  return { s, tx: qm[0] - s * pm[0], ty: qm[1] - s * pm[1] };
}

/** Landmarks of a character head in web head-pivot-local space (chin front, both ears' top and lobe). */
export function headLandmarkPoints(tri: Float32Array, lm: { earFrontTheta: number; earBackTheta: number; earTopPhi: number; earLobePhi: number }): Record<string, THREE.Vector3> {
  const HC = new THREE.Vector3(0, 0.425, -0.01), RX = 0.282, RY = 0.318, RZ = 0.31;
  let chin: THREE.Vector3 | null = null;
  const ears: Record<string, { top: THREE.Vector3 | null; lobe: THREE.Vector3 | null; tp: number; lp: number }> = { '1': { top: null, lobe: null, tp: 9, lp: -9 }, '-1': { top: null, lobe: null, tp: 9, lp: -9 } };
  const cand: { p: THREE.Vector3; phi: number; r: number; side: string }[] = [];
  for (let i = 0; i < tri.length; i += 3) {
    const x = tri[i], y = tri[i + 1], z = tri[i + 2];
    if (y >= 0 && y < 0.05 && Math.abs(x) < 0.05 && (!chin || z > chin.z)) chin = new THREE.Vector3(x, y, z);
    const dx = (x - HC.x) / RX, dy = (y - HC.y) / RY, dz = (z - HC.z) / RZ, r = Math.hypot(dx, dy, dz);
    const th = Math.abs(Math.atan2(dx, dz)), phi = Math.acos(Math.max(-1, Math.min(1, dy / r)));
    if (th > lm.earFrontTheta - 0.03 && th < lm.earBackTheta + 0.03 && phi > lm.earTopPhi - 0.06 && phi < lm.earLobePhi + 0.06) cand.push({ p: new THREE.Vector3(x, y, z), phi, r, side: x >= 0 ? '1' : '-1' });
  }
  for (const side of ['1', '-1']) {
    const c = cand.filter((k) => k.side === side);
    if (!c.length) continue;
    const rMax = Math.max(...c.map((k) => k.r));
    for (const k of c) {
      if (k.r < rMax - 0.07) continue; // the ear stands out from the skull
      const e = ears[side];
      if (k.phi < e.tp) { e.tp = k.phi; e.top = k.p; }
      if (k.phi > e.lp) { e.lp = k.phi; e.lobe = k.p; }
    }
  }
  const out: Record<string, THREE.Vector3> = {};
  if (chin) out.chin = chin;
  for (const side of ['1', '-1']) {
    if (ears[side].top) out['earTop' + side] = ears[side].top!;
    if (ears[side].lobe) out['earLobe' + side] = ears[side].lobe!;
  }
  return out;
}

/**
 * Projected positions of a view's reference landmark names on the head: earTop/earLobe = the ear nearer the camera,
 * ...L/...R = the ear on the image's left/right. proj returns [x, y, depth toward the camera].
 */
export function resolveLandmarks(names: string[], pts: Record<string, THREE.Vector3>, proj: (p: THREE.Vector3) => number[]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const n of names) {
    if (n === 'chin') { if (pts.chin) { const q = proj(pts.chin); out[n] = [q[0], q[1]]; } continue; }
    const kind = n.startsWith('earTop') ? 'earTop' : n.startsWith('earLobe') ? 'earLobe' : null;
    if (!kind) continue;
    const a = pts[kind + '1'], b = pts[kind + '-1'];
    if (!a || !b) continue;
    const qa = proj(a), qb = proj(b);
    const suf = n.slice(kind.length);
    const pick = suf === 'L' ? (qa[0] < qb[0] ? qa : qb) : suf === 'R' ? (qa[0] > qb[0] ? qa : qb) : (qa[2] > qb[2] ? qa : qb);
    out[n] = [pick[0], pick[1]];
  }
  return out;
}

/**
 * Compares a rendered hair mask (W x H, 1 = hair) with a reference panel's mask placed by the landmark fit.
 * Returns IoU, `over` (hair the render has and the reference doesn't, as a share of the reference's hair) and `under`
 * (reference hair the render misses, same share), plus the warped reference mask for the overlay.
 */
export function compareMasks(render: Uint8Array, W: number, H: number, ref: { w: number; h: number; mask: Uint8Array }, fit: { s: number; tx: number; ty: number }): OutlineResult & { warped: Uint8Array } {
  const warped = new Uint8Array(W * H);
  let both = 0, rOnly = 0, fOnly = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = (x + 0.5 - fit.tx) / fit.s, py = (y + 0.5 - fit.ty) / fit.s;
    const ix = Math.floor(px), iy = Math.floor(py);
    const f = ix >= 0 && iy >= 0 && ix < ref.w && iy < ref.h ? ref.mask[iy * ref.w + ix] : 0;
    warped[y * W + x] = f;
    const r = render[y * W + x];
    if (r && f) both++; else if (r) rOnly++; else if (f) fOnly++;
  }
  const refN = both + fOnly;
  return { iou: both / Math.max(1, both + rOnly + fOnly), over: rOnly / Math.max(1, refN), under: fOnly / Math.max(1, refN), scale: fit.s, warped };
}
