// Bakes the hair-card strand maps (src/engine/cardBake.ts) to PNGs.
//   npx tsx tools/cards/bake_cards.ts --sheet out.png            contact sheet of every channel (for looking at a bake)
//   npx tsx tools/cards/bake_cards.ts --unity                    writes the Unity package textures
//                                                                (unity-plugin/.../Textures/AetherStrand_*.png)
//   --recipe r.json  bakes with that recipe's shader.cardBake settings; --procedural  the old procedural maps instead
import fs from 'node:fs';
import path from 'node:path';
import { bakeHairCards } from '../../src/engine/cardBake';
import { computeProceduralHairTextureData, type HairTextureData } from '../../src/engine/hairTextures';
import { encodePng } from './png';

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const recipe = arg('--recipe') ? JSON.parse(fs.readFileSync(arg('--recipe')!, 'utf8')) : null;
const t0 = Date.now();
const data: HairTextureData = args.includes('--procedural') ? computeProceduralHairTextureData() : bakeHairCards(recipe?.shader?.cardBake);
console.error(`baked ${data.width}x${data.height} in ${Date.now() - t0} ms`);

export const UNITY_TEXTURE_NAMES: Record<string, keyof HairTextureData> = {
  AetherStrand_GrooveAO: 'grooveAo',
  AetherStrand_FlowIDShift: 'flowId',
  AetherStrand_Normal: 'normal',
  AetherStrand_AlphaCard: 'alphaCard',
  AetherStrand_StrandFlow: 'flow',
};

if (args.includes('--unity')) {
  const dir = 'unity-plugin/com.aetherstrand.sculptedhair/Textures';
  for (const [name, key] of Object.entries(UNITY_TEXTURE_NAMES)) {
    const f = path.join(dir, `${name}.png`);
    fs.writeFileSync(f, encodePng(data[key] as Uint8ClampedArray, data.width, data.height, 4));
    console.error('wrote', f);
  }
}

const sheet = arg('--sheet');
if (sheet) {
  // channels side by side at half size: AO, tone, depth, shift, normal, alpha, flow (x tinted), clump id
  const w = data.width >> 1, h = data.height >> 1;
  const panels: ((i: number) => number[])[] = [
    (i) => { const v = data.grooveAo[i]; return [v, v, v]; },
    (i) => { const v = data.flowId[i]; return [v, v, v]; },
    (i) => { const v = data.flowId[i + 1]; return [v, v, v]; },
    (i) => { const v = data.flowId[i + 2]; return [v, v, v]; },
    (i) => [data.normal[i], data.normal[i + 1], data.normal[i + 2]],
    (i) => { const v = data.alphaCard[i]; return [v, v, v]; },
    (i) => { const d = (data.flow[i] - 128) * 6; return [128 + d, 128, 128 - d]; },
    (i) => { const v = data.flow[i + 3]; return [v, 255 - v, (v * 7) % 255]; },
  ];
  const SW = w * panels.length + 4 * (panels.length - 1);
  const out = new Uint8ClampedArray(SW * h * 4).fill(255);
  panels.forEach((fn, p) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = fn(((y * 2) * data.width + x * 2) * 4);
      const o = (y * SW + p * (w + 4) + x) * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    }
  });
  fs.writeFileSync(sheet, encodePng(out, SW, h, 3));
  console.error('wrote', sheet, '(panels: AO, tone, depth, shift, normal, alpha, flow x, clump id; root at the bottom)');
}
