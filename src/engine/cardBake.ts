// Hair-card texture baking: renders real strands (clumped, waved, crossing, staggered tips, layered in depth) into the
// strand maps every lock samples (hairTextures.ts HairTextureData), instead of painting them from noise.
// Pure TypeScript, no DOM: the browser, the CPU preview and the Unity texture export (tools/cards/bake_cards.ts) all get
// the same pixels from the same settings. See docs/SHARED_TOOLS.md "Hair-card baking".
//
// Card space: u runs across the card (0..1, the strip TILES in u so each lock reads its own stretch of it through
// its seed: sampleUv = (uv.x * 0.92 + seed * 3.13, t)), v runs root (0) to tip (1). Images are stored the GL way:
// v = 0 is the BOTTOM image row, which is how three.js (flipY) and Unity both sample a texture.
import type { HairTextureData } from './hairTextures';

export interface CardBakeSettings {
  /** Strands across the strip. More = finer hair. */
  strands: number;
  /** Clumps across the strip; strands gather toward their clump's centre toward the tip. */
  clumps: number;
  /** How hard strands gather into clumps by the tip (0 = parallel, 1 = every clump ends in a point). */
  clumpTightness: number;
  /** Strand thickness in pixels at the root (512-wide strip). */
  strandWidthPx: number;
  /** Small per-strand wander across the card (frizz), in card widths. */
  frizz: number;
  /** Slow clump wave across the card, in card widths. */
  wave: number;
  /** How much strand lengths vary: 0 = all reach the tip, 1 = some end at 45% of the card. */
  tipStagger: number;
  /** Strands that cross their neighbours (fraction): they drift sideways over the clump and catch light differently. */
  strays: number;
  /** Physical width / length of a typical card: turns u-drift into the strand's real angle for the flow map. */
  cardAspect: number;
  width: number;
  height: number;
  seed: number;
}

export const CARD_BAKE_DEFAULTS: CardBakeSettings = {
  strands: 520,
  clumps: 13,
  clumpTightness: 0.55,
  strandWidthPx: 2.4,
  frizz: 0.004,
  wave: 0.012,
  tipStagger: 0.6,
  strays: 0.06,
  cardAspect: 0.18,
  width: 512,
  height: 1024,
  seed: 1337,
};

export function resolveCardBake(s?: Partial<CardBakeSettings> | null): CardBakeSettings {
  const out = { ...CARD_BAKE_DEFAULTS };
  if (s) for (const k of Object.keys(out) as (keyof CardBakeSettings)[]) if (typeof s[k] === 'number' && Number.isFinite(s[k])) out[k] = s[k] as number;
  out.strands = Math.max(16, Math.round(out.strands));
  out.clumps = Math.max(1, Math.round(out.clumps));
  out.width = Math.max(64, Math.round(out.width));
  out.height = Math.max(64, Math.round(out.height));
  return out;
}

/** A stable text key for caching a bake. */
export function cardBakeKey(s: CardBakeSettings): string {
  return (Object.keys(s) as (keyof CardBakeSettings)[]).sort().map((k) => `${k}=${s[k]}`).join(';');
}

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sstep = (e0: number, e1: number, x: number) => { const c = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return c * c * (3 - 2 * c); };

interface Clump { u: number; amp: number; freq: number; phase: number; tone: number; shift: number; depth: number }
interface Strand {
  clump: number; off: number; len: number; width: number; depth: number; tone: number; shift: number; id: number;
  frq: number; ph: number; amp: number; drift: number;
}

/** Where strand s is across the card at height v (unwrapped u; may leave 0..1, the strip tiles). */
function strandU(s: Strand, c: Clump, st: CardBakeSettings, v: number): number {
  const gather = 1 - st.clumpTightness * Math.pow(v, 1.6);
  const clumpWave = c.amp * Math.sin(v * c.freq + c.phase);
  const own = s.amp * Math.sin(v * s.frq + s.ph) + s.drift * v * v;
  return c.u + clumpWave + s.off * gather + own;
}

/**
 * Bakes the strand maps. Channels (same meaning as the procedural pack, so the shaders read them unchanged):
 *  grooveAo.r  strand AO: grooves between strands, strands shadowed by the ones lying over them, deep gaps between clumps
 *  flowId      r = tone (strand + clump), g = depth of the top strand (0 deep .. 1 outermost), b = highlight shift
 *              (mostly per clump, so a clump's highlight moves as one, plus a little per strand)
 *  normal      from the strand height field (round strands, grooves between)
 *  alphaCard.r coverage (strands end at different lengths and taper, clumps part toward the tip)
 *  flow        rg = the top strand's direction in card space (x across, y along, 0.5 = 0), b = strand id, a = clump id
 */
export function bakeHairCards(settings?: Partial<CardBakeSettings> | null): HairTextureData {
  const st = resolveCardBake(settings);
  const W = st.width, H = st.height;
  const r = rng(st.seed);
  const clumps: Clump[] = [];
  for (let i = 0; i < st.clumps; i++) {
    clumps.push({
      u: (i + 0.5 + (r() - 0.5) * 0.5) / st.clumps,
      amp: st.wave * (0.5 + r()),
      freq: 3 + r() * 5,
      phase: r() * Math.PI * 2,
      tone: r(),
      shift: r(),
      depth: r(),
    });
  }
  const clumpHalf = 0.5 / st.clumps;
  const strands: Strand[] = [];
  for (let i = 0; i < st.strands; i++) {
    const ci = Math.floor(r() * st.clumps);
    const c = clumps[ci];
    // denser in the clump's middle (sum of two uniforms)
    const off = (r() + r() - 1) * clumpHalf * 1.8; // clumps overlap at the root, part toward the tip
    const stray = r() < st.strays;
    const lenR = r();
    strands.push({
      clump: ci,
      off,
      len: 1.04 - st.tipStagger * 0.55 * Math.pow(lenR, 1.8),
      width: (st.strandWidthPx * (0.7 + r() * 0.6)) / W,
      // strands at the clump's middle lie on top; strays cross over everything
      depth: Math.min(1, 0.25 + 0.45 * c.depth + 0.3 * (1 - Math.abs(off) / (clumpHalf * 1.8)) * r() + (stray ? 0.35 : 0)),
      tone: 0.55 * c.tone + 0.45 * r(),
      shift: 0.7 * c.shift + 0.3 * r(),
      id: r(),
      frq: 6 + r() * 14,
      ph: r() * Math.PI * 2,
      amp: st.frizz * (0.4 + r()),
      drift: stray ? (r() - 0.5) * clumpHalf * 3 : 0,
    });
  }
  // stack order: deeper first, so the top strand overwrites
  strands.sort((a, b) => a.depth - b.depth);

  const N = W * H;
  const topH = new Float32Array(N).fill(-1); // height of the top strand surface (depth + round profile)
  const topDepth = new Float32Array(N);
  const tone = new Float32Array(N).fill(0.5);
  const shift = new Float32Array(N).fill(0.5);
  const fx = new Float32Array(N), fy = new Float32Array(N).fill(1);
  const sid = new Float32Array(N), cid = new Float32Array(N);
  const cover = new Float32Array(N); // 1 - prod(1 - a)
  const prof = new Float32Array(N); // the top strand's round profile (1 at its middle)

  for (const s of strands) {
    const c = clumps[s.clump];
    const endV = s.len;
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1);
      if (v > endV) break;
      // taper over the last 22% of this strand
      const taper = 1 - sstep(endV - 0.22, endV, v) * 0.85;
      const hw = s.width * 0.5 * taper;
      const uc = strandU(s, c, st, v);
      const dv = 1 / (H - 1);
      const du = strandU(s, c, st, Math.min(1, v + dv)) - uc;
      // physical direction: across = du * cardAspect, along = dv
      let dxp = (du / dv) * st.cardAspect, dyp = 1;
      const dl = Math.hypot(dxp, dyp); dxp /= dl; dyp /= dl;
      // the tip end fades out (alpha) over the last 6%
      const vFade = 1 - sstep(endV - 0.06, endV, v);
      const x0 = Math.floor((uc - hw) * W - 1), x1 = Math.ceil((uc + hw) * W + 1);
      const row = (H - 1 - y) * W; // GL convention: root at the bottom row
      for (let xi = x0; xi <= x1; xi++) {
        const x = ((xi % W) + W) % W;
        const pu = (xi + 0.5) / W;
        const d = Math.abs(pu - uc) / Math.max(1e-6, hw);
        // antialiased coverage across the strand's edge (one pixel wide)
        const edgeA = Math.max(0, Math.min(1, (hw - Math.abs(pu - uc)) * W + 0.5));
        if (edgeA <= 0) continue;
        const a = edgeA * vFade;
        const i = row + x;
        cover[i] = 1 - (1 - cover[i]) * (1 - a);
        const p = Math.sqrt(Math.max(0, 1 - Math.min(1, d) * Math.min(1, d)));
        const hgt = s.depth + 0.08 * p;
        if (a > 0.35 && hgt > topH[i]) {
          topH[i] = hgt; topDepth[i] = s.depth; tone[i] = s.tone; shift[i] = s.shift;
          fx[i] = dxp; fy[i] = dyp; sid[i] = s.id; cid[i] = s.clump / Math.max(1, st.clumps - 1); prof[i] = p;
        }
      }
    }
  }

  // contact shadow: a strand lying under a higher one nearby (across u) is darker. Blurred max of the height field.
  const R = 5;
  const occ = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const h0 = topH[row + x];
      let o = 0;
      for (let k = -R; k <= R; k++) {
        if (!k) continue;
        const hk = topH[row + ((x + k + W) % W)];
        if (hk > h0) o = Math.max(o, (hk - h0) * (1 - Math.abs(k) / (R + 1)));
      }
      occ[row + x] = o;
    }
  }

  const gA = new Uint8ClampedArray(N * 4), fA = new Uint8ClampedArray(N * 4), nA = new Uint8ClampedArray(N * 4), aA = new Uint8ClampedArray(N * 4), flA = new Uint8ClampedArray(N * 4);
  const height = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const has = topH[i] >= 0;
    // surface height for the normal map: the round strand profile on its depth, gaps drop to 0
    height[i] = has ? 0.35 * topDepth[i] + 0.65 * prof[i] : 0;
    const ao = has ? Math.max(0, Math.min(1, (0.5 + 0.5 * Math.pow(topDepth[i], 0.6)) * (0.72 + 0.28 * prof[i]) - occ[i] * 1.6)) : 0.3;
    const o = i * 4;
    const ab = Math.round(ao * 255);
    gA[o] = ab; gA[o + 1] = ab; gA[o + 2] = ab; gA[o + 3] = 255;
    fA[o] = Math.round(tone[i] * 255);
    fA[o + 1] = Math.round((has ? topDepth[i] : 0) * 255);
    fA[o + 2] = Math.round(shift[i] * 255);
    fA[o + 3] = 255;
    const cb = Math.round(Math.min(1, cover[i]) * 255);
    aA[o] = cb; aA[o + 1] = cb; aA[o + 2] = cb; aA[o + 3] = 255;
    flA[o] = Math.round((fx[i] * 0.5 + 0.5) * 255);
    flA[o + 1] = Math.round((fy[i] * 0.5 + 0.5) * 255);
    flA[o + 2] = Math.round(sid[i] * 255);
    flA[o + 3] = Math.round(cid[i] * 255);
  }
  // tangent-space normal from the height field (x across tiles, y along clamps). Image rows run tip (top) to root
  // (bottom), so "along the card toward the tip" is -row.
  const kx = 3.0, ky = 0.6;
  for (let y = 0; y < H; y++) {
    const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W;
      const dX = (height[y * W + xp] - height[y * W + xm]) * kx;
      const dY = (height[ym * W + x] - height[yp * W + x]) * ky;
      let nx = -dX, ny = -dY, nz = 1;
      const il = 1 / Math.hypot(nx, ny, nz); nx *= il; ny *= il; nz *= il;
      const o = (y * W + x) * 4;
      nA[o] = Math.round((nx * 0.5 + 0.5) * 255); nA[o + 1] = Math.round((ny * 0.5 + 0.5) * 255); nA[o + 2] = Math.round((nz * 0.5 + 0.5) * 255); nA[o + 3] = 255;
    }
  }
  return { width: W, height: H, grooveAo: gA, flowId: fA, normal: nA, alphaCard: aA, flow: flA };
}
