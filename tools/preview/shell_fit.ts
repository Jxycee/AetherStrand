// Fits a style's hair shell (hairShell.ts) to a reference outline: renders, measures how far each shell cell's hair edge
// sits from the reference outline (cpu_preview --shell-gaps), moves the cells by most of that, and repeats. Keeps the
// grid with the best outline score and writes it (each round's grid stays beside its render as <out>_fit_shell_<n>.json), ready to paste into the recipe as builder.shell (or pass with --shell).
//
// Usage (repo root), with the same render flags as cpu_preview (a --ref sheet and --head are required):
//   npx tsx tools/preview/shell_fit.ts --recipe tools/hair-blocks/recipes/ref_undercut-fade.json \
//     --head heads/Tobin_Head.obj --chin-y 1.5855 --views front,3q,left,back --zoom 1.9 --cy 0.9 \
//     --ref tools/hair-blocks/refs/undercut-fade_views.json --iters 6 --save fitted_shell.json --out fit.png
// Optional: --shell start.json (start from this grid instead of the recipe's shell or a capture of the style as built),
// --damp 0.7 (share of each measured gap moved per round), --step 12 (largest move per round, mm),
// --rows 15,30,45 (only these phi rows may change; others stay as they start).
// The shell only reshapes the hair that exists, and the fit only reads the outline: always look at the render after it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { HairShellGrid } from '../../src/types/hair';
import { formatHairShell, hairShellJson } from '../../src/engine/hairShell';

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const own = new Set(['--iters', '--save', '--damp', '--step', '--rows', '--shell', '--out']);
const pass: string[] = [];
for (let i = 0; i < args.length; i++) { if (own.has(args[i])) { i++; continue; } pass.push(args[i]); }
if (!arg('--ref')) throw new Error('shell_fit needs --ref');
const iters = Number(arg('--iters', '6')), damp = Number(arg('--damp', '0.7')), maxStep = Number(arg('--step', '12'));
const rows = arg('--rows') ? arg('--rows')!.split(',').map(Number) : null;
const out = arg('--out', 'shell_fit.png')!;
const work = out.replace(/\.png$/i, '') + '_fit';
fs.mkdirSync(path.dirname(work) || '.', { recursive: true });

const run = (extra: string[]) => {
  const r = spawnSync('npx', ['tsx', 'tools/preview/cpu_preview.ts', ...pass, ...extra], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  const last = r.stdout.trim().split('\n').pop()!;
  return JSON.parse(last) as { outlineScore: number; outline: Record<string, { iou: number }> };
};

// start: --shell, the recipe's own shell, or a capture of the style as built
let cur: HairShellGrid;
if (arg('--shell')) cur = JSON.parse(fs.readFileSync(arg('--shell')!, 'utf8'));
else {
  const recipe = JSON.parse(fs.readFileSync(arg('--recipe')!, 'utf8'));
  if (recipe.builder?.shell) cur = recipe.builder.shell;
  else { run(['--no-shell', '--shell-capture', `${work}_start.json`, '--out', `${work}_start.png`]); cur = JSON.parse(fs.readFileSync(`${work}_start.json`, 'utf8')); }
}
let best = { score: -1, grid: cur, iter: -1 };
for (let it = 0; it <= iters; it++) {
  // (each round's grid is kept next to its render, so a round that looks better than the best-scoring one can be used)
  fs.writeFileSync(`${work}_shell_${it}.json`, hairShellJson(cur));
  const res = run(['--shell', `${work}_shell_${it}.json`, '--shell-gaps', `${work}_gaps.json`, '--out', `${work}_${it}.png`]);
  const gaps: HairShellGrid = JSON.parse(fs.readFileSync(`${work}_gaps.json`, 'utf8'));
  console.error(`round ${it}: outline ${res.outlineScore} (${Object.entries(res.outline).map(([k, v]) => `${k} ${v.iou}`).join(', ')})`);
  // (compare the unrounded mean of the views' overlaps: outlineScore is a whole number, so small gains would tie)
  const ious = Object.values(res.outline).map((v) => v.iou);
  const score = ious.reduce((a, b) => a + b, 0) / Math.max(1, ious.length);
  if (score > best.score) best = { score, grid: JSON.parse(JSON.stringify(cur)), iter: it };
  if (it === iters) break;
  // move each cell by damp x its gap (lightly smoothed with its neighbours' gaps), at most maxStep mm per round
  const g = gaps.mm;
  const next = cur.mm.map((row, i) => row.map((v, j) => {
    if (v === null || g[i]?.[j] === null || g[i]?.[j] === undefined) return v;
    if (rows && !rows.includes(cur.phiDeg[i])) return v;
    const nb = [g[i - 1]?.[j], g[i + 1]?.[j], g[i]?.[j - 1], g[i]?.[j + 1]].filter((x): x is number => typeof x === 'number');
    const gap = nb.length ? 0.6 * g[i][j]! + 0.4 * (nb.reduce((a, b) => a + b, 0) / nb.length) : g[i][j]!;
    const mv = Math.max(-maxStep, Math.min(maxStep, damp * gap));
    return Math.round(Math.max(2, Math.min(150, v + mv)) * 2) / 2;
  }));
  cur = { ...cur, mm: next };
}
const save = arg('--save', `${work}_best.json`)!;
fs.writeFileSync(save, hairShellJson(best.grid));
console.error(formatHairShell(best.grid, 'best mm'));
console.log(JSON.stringify({ bestScore: Math.round(best.score * 1000) / 10, bestRound: best.iter, shell: save, render: `${work}_${best.iter}.png`, outline: `${work}_${best.iter}_outline.png` }));
