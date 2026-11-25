import * as THREE from 'three';
import { bakeHairCards, cardBakeKey, resolveCardBake, type CardBakeSettings } from './cardBake';

/**
 * The strand maps every hair card samples, as raw RGBA8 pixels (row 0 = root, last row = tip; U tiles).
 * Built either procedurally (computeProceduralHairTextureData) or by rendering real strands (cardBake.ts).
 * Pure data, so the CPU preview, the Unity export and the browser all use the same pixels.
 */
export interface HairTextureData {
  width: number;
  height: number;
  grooveAo: Uint8ClampedArray; // R = strand AO (grooves, strands shadowing strands)
  flowId: Uint8ClampedArray; // R = per-strand tone/ID, G = depth (procedural: root-to-tip gradient), B = highlight shift
  normal: Uint8ClampedArray; // tangent-space normal (x across the card, y along it)
  alphaCard: Uint8ClampedArray; // R = coverage
  flow: Uint8ClampedArray; // RG = strand direction in card space (x across, y along; 0.5 = straight down the card)
}

/**
 * The strand maps a recipe's shader asks for: baked from strands (default, shader.cardBake settings) or the old
 * procedural maps (shader.cardTextures = 'procedural'). key changes only when the maps would change, so callers can
 * cache. Bakes are memoised per key.
 */
export function strandMapsKey(shader: { cardTextures?: string; cardBake?: Partial<CardBakeSettings> } | undefined): string {
  return shader?.cardTextures === 'procedural' ? 'procedural' : 'baked:' + cardBakeKey(resolveCardBake(shader?.cardBake));
}
const strandMapCache = new Map<string, HairTextureData>();
export function strandMapsFor(shader: { cardTextures?: string; cardBake?: Partial<CardBakeSettings> } | undefined): HairTextureData {
  const key = strandMapsKey(shader);
  let d = strandMapCache.get(key);
  if (!d) {
    d = key === 'procedural' ? computeProceduralHairTextureData() : bakeHairCards(shader?.cardBake);
    if (strandMapCache.size > 6) strandMapCache.clear();
    strandMapCache.set(key, d);
  }
  return d;
}

/** Flips an RGBA8 image top to bottom in place. */
export function flipRows(px: Uint8ClampedArray, width: number, height: number): void {
  const rowLen = width * 4, tmp = new Uint8ClampedArray(rowLen);
  for (let y = 0; y < height >> 1; y++) {
    const a = y * rowLen, b = (height - 1 - y) * rowLen;
    tmp.set(px.subarray(a, a + rowLen)); px.copyWithin(a, b, b + rowLen); px.set(tmp, b);
  }
}

/** A flow map with every strand running straight down the card (what the procedural pack implies). */
export function flatFlowMap(width: number, height: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { d[i * 4] = 128; d[i * 4 + 1] = 255; d[i * 4 + 2] = 128; d[i * 4 + 3] = 255; }
  return d;
}

export interface HairTexturePack {
  grooveAoCanvas: HTMLCanvasElement;
  flowIdCanvas: HTMLCanvasElement;
  normalCanvas: HTMLCanvasElement;
  alphaCardCanvas: HTMLCanvasElement;
  flowCanvas: HTMLCanvasElement;
  grooveAoTexture: THREE.CanvasTexture;
  flowIdTexture: THREE.CanvasTexture;
  normalTexture: THREE.CanvasTexture;
  alphaCardTexture: THREE.CanvasTexture;
  flowTexture: THREE.CanvasTexture;
  data: HairTextureData;
  dispose: () => void;
}

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Generates photorealistic fine-filament AAA Final Fantasy hair maps (512x1024):
 * - Groove AO Map: 112 fine overlapping silky hair strands + 280+ micro-filaments with gentle natural depth
 * - Flow / ID / Shift Map: R = per-filament tonal variation, G = root-to-tip gradient, B = anisotropic tangent shift
 * - Tangent-Space Normal Map: refined silky directional normals (zero harsh plastic ridges)
 * - Alpha Card / Wispy Tip Map: 100% solid core through v = 0.70, fraying cleanly ONLY at the tips into fine wisps
 */
export function computeProceduralHairTextureData(): HairTextureData {
  const width = 512;
  const height = 1024;

  const rand = seededRandom(519204);

  // 136 ultra-fine overlapping silky hair bundles tiled seamlessly across U (0..1)
  const strandCount = 136;
  interface SubStrand {
    centerU: number;
    halfWidth: number;
    heightScale: number;
    tone: number;
    shift: number;
    waveAmp: number;
    wavePhase: number;
    tipLength: number;
  }

  const subStrands: SubStrand[] = [];
  for (let i = 0; i < strandCount; i++) {
    const baseU = (i + 0.5) / strandCount;
    const isLongWisp = i % 5 === 0 || i % 9 === 0;
    const isMidWisp = i % 3 === 0;
    subStrands.push({
      centerU: baseU + (rand() - 0.5) * (0.34 / strandCount),
      halfWidth: (0.58 + rand() * 0.44) / strandCount,
      heightScale: 0.68 + rand() * 0.34,
      tone: 0.22 + rand() * 0.66,
      shift: 0.18 + rand() * 0.68,
      waveAmp: 0.0016 + rand() * 0.0032,
      wavePhase: rand() * Math.PI * 2,
      // Staggered wispy tips dissolve smoothly from v = 0.60..1.0 for authentic Luminous Engine feathered hair
      tipLength: isLongWisp
        ? 0.92 + rand() * 0.08
        : isMidWisp
          ? 0.78 + rand() * 0.14
          : 0.64 + rand() * 0.18,
    });
  }

  const heightField = new Float32Array(width * height);
  const gImg = { data: new Uint8ClampedArray(width * height * 4) };
  const fImg = { data: new Uint8ClampedArray(width * height * 4) };
  const nImg = { data: new Uint8ClampedArray(width * height * 4) };
  const aImg = { data: new Uint8ClampedArray(width * height * 4) };

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1); // 0 = root, 1 = tip
    const macroFlow = Math.sin(v * Math.PI * 1.35) * 0.004;
    const tipSoften = 1.0 - Math.pow(v, 3.4) * 0.14;

    for (let x = 0; x < width; x++) {
      const uBase = (x / width + macroFlow + 1.0) % 1.0;

      let maxH = 0.0;
      let winTone = 0.5;
      let winShift = 0.5;
      let maxAlpha = 0.0;

      const approxIdx = Math.floor(uBase * strandCount);
      for (let d = -2; d <= 2; d++) {
        const sIdx = (approxIdx + d + strandCount) % strandCount;
        const st = subStrands[sIdx];
        const sCenter = (st.centerU + Math.sin(v * Math.PI * 2.0 + st.wavePhase) * st.waveAmp + 1.0) % 1.0;

        let du = Math.abs(uBase - sCenter);
        if (du > 0.5) du = 1.0 - du;

        // Taper each individual hair filament smoothly along the outer 28% toward a razor-fine needle tip
        const tipProgress = THREE.MathUtils.clamp((v - (st.tipLength - 0.24)) / 0.24, 0, 1);
        const widthAtV = st.halfWidth * (1.0 - tipProgress * 0.82);
        const normDist = du / Math.max(0.00025, widthAtV);

        if (normDist < 1.0) {
          const profile = Math.sqrt(1.0 - normDist * normDist);
          const h = profile * st.heightScale;
          if (h > maxH) {
            maxH = h;
            winTone = st.tone;
            winShift = st.shift;
          }

          const vFade = 1.0 - THREE.MathUtils.smoothstep(v, st.tipLength - 0.09, st.tipLength + 0.01);
          const edgeAlpha = THREE.MathUtils.smoothstep(1.0, 0.22, normDist);
          const strandA = vFade * edgeAlpha;
          if (strandA > maxAlpha) maxAlpha = strandA;
        }
      }

      // Ultra-fine silky micro-hair filaments (280+ fine strands across U)
      const microA = 0.5 + 0.5 * Math.sin(uBase * Math.PI * 2.0 * 264.0 + Math.sin(v * 6.0) * 0.25);
      const microB = 0.5 + 0.5 * Math.sin(uBase * Math.PI * 2.0 * 412.0 + v * 4.0 + 1.3);
      const microCombo = microA * 0.62 + microB * 0.38;

      const finalH = THREE.MathUtils.clamp((maxH * 0.66 + microCombo * 0.34) * tipSoften, 0.0, 1.0);
      heightField[y * width + x] = finalH;

      // Rich velvety inter-strand AO (0.42..1.0 gives natural silky hair depth)
      const aoVal = THREE.MathUtils.clamp(0.42 + Math.pow(finalH, 0.74) * 0.58, 0.0, 1.0);
      const idx = (y * width + x) * 4;

      const aoByte = Math.round(aoVal * 255);
      gImg.data[idx] = aoByte;
      gImg.data[idx + 1] = aoByte;
      gImg.data[idx + 2] = aoByte;
      gImg.data[idx + 3] = 255;

      const idByte = Math.round(
        THREE.MathUtils.clamp(winTone * 0.55 + microCombo * 0.27 + finalH * 0.18, 0, 1) * 255
      );
      const gradByte = Math.round(v * 255);
      const shiftByte = Math.round(
        THREE.MathUtils.clamp(winShift * 0.65 + microA * 0.25 + Math.sin(v * 8.0 + uBase * 44.0) * 0.06 + 0.07, 0, 1) *
          255
      );

      fImg.data[idx] = idByte;
      fImg.data[idx + 1] = gradByte;
      fImg.data[idx + 2] = shiftByte;
      fImg.data[idx + 3] = 255;

      // Solid core through v < 0.58 (zero scalp holes), then splits into delicate wispy micro-strands!
      const coreSolid = 1.0 - THREE.MathUtils.smoothstep(v, 0.56, 0.68);
      const fineWisp = maxAlpha * (0.72 + 0.28 * microA);
      const finalAlpha = THREE.MathUtils.clamp(Math.max(coreSolid, fineWisp), 0.0, 1.0);
      const alphaByte = Math.round(finalAlpha * 255);
      aImg.data[idx] = alphaByte;
      aImg.data[idx + 1] = alphaByte;
      aImg.data[idx + 2] = alphaByte;
      aImg.data[idx + 3] = 255;
    }
  }

  // Soft silky Tangent-Space Normal Map (no plastic rope ridges)
  const normalStrength = 2.6;
  for (let y = 0; y < height; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const xm = (x - 1 + width) % width;
      const xp = (x + 1) % width;

      const dX = (heightField[y * width + xp] - heightField[y * width + xm]) * normalStrength;
      const dY = (heightField[yp * width + x] - heightField[ym * width + x]) * (normalStrength * 0.25);

      let nx = -dX;
      let ny = -dY;
      let nz = 1.0;
      const invLen = 1.0 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx = (y * width + x) * 4;
      nImg.data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      nImg.data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      nImg.data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      nImg.data[idx + 3] = 255;
    }
  }

  // The loops above write the root at row 0, but three.js (flipY) and Unity both sample v = 0 from the BOTTOM row, so the
  // maps were read upside down: tip wisps sat at the root (where the shader ignores alpha) and the tips got the solid root
  // rows. Flip to the GL convention every strand map now uses (cardBake.ts writes it directly).
  for (const px of [gImg.data, fImg.data, nImg.data, aImg.data]) flipRows(px, width, height);
  // the normal map's y (along the card) was computed root->tip in row order; after the flip it must point the other way
  for (let i = 0; i < width * height; i++) nImg.data[i * 4 + 1] = 255 - nImg.data[i * 4 + 1];
  return { width, height, grooveAo: gImg.data, flowId: fImg.data, normal: nImg.data, alphaCard: aImg.data, flow: flatFlowMap(width, height) };
}

/** Browser wrapper: puts the strand maps on canvases and three.js textures (U repeats, V clamps). */
export function createHairTexturePack(maxAnisotropy = 4, data: HairTextureData = computeProceduralHairTextureData()): HairTexturePack {
  const { width, height } = data;
  const toCanvas = (px: Uint8ClampedArray) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(width, height);
    img.data.set(px);
    ctx.putImageData(img, 0, 0);
    return canvas;
  };
  const grooveAoCanvas = toCanvas(data.grooveAo);
  const flowIdCanvas = toCanvas(data.flowId);
  const normalCanvas = toCanvas(data.normal);
  const alphaCardCanvas = toCanvas(data.alphaCard);
  const flowCanvas = toCanvas(data.flow);

  const makeTex = (canvas: HTMLCanvasElement, repeatX: boolean) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = repeatX ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = maxAnisotropy;
    tex.needsUpdate = true;
    return tex;
  };

  const grooveAoTexture = makeTex(grooveAoCanvas, true);
  const flowIdTexture = makeTex(flowIdCanvas, true);
  const normalTexture = makeTex(normalCanvas, true);
  const alphaCardTexture = makeTex(alphaCardCanvas, true);
  const flowTexture = makeTex(flowCanvas, true);

  return {
    grooveAoCanvas,
    flowIdCanvas,
    normalCanvas,
    alphaCardCanvas,
    flowCanvas,
    grooveAoTexture,
    flowIdTexture,
    normalTexture,
    alphaCardTexture,
    flowTexture,
    data,
    dispose: () => {
      grooveAoTexture.dispose();
      flowIdTexture.dispose();
      normalTexture.dispose();
      alphaCardTexture.dispose();
      flowTexture.dispose();
    },
  };
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode PNG texture'));
    }, 'image/png');
  });
}
