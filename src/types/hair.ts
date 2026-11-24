export type HairPresetId = 'leon' | 'soldier' | 'silver' | 'noctis' | 'crimson';

export type RenderPipeline = 'urp' | 'builtin';

export type MotionMode = 'idle' | 'walk' | 'turn' | 'gust';

export type CameraPresetId = 'hero' | 'front' | 'left' | 'right' | 'back';

export type LightingPresetId = 'studio' | 'midgar' | 'sunset';

export type WorkspaceView = 'viewport' | 'unity' | 'blender' | 'textures';

export type VisionDebugMode =
  | 'shaded'
  | 'zones'
  | 'clearance'
  | 'normals'
  | 'uv'
  | 'silhouette'
  | 'motion';

export type BackdropMode = 'lighting' | 'matte-gray' | 'high-contrast' | 'chroma-green';

export type HairBuilderArchetype =
  | 'layered-shag'
  | 'spiky-hero'
  | 'long-cascade'
  | 'wolf-cut'
  | 'sleek-bob'
  | 'asym-cascade'
  | 'dolphin-long'
  | 'ribbon-halfup'
  | 'swept-back'
  | 'high-ponytail'
  | 'twin-tails'
  | 'emo-sweep'
  | 'short-crop';

export interface HairBuilderConfig {
  archetype: HairBuilderArchetype;
  partPosition: number; // -1 (deep left) to +1 (deep right), 0 = center
  bangsLength: number;  // 0.25 to 1.0
  bangsSweep: number;   // -1.0 (left) to +1.0 (right)
  crownVolume: number;  // 0.0 to 1.0
  spikeLift: number;    // 0.0 to 1.0
  sideLength: number;   // 0.2 to 1.0
  backLength: number;   // 0.25 to 1.0
  layerShag: number;    // 0.0 to 1.0
  density: number;      // 0.65 to 1.25
  strandWidth: number;  // 0.75 to 1.25
  seed: number;
}

export interface ShaderConfig {
  rootColor: string;
  baseColor: string;
  tipColor: string;
  primarySpecColor: string;
  secondarySpecColor: string;
  primaryShift: number;       // -0.5 to 0.5
  primaryPower: number;       // 20 to 240
  primaryIntensity: number;   // 0 to 1.5
  secondaryShift: number;     // -0.5 to 0.5
  secondaryPower: number;     // 8 to 120
  secondaryIntensity: number; // 0 to 1.2
  rimIntensity: number;       // 0 to 1.5
  rimPower: number;           // 1.5 to 6.0
  rootAO: number;             // 0 to 1.0
  grooveDepth: number;        // 0.1 to 1.0
  strandVariation: number;    // 0 to 0.40
}

export interface PhysicsConfig {
  stiffness: number;          // 0.05 to 0.95
  gravity: number;            // 0 to 16 m/s^2
  windStrength: number;       // 0 to 12
  windTurbulence: number;     // 0 to 1.5
  windAzimuth: number;        // 0 to 360 deg
  damping: number;            // 0.01 to 0.25
  inertia: number;            // 0 to 1.5
  bendingSmoothness: number;  // 0.0 to 0.95 (rest-curvature-preserving anti-kink)
  collisionMarginMm: number;  // 2 to 20 mm skull clearance
  rootAnchor: number;         // 0.1 to 1.0 upper scalp seal strength
  solverSubsteps: number;     // 1 to 4 integration substeps
  strandWidthScale: number;   // 0.65 to 1.45 live strand width multiplier
  collisionEnabled: boolean;
  showColliders: boolean;
  showBones: boolean;
}

export type AuditVerdict = 'PASS' | 'WARN' | 'FAIL';

export interface HairQualityAudit {
  presetId: HairPresetId;
  isCustomBuilder: boolean;
  motionMode: MotionMode;
  simTimeSec: number;
  strandCount: number;
  particleCount: number;
  triangleCount: number;
  penetratingNodes: number;
  tightClearanceNodes: number;
  maxKinkAngleDeg: number;
  p95KinkAngleDeg: number;
  meanTipSwayCm: number;
  maxTipSwayCm: number;
  maxStretchErrorPct: number;
  // Verifiable Head-Shape, Visual Bug, Inter-Lock Clipping & Temporal Sway Judge Metrics:
  scalpCoveragePct: number;
  floatingRootCount: number;
  crownHookCount: number;
  interLockClipCount: number;
  interLockClipPct: number;
  oscillatingNodes: number;
  maxBounceAmpMm: number;
  swaySmoothnessPct: number;
  score: number;
  verdict: AuditVerdict;
  issues: string[];
}

export interface AetherStrandRecipe {
  schemaVersion: '2.0';
  presetId: HairPresetId;
  customName?: string;
  builder?: HairBuilderConfig | null;
  pipeline: RenderPipeline;
  lightingPreset: LightingPresetId;
  motionMode: MotionMode;
  visionMode: VisionDebugMode;
  backdropMode: BackdropMode;
  shader: ShaderConfig;
  physics: Omit<PhysicsConfig, 'showColliders' | 'showBones'>;
}

export interface HairPresetDefinition {
  id: HairPresetId;
  name: string;
  subtitle: string;
  shader: ShaderConfig;
  physics: Omit<PhysicsConfig, 'showColliders' | 'showBones'>;
}

export const DEFAULT_BUILDER_BY_PRESET: Record<HairPresetId, HairBuilderConfig> = {
  leon: {
    archetype: 'layered-shag',
    partPosition: 0.42,
    bangsLength: 0.64,
    bangsSweep: -0.45,
    crownVolume: 0.45,
    spikeLift: 0.14,
    sideLength: 0.68,
    backLength: 0.62,
    layerShag: 0.68,
    density: 1.0,
    strandWidth: 0.96,
    seed: 202619,
  },
  soldier: {
    archetype: 'spiky-hero',
    partPosition: 0.15,
    bangsLength: 0.56,
    bangsSweep: 0.35,
    crownVolume: 0.78,
    spikeLift: 0.92,
    sideLength: 0.52,
    backLength: 0.58,
    layerShag: 0.85,
    density: 1.02,
    strandWidth: 1.04,
    seed: 199707,
  },
  silver: {
    archetype: 'long-cascade',
    partPosition: 0.0,
    bangsLength: 0.84,
    bangsSweep: 0.0,
    crownVolume: 0.48,
    spikeLift: 0.05,
    sideLength: 0.92,
    backLength: 0.96,
    layerShag: 0.36,
    density: 1.05,
    strandWidth: 1.08,
    seed: 999907,
  },
  noctis: {
    archetype: 'spiky-hero',
    partPosition: -0.1,
    bangsLength: 0.7,
    bangsSweep: -0.35,
    crownVolume: 0.44,
    spikeLift: 0.62,
    sideLength: 0.72,
    backLength: 0.7,
    layerShag: 0.72,
    density: 1.04,
    strandWidth: 0.96,
    seed: 201615,
  },
  crimson: {
    archetype: 'wolf-cut',
    partPosition: 0.38,
    bangsLength: 0.62,
    bangsSweep: -0.32,
    crownVolume: 0.52,
    spikeLift: 0.18,
    sideLength: 0.66,
    backLength: 0.84,
    layerShag: 0.78,
    density: 1.0,
    strandWidth: 1.0,
    seed: 202013,
  },
};

export const HAIR_PRESETS: Record<HairPresetId, HairPresetDefinition> = {
  leon: {
    id: 'leon',
    name: 'Leon Layered',
    subtitle: 'Parted chestnut shag & wispy tips',
    shader: {
      rootColor: '#26180f',
      baseColor: '#4c3322',
      tipColor: '#61432d',
      primarySpecColor: '#d9ba9c',
      secondarySpecColor: '#8c5d3a',
      primaryShift: 0.08,
      primaryPower: 84,
      primaryIntensity: 0.34,
      secondaryShift: -0.15,
      secondaryPower: 32,
      secondaryIntensity: 0.2,
      rimIntensity: 0.28,
      rimPower: 3.4,
      rootAO: 0.46,
      grooveDepth: 0.68,
      strandVariation: 0.22,
    },
    physics: {
      stiffness: 0.62,
      gravity: 4.4,
      windStrength: 0.55,
      windTurbulence: 0.24,
      windAzimuth: 30,
      damping: 0.095,
      inertia: 0.88,
      bendingSmoothness: 0.52,
      collisionMarginMm: 9,
      rootAnchor: 0.62,
      solverSubsteps: 1,
      strandWidthScale: 1.0,
      collisionEnabled: true,
    },
  },
  soldier: {
    id: 'soldier',
    name: 'SOLDIER Spiky',
    subtitle: 'Sculpted layered golden spikes',
    shader: {
      rootColor: '#5c401a',
      baseColor: '#b3893b',
      tipColor: '#d4b05d',
      primarySpecColor: '#fff0c7',
      secondarySpecColor: '#c48f2e',
      primaryShift: 0.09,
      primaryPower: 92,
      primaryIntensity: 0.36,
      secondaryShift: -0.14,
      secondaryPower: 34,
      secondaryIntensity: 0.22,
      rimIntensity: 0.3,
      rimPower: 3.3,
      rootAO: 0.44,
      grooveDepth: 0.66,
      strandVariation: 0.19,
    },
    physics: {
      stiffness: 0.8,
      gravity: 2.8,
      windStrength: 0.55,
      windTurbulence: 0.22,
      windAzimuth: 35,
      damping: 0.105,
      inertia: 0.76,
      bendingSmoothness: 0.62,
      collisionMarginMm: 9,
      rootAnchor: 0.7,
      solverSubsteps: 1,
      strandWidthScale: 1.0,
      collisionEnabled: true,
    },
  },
  silver: {
    id: 'silver',
    name: 'Silver Cascading',
    subtitle: 'Parted long flowing platinum tresses',
    shader: {
      rootColor: '#414957',
      baseColor: '#919cab',
      tipColor: '#c2ccd9',
      primarySpecColor: '#f2f6ff',
      secondarySpecColor: '#92a6c4',
      primaryShift: 0.06,
      primaryPower: 102,
      primaryIntensity: 0.36,
      secondaryShift: -0.16,
      secondaryPower: 38,
      secondaryIntensity: 0.2,
      rimIntensity: 0.32,
      rimPower: 3.2,
      rootAO: 0.42,
      grooveDepth: 0.64,
      strandVariation: 0.17,
    },
    physics: {
      stiffness: 0.56,
      gravity: 5.0,
      windStrength: 0.48,
      windTurbulence: 0.14,
      windAzimuth: 25,
      damping: 0.125,
      inertia: 0.86,
      bendingSmoothness: 0.56,
      collisionMarginMm: 9,
      rootAnchor: 0.64,
      solverSubsteps: 1,
      strandWidthScale: 1.0,
      collisionEnabled: true,
    },
  },
  noctis: {
    id: 'noctis',
    name: 'Noctis Lucis',
    subtitle: 'FFXV smoky charcoal spikes & wispy nape',
    shader: {
      rootColor: '#090a0c',
      baseColor: '#25272b',
      tipColor: '#4c5057',
      primarySpecColor: '#c8ccd2',
      secondarySpecColor: '#5c6068',
      primaryShift: 0.05,
      primaryPower: 64,
      primaryIntensity: 0.36,
      secondaryShift: -0.14,
      secondaryPower: 24,
      secondaryIntensity: 0.22,
      rimIntensity: 0.48,
      rimPower: 2.7,
      rootAO: 0.74,
      grooveDepth: 0.78,
      strandVariation: 0.28,
    },
    physics: {
      stiffness: 0.74,
      gravity: 3.6,
      windStrength: 0.55,
      windTurbulence: 0.24,
      windAzimuth: 28,
      damping: 0.1,
      inertia: 0.84,
      bendingSmoothness: 0.64,
      collisionMarginMm: 9,
      rootAnchor: 0.66,
      solverSubsteps: 1,
      strandWidthScale: 1.0,
      collisionEnabled: true,
    },
  },
  crimson: {
    id: 'crimson',
    name: 'Crimson Wolf-Cut',
    subtitle: 'Feathered auburn fringe & wispy tail',
    shader: {
      rootColor: '#2e100c',
      baseColor: '#69251c',
      tipColor: '#8f392a',
      primarySpecColor: '#ebbba0',
      secondarySpecColor: '#a33c24',
      primaryShift: 0.08,
      primaryPower: 84,
      primaryIntensity: 0.34,
      secondaryShift: -0.15,
      secondaryPower: 32,
      secondaryIntensity: 0.22,
      rimIntensity: 0.3,
      rimPower: 3.3,
      rootAO: 0.44,
      grooveDepth: 0.66,
      strandVariation: 0.2,
    },
    physics: {
      stiffness: 0.58,
      gravity: 4.6,
      windStrength: 0.52,
      windTurbulence: 0.2,
      windAzimuth: 42,
      damping: 0.105,
      inertia: 0.88,
      bendingSmoothness: 0.52,
      collisionMarginMm: 9,
      rootAnchor: 0.6,
      solverSubsteps: 1,
      strandWidthScale: 1.0,
      collisionEnabled: true,
    },
  },
};

export type ExportedHairZone = 'Bangs' | 'Crown' | 'Sides' | 'Rear';

export interface ExportedHairLock {
  zone: ExportedHairZone;
  width: number;
  thickness: number;
  seed: number;
  layerAO: number;
  isBaseShell: boolean;
  points: [number, number, number][];
}

export interface PluginFileEntry {
  path: string;
  name: string;
  category: 'unity' | 'blender';
  language: 'hlsl' | 'csharp' | 'python' | 'json' | 'markdown' | 'yaml';
  description: string;
  content: string;
}
