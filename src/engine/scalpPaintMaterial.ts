// Web viewport rendering of the scalp paint (scalpPaint.ts): a thin transparent overlay drawn on the head surfaces,
// coloured like the hair roots, opaque where the paint is full and stippled (stubble) where it fades.
// The paint curves live in a SCALP_PAINT_BINS x 1 float texture (R = fullPhi, G = edgePhi, B = edgeDensity) sampled with linear
// filtering and wrap, so azimuth interpolation matches evalScalpPaint.
import * as THREE from 'three';
import { SCALP_PAINT_BINS, binAzimuth, sampleArr, scalpPaintColor, type ScalpPaint } from './scalpPaint';

const vert = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  uniform float uLift;
  void main() {
    vLocal = position;
    vec3 p = position + normal * uLift;
    vec4 w = modelMatrix * vec4(p, 1.0);
    vPosW = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const frag = /* glsl */ `
  uniform sampler2D uCurves;
  uniform float uFeather;
  uniform float uDensity;
  uniform float uGrain;
  uniform vec3 uColor;
  uniform vec3 uHeadCenter;
  uniform vec3 uRadii;
  uniform vec3 uLightDir;
  uniform float uIrreg;
  uniform float uUnderShade;
  uniform float uGrainStretch;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  // mirrors paintHash / hairlineJag in scalpPaint.ts
  float h11(float i) { float t = fract(i * 0.1031); t *= t + 33.33; t *= t + t; return fract(t); }
  float vnoise(float az, float cells) {
    float x = (az + 3.14159265) / 6.2831853 * cells;
    float i = floor(x), f = x - i;
    float a = h11(mod(i, cells)), b = h11(mod(i + 1.0, cells));
    return mix(a, b, f * f * (3.0 - 2.0 * f));
  }
  // paintFibreAlpha (scalpPaint.ts): directional short-hair fibres, two octaves; fwAz = seam-safe fwidth(az)
  float bandCov(float d, float hw, float r) { return clamp((min(d + r, hw) - max(d - r, -hw)) / (2.0 * r), 0.0, 1.0); }
  float fibreOctave(float az, float phi, float dens, float grain, float freq, float stretch, float stagAmp,
                    float w0, float w1, float d0, float d1, float c1, vec3 kA, vec2 kB, float fwLane) {
    float x = az * freq, lane = floor(x), f = x - lane;
    float row = floor(phi * (freq / stretch) + h11(lane * kA.x + kA.y) * kA.z);
    float stag = h11(lane * kB.x + row * kB.y);
    float localD = clamp(dens + (stag - 0.5) * stagAmp * grain, 0.0, 1.0);
    float hw = mix(w0, w1, smoothstep(d0, d1, localD));
    float r = max(0.08, fwLane * 0.5);
    float fib = r < 0.5 ? bandCov(abs(f - 0.5), hw, r) : 2.0 * hw;
    float lanes = mix(fib, 2.0 * hw, smoothstep(0.35, 0.5, r));
    return lanes * smoothstep(0.02, c1, localD);
  }
  float paintFibreAlpha(float az, float phi, float dens, float grain, float stretch, float fwAz) {
    if (dens <= 0.002) return 0.0;
    if (dens >= 0.995) return 1.0;
    float st = max(2.0, stretch);
    float c1 = fibreOctave(az, phi, dens, grain, 260.0, st, 0.34, 0.14, 0.5, 0.05, 0.85, 0.28, vec3(2.91, 37.3, 4.0), vec2(3.17, 17.13), fwAz * 260.0);
    float c2 = fibreOctave(az, phi, dens, grain, 680.0, st * 1.25, 0.38, 0.12, 0.48, 0.04, 0.82, 0.24, vec3(4.13, 19.1, 6.0), vec2(5.71, 23.41), fwAz * 680.0);
    float base = pow(dens, 0.9);
    return clamp(mix(base, mix(c1, c2, 0.45), min(0.85, grain * 0.78)), 0.0, 1.0);
  }
  // paintRamp (scalpPaint.ts): one smooth monotone curve 1 -> ed (at edge) -> 0 (at edge + feather), no plateau at ed
  float paintRamp(float phi, float full, float edge, float ed, float feather) {
    if (phi <= full) return 1.0;
    float x2 = edge + max(1e-4, feather);
    if (phi >= x2) return 0.0;
    float h0 = max(1e-4, edge - full), h1 = x2 - edge;
    float s0 = (ed - 1.0) / h0, s1 = -ed / h1;
    float m1 = (s0 < 0.0 && s1 < 0.0) ? 2.0 * s0 * s1 / (s0 + s1) : 0.0;
    float t, ya, yb, ma, mb, h;
    if (phi <= edge) { t = (phi - full) / h0; ya = 1.0; yb = ed; ma = 0.0; mb = m1; h = h0; }
    else { t = (phi - edge) / h1; ya = ed; yb = 0.0; ma = m1; mb = 0.0; h = h1; }
    float t2 = t * t, t3 = t2 * t;
    return clamp((2.0 * t3 - 3.0 * t2 + 1.0) * ya + (t3 - 2.0 * t2 + t) * h * ma + (-2.0 * t3 + 3.0 * t2) * yb + (t3 - t2) * h * mb, 0.0, 1.0);
  }
  void main() {
    vec3 d = (vLocal - uHeadCenter) / uRadii;
    float r = length(d);
    float az = atan(d.x, d.z);
    float phi = acos(clamp(d.y / r, -1.0, 1.0));
    // seam-safe azimuth footprint (az jumps by 2 pi at the back), taken before any discard
    float fwAz = min(fwidth(az), fwidth(mod(az + 6.2831853, 6.2831853)));
    phi -= uIrreg * 0.008 * (vnoise(az, 28.0) - 0.5) * 2.0; // hairlineJag
    vec3 c = texture2D(uCurves, vec2((az + 3.14159265) / 6.2831853, 0.5)).rgb;
    float full = c.r, edge = max(c.r + 1e-4, c.g), ed = c.b;
    float dens = paintRamp(phi, full, edge, ed, uFeather) * uDensity;
    if (dens < 0.002) discard;
    float a = paintFibreAlpha(az, phi, dens, uGrain, uGrainStretch, fwAz);
    if (a < 0.004) discard;
    float ndl = clamp(dot(normalize(vNormalW), normalize(uLightDir)) * 0.5 + 0.6, 0.35, 1.0);
    // paintStreak: short strands combed along phi
    float ia = floor((az + 3.14159265) / 0.006);
    float sy = phi / 0.03, ib = floor(sy), sf = sy - ib;
    float streak = mix(h11(ia * 157.0 + ib * 113.0), h11(ia * 157.0 + (ib + 1.0) * 113.0), sf * sf * (3.0 - 2.0 * sf));
    // paintUnderShade: darker under the hair, the shadow of the locks above; the lit forehead takes 55% less
    float front = smoothstep(0.35, 0.95, 0.95 - abs(az) + 0.35);
    float cavity = 1.0 - smoothstep(full - 0.32, full + 0.02, phi);
    float under = 1.0 - uUnderShade * (1.0 - 0.55 * front) * cavity;
    // paintSheen: broad strand highlight on the downward comb tangent
    vec3 N = normalize(vNormalW), L = normalize(uLightDir), V = normalize(cameraPosition - vPosW);
    vec3 T = normalize(vec3(N.x * N.y, -1.0 + N.y * N.y, N.z * N.y) + vec3(0.0, -1e-5, 0.0));
    float th = clamp(dot(T, normalize(L + V)), -1.0, 1.0);
    float sheen = 0.08 * pow(sqrt(max(0.0, 1.0 - th * th)), 10.0) * smoothstep(0.15, 0.85, dens);
    gl_FragColor = vec4(uColor * ndl * (0.82 + 0.36 * streak) * under + uColor * sheen, a);
    #include <colorspace_fragment>
  }
`;

export interface ScalpPaintOverlay {
  group: THREE.Group;
  setPaint: (paint: ScalpPaint | null) => void;
  /** Paint colour: the paint's own override (ScalpPaint.color) or the hair's colour (scalpPaintColor). */
  setColor: (rootHex: string, baseHex?: string, tipHex?: string, specHex?: string, specIntensity?: number) => void;
  /** Rebuilds the overlay on new head surfaces (geometries in head-pivot-local space). */
  setSurfaces: (geos: THREE.BufferGeometry[]) => void;
  dispose: () => void;
}

export function createScalpPaintOverlay(lift = 0.0015): ScalpPaintOverlay {
  const group = new THREE.Group();
  group.name = 'AetherStrand_ScalpPaint';
  const W = SCALP_PAINT_BINS;
  const data = new Float32Array(W * 4);
  const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uCurves: { value: tex },
      uFeather: { value: 0.035 },
      uDensity: { value: 0 },
      uGrain: { value: 0.5 },
      uColor: { value: new THREE.Color('#2a1e18') },
      uHeadCenter: { value: new THREE.Vector3(0, 0.425, -0.01) },
      uRadii: { value: new THREE.Vector3(0.282, 0.318, 0.31) },
      uLightDir: { value: new THREE.Vector3(-0.4, 0.8, 0.6) },
      uLift: { value: lift },
      uIrreg: { value: 0.5 },
      uUnderShade: { value: 0 },
      uGrainStretch: { value: 1 },
    },
  });
  let meshes: THREE.Mesh[] = [];
  let current: ScalpPaint | null = null;
  let hairCol: [string, string | undefined, string | undefined, string | undefined, number | undefined] = ['#2a1e18', undefined, undefined, undefined, undefined];
  const applyColor = () => { (mat.uniforms.uColor.value as THREE.Color).copy(scalpPaintColor(current, hairCol[0], hairCol[1], hairCol[2], hairCol[3], hairCol[4])); };
  return {
    group,
    setPaint(p) {
      current = p;
      applyColor();
      if (!p) { mat.uniforms.uDensity.value = 0; group.visible = false; return; }
      group.visible = true;
      // resample (linear, wrapping) to the texture's bins; identical when p.bins === W
      for (let i = 0; i < W; i++) {
        const az = binAzimuth(i, W);
        data[i * 4] = sampleArr(p.fullPhi, az); data[i * 4 + 1] = sampleArr(p.edgePhi, az); data[i * 4 + 2] = sampleArr(p.edgeDensity, az); data[i * 4 + 3] = 1;
      }
      tex.needsUpdate = true;
      mat.uniforms.uFeather.value = p.feather;
      mat.uniforms.uDensity.value = p.density;
      mat.uniforms.uGrain.value = p.grain;
      mat.uniforms.uIrreg.value = p.irregularity ?? 0.5;
      mat.uniforms.uUnderShade.value = p.underShade ?? 0;
      mat.uniforms.uGrainStretch.value = p.grainStretch ?? 1;
    },
    setColor(rootHex, baseHex, tipHex, specHex, specIntensity) {
      hairCol = [rootHex, baseHex, tipHex, specHex, specIntensity];
      applyColor();
    },
    setSurfaces(geos) {
      meshes.forEach((m) => { group.remove(m); });
      meshes = geos.map((g) => { const m = new THREE.Mesh(g, mat); m.renderOrder = 1; group.add(m); return m; });
    },
    dispose() {
      mat.dispose();
      tex.dispose();
    },
  };
}
