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
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // mirrors paintHash / hairlineJag in scalpPaint.ts
  float h11(float i) { float t = fract(i * 0.1031); t *= t + 33.33; t *= t + t; return fract(t); }
  float vnoise(float az, float cells) {
    float x = (az + 3.14159265) / 6.2831853 * cells;
    float i = floor(x), f = x - i;
    float a = h11(mod(i, cells)), b = h11(mod(i + 1.0, cells));
    return mix(a, b, f * f * (3.0 - 2.0 * f));
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
    phi -= uIrreg * (0.024 * (vnoise(az, 150.0) - 0.5) * 2.0 + 0.011 * (vnoise(az, 440.0) - 0.5) * 2.0);
    vec3 c = texture2D(uCurves, vec2((az + 3.14159265) / 6.2831853, 0.5)).rgb;
    float full = c.r, edge = max(c.r + 1e-4, c.g), ed = c.b;
    float dens = paintRamp(phi, full, edge, ed, uFeather) * uDensity;
    if (dens < 0.002) discard;
    // scalpPaintAlpha: soft gradient mixed with stipple by grain
    float n = 0.5 + (hash(floor(vec2(az, phi) / 0.004)) - 0.5) * min(1.0, uGrain + 0.2);
    float stip = smoothstep(n - 0.14, n + 0.14, dens);
    float a = dens >= 0.999 ? 1.0 : mix(pow(dens, 0.85), stip, min(1.0, uGrain * 0.5));
    if (a < 0.01) discard;
    float ndl = clamp(dot(normalize(vNormalW), normalize(uLightDir)) * 0.5 + 0.6, 0.35, 1.0);
    // paintStreak: short strands combed along phi
    float ia = floor((az + 3.14159265) / 0.006);
    float sy = phi / 0.03, ib = floor(sy), sf = sy - ib;
    float streak = mix(h11(ia * 157.0 + ib * 113.0), h11(ia * 157.0 + (ib + 1.0) * 113.0), sf * sf * (3.0 - 2.0 * sf));
    gl_FragColor = vec4(uColor * ndl * (0.82 + 0.36 * streak), a);
    #include <colorspace_fragment>
  }
`;

export interface ScalpPaintOverlay {
  group: THREE.Group;
  setPaint: (paint: ScalpPaint | null) => void;
  /** Paint colour: the paint's own override (ScalpPaint.color) or the hair's colour (scalpPaintColor). */
  setColor: (rootHex: string, baseHex?: string, tipHex?: string) => void;
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
    },
  });
  let meshes: THREE.Mesh[] = [];
  let current: ScalpPaint | null = null;
  let hairCol: [string, string | undefined, string | undefined] = ['#2a1e18', undefined, undefined];
  const applyColor = () => { (mat.uniforms.uColor.value as THREE.Color).copy(scalpPaintColor(current, hairCol[0], hairCol[1], hairCol[2])); };
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
    },
    setColor(rootHex, baseHex, tipHex) {
      hairCol = [rootHex, baseHex, tipHex];
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
