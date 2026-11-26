// Checks the web generator's Unity ZIP against the package and the parity exporter (issue #8). Uses Vite's import.meta.glob,
// so bundle it first:
//   npx vite build --ssr tools/unity-parity/zip_check.ts --outDir node_modules/.cache/zipchk && node node_modules/.cache/zipchk/zip_check.js <recipe.json> [--mass] [--edge-cards N]
// Passes when every shader, script, asmdef and package.json in the URP ZIP is byte-identical to unity-plugin/, and the ZIP's
// Presets/PresetGeometry.json equals web_export.ts output for the same recipe.
import fs from 'node:fs';
import path from 'node:path';
import { exportGeometry } from './web_geometry';
import { generatePluginFiles } from '../../src/generators/unityPluginGenerator';
import { HAIR_PRESETS } from '../../src/types/hair';

const argv = process.argv.slice(2);
const at = (f: string) => argv.indexOf(f);
const recipe: any = JSON.parse(fs.readFileSync(argv[0], 'utf8'));
if (at('--mass') >= 0) recipe.builder.hybrid = { ...(recipe.builder.hybrid ?? {}), mass: true };
if (at('--edge-cards') >= 0) recipe.builder.hybrid = { ...(recipe.builder.hybrid ?? {}), edgeCards: Number(argv[at('--edge-cards') + 1]) };
const geo = exportGeometry(recipe);
const files = generatePluginFiles(recipe.shader ?? HAIR_PRESETS[recipe.presetId].shader, recipe.physics ?? HAIR_PRESETS[recipe.presetId].physics, recipe.presetId, 'urp', [], geo);
const pkg = path.resolve('unity-plugin/com.aetherstrand.sculptedhair');
let bad = 0, checked = 0;
for (const f of files) {
  if (!f.path.startsWith('AetherStrand_Unity/')) continue;
  const rel = f.path.slice('AetherStrand_Unity/'.length);
  if (!/\.(cs|shader|asmdef)$/.test(rel) && rel !== 'package.json') continue;
  const src = path.join(pkg, rel);
  if (!fs.existsSync(src)) continue; // generator-only extras (legacy bone-chain scripts)
  checked++;
  if (fs.readFileSync(src, 'utf8') !== f.content) { bad++; console.log('DIFFERS', rel); }
}
const zipGeo = files.find((f) => f.path === 'AetherStrand_Unity/Presets/PresetGeometry.json');
const same = zipGeo?.content === JSON.stringify(geo);
console.log(`package files checked ${checked}, differing ${bad}; PresetGeometry ${same ? 'identical' : 'MISSING OR DIFFERENT'}; hybridMass ${geo.hybridMass ? 'present' : 'absent'}`);
process.exit(bad || !same ? 1 : 0);
