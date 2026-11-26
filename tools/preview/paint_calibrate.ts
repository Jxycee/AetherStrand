// Tone a style's scalp paint to its own lit hair (hybrid plan 2c, Nov 26). Run with cwd = AetherStrand clone:
//   npx tsx tools/preview/paint_calibrate.ts <recipe.json> [--head Head.obj] [--target 1.0] [--write] [preview args...]
// The painted short hair is the same hair cut shorter: where it shows between lock tips it should read about as bright as
// the hair around it, as a game scalp texture is toned to the hair over it. The default paint colour (scalpPaint.ts
// PAINT_MIX x PAINT_SHEEN + PAINT_SPEC) is a fixed rule that came out at 1.06x the hair on the undercut but 2.5x on Messy
// Mage, whose hair renders much darker for similar colours (layered spiky clumps, lock undersides away from the key). No
// rule on the shader settings alone predicted both (sampling the shading model on the real locks still left them 0.66 vs
// 0.95), because the difference is in how the geometry renders. So this measures the render itself: left, 3/4 and back
// views with the preview renderer, the mean linear luminance of the paint that shows and of the hair, then scales the
// paint colour (hue kept) until paint / hair = target, and with --write stores it as the recipe's builder.scalpColor,
// which the web app, the preview and the Unity export all use as the paint colour.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { scalpPaintColor } from '../../src/engine/scalpPaint';
import { decodePng } from './outline';

const argv = process.argv.slice(2);
const recipePath = argv[0];
const take = (k: string) => { const i = argv.indexOf(k); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const target = Number(take('--target') ?? 1.0);
const write = argv.includes('--write'); if (write) argv.splice(argv.indexOf('--write'), 1);
const extra = argv.slice(1);
const recipe: any = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
const sh = recipe.shader ?? {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paintcal-'));

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
function render(rec: any, tag: string, flags: string[]) {
  const rp = path.join(dir, tag + '.json'), out = path.join(dir, tag + '.png');
  fs.writeFileSync(rp, JSON.stringify(rec));
  execFileSync('npx', ['tsx', 'tools/preview/cpu_preview.ts', '--recipe', rp, '--views', 'left,3q,back', '--aa', '2', ...extra, ...flags, '--out', out], { stdio: 'ignore' });
  return decodePng(fs.readFileSync(out));
}
function measure(rec: any) {
  const full = render(rec, 'full', []), nh = render(rec, 'nohair', ['--no-hair']), sk = render(rec, 'skin', ['--no-hair', '--no-paint']);
  let ps = 0, pn = 0, hs = 0, hn = 0;
  const F = full.rgb, NH = nh.rgb, SK = sk.rgb;
  for (let i = 0; i < F.length; i += 3) {
    const d = (a: Uint8Array, b: Uint8Array) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    const L = 0.2126 * lin(F[i] / 255) + 0.7152 * lin(F[i + 1] / 255) + 0.0722 * lin(F[i + 2] / 255);
    // hair: what the hair changes; visible paint: what the paint changes on the bare head and the hair leaves alone
    if (d(F, NH) > 40) { hs += L; hn++; } else if (d(NH, SK) > 40 && d(F, NH) < 6) { ps += L; pn++; }
  }
  if (!pn || !hn) throw new Error('no visible paint or hair in the views');
  return { ratio: ps / pn / (hs / hn), paintPx: pn, hairPx: hn };
}

const start = recipe.builder.scalpColor
  ? new THREE.Color(recipe.builder.scalpColor)
  : scalpPaintColor(null, sh.rootColor ?? '#2a1e18', sh.baseColor ?? '#5a4030', sh.tipColor ?? '#7a5a40', sh.primarySpecColor, sh.primaryIntensity ?? 0.32);
let c = start.clone();
const rec = JSON.parse(JSON.stringify(recipe));
let m = (rec.builder.scalpColor = '#' + c.getHexString(), measure(rec));
console.log(`start ${rec.builder.scalpColor}: paint / hair ${m.ratio.toFixed(2)} (paint ${m.paintPx} px, hair ${m.hairPx} px)`);
for (let it = 0; it < 3 && Math.abs(m.ratio / target - 1) > 0.04; it++) {
  c.multiplyScalar(target / m.ratio);
  rec.builder.scalpColor = '#' + c.getHexString();
  m = measure(rec);
  console.log(`step ${it + 1} ${rec.builder.scalpColor}: paint / hair ${m.ratio.toFixed(2)}`);
}
if (write) {
  recipe.builder.scalpColor = rec.builder.scalpColor;
  fs.writeFileSync(recipePath, JSON.stringify(recipe, null, 2) + '\n');
  console.log(`wrote builder.scalpColor ${rec.builder.scalpColor} to ${recipePath}`);
}
fs.rmSync(dir, { recursive: true, force: true });
