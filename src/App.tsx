import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Columns2, Download, ImagePlus, Layers, X } from 'lucide-react';
import { BottomControlDock } from './components/BottomControlDock';
import { CaptureOptions, HairViewport, HairViewportHandle } from './components/HairViewport';
import { PluginStudioPanel } from './components/PluginStudioPanel';
import {
  ALL_ARCHETYPES,
  CURATED_HAIR_PALETTES,
  generateRandomHairstyle,
  generateRandomShape,
  pickRandomPalette,
} from './engine/hairBuilder';
import { buildExportLocksForBlender, HairSimulationStats } from './engine/hairPhysics';
import { canvasToPngBlob, HairTexturePack } from './engine/hairTextures';
import {
  generatePluginFiles,
  sanitizeExportLightingPreset,
  sanitizeExportPresetId,
} from './generators/unityPluginGenerator';
import {
  AetherStrandRecipe,
  BackdropMode,
  CameraPresetId,
  DEFAULT_BUILDER_BY_PRESET,
  HAIR_PRESETS,
  HairBuilderArchetype,
  HairBuilderConfig,
  HairPresetId,
  HairQualityAudit,
  LightingPresetId,
  MotionMode,
  PhysicsConfig,
  RenderPipeline,
  ShaderConfig,
  VisionDebugMode,
  WorkspaceView,
} from './types/hair';

const VALID_PRESET_IDS: HairPresetId[] = ['noctis', 'leon', 'soldier', 'silver', 'crimson'];
const VALID_VISION_MODES: VisionDebugMode[] = ['shaded', 'zones', 'clearance', 'normals', 'uv', 'silhouette', 'motion'];
const VALID_BACKDROPS: BackdropMode[] = ['lighting', 'matte-gray', 'high-contrast', 'chroma-green'];
const VALID_MOTIONS: MotionMode[] = ['idle', 'walk', 'turn', 'gust'];

interface AetherStrandAgentApi {
  version: '2.0';
  getState: () => AetherStrandRecipe & {
    cameraPreset: CameraPresetId;
    stats: HairSimulationStats;
    audit: HairQualityAudit | null;
  };
  setPreset: (id: HairPresetId) => void;
  setBuilder: (patch: Partial<HairBuilderConfig>) => void;
  randomizeStyle: (seed?: number) => { name: string; seed: number; builder: HairBuilderConfig };
  patchShader: (patch: Partial<ShaderConfig>) => void;
  patchPhysics: (patch: Partial<PhysicsConfig>) => void;
  setVisionMode: (mode: VisionDebugMode) => void;
  setBackdropMode: (mode: BackdropMode) => void;
  setMotion: (mode: MotionMode) => void;
  setLighting: (preset: LightingPresetId) => void;
  setCamera: (preset: CameraPresetId) => void;
  stepFrames: (count?: number, motionMode?: MotionMode) => HairQualityAudit | null;
  auditQuality: () => HairQualityAudit | null;
  captureTurnaround: (opts?: CaptureOptions) => { dataUrl: string; audit: HairQualityAudit } | null;
  exportRecipeJson: () => string;
  importRecipeJson: (raw: string) => { ok: boolean; error?: string };
  getCaptureUrl: (overrides?: {
    preset?: HairPresetId;
    randomSeed?: number;
    sim?: MotionMode | 'rest';
    frames?: number;
    debug?: VisionDebugMode;
    bg?: BackdropMode;
    view?: CameraPresetId | '4up';
  }) => string;
}

declare global {
  interface Window {
    __AETHERSTRAND__?: AetherStrandAgentApi;
    __AETHERSTRAND_CAPTURE_AUDIT__?: HairQualityAudit;
  }
}

function getInitialQueryParams(): {
  captureMode: boolean;
  preset: HairPresetId;
  randomSeed: number | null;
  forcedArchetype: HairBuilderArchetype | null;
  visionMode: VisionDebugMode;
  backdropMode: BackdropMode;
  motionMode: MotionMode;
  showColliders: boolean;
  showBones: boolean;
} {
  if (typeof window === 'undefined') {
    return {
      captureMode: false,
      preset: 'noctis',
      randomSeed: null,
      forcedArchetype: null,
      visionMode: 'shaded',
      backdropMode: 'lighting',
      motionMode: 'idle',
      showColliders: false,
      showBones: false,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const captureMode = params.get('capture') === '1';
  const reqPreset = params.get('preset') as HairPresetId | null;
  const preset = reqPreset && VALID_PRESET_IDS.includes(reqPreset) ? reqPreset : 'noctis';
  const reqRandom = params.get('random');
  const parsedSeed = reqRandom !== null ? parseInt(reqRandom, 10) : NaN;
  const randomSeed = Number.isFinite(parsedSeed) ? parsedSeed : null;
  const reqArch = params.get('archetype') as HairBuilderArchetype | null;
  const forcedArchetype = reqArch && ALL_ARCHETYPES.includes(reqArch) ? reqArch : null;
  const reqDebug = params.get('debug') as VisionDebugMode | null;
  const visionMode = reqDebug && VALID_VISION_MODES.includes(reqDebug) ? reqDebug : 'shaded';
  const reqBg = params.get('bg') as BackdropMode | null;
  const backdropMode = reqBg && VALID_BACKDROPS.includes(reqBg) ? reqBg : 'lighting';
  const reqSim = params.get('sim') as MotionMode | null;
  const motionMode = reqSim && VALID_MOTIONS.includes(reqSim) ? reqSim : 'idle';
  const showColliders = params.get('colliders') === '1';
  const showBones = params.get('bones') === '1';
  return { captureMode, preset, randomSeed, forcedArchetype, visionMode, backdropMode, motionMode, showColliders, showBones };
}

export default function App() {
  const initialQuery = useMemo(() => getInitialQueryParams(), []);
  const initialRandom = useMemo(
    () =>
      initialQuery.randomSeed !== null || initialQuery.forcedArchetype !== null
        ? generateRandomHairstyle(initialQuery.randomSeed ?? 777, initialQuery.forcedArchetype ?? undefined)
        : null,
    [initialQuery.randomSeed, initialQuery.forcedArchetype]
  );
  const viewportRef = useRef<HairViewportHandle>(null);

  const [view, setView] = useState<WorkspaceView>('viewport');
  const [dockCollapsed, setDockCollapsed] = useState(false);

  const [presetId, setPresetId] = useState<HairPresetId>(
    initialRandom ? initialRandom.basePreset : initialQuery.preset
  );
  const [builderConfig, setBuilderConfig] = useState<HairBuilderConfig | null>(
    initialRandom ? initialRandom.builder : null
  );
  const [customStyleName, setCustomStyleName] = useState<string | null>(
    initialRandom ? initialRandom.name : null
  );
  const [shaderConfig, setShaderConfig] = useState<ShaderConfig>(
    initialRandom ? initialRandom.shader : HAIR_PRESETS[initialQuery.preset].shader
  );
  const [physicsConfig, setPhysicsConfig] = useState<PhysicsConfig>({
    ...(initialRandom ? initialRandom.physics : HAIR_PRESETS[initialQuery.preset].physics),
    showColliders: initialQuery.showColliders,
    showBones: initialQuery.showBones,
  });

  const [motionMode, setMotionMode] = useState<MotionMode>(initialQuery.motionMode);
  const [lightingPreset, setLightingPreset] = useState<LightingPresetId>('studio');
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('hero');
  const [cameraRequestNonce, setCameraRequestNonce] = useState(0);
  const [visionMode, setVisionMode] = useState<VisionDebugMode>(initialQuery.visionMode);
  const [backdropMode, setBackdropMode] = useState<BackdropMode>(initialQuery.backdropMode);
  const [pipeline, setPipeline] = useState<RenderPipeline>('urp');

  const [simStats, setSimStats] = useState<HairSimulationStats>({
    strandCount: 136,
    particleCount: 1224,
    triangleCount: 11424,
    colliderCount: 6,
  });
  const [qualityAudit, setQualityAudit] = useState<HairQualityAudit | null>(null);
  const [texturePack, setTexturePack] = useState<HairTexturePack | null>(null);
  const [exporting, setExporting] = useState(false);

  const [turnaroundCaptureUrl, setTurnaroundCaptureUrl] = useState<string | null>(null);
  const [turnaroundAudit, setTurnaroundAudit] = useState<HairQualityAudit | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [referenceCompareLayout, setReferenceCompareLayout] = useState<'overlay' | 'side-by-side'>('side-by-side');
  const [referenceOpacity, setReferenceOpacity] = useState(0.42);

  const [autoCaptureUrl, setAutoCaptureUrl] = useState<string | null>(null);
  const [autoCaptureAudit, setAutoCaptureAudit] = useState<HairQualityAudit | null>(null);

  const handleSelectPreset = useCallback((id: HairPresetId) => {
    const def = HAIR_PRESETS[id];
    setPresetId(id);
    setBuilderConfig(null);
    setCustomStyleName(null);
    setShaderConfig({ ...def.shader });
    setPhysicsConfig((prev) => ({
      ...def.physics,
      showColliders: prev.showColliders,
      showBones: prev.showBones,
    }));
  }, []);

  const handleChangeBuilder = useCallback(
    (patch: Partial<HairBuilderConfig>) => {
      setBuilderConfig((prev) => {
        const base = prev ?? DEFAULT_BUILDER_BY_PRESET[presetId];
        return { ...base, ...patch };
      });
      setCustomStyleName((prev) => prev ?? 'Custom Sculpt');
    },
    [presetId]
  );

  const handleRandomizeStyle = useCallback((seed?: number) => {
    const generated = generateRandomHairstyle(seed);
    setPresetId(generated.basePreset);
    setBuilderConfig(generated.builder);
    setCustomStyleName(generated.name);
    setShaderConfig({ ...generated.shader });
    setPhysicsConfig((prev) => ({
      ...generated.physics,
      showColliders: prev.showColliders,
      showBones: prev.showBones,
    }));
    return { name: generated.name, seed: generated.builder.seed, builder: generated.builder };
  }, []);

  const handleRandomizeShape = useCallback(() => {
    const generated = generateRandomShape(builderConfig?.archetype);
    setPresetId(generated.basePreset);
    setBuilderConfig(generated.builder);
    setCustomStyleName(generated.name);
    setPhysicsConfig((prev) => ({
      ...generated.physics,
      showColliders: prev.showColliders,
      showBones: prev.showBones,
    }));
  }, [builderConfig?.archetype]);

  const handleRandomizeColor = useCallback(() => {
    const currentId = CURATED_HAIR_PALETTES.find(
      (p) => p.shader.baseColor.toLowerCase() === shaderConfig.baseColor.toLowerCase()
    )?.id;
    const next = pickRandomPalette(currentId);
    setShaderConfig({ ...next.shader });
  }, [shaderConfig.baseColor]);

  const handleSelectPalette = useCallback((paletteId: string) => {
    const found = CURATED_HAIR_PALETTES.find((p) => p.id === paletteId);
    if (found) {
      setShaderConfig({ ...found.shader });
    }
  }, []);

  const handleResetToPreset = useCallback(() => {
    handleSelectPreset(presetId);
  }, [handleSelectPreset, presetId]);

  const handleChangeShader = useCallback((patch: Partial<ShaderConfig>) => {
    setShaderConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleChangePhysics = useCallback((patch: Partial<PhysicsConfig>) => {
    setPhysicsConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleChangeCamera = useCallback((next: CameraPresetId) => {
    setCameraPreset(next);
    setCameraRequestNonce((n) => n + 1);
  }, []);

  const handleTriggerImpulse = useCallback(() => {
    const angle = (physicsConfig.windAzimuth * Math.PI) / 180;
    viewportRef.current?.triggerImpulse(Math.cos(angle) * 8.2, 2.0, Math.sin(angle) * 8.2);
  }, [physicsConfig.windAzimuth]);

  const handleResetCamera = useCallback(() => {
    setCameraPreset('hero');
    setCameraRequestNonce((n) => n + 1);
    viewportRef.current?.resetCamera();
  }, []);

  const handleRunDeterministicAudit = useCallback(() => {
    const audit = viewportRef.current?.stepFrames(300, motionMode);
    if (audit) {
      setQualityAudit(audit);
    }
  }, [motionMode]);

  const buildRecipeObject = useCallback((): AetherStrandRecipe => {
    const { showColliders: _sc, showBones: _sb, ...portablePhysics } = physicsConfig;
    return {
      schemaVersion: '2.0',
      presetId,
      customName: customStyleName ?? undefined,
      builder: builderConfig ?? undefined,
      pipeline,
      lightingPreset,
      motionMode,
      visionMode,
      backdropMode,
      shader: shaderConfig,
      physics: portablePhysics,
    };
  }, [
    presetId,
    customStyleName,
    builderConfig,
    pipeline,
    lightingPreset,
    motionMode,
    visionMode,
    backdropMode,
    shaderConfig,
    physicsConfig,
  ]);

  const exportRecipeJson = useCallback(
    () => JSON.stringify(buildRecipeObject(), null, 2),
    [buildRecipeObject]
  );

  const importRecipeJson = useCallback((raw: string): { ok: boolean; error?: string } => {
    try {
      const parsed = JSON.parse(raw) as Partial<AetherStrandRecipe>;
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'Recipe must be a JSON object.' };
      }
      if (parsed.presetId && VALID_PRESET_IDS.includes(parsed.presetId)) {
        const base = HAIR_PRESETS[parsed.presetId];
        setPresetId(parsed.presetId);
        setShaderConfig({ ...base.shader, ...(parsed.shader ?? {}) });
        setPhysicsConfig((prev) => ({
          ...base.physics,
          ...(parsed.physics ?? {}),
          showColliders: prev.showColliders,
          showBones: prev.showBones,
        }));
      } else {
        if (parsed.shader) setShaderConfig((prev) => ({ ...prev, ...parsed.shader }));
        if (parsed.physics) setPhysicsConfig((prev) => ({ ...prev, ...parsed.physics }));
      }
      if (parsed.builder && typeof parsed.builder === 'object') {
        setBuilderConfig({
          ...DEFAULT_BUILDER_BY_PRESET[parsed.presetId ?? 'noctis'],
          ...parsed.builder,
        });
        setCustomStyleName(parsed.customName ?? 'Imported Custom Style');
      } else {
        setBuilderConfig(null);
        setCustomStyleName(null);
      }
      if (parsed.pipeline === 'urp' || parsed.pipeline === 'builtin') setPipeline(parsed.pipeline);
      if (parsed.lightingPreset === 'studio' || parsed.lightingPreset === 'midgar' || parsed.lightingPreset === 'sunset') {
        setLightingPreset(parsed.lightingPreset);
      }
      if (parsed.motionMode && VALID_MOTIONS.includes(parsed.motionMode)) setMotionMode(parsed.motionMode);
      if (parsed.visionMode && VALID_VISION_MODES.includes(parsed.visionMode)) setVisionMode(parsed.visionMode);
      if (parsed.backdropMode && VALID_BACKDROPS.includes(parsed.backdropMode)) setBackdropMode(parsed.backdropMode);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not parse JSON recipe.' };
    }
  }, []);

  const buildCaptureUrl = useCallback(
    (overrides?: {
      preset?: HairPresetId;
      randomSeed?: number;
      sim?: MotionMode | 'rest';
      frames?: number;
      debug?: VisionDebugMode;
      bg?: BackdropMode;
      view?: CameraPresetId | '4up';
    }) => {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3000';
      const params = new URLSearchParams();
      params.set('capture', '1');
      if (overrides?.randomSeed !== undefined) {
        params.set('random', String(overrides.randomSeed));
      } else if (builderConfig && !overrides?.preset) {
        params.set('random', String(builderConfig.seed));
      } else {
        params.set('preset', overrides?.preset ?? presetId);
      }
      params.set('sim', overrides?.sim ?? motionMode);
      params.set('frames', String(overrides?.frames ?? 300));
      const dbg = overrides?.debug ?? visionMode;
      if (dbg !== 'shaded') params.set('debug', dbg);
      const bg = overrides?.bg ?? backdropMode;
      if (bg !== 'lighting') params.set('bg', bg);
      if (overrides?.view && overrides.view !== '4up') params.set('view', overrides.view);
      if (physicsConfig.showColliders) params.set('colliders', '1');
      if (physicsConfig.showBones) params.set('bones', '1');
      return `${origin}/?${params.toString()}`;
    },
    [presetId, builderConfig, motionMode, visionMode, backdropMode, physicsConfig.showColliders, physicsConfig.showBones]
  );

  const handleCopyRecipeJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportRecipeJson());
      return true;
    } catch {
      return false;
    }
  }, [exportRecipeJson]);

  const handleCopyCaptureUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildCaptureUrl());
      return true;
    } catch {
      return false;
    }
  }, [buildCaptureUrl]);

  const handleCaptureTurnaround = useCallback(() => {
    const result = viewportRef.current?.captureTurnaroundSheet({ resetPose: false });
    if (result) {
      setTurnaroundCaptureUrl(result.dataUrl);
      setTurnaroundAudit(result.audit);
    }
  }, []);

  const handleDownloadTurnaround = useCallback(() => {
    if (!turnaroundCaptureUrl) return;
    const parts = turnaroundCaptureUrl.split(',');
    if (parts.length !== 2) return;
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileTag = builderConfig ? `Custom_${builderConfig.seed}` : presetId;
    a.download = `AetherStrand_${fileTag}_${visionMode}_4View.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [turnaroundCaptureUrl, builderConfig, presetId, visionMode]);

  const handleReferenceUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setReferenceImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  // Expose programmatic AI Agent API on window.__AETHERSTRAND__
  useEffect(() => {
    if (initialQuery.captureMode) return;
    window.__AETHERSTRAND__ = {
      version: '2.0',
      getState: () => ({
        ...buildRecipeObject(),
        cameraPreset,
        stats: simStats,
        audit: qualityAudit,
      }),
      setPreset: handleSelectPreset,
      setBuilder: handleChangeBuilder,
      randomizeStyle: handleRandomizeStyle,
      patchShader: handleChangeShader,
      patchPhysics: handleChangePhysics,
      setVisionMode,
      setBackdropMode,
      setMotion: setMotionMode,
      setLighting: setLightingPreset,
      setCamera: handleChangeCamera,
      stepFrames: (count = 300, overrideMotion?: MotionMode) =>
        viewportRef.current?.stepFrames(count, overrideMotion) ?? null,
      auditQuality: () => viewportRef.current?.auditQuality() ?? null,
      captureTurnaround: (opts?: CaptureOptions) =>
        viewportRef.current?.captureTurnaroundSheet(opts) ?? null,
      exportRecipeJson,
      importRecipeJson,
      getCaptureUrl: buildCaptureUrl,
    };
    return () => {
      delete window.__AETHERSTRAND__;
    };
  }, [
    initialQuery.captureMode,
    buildRecipeObject,
    cameraPreset,
    simStats,
    qualityAudit,
    handleSelectPreset,
    handleChangeBuilder,
    handleRandomizeStyle,
    handleChangeShader,
    handleChangePhysics,
    handleChangeCamera,
    exportRecipeJson,
    importRecipeJson,
    buildCaptureUrl,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key.toLowerCase() === 'h' && view === 'viewport') {
        setDockCollapsed((c) => !c);
      } else if (e.code === 'Space' && view === 'viewport') {
        e.preventDefault();
        handleTriggerImpulse();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, handleTriggerImpulse]);

  const previewExportLocks = useMemo(() => {
    const liveLocks = viewportRef.current?.getExportLockGeometry();
    if (liveLocks && liveLocks.length > 0) return liveLocks;
    return buildExportLocksForBlender(presetId, builderConfig, physicsConfig.strandWidthScale);
  }, [presetId, builderConfig, physicsConfig.strandWidthScale, simStats]);

  const pluginFiles = useMemo(
    () => generatePluginFiles(shaderConfig, physicsConfig, presetId, pipeline, previewExportLocks),
    [shaderConfig, physicsConfig, presetId, pipeline, previewExportLocks]
  );

  const handleExportZip = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const zip = new JSZip();

      const liveLocks = viewportRef.current?.getExportLockGeometry();
      const activeLocks =
        liveLocks && liveLocks.length > 0
          ? liveLocks
          : buildExportLocksForBlender(presetId, builderConfig, physicsConfig.strandWidthScale);
      const exportFiles = generatePluginFiles(shaderConfig, physicsConfig, presetId, pipeline, activeLocks);

      for (const file of exportFiles) {
        zip.file(file.path, file.content);
      }

      const rawRecipe = buildRecipeObject();
      const sanitizedLook = {
        ...rawRecipe,
        presetId: sanitizeExportPresetId(presetId),
        lightingPreset: sanitizeExportLightingPreset(rawRecipe.lightingPreset),
        physics: {
          ...rawRecipe.physics,
          windStrength: 0,
          solverSubsteps: 3,
        },
      };
      zip.file('AetherStrand_Unity/Presets/ExportedLook.json', JSON.stringify(sanitizedLook, null, 2));

      const pack = texturePack ?? viewportRef.current?.getTexturePack();
      if (pack) {
        const [grooveBlob, flowBlob, normalBlob, alphaBlob] = await Promise.all([
          canvasToPngBlob(pack.grooveAoCanvas),
          canvasToPngBlob(pack.flowIdCanvas),
          canvasToPngBlob(pack.normalCanvas),
          canvasToPngBlob(pack.alphaCardCanvas),
        ]);
        zip.file('AetherStrand_Unity/Textures/AetherStrand_GrooveAO.png', grooveBlob);
        zip.file('AetherStrand_Unity/Textures/AetherStrand_FlowIDShift.png', flowBlob);
        zip.file('AetherStrand_Unity/Textures/AetherStrand_Normal.png', normalBlob);
        zip.file('AetherStrand_Unity/Textures/AetherStrand_AlphaCard.png', alphaBlob);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      const exportTag = builderConfig ? `Custom_${builderConfig.seed}` : sanitizeExportPresetId(presetId);
      a.download = `AetherStrand_${exportTag}_${pipeline.toUpperCase()}_Plugin.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [
    exporting,
    builderConfig,
    presetId,
    pipeline,
    shaderConfig,
    physicsConfig,
    buildRecipeObject,
    texturePack,
  ]);

  const navItems: { id: WorkspaceView; label: string; shortLabel: string }[] = [
    { id: 'viewport', label: 'Viewport', shortLabel: 'View' },
    { id: 'unity', label: 'Unity Plugin', shortLabel: 'Unity' },
    { id: 'blender', label: 'Blender Addon', shortLabel: 'Blender' },
    { id: 'textures', label: 'Textures', shortLabel: 'Maps' },
  ];

  const activePresetDef = HAIR_PRESETS[presetId];
  const activeDisplayName = customStyleName ?? activePresetDef.name;

  if (initialQuery.captureMode) {
    return (
      <div className="relative w-screen h-screen overflow-hidden bg-[#0b0d12] flex items-center justify-center">
        {!autoCaptureUrl && (
          <div className="w-[1024px] h-[1024px]">
            <HairViewport
              ref={viewportRef}
              presetId={presetId}
              builderConfig={builderConfig}
              shaderConfig={shaderConfig}
              physicsConfig={physicsConfig}
              motionMode={motionMode}
              lightingPreset={lightingPreset}
              cameraPreset="front"
              cameraRequestNonce={0}
              visionMode={visionMode}
              backdropMode={backdropMode}
              paused={true}
              captureMode={true}
              onCaptureComplete={(url, audit) => {
                window.__AETHERSTRAND_CAPTURE_AUDIT__ = audit;
                setAutoCaptureAudit(audit);
                setAutoCaptureUrl(url);
              }}
            />
          </div>
        )}
        {autoCaptureUrl && (
          <img
            id="turnaround-capture-img"
            src={autoCaptureUrl}
            data-audit-json={autoCaptureAudit ? JSON.stringify(autoCaptureAudit) : ''}
            alt={`${activeDisplayName} 4-View Turnaround`}
            className="w-full h-full object-contain block"
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0b0d12] text-[#eceff4]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="fixed top-0 inset-x-0 h-14 z-40 flex items-center justify-between gap-3 sm:gap-8 px-3.5 sm:px-6 bg-[#0b0d12]/95 border-b border-white/10">
        <button
          type="button"
          onClick={() => setView('viewport')}
          className="font-display text-base sm:text-lg font-semibold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer"
        >
          AetherStrand
        </button>

        <nav className="flex items-center gap-3 sm:gap-6 min-w-0">
          {navItems.map((item) => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={`relative py-1 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active ? 'text-white' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sm:hidden">{item.shortLabel}</span>
                {active && (
                  <span className="absolute left-0 right-0 -bottom-[17px] h-[2px] bg-[#e5a93c]" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleExportZip}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg bg-[#e5a93c] text-[#0b0d12] text-xs font-semibold hover:bg-[#f0b84d] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{exporting ? 'Exporting...' : 'Export ZIP'}</span>
            <span className="sm:hidden">{exporting ? '...' : 'ZIP'}</span>
          </button>
        </div>
      </header>

      {/* Persistent Full-Viewport 3D Hair Simulation Canvas */}
      <main className="fixed inset-0 pt-14 z-0">
        <HairViewport
          ref={viewportRef}
          presetId={presetId}
          builderConfig={builderConfig}
          shaderConfig={shaderConfig}
          physicsConfig={physicsConfig}
          motionMode={motionMode}
          lightingPreset={lightingPreset}
          cameraPreset={cameraPreset}
          cameraRequestNonce={cameraRequestNonce}
          visionMode={visionMode}
          backdropMode={backdropMode}
          paused={view !== 'viewport' || turnaroundCaptureUrl !== null}
          onStatsChange={setSimStats}
          onAuditChange={setQualityAudit}
          onTexturesReady={setTexturePack}
        />
      </main>

      {/* Quiet Unboxed Viewport Spec Line */}
      {view === 'viewport' && (
        <div className="fixed top-[72px] left-4 sm:left-6 z-10 pointer-events-none select-none space-y-0.5">
          <h1 className="font-display text-base sm:text-lg font-semibold text-white tracking-tight">
            {activeDisplayName}
          </h1>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
            <span>{simStats.strandCount} locks</span>
            <span aria-hidden="true">·</span>
            <span>{simStats.triangleCount.toLocaleString()} tris</span>
            <span aria-hidden="true">·</span>
            <span>{pipeline === 'urp' ? 'Unity URP' : 'Unity Built-in'}</span>
            {visionMode !== 'shaded' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-amber-300 uppercase">{visionMode}</span>
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-500 pt-0.5 hidden sm:block">
            Drag to orbit · Scroll to zoom · Space for wind gust
          </p>
        </div>
      )}

      {/* Collapsible Unified Bottom Control Dock */}
      {view === 'viewport' && (
        <BottomControlDock
          collapsed={dockCollapsed}
          onToggleCollapse={() => setDockCollapsed((c) => !c)}
          presetId={presetId}
          onSelectPreset={handleSelectPreset}
          builderConfig={builderConfig}
          customStyleName={customStyleName}
          onChangeBuilder={handleChangeBuilder}
          onRandomizeStyle={() => handleRandomizeStyle()}
          onRandomizeShape={handleRandomizeShape}
          onRandomizeColor={handleRandomizeColor}
          onSelectPalette={handleSelectPalette}
          onResetToPreset={handleResetToPreset}
          shader={shaderConfig}
          onChangeShader={handleChangeShader}
          physics={physicsConfig}
          onChangePhysics={handleChangePhysics}
          motionMode={motionMode}
          onChangeMotion={setMotionMode}
          lightingPreset={lightingPreset}
          onChangeLighting={setLightingPreset}
          cameraPreset={cameraPreset}
          onChangeCamera={handleChangeCamera}
          visionMode={visionMode}
          onChangeVisionMode={setVisionMode}
          backdropMode={backdropMode}
          onChangeBackdropMode={setBackdropMode}
          qualityAudit={qualityAudit}
          onRunDeterministicAudit={handleRunDeterministicAudit}
          onCopyRecipeJson={handleCopyRecipeJson}
          onImportRecipeJson={importRecipeJson}
          onCopyCaptureUrl={handleCopyCaptureUrl}
          onTriggerImpulse={handleTriggerImpulse}
          onResetCamera={handleResetCamera}
          onCaptureTurnaround={handleCaptureTurnaround}
        />
      )}

      {/* 4-View Turnaround Capture Preview & Reference Compare Modal */}
      {turnaroundCaptureUrl && (
        <div className="fixed inset-0 z-50 bg-[#0b0d12]/90 flex items-center justify-center p-4 sm:p-8">
          <div
            className={`w-full ${
              referenceImageUrl && referenceCompareLayout === 'side-by-side' ? 'max-w-5xl' : 'max-w-2xl'
            } bg-[#131720] border border-white/12 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
              <div>
                <h2 className="font-display text-sm font-semibold text-white">
                  4-View Turnaround · {activeDisplayName}
                </h2>
                <p className="text-[11px] font-mono tabular-nums text-slate-400">
                  {turnaroundAudit
                    ? `${turnaroundAudit.verdict} ${turnaroundAudit.score}/100 · ${turnaroundAudit.scalpCoveragePct.toFixed(1)}% scalp · ${turnaroundAudit.oscillatingNodes} bounce · ${turnaroundAudit.interLockClipPct.toFixed(1)}% clip · ${turnaroundAudit.penetratingNodes} pen · ${turnaroundAudit.meanTipSwayCm.toFixed(2)} cm sway`
                    : 'Front · Back · Left Profile · Right Profile (1024×1024 PNG)'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {presetId === 'noctis' && !builderConfig && !referenceImageUrl && (
                  <button
                    type="button"
                    onClick={() => setReferenceImageUrl('/assets/aistudio/image_1a24357a.jpeg')}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#191e2b] border border-white/10 text-xs font-medium text-slate-200 hover:border-amber-400/50 hover:text-amber-200 transition-colors cursor-pointer"
                  >
                    <Columns2 className="w-3.5 h-3.5" />
                    <span>Compare Ref</span>
                  </button>
                )}
                <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#191e2b] border border-white/10 text-xs font-medium text-slate-200 hover:border-white/25 transition-colors cursor-pointer">
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>{referenceImageUrl ? 'Change Ref' : 'Load Ref'}</span>
                  <input type="file" accept="image/*" onChange={handleReferenceUpload} className="hidden" />
                </label>
                {referenceImageUrl && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setReferenceCompareLayout((l) => (l === 'side-by-side' ? 'overlay' : 'side-by-side'))
                      }
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#191e2b] border border-white/10 text-xs font-medium text-slate-200 hover:text-white cursor-pointer"
                    >
                      {referenceCompareLayout === 'side-by-side' ? (
                        <Layers className="w-3.5 h-3.5" />
                      ) : (
                        <Columns2 className="w-3.5 h-3.5" />
                      )}
                      <span>{referenceCompareLayout === 'side-by-side' ? 'Overlay' : 'Side-by-Side'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReferenceImageUrl(null)}
                      className="px-2 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white cursor-pointer"
                    >
                      Clear Ref
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleDownloadTurnaround}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#e5a93c] text-[#0b0d12] text-xs font-semibold hover:bg-[#f0b84d] transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Save PNG
                </button>
                <button
                  type="button"
                  onClick={() => setTurnaroundCaptureUrl(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  aria-label="Close turnaround preview"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {referenceImageUrl && referenceCompareLayout === 'overlay' && (
              <div className="px-4 py-2 bg-[#0f131b] border-b border-white/8 flex items-center gap-3">
                <span className="text-xs text-slate-400 whitespace-nowrap">Reference Opacity</span>
                <input
                  type="range"
                  className="studio-slider max-w-xs"
                  min={0}
                  max={1}
                  step={0.02}
                  value={referenceOpacity}
                  onChange={(e) => setReferenceOpacity(parseFloat(e.target.value))}
                />
                <span className="text-xs font-mono tabular-nums text-slate-300">
                  {Math.round(referenceOpacity * 100)}%
                </span>
              </div>
            )}

            <div className="p-3 bg-[#0b0d12] overflow-auto flex items-center justify-center">
              {referenceImageUrl && referenceCompareLayout === 'side-by-side' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                  <img
                    src={turnaroundCaptureUrl}
                    alt={`${activeDisplayName} 4-View Turnaround Sheet`}
                    className="w-full aspect-square object-contain rounded-lg border border-white/10 bg-[#14171f]"
                  />
                  <img
                    src={referenceImageUrl}
                    alt="Reference Turnaround Comparison"
                    className="w-full aspect-square object-contain rounded-lg border border-white/10 bg-[#14171f]"
                  />
                </div>
              ) : (
                <div className="relative w-full max-w-[600px] aspect-square">
                  <img
                    src={turnaroundCaptureUrl}
                    alt={`${activeDisplayName} 4-View Turnaround Sheet`}
                    className="w-full h-full object-contain rounded-lg border border-white/10"
                  />
                  {referenceImageUrl && (
                    <img
                      src={referenceImageUrl}
                      alt="Reference Overlay"
                      style={{ opacity: referenceOpacity }}
                      className="absolute inset-0 w-full h-full object-contain rounded-lg pointer-events-none"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Unity Plugin, Blender Addon, and Procedural Texture Studio Panel */}
      {view !== 'viewport' && (
        <PluginStudioPanel
          mode={view}
          files={pluginFiles}
          pipeline={pipeline}
          onChangePipeline={setPipeline}
          texturePack={texturePack}
          onExportZip={handleExportZip}
          exporting={exporting}
        />
      )}
    </div>
  );
}
