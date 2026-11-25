import * as THREE from 'three';
import { BackdropMode, LightingPresetId, ShaderConfig, VisionDebugMode } from '../types/hair';
import { HairTexturePack } from './hairTextures';

export interface LightingRigSpec {
  bgHex: string;
  fogHex: string;
  keyColor: string;
  keyDir: [number, number, number];
  keyIntensity: number;
  fillColor: string;
  fillDir: [number, number, number];
  fillIntensity: number;
  rimColor: string;
  rimDir: [number, number, number];
  rimIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
}

export const LIGHTING_RIGS: Record<LightingPresetId, LightingRigSpec> = {
  studio: {
    bgHex: '#3a3b3f',
    fogHex: '#3a3b3f',
    keyColor: '#fff9f0',
    keyDir: [1.7, 3.8, 3.2],
    keyIntensity: 2.55,
    fillColor: '#dfe7f2',
    fillDir: [-2.8, 1.8, 2.4],
    fillIntensity: 1.38,
    rimColor: '#f5efe6',
    rimDir: [-1.1, 2.4, -3.2],
    rimIntensity: 1.78,
    hemiSky: '#dde2ea',
    hemiGround: '#4a4642',
    hemiIntensity: 1.12,
  },
  midgar: {
    bgHex: '#202633',
    fogHex: '#202633',
    keyColor: '#ffecd0',
    keyDir: [2.4, 3.5, 3.2],
    keyIntensity: 2.35,
    fillColor: '#9dbbe0',
    fillDir: [-3.0, 1.6, 2.0],
    fillIntensity: 1.18,
    rimColor: '#a6d6fa',
    rimDir: [-1.4, 2.3, -3.4],
    rimIntensity: 1.85,
    hemiSky: '#a8bdd9',
    hemiGround: '#2d313d',
    hemiIntensity: 0.96,
  },
  sunset: {
    bgHex: '#382c2c',
    fogHex: '#382c2c',
    keyColor: '#ffc98f',
    keyDir: [3.2, 2.5, 2.6],
    keyIntensity: 2.48,
    fillColor: '#b4a8cf',
    fillDir: [-2.8, 1.9, 2.0],
    fillIntensity: 1.15,
    rimColor: '#ffa66b',
    rimDir: [-1.6, 2.1, -3.1],
    rimIntensity: 1.85,
    hemiSky: '#d9b29c',
    hemiGround: '#3d3035',
    hemiIntensity: 1.0,
  },
};

export const VISION_DEBUG_MODE_INDEX: Record<VisionDebugMode, number> = {
  shaded: 0,
  zones: 1,
  clearance: 2,
  normals: 3,
  uv: 4,
  silhouette: 5,
  motion: 6,
};

export function resolveBackdropHex(lightingId: LightingPresetId, backdrop: BackdropMode): string {
  if (backdrop === 'matte-gray') return '#4b4e54';
  if (backdrop === 'high-contrast') return '#07090d';
  if (backdrop === 'chroma-green') return '#14b84a';
  return LIGHTING_RIGS[lightingId].bgHex;
}

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 aHairTangent;
  attribute vec3 aHeadNormal;
  attribute float aStrandSeed;
  attribute float aLayerAO;
  attribute float aCardMask;
  attribute float aClearance;
  attribute float aScalpRoot;
  attribute float aGradT;
  attribute float aInstability;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldHeadNormal;
  varying vec3 vWorldTangent;
  varying vec3 vWorldPos;
  varying float vStrandSeed;
  varying float vLayerAO;
  varying float vCardMask;
  varying float vClearance;
  varying float vScalpRoot;
  varying float vGradT;
  varying float vInstability;

  void main() {
    vUv = uv;
    vStrandSeed = aStrandSeed;
    vLayerAO = aLayerAO;
    vCardMask = aCardMask;
    vClearance = aClearance;
    vScalpRoot = aScalpRoot;
    vGradT = aGradT;
    vInstability = aInstability;

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;

    mat3 normalMat = mat3(modelMatrix);
    vWorldNormal = normalize(normalMat * normal);
    vWorldHeadNormal = normalize(normalMat * aHeadNormal);
    vWorldTangent = normalize(normalMat * aHairTangent);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uGrooveAoMap;
  uniform sampler2D uFlowIdMap;
  uniform sampler2D uNormalMap;
  uniform sampler2D uAlphaMap;

  uniform vec3 uRootColor;
  uniform vec3 uBaseColor;
  uniform vec3 uTipColor;
  uniform vec3 uPrimarySpecColor;
  uniform vec3 uSecondarySpecColor;

  uniform float uPrimaryShift;
  uniform float uPrimaryPower;
  uniform float uPrimaryIntensity;
  uniform float uSecondaryShift;
  uniform float uSecondaryPower;
  uniform float uSecondaryIntensity;

  uniform float uRimIntensity;
  uniform float uRimPower;
  uniform float uRootAO;
  uniform float uGrooveDepth;
  uniform float uStrandVariation;
  uniform float uFadeOpacity;
  uniform float uFadeSoftness;
  uniform float uFadeReach;
  uniform float uSheenBand;
  uniform float uSheenPower;
  uniform float uShadowLift;
  uniform float uClumpVariation;
  uniform float uTipLighten;
  uniform float uDebugMode;

  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform vec3 uFillDir;
  uniform vec3 uFillColor;
  uniform vec3 uRimDir;
  uniform vec3 uRimColor;
  uniform vec3 uAmbientColor;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldHeadNormal;
  varying vec3 vWorldTangent;
  varying vec3 vWorldPos;
  varying float vStrandSeed;
  varying float vLayerAO;
  varying float vCardMask;
  varying float vClearance;
  varying float vScalpRoot;
  varying float vGradT;
  varying float vInstability;

  vec3 shiftTangent(vec3 T, vec3 N, float shift) {
    return normalize(T + N * shift);
  }

  float strandSpecular(vec3 T, vec3 V, vec3 L, float exponent) {
    vec3 H = normalize(L + V);
    float dotTH = dot(T, H);
    float sinTH = sqrt(max(0.0001, 1.0 - dotTH * dotTH));
    float dirAtten = smoothstep(-1.0, 0.0, dotTH);
    return dirAtten * pow(sinTH, exponent);
  }

  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  // 0 until the fade starts, then 0..1 toward the hairline (mirrors AetherFadeU in the Unity shader)
  float fadeU(float a, float t) {
    float fs = abs(a - 0.25) < 0.002 ? 0.25 : clamp((a - 0.16) / 0.28, 0.0, 1.0);
    fs = fs < 0.9 ? min(fs, uFadeReach) : fs;
    return smoothstep(fs, 1.0, t);
  }

  void main() {
    float t = clamp(vUv.y, 0.0, 1.0);

    // Mode 1: isFadeCap dithered-opaque fade: solid before the fade starts, mostly opaque (uFadeOpacity) through it, fine dither only in the last uFadeSoftness
    bool isFadeCap = vCardMask > 0.15 && vCardMask < 0.45;
    float fadeU0 = isFadeCap ? fadeU(vCardMask, t) : 0.0;
    if (isFadeCap) {
      float fadeTail = smoothstep(1.0 - clamp(uFadeSoftness, 0.0, 1.0), 1.0, fadeU0);
      float fadeCov = mix(1.0, uFadeOpacity * (1.0 - 0.45 * fadeU0), smoothstep(0.0, 0.2, fadeU0)) * (1.0 - fadeTail);
      float fadeIgn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float fadeWn = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
      if (fadeCov - mix(fadeIgn, fadeWn, 0.45) < 0.0) discard;
    }

    // Fine realistic multi-filament UVs scaled for slender sculpted 3D locks
    vec2 sampleUv = vec2(vUv.x * 0.92 + vStrandSeed * 3.13, t);

    // Feathered Multi-Filament Tip Cutout:
    // Inner foundation shell (vCardMask < 0.5) stays 100% solid; outer locks stay cohesive
    // across root->mid-body and dissolve cleanly into fine individual hair wisps across the outer 42% tip!
    if (vCardMask > 0.5 && t > 0.58) {
      float strandAlpha = texture2D(uAlphaMap, sampleUv).r;
      float edgeDist = min(abs(vUv.x - 0.34), abs(vUv.x - 0.66));
      float lateralFray = smoothstep(0.0, 0.075, edgeDist);
      float tipRamp = smoothstep(0.58, 0.98, t);
      float combinedAlpha = strandAlpha * mix(1.0, 0.44 + 0.56 * lateralFray, tipRamp);
      if (combinedAlpha < 0.36) discard;
    }

    vec3 lockN = normalize(vWorldNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 headN = normalize(vWorldHeadNormal);
    vec3 baseN = normalize(mix(lockN, headN, 0.42));

    // AI Vision Diagnostic Render Modes (Bypass PBR lighting for crisp machine/artist inspection)
    if (uDebugMode > 0.5) {
      float ndlDiag = 0.52 + 0.48 * clamp(dot(lockN, normalize(uKeyDir)) * 0.5 + 0.5, 0.0, 1.0);

      // Mode 1: Strand ID / Base-Shell Zone Separation
      if (uDebugMode < 1.5) {
        float hue = fract(vStrandSeed * 7.618 + (vCardMask < 0.5 ? 0.58 : 0.0));
        float sat = vCardMask < 0.5 ? 0.25 : 0.72;
        float val = vCardMask < 0.5 ? 0.34 : (0.58 + 0.32 * t);
        vec3 col = hsv2rgb(vec3(hue, sat, val)) * ndlDiag;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        return;
      }

      // Mode 2: Analytical Skull Clearance Heatmap (Red = clipping < 0mm, Amber = tight 0..3mm, Emerald = clean 3..14mm, Slate = free tips)
      if (uDebugMode < 2.5) {
        float mm = vClearance * 318.0;
        vec3 col;
        if (mm < 0.0) {
          col = vec3(1.0, 0.14, 0.14);
        } else if (mm < 3.0) {
          col = mix(vec3(1.0, 0.45, 0.08), vec3(0.95, 0.82, 0.15), clamp(mm / 3.0, 0.0, 1.0));
        } else if (mm < 14.0) {
          col = mix(vec3(0.18, 0.84, 0.50), vec3(0.16, 0.58, 0.86), clamp((mm - 3.0) / 11.0, 0.0, 1.0));
        } else {
          col = vec3(0.32, 0.42, 0.58);
        }
        gl_FragColor = vec4(col * (0.68 + 0.32 * ndlDiag), 1.0);
        #include <colorspace_fragment>
        return;
      }

      // Mode 3: World Normals (flags flipped blades, kinks & normal discontinuities)
      if (uDebugMode < 3.5) {
        vec3 nCol = lockN * 0.5 + 0.5;
        gl_FragColor = vec4(nCol, 1.0);
        #include <colorspace_fragment>
        return;
      }

      // Mode 4: Root-to-Tip UV Flow + 10% Segment Isolines (exposes accordion buckling immediately)
      if (uDebugMode < 4.5) {
        vec3 ramp = mix(vec3(0.12, 0.25, 0.85), vec3(0.98, 0.72, 0.16), t);
        float stripe = smoothstep(0.04, 0.0, abs(fract(t * 10.0) - 0.5) - 0.44);
        vec3 col = mix(ramp * ndlDiag, vec3(0.04, 0.05, 0.08), stripe * 0.65);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        return;
      }

      // Mode 5: High-Contrast Silhouette Matte (chalk contour for exact reference comparison)
      if (uDebugMode < 5.5) {
        float edgeShade = 0.78 + 0.22 * clamp(dot(baseN, normalize(cameraPosition - vWorldPos)), 0.0, 1.0);
        gl_FragColor = vec4(vec3(0.92 * edgeShade), 1.0);
        #include <colorspace_fragment>
        return;
      }

      // Mode 6: Temporal Bounce & Inter-Lock Contact Heatmap
      // Deep teal = calm stable flow, Cyan-green = healthy sway, Amber = lock-to-lock contact, Magenta-red = bounce/oscillation!
      float inst = clamp(vInstability, 0.0, 1.0);
      vec3 mCol;
      if (inst < 0.35) {
        mCol = mix(vec3(0.10, 0.36, 0.54), vec3(0.16, 0.80, 0.62), inst / 0.35);
      } else if (inst < 0.7) {
        mCol = mix(vec3(0.16, 0.80, 0.62), vec3(0.98, 0.76, 0.14), (inst - 0.35) / 0.35);
      } else {
        mCol = mix(vec3(0.98, 0.76, 0.14), vec3(1.0, 0.12, 0.42), (inst - 0.7) / 0.3);
      }
      gl_FragColor = vec4(mCol * (0.68 + 0.32 * ndlDiag), 1.0);
      #include <colorspace_fragment>
      return;
    }

    float grooveAo = texture2D(uGrooveAoMap, sampleUv).r;
    vec3 flowId = texture2D(uFlowIdMap, sampleUv).rgb;
    vec3 normalTex = texture2D(uNormalMap, sampleUv).rgb * 2.0 - 1.0;

    vec3 T = normalize(vWorldTangent);
    vec3 B = normalize(cross(baseN, T));

    // Silky micro-filament normal perturbation
    vec3 perturbedN = normalize(baseN + B * normalTex.x * (0.32 * uGrooveDepth) + T * normalTex.y * 0.05);
    vec3 V = normalize(cameraPosition - vWorldPos);

    // Smooth 3-Stop Root -> Base -> Tip Gradient:
    // Full dark root shadow only on true scalp/hairline roots (vScalpRoot = 1.0); shingled mid-back tiers blend seamlessly!
    // the colour gradient runs on aGradT (= uv.y unless the lock shows only part of it: LockBuildSpec.colorRange)
    float gt = clamp(vGradT, 0.0, 1.0);
    vec3 effRootColor = mix(uBaseColor, uRootColor, vScalpRoot);
    vec3 gradColor = gt < 0.28
      ? mix(effRootColor, uBaseColor, smoothstep(0.0, 0.28, gt))
      : mix(uBaseColor, uTipColor, smoothstep(0.28, 1.0, gt));

    // Natural multi-filament tonal variation
    float fiberTone = (flowId.r - 0.5) * 0.92 + (vStrandSeed - 0.5) * 0.32;
    vec3 albedo = clamp(gradColor * (1.0 + fiberTone * uStrandVariation), 0.0, 1.2);
    // Fade caps: dark hair colour between root and base, easing to a lighter desaturated stubble tone (never toward the tip colour or white)
    float fadeMask = isFadeCap ? smoothstep(0.0, 0.3, fadeU0) : 0.0;
    if (fadeMask > 0.0) {
      vec3 fadeDark = mix(uRootColor, uBaseColor, 0.5);
      vec3 stubble = mix(fadeDark, vec3(dot(fadeDark, vec3(0.3333)) * 1.15), 0.35);
      vec3 fadeAlbedo = mix(fadeDark, stubble, smoothstep(0.35, 1.0, t)) * (1.0 + fiberTone * uStrandVariation * 0.5);
      albedo = mix(albedo, fadeAlbedo, fadeMask);
    }
    // Game-style look: per-clump brightness/warmth variation (one value per lock via the seed) plus lighter tips
    float clumpTone = fract(vStrandSeed * 41.7 + 0.31) * 2.0 - 1.0;
    albedo *= 1.0 + clumpTone * uClumpVariation * (1.0 - fadeMask);
    albedo *= mix(vec3(1.0), vec3(1.07, 1.0, 0.93), clamp(clumpTone * 0.5 + 0.5, 0.0, 1.0) * uClumpVariation * (1.0 - fadeMask));
    albedo *= 1.0 + uTipLighten * smoothstep(0.5, 1.0, t) * (1.0 - fadeMask);

    // Deep root & layered inter-clump AO for authentic velvet FFXV hair volume (no horizontal mid-tier root bars!)
    float rootOcclusion = mix(1.0 - uRootAO * 0.72 * vScalpRoot, 1.0, smoothstep(0.0, 0.22, t));
    float grooveCrevice = mix(1.0, grooveAo, uGrooveDepth * 0.68);
    float domeGrad = mix(0.84, 1.08, smoothstep(-0.55, 0.68, headN.y));
    float totalAO = rootOcclusion * grooveCrevice * mix(0.72, 1.04, vLayerAO) * domeGrad;
    totalAO *= mix(1.0, 0.9, t * fadeMask); // fade stays dark (no lift toward white)

    // Balanced 360-degree Studio Softbox Diffuse with rich shadow depth
    vec3 LKey = normalize(uKeyDir);
    vec3 LFill = normalize(uFillDir);
    vec3 LRim = normalize(uRimDir);

    float ndlKey = clamp((dot(perturbedN, LKey) + 0.46) / 1.46, 0.0, 1.0);
    float ndlFill = clamp((dot(perturbedN, LFill) + 0.48) / 1.48, 0.0, 1.0);
    float ndlBack = clamp((dot(perturbedN, LRim) + 0.46) / 1.46, 0.0, 1.0);
    float skyLift = clamp(baseN.y * 0.5 + 0.5, 0.0, 1.0);

    // Shadow lift: AO only partly darkens, plus a little ambient fill, so shaded hair stays coloured instead of muddy
    float aoD = mix(totalAO, 1.0, uShadowLift * (1.0 - fadeMask));
    vec3 diffuse = albedo * (
      uAmbientColor * (0.42 + 0.24 * skyLift + 0.16 * uShadowLift * (1.0 - fadeMask)) +
      uKeyColor * ndlKey * 0.88 +
      uFillColor * ndlFill * 0.40 +
      uRimColor * ndlBack * 0.56
    ) * aoD;

    // Velvety Multi-Strand Kajiya-Kay Dual-Lobe Anisotropic Specular (silky natural sheen, zero plastic glare)
    float shiftTex = (flowId.b - 0.5) * 0.38 + (vStrandSeed - 0.5) * 0.12;
    vec3 t1 = shiftTangent(T, perturbedN, uPrimaryShift + shiftTex);
    vec3 t2 = shiftTangent(T, perturbedN, uSecondaryShift + shiftTex * 1.2);

    float fiberCrest = smoothstep(0.42, 0.92, grooveAo);
    float microGlint = 0.74 + 0.26 * smoothstep(0.28, 0.86, flowId.r);
    // (no highlight on a root at the skin; a lock with a light root (scalpRoot < 0.5) lies on other hair and keeps its
    // highlight to the root, so a root left uncovered at a crop's edge isn't a dark dash)
    float specMask = mix(1.0, smoothstep(0.08, 0.24, t), smoothstep(0.0, 0.5, vScalpRoot)) * (0.24 + 0.76 * fiberCrest) * microGlint * mix(0.62, 1.0, vLayerAO) * mix(1.0, 0.35, fadeMask);
    float keyFacing = smoothstep(-0.14, 0.48, dot(baseN, LKey));
    float backFacing = smoothstep(-0.14, 0.48, dot(baseN, LRim));

    float spec1 = strandSpecular(t1, V, LKey, uPrimaryPower) * uPrimaryIntensity;
    float spec2 = strandSpecular(t2, V, LKey, uSecondaryPower) * uSecondaryIntensity;
    float backSpec = strandSpecular(t1, V, LRim, uPrimaryPower * 0.78) * uPrimaryIntensity * 0.54;

    // Albedo-harmonized soft silk sheen
    vec3 spec1Tint = mix(albedo * 1.55, uPrimarySpecColor, 0.48);
    vec3 spec2Tint = mix(albedo * 1.35, uSecondarySpecColor, 0.48);

    vec3 specular = (
      (spec1Tint * spec1 * 0.56 + spec2Tint * spec2 * 0.44) * uKeyColor * keyFacing +
      spec1Tint * backSpec * uRimColor * backFacing
    ) * specMask * rootOcclusion;

    // Soft wide anisotropic sheen band (third Kajiya-Kay lobe, smooth mask: no per-fibre striping)
    vec3 tS = shiftTangent(T, perturbedN, 0.02 + shiftTex * 0.5);
    float sheenMask = smoothstep(0.08, 0.30, t) * (0.7 + 0.3 * fiberCrest) * mix(0.6, 1.0, vLayerAO) * (1.0 - fadeMask);
    vec3 sheenTint = mix(albedo * 2.4, uPrimarySpecColor, 0.40);
    specular += sheenTint * sheenMask * uSheenBand * (
      strandSpecular(tS, V, LKey, uSheenPower) * uKeyColor * keyFacing +
      strandSpecular(tS, V, LRim, uSheenPower) * uRimColor * backFacing * 0.6);

    // Marschner-style Rim & Feathered Tip Ash-Translucency Separation
    float fresnel = pow(1.0 - max(0.0, dot(baseN, V)), uRimPower);
    float backGate = pow(max(0.0, dot(V, -LRim)), 1.4) * 0.45 + 0.55;
    float tipWeight = mix(0.22, 1.0, smoothstep(0.28, 0.94, t));
    vec3 rimTint = mix(albedo * 1.65, uRimColor, 0.30);
    vec3 rimScatter = rimTint * fresnel * backGate * tipWeight * uRimIntensity * 0.42 * mix(0.72, 1.0, vLayerAO) * mix(1.0, 0.3, fadeMask);

    vec3 finalColor = diffuse + specular + rimScatter;

    gl_FragColor = vec4(finalColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createHairShaderMaterial(
  textures: HairTexturePack,
  config: ShaderConfig,
  lightingId: LightingPresetId,
  debugMode: VisionDebugMode = 'shaded'
): THREE.ShaderMaterial {
  const rig = LIGHTING_RIGS[lightingId];

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    uniforms: {
      uGrooveAoMap: { value: textures.grooveAoTexture },
      uFlowIdMap: { value: textures.flowIdTexture },
      uNormalMap: { value: textures.normalTexture },
      uAlphaMap: { value: textures.alphaCardTexture },

      uRootColor: { value: new THREE.Color(config.rootColor) },
      uBaseColor: { value: new THREE.Color(config.baseColor) },
      uTipColor: { value: new THREE.Color(config.tipColor) },
      uPrimarySpecColor: { value: new THREE.Color(config.primarySpecColor) },
      uSecondarySpecColor: { value: new THREE.Color(config.secondarySpecColor) },

      uPrimaryShift: { value: config.primaryShift },
      uPrimaryPower: { value: config.primaryPower },
      uPrimaryIntensity: { value: config.primaryIntensity },
      uSecondaryShift: { value: config.secondaryShift },
      uSecondaryPower: { value: config.secondaryPower },
      uSecondaryIntensity: { value: config.secondaryIntensity },

      uRimIntensity: { value: config.rimIntensity },
      uRimPower: { value: config.rimPower },
      uRootAO: { value: config.rootAO },
      uGrooveDepth: { value: config.grooveDepth },
      uStrandVariation: { value: config.strandVariation },
      uFadeOpacity: { value: 0.85 },
      uFadeSoftness: { value: 0.85 },
      uFadeReach: { value: 0.45 },
      uSheenBand: { value: 0.30 },
      uSheenPower: { value: 14.0 },
      uShadowLift: { value: 0.30 },
      uClumpVariation: { value: 0.20 },
      uTipLighten: { value: 0.12 },
      uDebugMode: { value: VISION_DEBUG_MODE_INDEX[debugMode] },

      uKeyDir: { value: new THREE.Vector3(...rig.keyDir).normalize() },
      uKeyColor: { value: new THREE.Color(rig.keyColor).multiplyScalar(rig.keyIntensity * 0.42) },
      uFillDir: { value: new THREE.Vector3(...rig.fillDir).normalize() },
      uFillColor: { value: new THREE.Color(rig.fillColor).multiplyScalar(rig.fillIntensity * 0.38) },
      uRimDir: { value: new THREE.Vector3(...rig.rimDir).normalize() },
      uRimColor: { value: new THREE.Color(rig.rimColor).multiplyScalar(rig.rimIntensity * 0.42) },
      uAmbientColor: { value: new THREE.Color(rig.hemiSky).multiplyScalar(rig.hemiIntensity * 0.48) },
    },
  });

  return material;
}

export function syncHairShaderUniforms(
  material: THREE.ShaderMaterial,
  config: ShaderConfig,
  lightingId: LightingPresetId,
  debugMode: VisionDebugMode = 'shaded'
): void {
  const u = material.uniforms;
  const rig = LIGHTING_RIGS[lightingId];

  u.uRootColor.value.set(config.rootColor);
  u.uBaseColor.value.set(config.baseColor);
  u.uTipColor.value.set(config.tipColor);
  u.uPrimarySpecColor.value.set(config.primarySpecColor);
  u.uSecondarySpecColor.value.set(config.secondarySpecColor);

  u.uPrimaryShift.value = config.primaryShift;
  u.uPrimaryPower.value = config.primaryPower;
  u.uPrimaryIntensity.value = config.primaryIntensity;
  u.uSecondaryShift.value = config.secondaryShift;
  u.uSecondaryPower.value = config.secondaryPower;
  u.uSecondaryIntensity.value = config.secondaryIntensity;

  u.uRimIntensity.value = config.rimIntensity;
  u.uRimPower.value = config.rimPower;
  u.uRootAO.value = config.rootAO;
  u.uGrooveDepth.value = config.grooveDepth;
  u.uStrandVariation.value = config.strandVariation;
  u.uDebugMode.value = VISION_DEBUG_MODE_INDEX[debugMode];

  u.uKeyDir.value.set(...rig.keyDir).normalize();
  u.uKeyColor.value.set(rig.keyColor).multiplyScalar(rig.keyIntensity * 0.42);
  u.uFillDir.value.set(...rig.fillDir).normalize();
  u.uFillColor.value.set(rig.fillColor).multiplyScalar(rig.fillIntensity * 0.38);
  u.uRimDir.value.set(...rig.rimDir).normalize();
  u.uRimColor.value.set(rig.rimColor).multiplyScalar(rig.rimIntensity * 0.42);
  u.uAmbientColor.value.set(rig.hemiSky).multiplyScalar(rig.hemiIntensity * 0.48);
}
