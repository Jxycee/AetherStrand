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
//   --ref refs/style_views.json (with --head): outline score. Lines each reference view up with the render by its landmarks
//   (chin, ear top, ear lobe; see outline.ts) and compares the hair masks: prints IoU / over / under per view and writes
//   <out>_outline.png (red: hair the render has and the reference doesn't; blue: reference hair the render misses; cyan:
//   the reference outline).
//   --shell grid.json: uses that outer-shape grid (hairShell.ts) instead of the recipe's builder.shell; --no-shell drops it.
//   Every run prints the hair's outer height grid (mm above the scalp, rows = phi from the crown, columns = azimuth from the
//   front) as built by the archetype and, with a shell, after it. --shell-capture grid.json writes the current result as
//   an editable shell grid (start a new shell from it). --shell-overlay writes <out>_shell.png: the shell surface as a green
//   grid on the render (bright where it is in front of the hair, faint where the hair covers it, hidden behind the head).
//   --shell-gaps gaps.json (with --ref): per shell cell, how many mm its hair edge must move out (+) or in (-) to meet the
//   reference outline, measured on each view's rim (null: no view sees that cell's edge). tools/preview/shell_fit.ts loops it.
//   --debug silhouette,roots,fade writes <out>_<view>.png per debug view: silhouette (flat white hair, light grey solid paint,
//   dark head: the outline alone), roots (bare head with every lock root as a dot coloured by layer: grey base shell,
//   blue nape/under, green sides/back, orange crown/bangs, magenta accents, cyan fade caps; a short line shows the comb
//   direction), fade (the scalp paint's alpha as a heat map on the bare head: grey none, blue low, green, yellow, red solid;
//   white contours at 0.25, 0.5 and 0.75).
//   Comparison look (hybrid plan phase 0): by default the sheet is rendered 3x and box-filtered down (--aa N; 1 when --ref,
//   --debug or the shell overlays measure pixels), on a mid-grey backdrop with a skin-toned head, and hair and body share
//   one rig (key upper left of the viewer, fill right, rim behind). --look legacy restores the old navy/plaster/studio
//   look (with --aa 1 it is byte-identical to earlier renders). --layers writes <out>_layers.png: the first view as base
//   (ambient only), key only, rim only and full. --turntable: 8 views every 45 degrees instead of the standard set.
//   --pair refs/style_views.json writes <out>_pair.png: each view after the game reference panel at that angle, framed to
//   the reference head size by its chin and ear-top landmarks unless --zoom / --cy are given.
//   Hybrid (phase 1): --mass builds the inner mass and drops the base shells, --edge-cards N adds strand cards,
//   --mass-only / --mass-tint show the mass alone / flat cyan; --pose turn|nod draws the hair mid head motion.
//   --no-hair hides the hair. --grid overlays the scalp coordinate grid on the head (blue |azimuth|, red phi, every 0.1 rad, thick lines at 0.5).
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { HairPhysicsSystem } from '../../src/engine/hairPhysics';
import { buildArchetypeSpecs, buildCustomHairSpecs, generateRandomHairstyle, naturalMaxHairlinePhi, scalpRegionPhi } from '../../src/engine/hairBuilder';
import { conformPoint, loadCharacterHead, type HeadConformMap } from '../../src/engine/characterHead';
import { captureHairShell, DEFAULT_SHELL_AZ_DEG, DEFAULT_SHELL_PHI_DEG, formatHairShell, hairShellJson, hairShellPolylines, shellSurfacePoint } from '../../src/engine/hairShell';
import { compareMasks, fitSimilarity, headLandmarkPoints, loadRefSheet, refHairMask, resolveLandmarks, type OutlineResult } from './outline';
import { computeProceduralHairTextureData, type HairTextureData } from '../../src/engine/hairTextures';
import { bakeHairCards } from '../../src/engine/cardBake';
import { displaySRGB, makeShadeEnv, rigLights, shadeHairPixel, SHEEN_DEFAULTS, SHEEN_LEGACY, type ShadeInput } from '../../src/engine/hairShadingModel';
import { evalScalpPaint, hairlineJag, paintStreak, paintUnderShade, sampleArr, scalpAngles, scalpPaintAlpha, scalpPaintColor, type ScalpPaint } from '../../src/engine/scalpPaint';

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
// --look game (default): the comparison look. Mid-grey backdrop like the reference sheets, skin-toned head, and one light
// rig for hair and body alike: key high from the viewer's upper left, soft fill from the right, rim from behind. The rig
// turns with the view. --look legacy: the old navy backdrop, plaster head and studio rig (hair key from the right while the
// body's key came from the left), for A/B against earlier renders.
const look = arg('--look', 'game') === 'legacy' ? 'legacy' : 'game';
// --aa N: render N times larger and box-filter down (linear light), so alpha-tested tips and the fade dither average out
// the way MSAA / TAA show them in Unity and the web. Default 3 for review sheets; 1 when a measuring tool runs (--ref,
// --debug, --shell-overlay, --shell-gaps), since those count pixels at the base size.
const measuring = ['--ref', '--debug', '--shell-overlay', '--shell-gaps'].some((k) => args.includes(k));
const AA = Math.max(1, Math.round(Number(arg('--aa', measuring ? '1' : '3'))));
if (AA > 1 && measuring) throw new Error('--aa > 1 cannot be combined with --ref, --debug or the shell overlays (they measure at the base size)');
// hair shading: by default every hair pixel is shaded by hairShadingModel.ts (the same maths as the viewport and Unity
// shaders) with the strand maps the app uses. --vertex-shade: the old per-vertex approximation (faster).
// --cards baked|procedural picks the strand maps (default: the recipe's shader.cardTextures, else baked);
// --sheen legacy shades with the pre-v2 highlight settings (A/B); --lights world keeps the app's fixed light rig
// (the back is then lit by the rim light only) instead of turning the rig with each view.
const pixelShade = !args.includes('--vertex-shade');
const lightsWorld = arg('--lights') === 'world';
// --shell / --no-shell: the outer-shape grid (hairShell.ts)
if (arg('--shell')) recipe.builder.shell = JSON.parse(fs.readFileSync(arg('--shell')!, 'utf8'));
if (args.includes('--no-shell')) delete recipe.builder.shell;
const shellGrid = recipe.builder.shell ?? null;
{
  const az = shellGrid?.azDeg ?? DEFAULT_SHELL_AZ_DEG, ph = shellGrid?.phiDeg ?? DEFAULT_SHELL_PHI_DEG, mir = shellGrid?.mirror !== false;
  const built = captureHairShell(buildArchetypeSpecs(recipe.builder), az, ph, mir);
  console.error(formatHairShell(built, 'built mm'));
  const result = shellGrid ? captureHairShell(buildCustomHairSpecs(recipe.builder), az, ph, mir) : built;
  if (shellGrid) { console.error(formatHairShell(shellGrid, 'target mm')); console.error(formatHairShell(result, 'result mm')); }
  if (arg('--shell-capture')) fs.writeFileSync(arg('--shell-capture')!, hairShellJson({ ...result, mirror: mir, strength: 1 }));
}

// --mass (hybrid plan phase 1): build the inner hair mass (hairMass.ts) and drop the base-shell ribbons, as
// builder.hybrid.mass does in a recipe; --mass-height 0.6 sets its height share; --no-mass turns a recipe's mass off.
// --mass-only draws the mass without the locks; --mass-tint draws it flat cyan, so every place it shows through the
// locks is easy to see.
if (args.includes('--mass')) recipe.builder.hybrid = { ...(recipe.builder.hybrid ?? {}), mass: true };
if (arg('--mass-height')) recipe.builder.hybrid = { ...(recipe.builder.hybrid ?? {}), massHeight: Number(arg('--mass-height')) };
if (args.includes('--no-mass') && recipe.builder.hybrid) recipe.builder.hybrid.mass = false;
// --edge-cards N: N thin strand cards split off the outline locks (hairCards.ts), as builder.hybrid.edgeCards
if (arg('--edge-cards')) recipe.builder.hybrid = { ...(recipe.builder.hybrid ?? {}), edgeCards: Number(arg('--edge-cards')) };
const massOnly = args.includes('--mass-only'), massTint = args.includes('--mass-tint');

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
let conformMap: HeadConformMap | null = null;
if (headArg && !args.includes('--no-conform')) {
  conformMap = loadCharacterHead(fs.readFileSync(headArg, 'utf8'), headArg, arg('--chin-y') ? Number(arg('--chin-y')) : undefined).conform;
  hair.conformToHead(conformMap);
}
const wScale = recipe.physics?.strandWidthScale ?? 1;
hair.snapToHead(headPivot, wScale);
const audit = hair.auditQuality(headPivot, 'rest');
// --pose turn|nod (hybrid plan phase 1 deformation check): runs the live solver from the rest pose through a head motion
// and draws the hair where it is at the moment of most lag, in the head's own frame (the head mesh stays put, the hair
// shows its offset from the head). turn = the app's own turn motion (HairViewport applyMotionPose: +-0.62 rad yaw),
// frozen at its first swing through centre, where the head moves fastest; nod = +-0.35 rad pitch at 2.6 rad/s, frozen at
// its centre crossing too. Prints the mass's largest edge stretch over the whole run.
const poseArg = arg('--pose');
let poseReport: Record<string, number> | null = null;
if (poseArg) {
  const physics: any = { ...(recipe.physics ?? {}), showColliders: false, showBones: false };
  const freezeT = poseArg === 'nod' ? Math.PI / 2.6 : Math.PI / 2.15;
  const frames = Math.round(freezeT * 60);
  let worst = 0;
  (hair as any).measureMassStretch = true;
  for (let f = 1; f <= frames; f++) {
    const t = f / 60;
    if (poseArg === 'turn') {
      const swing = Math.sin(t * 2.15);
      headPivot.position.set(swing * 0.022, 0.44 + Math.cos(t * 4.3) * 0.012, 0);
      headPivot.rotation.set(Math.sin(t * 1.4) * 0.055, swing * 0.62, -swing * 0.085);
    } else if (poseArg === 'nod') {
      headPivot.position.set(0, 0.44, 0);
      headPivot.rotation.set(Math.sin(t * 2.6) * 0.35, 0, 0);
    } else throw new Error('--pose turn|nod');
    rootGroup.updateMatrixWorld(true);
    hair.step(1 / 60, headPivot, rootGroup, physics);
    worst = Math.max(worst, hair.massStretch ?? 0);
  }
  // back into the head's rest frame for drawing
  headPivot.updateMatrixWorld(true);
  const hq = new THREE.Quaternion(), hpw = new THREE.Vector3(), hs = new THREE.Vector3();
  headPivot.matrixWorld.decompose(hpw, hq, hs);
  const iq = hq.clone().invert(), rest0 = new THREE.Vector3(0, 0.44, 0), v = new THREE.Vector3();
  const toHead = (g: THREE.BufferGeometry) => {
    for (const name of ['position', 'normal', 'aHeadNormal', 'aHairTangent']) {
      const a = g.attributes[name].array as Float32Array;
      for (let i = 0; i < a.length; i += 3) {
        v.set(a[i], a[i + 1], a[i + 2]);
        if (name === 'position') v.sub(hpw).applyQuaternion(iq).add(rest0); else v.applyQuaternion(iq);
        a[i] = v.x; a[i + 1] = v.y; a[i + 2] = v.z;
      }
    }
  };
  toHead(hair.geometry);
  if (hair.mass) toHead(hair.mass.geometry);
  poseReport = { frames, massStretchMaxPct: +(worst * 100).toFixed(2), massStretchNowPct: +((hair.massStretch ?? 0) * 100).toFixed(2) };
  console.error('pose', poseArg, JSON.stringify(poseReport));
}
// the mass, when built, is drawn with the locks in one buffer (same attributes); massStart = its first vertex
let geo: THREE.BufferGeometry = hair.geometry;
let massStart = Infinity;
if (hair.mass) {
  const m = hair.mass, lg: THREE.BufferGeometry = hair.geometry;
  const nL = lg.attributes.position.count;
  massStart = massOnly ? 0 : nL;
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'aHeadNormal', 'aHairTangent', 'uv', 'aStrandSeed', 'aLayerAO', 'aCardMask', 'aScalpRoot', 'aGradT']) {
    const a = lg.attributes[name] as THREE.BufferAttribute, b = m.geometry.attributes[name] as THREE.BufferAttribute;
    const arr = new Float32Array((massOnly ? 0 : a.array.length) + b.array.length);
    if (!massOnly) arr.set(a.array as Float32Array, 0);
    arr.set(b.array as Float32Array, massOnly ? 0 : a.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  const li = massOnly ? new Uint32Array(0) : (lg.index!.array as Uint32Array), mi = m.geometry.index!.array as ArrayLike<number>;
  const idx = new Uint32Array(li.length + mi.length);
  idx.set(li, 0);
  for (let i = 0; i < mi.length; i++) idx[li.length + i] = mi[i] + massStart;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  geo = g;
  console.error('mass', JSON.stringify({ ...m.stats, meanMm: +m.stats.meanMm.toFixed(2), maxMm: +m.stats.maxMm.toFixed(2), vertices: m.vertexCount, locks: hair.locks.length }));
}

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
// skin for --look game: a light warm tone, so the hairline and fade are judged against skin, not grey plaster
const SKIN = '#e3bfa6', SKIN_EAR = '#dcb398';
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
let headLm: Record<string, THREE.Vector3> | null = null;
if (headPath) {
  const ch = loadCharacterHead(fs.readFileSync(headPath, 'utf8'), headPath, arg('--chin-y') ? Number(arg('--chin-y')) : undefined);
  headLm = headLandmarkPoints(ch.positions, ch.landmarks);
  for (const k of Object.keys(headLm)) headLm[k].y += 0.44;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(ch.positions, 3));
  add(g, P, look === 'game' ? SKIN : '#b8b2ae', false, false, true);
  console.error('head fit', JSON.stringify({ scale: ch.fit.scale, offset: ch.fit.offset, chinY: ch.fit.chinY, landmarks: ch.landmarks }));
} else {
  const headGeo = new THREE.LatheGeometry([V2(0, 0), V2(0.052, 0.012), V2(0.122, 0.055), V2(0.192, 0.135), V2(0.244, 0.245), V2(0.272, 0.365), V2(0.28, 0.48), V2(0.264, 0.585), V2(0.208, 0.672), V2(0.115, 0.725), V2(0, 0.742)], 48);
  headGeo.scale(0.97, 1.0, 1.09);
  add(headGeo, P, look === 'game' ? SKIN : '#9c8678', false, true, true);
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
    add(outer, earM, look === 'game' ? SKIN_EAR : '#b49482');
    const helix = new THREE.TorusGeometry(0.04, 0.01, 10, 20, Math.PI * 1.48);
    add(helix, M([side * 0.008, 0.004, -0.004], [0, side * Math.PI * 0.44, side * -0.42], [1, 1, 1], earM), look === 'game' ? SKIN_EAR : '#b49482');
  }
  const neck = new THREE.LatheGeometry([V2(0.145, -0.22), V2(0.118, -0.12), V2(0.112, -0.02), V2(0.122, 0.08)], 28);
  neck.scale(0.96, 1.0, 1.04);
  add(neck, M([0, 0.01, -0.032], [0, 0, 0], [1, 1, 1], P), look === 'game' ? SKIN : '#9c8678');
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
// THREE.Color(hex) is already linear (ColorManagement on), as the viewport's shader uniforms are
if (scalpCoreMesh) scalpCoreMesh.color.copy(cRoot).multiplyScalar(0.55);
const usePaint = !args.includes('--no-paint') && !args.includes('--magenta') && !!hair.scalpPaint;
const useMagenta = args.includes('--magenta');
// --grid: draws the scalp coordinate grid on the head (|azimuth| blue, phi red; every 0.1 rad, thick at 0.5) to place landmarks
const showGrid = args.includes('--grid') || !!arg('--lines');
// --lines th:1.62,ph:1.64,...  draws only these scalp lines (|azimuth| or phi), coloured in order (blue, cyan, red, orange, green, yellow, magenta, white)
const LINE_COLS = [[0.1, 0.3, 1], [0, 0.9, 0.9], [1, 0.1, 0.1], [1, 0.55, 0], [0.1, 0.85, 0.1], [1, 0.95, 0], [1, 0, 1], [1, 1, 1]];
const gridLines = (arg('--lines') ?? '').split(',').filter(Boolean).map((t, i) => ({ th: t.startsWith('th'), v: Number(t.split(':')[1]), c: LINE_COLS[i % LINE_COLS.length] }));
const paint: ScalpPaint | null = usePaint ? hair.scalpPaint : null;
// painted short hair: the paint's colour override, else the hair's own colour (same rule as the web app and Unity)
const cPaint = scalpPaintColor(hair.scalpPaint, sh.rootColor ?? '#2a1e18', sh.baseColor ?? '#5a4030', sh.tipColor ?? '#7a5a40', sh.primarySpecColor, sh.primaryIntensity ?? 0.32);
// strand maps and shading environment for per-pixel hair (hairShadingModel.ts)
const cardKind = arg('--cards') ?? (sh.cardTextures === 'procedural' ? 'procedural' : 'baked');
const strandMaps: HairTextureData = cardKind === 'procedural' ? computeProceduralHairTextureData() : bakeHairCards(sh.cardBake);
const sheenBase = arg('--sheen') === 'legacy' ? SHEEN_LEGACY : SHEEN_DEFAULTS;
const shaderFull = {
  rootColor: '#2a1e18', baseColor: '#5a4030', tipColor: '#7a5a40', primarySpecColor: '#ffe8d0', secondarySpecColor: '#a07050',
  primaryShift: 0.05, primaryPower: 76, primaryIntensity: 0.32, secondaryShift: -0.14, secondaryPower: 24, secondaryIntensity: 0.2,
  rimIntensity: 0.3, rimPower: 3.4, rootAO: 0.74, grooveDepth: 0.6, strandVariation: 0.2, ...sh,
};
const grainAt = (az: number, phi: number) => {
  // (grainStretch: cells longer along phi, narrower across, same area)
  const gs = Math.sqrt(Math.max(1, paint?.grainStretch ?? 1));
  const a = Math.floor(az * gs / 0.011), b = Math.floor(phi / gs / 0.011);
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

const BW = 440, BH = 480;
const W = BW * AA, H = BH * AA;
const views: { name: string; d: THREE.Vector3; up: THREE.Vector3; c: THREE.Vector3; ext: number }[] = [];
const allViews: typeof views = [];
// --turntable: 8 views every 45 degrees (t0 = front, t90 = left profile, t180 = back) in place of the standard four + top
const yaws: (readonly [string, number])[] = args.includes('--turntable')
  ? [0, 45, 90, 135, 180, 225, 270, 315].map((a) => [`t${a}`, (-a * Math.PI) / 180] as const)
  : ([['front', 0], ['3q', Math.PI / 4], ['left', -Math.PI / 2], ['back', Math.PI]] as const);
for (const [name, yaw] of yaws) {
  views.push({ name, d: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), up: new THREE.Vector3(0, 1, 0), c: new THREE.Vector3(0, 0.66, 0), ext: 0.78 });
}
if (!args.includes('--turntable')) views.push({ name: 'top', d: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1), c: new THREE.Vector3(0, 0.0, -0.01), ext: 0.5 });
// --views front,back  picks views; --zoom 2 --cy 0.5 frames a close-up (centre height in world metres) for checking tips and partings
{
  const pickViews = arg('--views');
  const zoom = Number(arg('--zoom', '1'));
  const cy = arg('--cy');
  for (const v of views) {
    v.ext /= zoom;
    if (cy !== undefined && v.name !== 'top') v.c.y = Number(cy);
  }
  // --pair without --zoom / --cy: frame the side views so the head is the size and height it is in the reference panels
  // (chin to ear top, measured on the front panel), otherwise the bust renders smaller than the reference head and
  // shapes cannot be compared side by side. Bust: chin y 0.44, ear top y ~0.753; --head: its measured landmarks.
  const pairRef = arg('--pair');
  if (pairRef && !arg('--zoom') && cy === undefined) {
    const rs: any = loadRefSheet(pairRef).sheet;
    const fv = rs.views.front ?? Object.values(rs.views)[0];
    const lm = fv.landmarks, top = Object.entries(lm).filter(([n]) => n.startsWith('earTop')).map(([, q]: any) => q[1]);
    if (lm.chin && top.length) {
      const chinW = headLm?.chin ? headLm.chin.y : 0.44;
      const earW = headLm ? Math.max(...Object.entries(headLm).filter(([n]) => n.startsWith('earTop')).map(([, q]) => q.y)) : 0.753;
      const fracSpan = (lm.chin[1] - Math.min(...top)) / fv.crop[3], fracChin = lm.chin[1] / fv.crop[3];
      const ext = (earW - chinW) / (2 * fracSpan);
      for (const v of views) if (v.name !== 'top') { v.ext = ext; v.c.y = chinW + (fracChin - 0.5) * 2 * ext; }
    }
  }
  allViews.push(...views);
  const keep = pickViews ? views.filter((v) => pickViews.split(',').includes(v.name)) : views.slice();
  views.length = 0;
  views.push(...keep);
}
/** Screen projection of a view: [x, y, depth] with depth larger nearer the camera. */
function viewProj(v: (typeof views)[number]) {
  const d = v.d.clone().normalize();
  const r = new THREE.Vector3().crossVectors(v.up, d).normalize();
  const u = new THREE.Vector3().crossVectors(d, r).normalize();
  const scale = (H * 0.5) / v.ext;
  return (x: number, y: number, z: number) => {
    const dx = x - v.c.x, dy = y - v.c.y, dz = z - v.c.z;
    return [W * 0.5 + (dx * r.x + dy * r.y + dz * r.z) * scale, H * 0.5 - (dx * u.x + dy * u.y + dz * u.z) * scale, dx * d.x + dy * d.y + dz * d.z];
  };
}

const sheet = new Uint8Array(W * views.length * H * 3);
// --ref: reference outline score (outline.ts)
const refArg = arg('--ref');
const ref = refArg ? loadRefSheet(refArg) : null;
if (ref && !headLm) throw new Error('--ref needs --head (the landmarks are measured on the character head)');
const osheet = ref ? new Uint8Array(sheet.length) : null;
const outline: Record<string, OutlineResult> = {};
// --shell-overlay: the shell (or, without one, the captured outer surface) drawn as a grid on a copy of the render
const showShell = args.includes('--shell-overlay');
const ssheet = showShell ? new Uint8Array(sheet.length) : null;
// --debug silhouette,roots,fade: flat debug views, one <out>_<view>.png each
const DEBUG_VIEWS = ['silhouette', 'roots', 'fade'] as const;
const debugViews = (arg('--debug') ?? '').split(',').filter((x): x is (typeof DEBUG_VIEWS)[number] => (DEBUG_VIEWS as readonly string[]).includes(x));
if (arg('--debug') && !debugViews.length) throw new Error(`--debug takes ${DEBUG_VIEWS.join(', ')}`);
const dsheets: Record<string, Uint8Array> = Object.fromEntries(debugViews.map((k) => [k, new Uint8Array(sheet.length)]));
// lock roots for the roots view: world position of the root, a point two nodes along (the comb direction), layer
const ROOT_COLS: Record<number, number[]> = { 0: [150, 150, 150], 1: [70, 140, 255], 2: [80, 220, 110], 3: [255, 165, 40], 4: [255, 70, 220] };
const lockRoots = debugViews.includes('roots')
  ? (hair.locks as any[]).map((l) => ({ a: l.particles[0].pos as THREE.Vector3, b: l.particles[Math.min(2, l.particles.length - 1)].pos as THREE.Vector3, col: l.isFadeCap ? [0, 230, 230] : ROOT_COLS[l.layerOrder ?? 2] ?? [255, 255, 255] }))
  : [];
// --shell-gaps gaps.json (with --ref): how far, in mm, each shell cell's hair edge sits from the reference outline
const gapsArg = arg('--shell-gaps');
if (gapsArg && !ref) throw new Error('--shell-gaps needs --ref');
const overlayGrid = showShell || gapsArg ? shellGrid ?? captureHairShell(buildCustomHairSpecs(recipe.builder)) : null;
/** Shell grid nodes in world space (both sides when mirrored), with the radial direction and mm per world unit there. */
const shellNodes: { i: number; j: number; p: THREE.Vector3; n: THREE.Vector3; mmPerWorld: number }[] = [];
const gapSum = overlayGrid ? overlayGrid.mm.map((r: unknown[]) => r.map(() => 0)) : [];
const gapW = overlayGrid ? overlayGrid.mm.map((r: unknown[]) => r.map(() => 0)) : [];
if (overlayGrid && gapsArg) {
  const DEGR = Math.PI / 180, HCw = new THREE.Vector3(0, 0.425 + 0.44, -0.01);
  overlayGrid.phiDeg.forEach((ph: number, i: number) => overlayGrid.azDeg.forEach((a: number, j: number) => {
    const mm = overlayGrid.mm[i][j];
    if (mm === null || ph <= 0) return;
    for (const sgn of overlayGrid.mirror !== false && a > 0 && a < 180 ? [1, -1] : [1]) {
      const p = shellSurfacePoint(sgn * a * DEGR, ph * DEGR, mm);
      const base = shellSurfacePoint(sgn * a * DEGR, ph * DEGR, 0).sub(new THREE.Vector3(0, 0.425, -0.01));
      if (conformMap) conformPoint(conformMap, p, naturalMaxHairlinePhi, true);
      p.y += 0.44;
      shellNodes.push({ i, j, p, n: p.clone().sub(HCw).normalize(), mmPerWorld: 295 / base.length() });
    }
  }));
}
/** World-space polylines along the overlay grid's rows (constant phi) and columns (constant azimuth), both sides. */
const shellLines: THREE.Vector3[][] = [];
if (overlayGrid && showShell) {
  shellLines.push(...hairShellPolylines(overlayGrid, (p) => { if (conformMap) conformPoint(conformMap, p, naturalMaxHairlinePhi, true); p.y += 0.44; }));
}
// Landmark fit per reference view. The scale is shared: one head size for every view, measured on the views that show
// both ears (front, back), since a profile's chin-to-ear span differs between faces and gave a wrong size on its own.
const refFits: Record<string, { s: number; tx: number; ty: number; got: Record<string, [number, number]>; use: string[] }> = {};
if (ref && headLm) {
  const lmOf = (rv: (typeof ref.sheet.views)[string], n: string): [number, number] => (rv.mirror ? [rv.crop[2] - rv.landmarks[n][0], rv.landmarks[n][1]] : rv.landmarks[n]);
  const per: Record<string, { use: string[]; got: Record<string, [number, number]>; s: number }> = {};
  for (const v of allViews) {
    const rv = ref.sheet.views[v.name];
    if (!rv) continue;
    const pr = viewProj(v);
    const got = resolveLandmarks(Object.keys(rv.landmarks), headLm, (p) => pr(p.x, p.y, p.z));
    const use = Object.keys(rv.landmarks).filter((n) => got[n]);
    if (use.length < 2) continue;
    per[v.name] = { use, got, s: fitSimilarity(use.map((n) => lmOf(rv, n)), use.map((n) => got[n])).s };
  }
  const wide = Object.entries(per).filter(([n]) => { const k = Object.keys(ref.sheet.views[n].landmarks); return k.some((x) => x.endsWith('L')) && k.some((x) => x.endsWith('R')); }).map(([, f]) => f.s);
  const shared = wide.length ? wide.reduce((a, b) => a + b, 0) / wide.length : null;
  for (const [name, f] of Object.entries(per)) {
    const rv = ref.sheet.views[name];
    const s = rv.ownScale || shared === null ? f.s : shared;
    let tx = 0, ty = 0;
    for (const n of f.use) { const p = lmOf(rv, n); tx += (f.got[n][0] - s * p[0]) / f.use.length; ty += (f.got[n][1] - s * p[1]) / f.use.length; }
    refFits[name] = { s, tx, ty, got: f.got, use: f.use };
  }
}
// The hair's light rig. legacy: the app's studio rig turned with the view (or fixed with --lights world). game: the same
// key and fill directions the body uses (so hair and head are lit from the same side), studio colours, a rim from behind
// and above. layerMode isolates one part for the --layers sheet: base (ambient only: colour and form without highlights),
// key only, rim only, or full.
let layerMode: 'full' | 'base' | 'key' | 'rim' = 'full';
function previewLights(viewRot: THREE.Matrix4, key: THREE.Vector3, fill: THREE.Vector3, r: THREE.Vector3, u: THREE.Vector3, d: THREE.Vector3) {
  const L = look === 'legacy' ? rigLights('studio', lightsWorld ? undefined : viewRot) : rigLights('studio', viewRot);
  if (look === 'game') {
    L.keyDir.copy(key);
    L.fillDir.copy(fill);
    L.rimDir.copy(r).multiplyScalar(0.3).addScaledVector(u, 0.55).addScaledVector(d, -0.78).normalize();
  }
  const off = (c: THREE.Color) => c.setRGB(0, 0, 0);
  if (layerMode === 'base') { off(L.keyColor); off(L.fillColor); off(L.rimColor); L.ambient.multiplyScalar(1.8); }
  if (layerMode === 'key') { off(L.fillColor); off(L.rimColor); off(L.ambient); }
  if (layerMode === 'rim') { off(L.keyColor); off(L.fillColor); off(L.ambient); }
  return L;
}
const bg = look === 'game' ? [118, 119, 122] : [32, 35, 43];

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
  // what each pixel shows (0 background, 1 body, 2 hair) and the scalp paint's alpha there, for the outline score
  const kindBuf = new Uint8Array(W * H), paintBuf = new Float32Array(W * H);
  let curKind = 1;
  const col = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) { col[i * 3] = bg[0] / 255; col[i * 3 + 1] = bg[1] / 255; col[i * 3 + 2] = bg[2] / 255; }
  const proj = (x: number, y: number, z: number) => {
    const dx = x - v.c.x, dy = y - v.c.y, dz = z - v.c.z;
    return [W * 0.5 + (dx * r.x + dy * r.y + dz * r.z) * scale, H * 0.5 - (dx * u.x + dy * u.y + dz * u.z) * scale, dx * d.x + dy * d.y + dz * d.z];
  };
  // hu: per-vertex [u across the lock, t along it, strand seed] for hair: a procedural stand-in for the viewport's strand
  // alpha / groove maps (separate strands, darker grooves between them, frayed tips) so locks don't read as smooth leaves
  const strandH = (i: number) => { let t = i * 0.1031; t -= Math.floor(t); t *= t + 33.33; t *= t + t; return t - Math.floor(t); };
  const tri = (p: number[][], c: number[][], wp?: number[][], skin?: number[], hu?: number[][]) => {
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
        let tone = 1;
        if (hu) {
          const uu = w0 * hu[0][0] + w1 * hu[1][0] + w2 * hu[2][0];
          const tt = w0 * hu[0][1] + w1 * hu[1][1] + w2 * hu[2][1];
          const sd = hu[0][2];
          const sx = uu * 18 + sd * 37.0, si = Math.floor(sx), sf = sx - si;
          const hs = strandH(si + Math.floor(sd * 997));
          // tips fray: strands end at different lengths
          if (tt > 0.55 && hs < ((tt - 0.55) / 0.45) * 0.9) continue;
          const groove = Math.pow(Math.sin(Math.PI * sf), 0.6);
          tone = (0.72 + 0.28 * groove) * (0.85 + 0.3 * hs);
        }
        zbuf[idx] = z;
        kindBuf[idx] = curKind; paintBuf[idx] = 0;
        if (wp && skin) {
          // c holds the lighting factor; blend skin and painted hair per pixel
          const k = w0 * c[0][0] + w1 * c[1][0] + w2 * c[2][0];
          const lx = w0 * wp[0][0] + w1 * wp[1][0] + w2 * wp[2][0], ly = w0 * wp[0][1] + w1 * wp[1][1] + w2 * wp[2][1] - 0.44, lz = w0 * wp[0][2] + w1 * wp[1][2] + w2 * wp[2][2];
          const al = paintAlpha(lx, ly, lz);
          paintBuf[idx] = al;
          let st = 1;
          if (al > 0) {
            const sa = scalpAngles(lx, ly, lz); st = 0.82 + 0.36 * paintStreak(sa.az, sa.phi);
            // darker under the hair, as the web and Unity shaders (paintUnderShade)
            if (paint?.underShade) st *= paintUnderShade(paint.underShade, sa.phi - hairlineJag(paint.irregularity ?? 0.5, sa.az), sampleArr(paint.fullPhi, sa.az));
          }
          col[idx * 3] = k * (skin[0] + (cPaint.r * st - skin[0]) * al);
          col[idx * 3 + 1] = k * (skin[1] + (cPaint.g * st - skin[1]) * al);
          col[idx * 3 + 2] = k * (skin[2] + (cPaint.b * st - skin[2]) * al);
          if (showGrid) {
            // scalp-coordinate grid: blue lines every 0.1 rad of |azimuth|, red every 0.1 rad of phi (thick at each 0.5)
            const sa = scalpAngles(lx, ly, lz), th = Math.abs(sa.az);
            const near = (v: number, step: number, w: number) => Math.abs(v / step - Math.round(v / step)) * step < w;
            if (gridLines.length) {
              for (const g of gridLines) if (Math.abs((g.th ? th : sa.phi) - g.v) < 0.006) { col[idx * 3] = g.c[0]; col[idx * 3 + 1] = g.c[1]; col[idx * 3 + 2] = g.c[2]; }
            } else {
              if (near(th, 0.5, 0.008) || near(th, 0.1, 0.003)) { col[idx * 3] = 0.1; col[idx * 3 + 1] = 0.3; col[idx * 3 + 2] = 1; }
              if (near(sa.phi, 0.5, 0.008) || near(sa.phi, 0.1, 0.003)) { col[idx * 3] = 1; col[idx * 3 + 1] = 0.15; col[idx * 3 + 2] = 0.1; }
            }
          }
          continue;
        }
        col[idx * 3] = (w0 * c[0][0] + w1 * c[1][0] + w2 * c[2][0]) * tone;
        col[idx * 3 + 1] = (w0 * c[0][1] + w1 * c[1][1] + w2 * c[2][1]) * tone;
        col[idx * 3 + 2] = (w0 * c[0][2] + w1 * c[1][2] + w2 * c[2][2]) * tone;
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
      if ((paint || showGrid) && m.paint) {
        const wp: number[][] = [];
        for (let j = 0; j < 3; j++) {
          const o = i + j * 3;
          p.push(proj(pos[o], pos[o + 1], pos[o + 2]));
          wp.push([pos[o], pos[o + 1], pos[o + 2]]);
          const k = shadeBody(nor[o], nor[o + 1], nor[o + 2], WHITE, !!m.flat)[0];
          c.push([k, k, k]);
        }
        // (a back face, like the inside of the skull seen through the eye holes, is not counted as painted hair)
        curKind = (nor[i] + nor[i + 3] + nor[i + 6]) * d.x + (nor[i + 1] + nor[i + 4] + nor[i + 7]) * d.y + (nor[i + 2] + nor[i + 5] + nor[i + 8]) * d.z < 0 ? 3 : 1;
        tri(p, c, wp, [m.color.r, m.color.g, m.color.b]);
        curKind = 1;
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
  const seeds = geo.attributes.aStrandSeed.array as Float32Array;
  const scalpRootA = geo.attributes.aScalpRoot.array as Float32Array;
  const gradTA = geo.attributes.aGradT.array as Float32Array;
  const headNA = geo.attributes.aHeadNormal.array as Float32Array;
  const HN = new THREE.Vector3(), BN = new THREE.Vector3();
  // highlights as the viewport shader draws them (hairShaders.ts): primary lobe at the recipe's power and intensity, gated by
  // a normal blended 42% toward the head normal (not the raw card normal, which dots every lock), plus the wide sheen band
  const rootAO = sh.rootAO ?? 0.74;
  const pPow = sh.primaryPower ?? 76, pInt = sh.primaryIntensity ?? 0.32, sPow = sh.secondaryPower ?? 24, sInt = sh.secondaryIntensity ?? 0.2;
  const sstepK = (e0: number, e1: number, x: number) => { const c = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return c * c * (3 - 2 * c); };
  // --no-hair: head, paint and grid only
  const index = args.includes('--no-hair') ? new Uint32Array(0) : (geo.index!.array as Uint32Array);
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
    // as hairShaders.ts: the dark root only on true scalp roots (scalpRoot 1); shingled tiers blend toward the base colour
    const sstep = (e0: number, e1: number, x: number) => { const c = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return c * c * (3 - 2 * c); };
    const gt = Math.max(0, Math.min(1, gradTA[i])); // colour gradient coordinate (colorRange)
    const a = sstep(0, 0.28, t);
    const effRoot = cBase.clone().lerp(cRoot, scalpRootA[i]);
    const base = gt < 0.28 ? effRoot.lerp(cBase, sstep(0, 0.28, gt)) : cBase.clone().lerp(cTip, sstep(0.28, 1, gt));
    const isShell = card[i] === 0;
    // root occlusion and layer AO as hairShaders.ts: the root darkens by rootAO x 0.72 x scalpRoot over the first 22% of
    // the lock (so a lock with a low scalpRoot, like an outer layer over other hair, keeps a light root)
    const rootOcc = isShell ? 0.72 + 0.28 * a : (1 - rootAO * 0.72 * scalpRootA[i]) + (rootAO * 0.72 * scalpRootA[i]) * sstep(0, 0.22, t);
    const aoK = (isShell ? 0.55 : 0.72 + 0.32 * ao[i]) * rootOcc;
    HN.set(headNA[i * 3], headNA[i * 3 + 1], headNA[i * 3 + 2]).normalize();
    BN.copy(N).lerp(HN, 0.42).normalize();
    // diffuse on the normal blended toward the head normal, as hairShaders.ts lights it (perturbedN from baseN): the raw
    // card normal made every card seen edge-on or from below a near-black leaf the app never shows
    const diff = 0.34 + 0.58 * Math.max(0, (BN.dot(key) + 0.25) / 1.25) + 0.16 * Math.max(0, BN.dot(fill));
    const keyFacing = sstepK(-0.14, 0.48, BN.dot(key));
    // (as hairShaders.ts: a light-rooted lock (scalpRoot < 0.5) keeps its highlight to the root)
    const specMask = (1 + (sstepK(0.08, 0.24, t) - 1) * sstepK(0, 0.5, scalpRootA[i])) * (0.62 + 0.38 * ao[i]);
    const lobe = (shift: number, pw: number) => { const th = T.clone().addScaledVector(BN, shift).normalize().dot(Hh); return Math.pow(Math.sqrt(Math.max(0, 1 - th * th)), pw); };
    const spec1 = (lobe(0.05, pPow) * pInt * 0.56 * 1.6 + lobe(0.02, 14) * 0.3 * 0.35) * keyFacing * specMask;
    const spec2 = lobe(0.25, sPow) * sInt * 0.44 * keyFacing * specMask;
    const rim = Math.pow(1 - Math.abs(facing), 3) * 0.12;
    vc[i] = [0, 1, 2].map((k) => {
      const bc = [base.r, base.g, base.b][k];
      const s1 = [cSpec.r, cSpec.g, cSpec.b][k];
      const s2 = [cSpec2.r, cSpec2.g, cSpec2.b][k];
      return bc * diff * aoK + s1 * spec1 * aoK + s2 * spec2 * aoK + rim * bc * 2;
    });
  }
  // the head and paint alone, before the hair goes on, for the debug views
  const bodyZ = debugViews.length ? zbuf.slice() : null, bodyCol = debugViews.length ? col.slice() : null, bodyPaint = debugViews.length ? paintBuf.slice() : null, bodyKind = debugViews.length ? kindBuf.slice() : null;
  // per-pixel hair: interpolate the vertex data and shade with hairShadingModel.ts (the viewport / Unity maths)
  const viewRot = new THREE.Matrix4().makeBasis(r, u, d);
  const env = makeShadeEnv(shaderFull as any, strandMaps, previewLights(viewRot, key, fill, r, u, d), sheenBase);
  const tng = geo.attributes.aHairTangent.array as Float32Array;
  const pin: ShadeInput = { u: 0, t: 0, seed: 0, layerAO: 0, cardMask: 0, scalpRoot: 0, gradT: 0, N: new THREE.Vector3(), headN: new THREE.Vector3(), T: new THREE.Vector3(), V: d.clone() };
  const outC = [0, 0, 0];
  const lerp3 = (arr: Float32Array, a: number, b: number, c: number, w0: number, w1: number, w2: number, o: THREE.Vector3) =>
    o.set(w0 * arr[a * 3] + w1 * arr[b * 3] + w2 * arr[c * 3], w0 * arr[a * 3 + 1] + w1 * arr[b * 3 + 1] + w2 * arr[c * 3 + 1], w0 * arr[a * 3 + 2] + w1 * arr[b * 3 + 2] + w2 * arr[c * 3 + 2]);
  const triHair = (a: number, b: number, c: number) => {
    const p0 = vp[a], p1 = vp[b], p2 = vp[c];
    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    if (minX > maxX || minY > maxY) return;
    const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (Math.abs(area) < 1e-9) return;
    // which side faces the viewer (as gl_FrontFacing: the geometric winding)
    const front = area < 0;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((p1[0] - px) * (p2[1] - py) - (p2[0] - px) * (p1[1] - py)) / area;
      const w1 = ((p2[0] - px) * (p0[1] - py) - (p0[0] - px) * (p2[1] - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
      const idx = y * W + x;
      if (z <= zbuf[idx]) continue;
      pin.u = w0 * uv[a * 2] + w1 * uv[b * 2] + w2 * uv[c * 2];
      pin.t = w0 * uv[a * 2 + 1] + w1 * uv[b * 2 + 1] + w2 * uv[c * 2 + 1];
      pin.seed = seeds[a];
      pin.layerAO = w0 * ao[a] + w1 * ao[b] + w2 * ao[c];
      pin.cardMask = card[a];
      pin.scalpRoot = w0 * scalpRootA[a] + w1 * scalpRootA[b] + w2 * scalpRootA[c];
      pin.gradT = w0 * gradTA[a] + w1 * gradTA[b] + w2 * gradTA[c];
      lerp3(nor, a, b, c, w0, w1, w2, pin.N).normalize();
      // gl_FrontFacing flips the normal on back faces; use the interpolated normal's side when the winding is unreliable
      if (pin.N.dot(d) < 0) pin.N.negate();
      void front;
      lerp3(headNA, a, b, c, w0, w1, w2, pin.headN).normalize();
      lerp3(tng, a, b, c, w0, w1, w2, pin.T).normalize();
      // fade caps: the shader's screen dither (interleaved gradient + white noise)
      if (pin.cardMask > 0.15 && pin.cardMask < 0.45) {
        const a0 = pin.cardMask; let fs = Math.abs(a0 - 0.25) < 0.002 ? 0.25 : Math.max(0, Math.min(1, (a0 - 0.16) / 0.28)); fs = fs < 0.9 ? Math.min(fs, 0.45) : fs;
        const fu = sstepK(fs, 1, Math.max(0, Math.min(1, pin.t)));
        const tail = sstepK(1 - 0.85, 1, fu);
        const cov = (1 + (0.85 * (1 - 0.45 * fu) - 1) * sstepK(0, 0.2, fu)) * (1 - tail);
        const fr = (q: number) => q - Math.floor(q);
        const ign = fr(52.9829189 * fr(px * 0.06711056 + py * 0.00583715));
        const wn = fr(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
        if (cov - (ign + (wn - ign) * 0.45) < 0) continue;
      }
      if (massTint && a >= massStart) { outC[0] = 0; outC[1] = 0.55; outC[2] = 0.6; }
      else if (!shadeHairPixel(pin, env, outC)) continue;
      zbuf[idx] = z; kindBuf[idx] = 2; paintBuf[idx] = 0;
      col[idx * 3] = outC[0]; col[idx * 3 + 1] = outC[1]; col[idx * 3 + 2] = outC[2];
      hairPx[idx] = 1;
    }
  };
  const hairPx = new Uint8Array(W * H);
  curKind = 2;
  for (let i = 0; i < index.length; i += 3) {
    const a0 = index[i], a1 = index[i + 1], a2 = index[i + 2];
    const hu = card[a0] > 0.5 ? [[uv[a0 * 2], uv[a0 * 2 + 1], seeds[a0]], [uv[a1 * 2], uv[a1 * 2 + 1], seeds[a0]], [uv[a2 * 2], uv[a2 * 2 + 1], seeds[a0]]] : undefined;
    if (pixelShade) triHair(a0, a1, a2);
    else tri([vp[a0], vp[a1], vp[a2]], [vc[a0], vc[a1], vc[a2]], undefined, undefined, hu);
  }
  // linear -> sRGB with a soft ACES-like shoulder
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = (y * W * views.length + vi * W + x) * 3;
      for (let k = 0; k < 3; k++) {
        let c = col[i * 3 + k];
        if (pixelShade && hairPx[i]) {
          if (k === 0) { const s3 = displaySRGB([col[i * 3], col[i * 3 + 1], col[i * 3 + 2]]); sheet[o] = s3[0]; sheet[o + 1] = s3[1]; sheet[o + 2] = s3[2]; }
          continue;
        }
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
  // debug views. silhouette: flat hair (white), solid scalp paint (light grey), head (dark grey), so the outline reads
  // alone. roots: the head and paint with no hair, a dot at every lock root coloured by layer and a short line along its
  // first nodes (comb direction). fade: the scalp paint's alpha as a heat map on the bare head, contours at 0.25/0.5/0.75.
  const toS = (c: number) => { c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14); c = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); };
  for (const dv of debugViews) {
    const ds = dsheets[dv];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, o = (y * W * views.length + vi * W + x) * 3;
      let c: number[];
      if (dv === 'silhouette') {
        c = kindBuf[i] === 2 ? [245, 245, 245] : kindBuf[i] === 1 && paintBuf[i] >= 0.6 ? [175, 175, 175] : kindBuf[i] ? [70, 72, 78] : [12, 12, 16];
      } else if (dv === 'roots') {
        c = bodyZ![i] > -1e8 ? [toS(bodyCol![i * 3]), toS(bodyCol![i * 3 + 1]), toS(bodyCol![i * 3 + 2])] : bg;
      } else {
        const a = bodyPaint![i];
        if (bodyZ![i] <= -1e8) c = bg;
        else if (a <= 0.01 || bodyKind![i] === 3) c = [120, 116, 112]; // (back faces, e.g. inside the eye holes, show no paint)
        else {
          const stops = [[40, 60, 200], [40, 190, 120], [240, 220, 40], [230, 50, 40]];
          const t = Math.min(0.999, a) * 3, k = Math.floor(t), f = t - k;
          c = [0, 1, 2].map((q) => stops[k][q] + (stops[k + 1][q] - stops[k][q]) * f);
        }
        // contours where the alpha crosses 0.25, 0.5, 0.75
        if (x > 0 && y > 0 && bodyZ![i] > -1e8 && bodyKind![i] !== 3) for (const lv of [0.25, 0.5, 0.75]) {
          const ok = (k: number) => bodyZ![k] > -1e8 && bodyKind![k] !== 3; // neighbours on the head's front only
          const s0 = a >= lv;
          if ((ok(i - 1) && s0 !== bodyPaint![i - 1] >= lv) || (ok(i - W) && s0 !== bodyPaint![i - W] >= lv)) c = [255, 255, 255];
        }
      }
      ds[o] = c[0]; ds[o + 1] = c[1]; ds[o + 2] = c[2];
    }
    if (dv === 'roots') {
      const put = (x: number, y: number, col: number[]) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W * views.length + vi * W + x) * 3; ds[o] = col[0]; ds[o + 1] = col[1]; ds[o + 2] = col[2]; };
      for (const lr of lockRoots) {
        const a = proj(lr.a.x, lr.a.y, lr.a.z), b = proj(lr.b.x, lr.b.y, lr.b.z);
        const ix = Math.round(a[0]), iy = Math.round(a[1]);
        if (ix < 0 || iy < 0 || ix >= W || iy >= H || a[2] < bodyZ![iy * W + ix] - 0.006) continue; // root behind the head
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
        for (let t = 0; t <= n; t++) put(Math.round(a[0] + ((b[0] - a[0]) * t) / n), Math.round(a[1] + ((b[1] - a[1]) * t) / n), lr.col.map((v) => v * 0.7));
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(ix + dx, iy + dy, lr.col);
      }
    }
  }
  // shell overlay: green grid lines, bright where in front of the hair or head, faint where covered
  if (ssheet) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W * views.length + vi * W + x) * 3; ssheet[o] = sheet[o] * 0.8; ssheet[o + 1] = sheet[o + 1] * 0.8; ssheet[o + 2] = sheet[o + 2] * 0.8; }
    const plot = (q: number[]) => {
      for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
        const x = Math.floor(q[0]) + dx, y = Math.floor(q[1]) + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const o = (y * W * views.length + vi * W + x) * 3;
        const front = q[2] >= zbuf[y * W + x] - 0.004;
        if (!front && kindBuf[y * W + x] !== 2) continue; // behind the head: hidden
        const a = front ? 1 : 0.45;
        ssheet[o] = ssheet[o] * (1 - a) + 60 * a; ssheet[o + 1] = ssheet[o + 1] * (1 - a) + 255 * a; ssheet[o + 2] = ssheet[o + 2] * (1 - a) + 90 * a;
      }
    };
    for (const line of shellLines) for (let k = 0; k + 1 < line.length; k++) {
      const a = proj(line[k].x, line[k].y, line[k].z), b = proj(line[k + 1].x, line[k + 1].y, line[k + 1].z);
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let t = 0; t <= n; t++) plot([a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n, a[2] + ((b[2] - a[2]) * t) / n]);
    }
  }
  // outline score: rendered hair (locks, plus solid scalp paint) against the reference panel placed by its landmarks
  const rv = ref?.sheet.views[v.name];
  if (ref && osheet && rv && headLm) {
    const rmask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) rmask[i] = kindBuf[i] === 2 || (kindBuf[i] === 1 && paintBuf[i] >= 0.6) ? 1 : 0;
    const rf = refFits[v.name];
    if (rf) {
      const lm = rv.landmarks, got = rf.got, use = rf.use, fit = rf;
      const fmask = refHairMask(ref.img, rv);
      const cmp = compareMasks(rmask, W, H, fmask, fit);
      outline[v.name] = { iou: +cmp.iou.toFixed(3), over: +cmp.over.toFixed(3), under: +cmp.under.toFixed(3), scale: +cmp.scale.toFixed(3) };
      // shell gaps: for each shell node on this view's rim, march along its outward direction on screen and compare where
      // the rendered hair ends with where the reference hair ends; the difference is how far that cell must move
      if (gapsArg) {
        const edge = (m: ArrayLike<number>, x0: number, y0: number, sx: number, sy: number) => {
          const at = (t: number) => { const x = Math.round(x0 + sx * t), y = Math.round(y0 + sy * t); return x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] ? 1 : 0; };
          if (at(0)) { for (let t = 1; t < 90; t++) if (!at(t)) return t - 0.5; return 90; }
          for (let t = 1; t < 90; t++) if (at(-t)) return -t + 0.5;
          return null;
        };
        for (const sn of shellNodes) {
          const facing = sn.n.dot(d);
          if (Math.abs(facing) > 0.45) continue; // only nodes near the rim of this view
          const sx = sn.n.dot(r), sy = -sn.n.dot(u), sl = Math.hypot(sx, sy);
          if (sl < 0.5) continue;
          const q = proj(sn.p.x, sn.p.y, sn.p.z);
          const eR = edge(rmask, q[0], q[1], sx / sl, sy / sl), eF = edge(cmp.warped, q[0], q[1], sx / sl, sy / sl);
          if (eR === null || eF === null) continue;
          const dmm = ((eF - eR) / (scale * sl)) * sn.mmPerWorld;
          const w = 1 - Math.abs(facing) / 0.45;
          gapSum[sn.i][sn.j] += dmm * w; gapW[sn.i][sn.j] += w;
        }
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, o = (y * W * views.length + vi * W + x) * 3;
        const r = rmask[i], f = cmp.warped[i];
        const edge = f && (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !cmp.warped[i - 1] || !cmp.warped[i + 1] || !cmp.warped[i - W] || !cmp.warped[i + W]);
        let c = [sheet[o], sheet[o + 1], sheet[o + 2]];
        if (r && !f) c = [c[0] * 0.45 + 255 * 0.55, c[1] * 0.45 + 40 * 0.55, c[2] * 0.45 + 40 * 0.55];
        else if (f && !r) c = [c[0] * 0.45 + 40 * 0.55, c[1] * 0.45 + 90 * 0.55, c[2] * 0.45 + 255 * 0.55];
        if (edge) c = [0, 255, 255];
        osheet[o] = c[0]; osheet[o + 1] = c[1]; osheet[o + 2] = c[2];
      }
      // landmarks: yellow = the head's, magenta = the reference's after the fit
      const dot = (q: number[], col: number[]) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const x = Math.round(q[0]) + dx, y = Math.round(q[1]) + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue; const o = (y * W * views.length + vi * W + x) * 3; osheet[o] = col[0]; osheet[o + 1] = col[1]; osheet[o + 2] = col[2]; } };
      for (const n of use) {
        dot(got[n], [255, 230, 0]);
        const p = rv.mirror ? [rv.crop[2] - lm[n][0], lm[n][1]] : lm[n];
        dot([p[0] * fit.s + fit.tx, p[1] * fit.s + fit.ty], [255, 0, 255]);
      }
    }
  }
  if (osheet && !outline[v.name]) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W * views.length + vi * W + x) * 3; osheet[o] = sheet[o]; osheet[o + 1] = sheet[o + 1]; osheet[o + 2] = sheet[o + 2]; }
}
views.forEach((_, i) => renderView(i));
// --layers: the first view four times (base, key only, rim only, full) in <out>_layers.png, to judge form shading
// without the highlight fooling the eye
let layersSheet: Uint8Array | null = null;
if (args.includes('--layers')) {
  const keep = sheet.slice();
  const modes = ['base', 'key', 'rim', 'full'] as const;
  layersSheet = new Uint8Array(W * modes.length * H * 3);
  modes.forEach((m, mi) => {
    layerMode = m;
    renderView(0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W * views.length + x) * 3, q = (y * W * modes.length + mi * W + x) * 3;
      layersSheet![q] = sheet[o]; layersSheet![q + 1] = sheet[o + 1]; layersSheet![q + 2] = sheet[o + 2];
    }
  });
  layerMode = 'full';
  sheet.set(keep);
}

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
/** box-filter an AA-times-larger sRGB image down to the base size, averaging in linear light */
const toLin = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const toS8 = (c: number) => Math.max(0, Math.min(255, Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255)));
const downsample = (px: Uint8Array, cols: number) => {
  if (AA === 1) return px;
  const sw = W * cols, ow = BW * cols, out = new Uint8Array(ow * BH * 3), n = AA * AA;
  for (let y = 0; y < BH; y++) for (let x = 0; x < ow; x++) for (let k = 0; k < 3; k++) {
    let acc = 0;
    for (let j = 0; j < AA; j++) for (let i = 0; i < AA; i++) acc += toLin[px[((y * AA + j) * sw + x * AA + i) * 3 + k]];
    out[(y * ow + x) * 3 + k] = toS8(acc / n);
  }
  return out;
};
const writeRgbPng = (file: string, px: Uint8Array, SW: number, H: number) => {
  const raw = Buffer.alloc((SW * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (SW * 3 + 1)] = 0;
    Buffer.from(px.buffer, y * SW * 3, SW * 3).copy(raw, y * (SW * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SW, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))]));
};
const SW = W * views.length;
const writePng = (file: string, px: Uint8Array) => writeRgbPng(file, px, SW, H);
const finalSheet = downsample(sheet, views.length);
writeRgbPng(outPath, finalSheet, BW * views.length, BH);
const layersPath = outPath.replace(/\.png$/i, '') + '_layers.png';
if (layersSheet) writeRgbPng(layersPath, downsample(layersSheet, 4), BW * 4, BH);
// --pair refs/style_views.json: each view next to the game reference panel at the same angle, reference first (the
// game-style reference leads). The panel is scaled to the render height; views the sheet lacks are left out.
const pairArg = arg('--pair');
const pairPath = outPath.replace(/\.png$/i, '') + '_pair.png';
if (pairArg) {
  const pr = loadRefSheet(pairArg);
  const named = views.map((v, i) => ({ v, i })).filter(({ v }) => pr.sheet.views[v.name]);
  const pw = (rv: { crop: number[] }) => Math.round((rv.crop[2] * BH) / rv.crop[3]);
  const totalW = named.reduce((a, { v }) => a + pw(pr.sheet.views[v.name]) + BW, 0);
  const out = new Uint8Array(totalW * BH * 3);
  let x0 = 0;
  for (const { v, i } of named) {
    const rv: any = pr.sheet.views[v.name];
    const [cx, cy, cw, ch] = rv.crop, w = pw(rv);
    for (let y = 0; y < BH; y++) for (let x = 0; x < w; x++) {
      const fx = Math.min(cw - 1, Math.floor(((x + 0.5) * cw) / w)), fy = Math.min(ch - 1, Math.floor(((y + 0.5) * ch) / BH));
      const sx = Math.min(pr.img.w - 1, cx + (rv.mirror ? cw - 1 - fx : fx)), sy = Math.min(pr.img.h - 1, cy + fy);
      const si = (sy * pr.img.w + sx) * 3, o = (y * totalW + x0 + x) * 3;
      out[o] = pr.img.rgb[si]; out[o + 1] = pr.img.rgb[si + 1]; out[o + 2] = pr.img.rgb[si + 2];
    }
    x0 += w;
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
      const s0 = (y * BW * views.length + i * BW + x) * 3, o = (y * totalW + x0 + x) * 3;
      out[o] = finalSheet[s0]; out[o + 1] = finalSheet[s0 + 1]; out[o + 2] = finalSheet[s0 + 2];
    }
    x0 += BW;
  }
  writeRgbPng(pairPath, out, totalW, BH);
}
const outlinePath = outPath.replace(/\.png$/i, '') + '_outline.png';
if (osheet) writePng(outlinePath, osheet);
if (gapsArg && overlayGrid) {
  const gaps = { azDeg: overlayGrid.azDeg, phiDeg: overlayGrid.phiDeg, mirror: overlayGrid.mirror !== false, strength: 1, mm: gapSum.map((row: number[], i: number) => row.map((v: number, j: number) => (gapW[i][j] > 0.15 ? Math.round((v / gapW[i][j]) * 2) / 2 : null))) };
  fs.writeFileSync(gapsArg, hairShellJson(gaps));
  console.error(formatHairShell(gaps, 'gap mm'));
}
const shellPath = outPath.replace(/\.png$/i, '') + '_shell.png';
if (ssheet) writePng(shellPath, ssheet);
const debugPaths: Record<string, string> = {};
for (const dv of debugViews) { debugPaths[dv] = outPath.replace(/\.png$/i, '') + `_${dv}.png`; writePng(debugPaths[dv], dsheets[dv]); }
const ov = Object.values(outline);

const pick = (k: string) => (typeof audit[k] === 'number' ? Number(audit[k].toFixed(2)) : audit[k]);
console.log(JSON.stringify({
  name: recipe.customName, out: outPath,
  locks: hair.locks.length, triangles: (geo.index!.count / 3) | 0,
  scalpCoveragePct: pick('scalpCoveragePct'), floatingRootCount: pick('floatingRootCount'), penetratingNodes: pick('penetratingNodes'),
  crownHookCount: pick('crownHookCount'), interLockClipPct: pick('interLockClipPct'), score: pick("score"), verdict: audit.verdict, pose: poseReport,
  ...(osheet ? { outline, outlineScore: ov.length ? Math.round((100 * ov.reduce((a, o) => a + o.iou, 0)) / ov.length) : null, outlineImage: outlinePath } : {}),
  ...(ssheet ? { shellImage: shellPath } : {}),
  ...(debugViews.length ? { debugImages: debugPaths } : {}),
  ...(layersSheet ? { layersImage: layersPath } : {}),
  ...(pairArg ? { pairImage: pairPath } : {}),
  look, aa: AA,
}));
