// Headless web-side exporter. Run with cwd = AetherStrand clone:
//   npx tsx web_export.ts <recipe.json> <outDir> [--mass] [--edge-cards N]
// Writes PresetGeometry.json (schema 2.1: plugin format + solver extras, full precision) for ANY recipe.
// --mass / --edge-cards N turn the hybrid on as builder.hybrid does in a recipe (same flags as cpu_preview); with the mass on
// the file carries a hybridMass block (web_geometry.ts exportMass).
import fs from 'node:fs';
import path from 'node:path';
import { exportGeometry } from './web_geometry';

const argv = process.argv.slice(2);
const flagAt = (f: string) => argv.indexOf(f);
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--edge-cards');
const [recipePath, out = '.'] = positional;
const recipe: any = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
if (flagAt('--mass') >= 0) recipe.builder.hybrid = { ...(recipe.builder.hybrid ?? {}), mass: true };
if (flagAt('--edge-cards') >= 0) recipe.builder.hybrid = { ...(recipe.builder.hybrid ?? {}), edgeCards: Number(argv[flagAt('--edge-cards') + 1]) };
fs.mkdirSync(out, { recursive: true });
const geo = exportGeometry(recipe);
fs.writeFileSync(path.join(out, 'PresetGeometry.json'), JSON.stringify(geo));
console.log(geo.presetName, 'locks', geo.lockCount, geo.hybridMass ? `mass vertices ${geo.hybridMass.vertexCount}` : '');
