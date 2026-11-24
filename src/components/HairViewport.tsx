import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BustRig, createStylizedBust } from '../engine/bustModel';
import type { CharacterHead } from '../engine/characterHead';
import { HairPhysicsSystem, HairSimulationStats } from '../engine/hairPhysics';
import {
  createHairShaderMaterial,
  LIGHTING_RIGS,
  resolveBackdropHex,
  syncHairShaderUniforms,
} from '../engine/hairShaders';
import { createHairTexturePack, HairTexturePack } from '../engine/hairTextures';
import {
  BackdropMode,
  CameraPresetId,
  ExportedHairLock,
  HairBuilderConfig,
  HairPresetId,
  HairQualityAudit,
  LightingPresetId,
  MotionMode,
  PhysicsConfig,
  ShaderConfig,
  VisionDebugMode,
} from '../types/hair';

export interface CaptureOptions {
  resetPose?: boolean;
  singleView?: CameraPresetId | '4up';
  debugMode?: VisionDebugMode;
}

export interface HairViewportHandle {
  triggerImpulse: (x?: number, y?: number, z?: number) => void;
  resetCamera: () => void;
  getTexturePack: () => HairTexturePack | null;
  getExportLockGeometry: () => ExportedHairLock[];
  auditQuality: () => HairQualityAudit | null;
  stepFrames: (count: number, overrideMotion?: MotionMode) => HairQualityAudit | null;
  captureTurnaroundSheet: (opts?: CaptureOptions) => { dataUrl: string; audit: HairQualityAudit } | null;
}

interface HairViewportProps {
  presetId: HairPresetId;
  builderConfig: HairBuilderConfig | null;
  shaderConfig: ShaderConfig;
  physicsConfig: PhysicsConfig;
  motionMode: MotionMode;
  lightingPreset: LightingPresetId;
  cameraPreset: CameraPresetId;
  cameraRequestNonce: number;
  visionMode: VisionDebugMode;
  backdropMode: BackdropMode;
  paused: boolean;
  captureMode?: boolean;
  onCaptureComplete?: (dataUrl: string, audit: HairQualityAudit) => void;
  onStatsChange?: (stats: HairSimulationStats) => void;
  onAuditChange?: (audit: HairQualityAudit) => void;
  onTexturesReady?: (pack: HairTexturePack) => void;
  /** Optional character head (OBJ, fitted like the Unity plugin) shown instead of the mannequin. */
  characterHead?: CharacterHead | null;
}

const CAMERA_PRESETS: Record<CameraPresetId, { pos: [number, number, number]; target: [number, number, number] }> = {
  hero: { pos: [0.36, 0.88, 1.62], target: [0, 0.78, 0] },
  front: { pos: [0.0, 0.84, 1.68], target: [0, 0.78, 0] },
  left: { pos: [1.72, 0.84, 0.0], target: [0, 0.78, -0.04] },
  right: { pos: [-1.72, 0.84, 0.0], target: [0, 0.78, -0.04] },
  back: { pos: [0.0, 0.84, -1.72], target: [0, 0.78, -0.02] },
};

const VALID_SINGLE_VIEWS: CameraPresetId[] = ['hero', 'front', 'left', 'right', 'back'];

function applyMotionPose(bust: BustRig, hair: HairPhysicsSystem, mode: MotionMode, t: number): void {
  if (mode === 'idle') {
    bust.headPivot.position.set(
      Math.sin(t * 0.68) * 0.005,
      0.44 + Math.sin(t * 1.45) * 0.006,
      Math.cos(t * 0.6) * 0.003
    );
    bust.headPivot.rotation.set(
      Math.sin(t * 0.95) * 0.028,
      Math.sin(t * 0.65) * 0.125,
      Math.sin(t * 0.52) * 0.024
    );
  } else if (mode === 'walk') {
    bust.headPivot.position.set(
      Math.sin(t * 3.2) * 0.022,
      0.44 + Math.abs(Math.sin(t * 6.4)) * 0.032,
      Math.cos(t * 3.2) * 0.012
    );
    bust.headPivot.rotation.set(
      0.03 + Math.sin(t * 6.4) * 0.048,
      Math.sin(t * 3.2) * 0.18,
      Math.cos(t * 3.2) * 0.052
    );
  } else if (mode === 'turn') {
    const swing = Math.sin(t * 2.15);
    bust.headPivot.position.set(swing * 0.022, 0.44 + Math.cos(t * 4.3) * 0.012, 0);
    bust.headPivot.rotation.set(Math.sin(t * 1.4) * 0.055, swing * 0.62, -swing * 0.085);
  } else if (mode === 'gust') {
    bust.headPivot.position.set(Math.sin(t * 1.8) * 0.008, 0.44 + Math.sin(t * 2.1) * 0.007, 0);
    bust.headPivot.rotation.set(
      -0.05 + Math.sin(t * 1.7) * 0.038,
      0.14 + Math.sin(t * 0.9) * 0.11,
      -0.045 + Math.cos(t * 1.5) * 0.025
    );
    if (Math.sin(t * 1.8) > 0.72) {
      hair.applyImpulse(0.28, 0.05, -0.14);
    }
  }
}

function renderCaptureDataUrl(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  bust: BustRig,
  hair: HairPhysicsSystem,
  restoreLiveViewport: boolean,
  resetPose = true,
  singleView: CameraPresetId | '4up' = '4up'
): string | null {
  const prevSize = new THREE.Vector2();
  renderer.getSize(prevSize);
  const prevPixelRatio = renderer.getPixelRatio();
  const prevAspect = camera.aspect;
  const prevFov = camera.fov;
  const prevCamPos = camera.position.clone();
  const prevTarget = controls.target.clone();
  const prevHeadPos = bust.headPivot.position.clone();
  const prevHeadRot = bust.headPivot.rotation.clone();

  if (resetPose) {
    bust.headPivot.position.set(0, 0.44, 0);
    bust.headPivot.rotation.set(0, 0, 0);
    hair.snapToHead(bust.headPivot);
  }

  let dataUrl: string | null = null;

  if (singleView !== '4up') {
    const outSize = 1024;
    renderer.setPixelRatio(1);
    renderer.setSize(outSize, outSize, false);
    camera.aspect = 1;
    camera.fov = 33;
    camera.updateProjectionMatrix();

    const preset = CAMERA_PRESETS[singleView] ?? CAMERA_PRESETS.hero;
    camera.position.set(...preset.pos);
    camera.lookAt(...preset.target);
    renderer.render(scene, camera);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outSize;
    outCanvas.height = outSize;
    const ctx = outCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(renderer.domElement, 0, 0, outSize, outSize);
      ctx.fillStyle = 'rgba(11, 13, 18, 0.74)';
      ctx.fillRect(16, 16, 132, 26);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '600 12px "JetBrains Mono", monospace';
      ctx.fillText(singleView.toUpperCase(), 26, 33);
      dataUrl = outCanvas.toDataURL('image/png');
    }
  } else {
    const tileSize = 512;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = tileSize * 2;
    outCanvas.height = tileSize * 2;
    const ctx = outCanvas.getContext('2d');
    if (ctx) {
      renderer.setPixelRatio(1);
      renderer.setSize(tileSize, tileSize, false);
      camera.aspect = 1;
      camera.fov = 33;
      camera.updateProjectionMatrix();

      const views: { label: string; pos: [number, number, number]; target: [number, number, number]; gx: number; gy: number }[] = [
        { label: 'FRONT', pos: [0.0, 0.82, 1.84], target: [0, 0.77, 0], gx: 0, gy: 0 },
        { label: 'BACK', pos: [0.0, 0.82, -1.84], target: [0, 0.77, -0.02], gx: tileSize, gy: 0 },
        { label: 'LEFT PROFILE', pos: [1.86, 0.82, 0.0], target: [0, 0.77, -0.05], gx: 0, gy: tileSize },
        { label: 'RIGHT PROFILE', pos: [-1.86, 0.82, 0.0], target: [0, 0.77, -0.05], gx: tileSize, gy: tileSize },
      ];

      for (const v of views) {
        camera.position.set(...v.pos);
        camera.lookAt(...v.target);
        renderer.render(scene, camera);
        ctx.drawImage(renderer.domElement, v.gx, v.gy, tileSize, tileSize);

        ctx.fillStyle = 'rgba(11, 13, 18, 0.72)';
        ctx.fillRect(v.gx + 12, v.gy + 12, 114, 22);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillText(v.label, v.gx + 20, v.gy + 27);
      }

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tileSize, 0);
      ctx.lineTo(tileSize, tileSize * 2);
      ctx.moveTo(0, tileSize);
      ctx.lineTo(tileSize * 2, tileSize);
      ctx.stroke();

      dataUrl = outCanvas.toDataURL('image/png');
    }
  }

  if (restoreLiveViewport) {
    bust.headPivot.position.copy(prevHeadPos);
    bust.headPivot.rotation.copy(prevHeadRot);
    hair.snapToHead(bust.headPivot);

    renderer.setPixelRatio(prevPixelRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.fov = prevFov;
    camera.updateProjectionMatrix();
    camera.position.copy(prevCamPos);
    controls.target.copy(prevTarget);
    controls.update();
    renderer.render(scene, camera);
  }

  return dataUrl;
}

function detectSoftwareWebGL(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function mergeWorstAudit(worst: HairQualityAudit | null, current: HairQualityAudit): HairQualityAudit {
  if (!worst) return current;
  const verdictRank = (v: HairQualityAudit['verdict']) => (v === 'FAIL' ? 2 : v === 'WARN' ? 1 : 0);
  const mergedVerdict = verdictRank(current.verdict) >= verdictRank(worst.verdict) ? current.verdict : worst.verdict;
  const mergedScore = Math.min(worst.score, current.score);
  const issueSet = new Set<string>();
  for (const iss of worst.issues) {
    if (!iss.startsWith('All shape')) issueSet.add(iss);
  }
  for (const iss of current.issues) {
    if (!iss.startsWith('All shape')) issueSet.add(iss);
  }
  const issues =
    issueSet.size > 0
      ? Array.from(issueSet)
      : ['All shape, coverage, anti-bounce & inter-lock checks passed for full window'];

  return {
    ...current,
    penetratingNodes: Math.max(worst.penetratingNodes, current.penetratingNodes),
    tightClearanceNodes: Math.max(worst.tightClearanceNodes, current.tightClearanceNodes),
    maxKinkAngleDeg: Math.max(worst.maxKinkAngleDeg, current.maxKinkAngleDeg),
    p95KinkAngleDeg: Math.max(worst.p95KinkAngleDeg, current.p95KinkAngleDeg),
    maxTipSwayCm: Math.max(worst.maxTipSwayCm, current.maxTipSwayCm),
    maxStretchErrorPct: Math.max(worst.maxStretchErrorPct, current.maxStretchErrorPct),
    scalpCoveragePct: Math.min(worst.scalpCoveragePct, current.scalpCoveragePct),
    floatingRootCount: Math.max(worst.floatingRootCount, current.floatingRootCount),
    crownHookCount: Math.max(worst.crownHookCount, current.crownHookCount),
    interLockClipCount: Math.max(worst.interLockClipCount, current.interLockClipCount),
    interLockClipPct: Math.max(worst.interLockClipPct, current.interLockClipPct),
    oscillatingNodes: Math.max(worst.oscillatingNodes, current.oscillatingNodes),
    maxBounceAmpMm: Math.max(worst.maxBounceAmpMm, current.maxBounceAmpMm),
    swaySmoothnessPct: Math.min(worst.swaySmoothnessPct, current.swaySmoothnessPct),
    score: mergedScore,
    verdict: mergedVerdict,
    issues,
  };
}

export const HairViewport = forwardRef<HairViewportHandle, HairViewportProps>(function HairViewport(
  {
    presetId,
    builderConfig,
    shaderConfig,
    physicsConfig,
    motionMode,
    lightingPreset,
    cameraPreset,
    cameraRequestNonce,
    visionMode,
    backdropMode,
    paused,
    captureMode = false,
    onCaptureComplete,
    onStatsChange,
    onAuditChange,
    onTexturesReady,
    characterHead = null,
  },
  ref
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [contextLost, setContextLost] = useState(false);

  const shaderRef = useRef(shaderConfig);
  const physicsRef = useRef(physicsConfig);
  const motionRef = useRef(motionMode);
  const lightingRef = useRef(lightingPreset);
  const visionRef = useRef(visionMode);
  const backdropRef = useRef(backdropMode);
  const pausedRef = useRef(paused);

  shaderRef.current = shaderConfig;
  physicsRef.current = physicsConfig;
  motionRef.current = motionMode;
  lightingRef.current = lightingPreset;
  visionRef.current = visionMode;
  backdropRef.current = backdropMode;
  pausedRef.current = paused;

  const hairSystemRef = useRef<HairPhysicsSystem | null>(null);
  const hairMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const texturePackRef = useRef<HairTexturePack | null>(null);
  const bustRigRef = useRef<BustRig | null>(null);
  const simClockRef = useRef(0);
  const renderRigRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    isSoftwareGl: boolean;
  } | null>(null);
  const sceneObjectsRef = useRef<{
    scene: THREE.Scene;
    keyLight: THREE.DirectionalLight;
    fillLight: THREE.DirectionalLight;
    rimLight: THREE.DirectionalLight;
    hemiLight: THREE.HemisphereLight;
  } | null>(null);

  const cameraTransitionRef = useRef<{
    active: boolean;
    pos: THREE.Vector3;
    target: THREE.Vector3;
  }>({
    active: false,
    pos: new THREE.Vector3(...CAMERA_PRESETS.hero.pos),
    target: new THREE.Vector3(...CAMERA_PRESETS.hero.target),
  });

  useImperativeHandle(ref, () => ({
    triggerImpulse: (x = 7.2, y = 2.0, z = -3.4) => {
      hairSystemRef.current?.applyImpulse(x, y, z);
    },
    resetCamera: () => {
      const def = CAMERA_PRESETS.hero;
      cameraTransitionRef.current.pos.set(...def.pos);
      cameraTransitionRef.current.target.set(...def.target);
      cameraTransitionRef.current.active = true;
    },
    getTexturePack: () => texturePackRef.current,
    getExportLockGeometry: () =>
      hairSystemRef.current?.exportLockGeometry(physicsRef.current.strandWidthScale) ?? [],
    auditQuality: () => {
      const bust = bustRigRef.current;
      const hair = hairSystemRef.current;
      if (!bust || !hair) return null;
      const audit = hair.auditQuality(bust.headPivot, motionRef.current);
      onAuditChange?.(audit);
      return audit;
    },
    stepFrames: (count: number, overrideMotion?: MotionMode) => {
      const rig = renderRigRef.current;
      const bust = bustRigRef.current;
      const hair = hairSystemRef.current;
      if (!rig || !bust || !hair) return null;
      const mode = overrideMotion ?? motionRef.current;
      const steps = Math.max(1, Math.min(600, Math.round(count)));
      const fixedDt = 1 / 60;
      let worstAudit: HairQualityAudit | null = null;
      for (let f = 0; f < steps; f++) {
        simClockRef.current += fixedDt;
        applyMotionPose(bust, hair, mode, simClockRef.current);
        hair.step(fixedDt, bust.headPivot, bust.rootGroup, physicsRef.current);
        if ((f + 1) % 15 === 0 || f === steps - 1) {
          worstAudit = mergeWorstAudit(worstAudit, hair.auditQuality(bust.headPivot, mode));
        }
      }
      rig.renderer.render(rig.scene, rig.camera);
      const audit = worstAudit ?? hair.auditQuality(bust.headPivot, mode);
      onAuditChange?.(audit);
      return audit;
    },
    captureTurnaroundSheet: (opts?: CaptureOptions) => {
      const rig = renderRigRef.current;
      const bust = bustRigRef.current;
      const hair = hairSystemRef.current;
      const mat = hairMatRef.current;
      if (!rig || !bust || !hair || !mat) return null;

      const prevVision = visionRef.current;
      if (opts?.debugMode && opts.debugMode !== prevVision) {
        syncHairShaderUniforms(mat, shaderRef.current, lightingRef.current, opts.debugMode);
      }

      const resetPose = opts?.resetPose ?? false;
      const dataUrl = renderCaptureDataUrl(
        rig.renderer,
        rig.scene,
        rig.camera,
        rig.controls,
        bust,
        hair,
        true,
        resetPose,
        opts?.singleView ?? '4up'
      );

      if (opts?.debugMode && opts.debugMode !== prevVision) {
        syncHairShaderUniforms(mat, shaderRef.current, lightingRef.current, prevVision);
      }

      const audit = hair.auditQuality(bust.headPivot, motionRef.current);
      onAuditChange?.(audit);
      return dataUrl ? { dataUrl, audit } : null;
    },
  }));

  useEffect(() => {
    const def = CAMERA_PRESETS[cameraPreset];
    cameraTransitionRef.current.pos.set(...def.pos);
    cameraTransitionRef.current.target.set(...def.target);
    const rig = renderRigRef.current;
    if (rig && rig.isSoftwareGl) {
      rig.camera.position.set(...def.pos);
      rig.controls.target.set(...def.target);
      rig.controls.update();
      cameraTransitionRef.current.active = false;
    } else {
      cameraTransitionRef.current.active = true;
    }
  }, [cameraPreset, cameraRequestNonce]);

  const builderKey = builderConfig ? JSON.stringify(builderConfig) : '';

  // the hair is fitted to the loaded character's skull (head conform), as the Unity plugin and the preview renderer do
  const characterHeadRef = useRef<CharacterHead | null>(characterHead);
  characterHeadRef.current = characterHead;

  useEffect(() => {
    bustRigRef.current?.setCharacterHead(characterHead);
    const sys = hairSystemRef.current;
    const bust = bustRigRef.current;
    if (sys && bust) {
      sys.conformToHead(characterHead?.conform ?? null);
      sys.snapToHead(bust.headPivot, physicsRef.current.strandWidthScale);
    }
  }, [characterHead]);

  useEffect(() => {
    const sys = hairSystemRef.current;
    const bust = bustRigRef.current;
    if (!sys || !bust) return;
    const stats = builderConfig
      ? sys.loadCustomBuilder(builderConfig, presetId)
      : sys.loadPreset(presetId);
    sys.conformToHead(characterHeadRef.current?.conform ?? null);
    sys.snapToHead(bust.headPivot, physicsRef.current.strandWidthScale);
    bust.setScalpPaint(sys.scalpPaint);
    onStatsChange?.(stats);
    onAuditChange?.(sys.auditQuality(bust.headPivot, motionRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, builderKey, onStatsChange, onAuditChange]);

  useEffect(() => {
    if (hairMatRef.current) {
      syncHairShaderUniforms(hairMatRef.current, shaderConfig, lightingPreset, visionMode);
    }
    bustRigRef.current?.setRootTint(shaderConfig.rootColor, shaderConfig.baseColor, shaderConfig.tipColor);

    const objs = sceneObjectsRef.current;
    if (objs) {
      const rig = LIGHTING_RIGS[lightingPreset];
      const effBackdrop =
        visionMode === 'silhouette' && backdropMode === 'lighting'
          ? 'high-contrast'
          : backdropMode;
      const bgHex = resolveBackdropHex(lightingPreset, effBackdrop);
      objs.scene.background = new THREE.Color(bgHex);
      objs.scene.fog =
        effBackdrop === 'chroma-green' || effBackdrop === 'high-contrast'
          ? null
          : new THREE.FogExp2(bgHex, 0.08);
      objs.keyLight.color.set(rig.keyColor);
      objs.keyLight.intensity = rig.keyIntensity;
      objs.keyLight.position.set(...rig.keyDir);
      objs.fillLight.color.set(rig.fillColor);
      objs.fillLight.intensity = rig.fillIntensity;
      objs.fillLight.position.set(...rig.fillDir);
      objs.rimLight.color.set(rig.rimColor);
      objs.rimLight.intensity = rig.rimIntensity;
      objs.rimLight.position.set(...rig.rimDir);
      objs.hemiLight.color.set(rig.hemiSky);
      objs.hemiLight.groundColor.set(rig.hemiGround);
      objs.hemiLight.intensity = rig.hemiIntensity;
    }
  }, [shaderConfig, lightingPreset, visionMode, backdropMode]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => setContextLost(false);
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const rig = LIGHTING_RIGS[lightingRef.current];
    const effBackdrop =
      visionRef.current === 'silhouette' && backdropRef.current === 'lighting'
        ? 'high-contrast'
        : backdropRef.current;
    const bgHex = resolveBackdropHex(lightingRef.current, effBackdrop);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bgHex);
    scene.fog =
      effBackdrop === 'chroma-green' || effBackdrop === 'high-contrast'
        ? null
        : new THREE.FogExp2(bgHex, 0.08);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 40);
    camera.position.set(...CAMERA_PRESETS.hero.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...CAMERA_PRESETS.hero.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.85;
    controls.maxDistance = 3.8;
    controls.maxPolarAngle = Math.PI * 0.62;
    controls.minPolarAngle = Math.PI * 0.12;
    controls.update();

    const onControlStart = () => {
      cameraTransitionRef.current.active = false;
    };
    controls.addEventListener('start', onControlStart);

    const hemiLight = new THREE.HemisphereLight(rig.hemiSky, rig.hemiGround, rig.hemiIntensity);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(rig.keyColor, rig.keyIntensity);
    keyLight.position.set(...rig.keyDir);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 12;
    keyLight.shadow.camera.left = -2;
    keyLight.shadow.camera.right = 2;
    keyLight.shadow.camera.top = 2.5;
    keyLight.shadow.camera.bottom = -1.5;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(rig.fillColor, rig.fillIntensity);
    fillLight.position.set(...rig.fillDir);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(rig.rimColor, rig.rimIntensity);
    rimLight.position.set(...rig.rimDir);
    scene.add(rimLight);

    sceneObjectsRef.current = { scene, keyLight, fillLight, rimLight, hemiLight };
    renderRigRef.current = { renderer, scene, camera, controls, isSoftwareGl };

    const bust = createStylizedBust();
    bust.setRootTint(shaderRef.current.rootColor, shaderRef.current.baseColor, shaderRef.current.tipColor);
    if (characterHead) bust.setCharacterHead(characterHead);
    scene.add(bust.rootGroup);
    bustRigRef.current = bust;

    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const texturePack = createHairTexturePack(maxAniso);
    texturePackRef.current = texturePack;
    onTexturesReady?.(texturePack);

    const hairMaterial = createHairShaderMaterial(
      texturePack,
      shaderRef.current,
      lightingRef.current,
      visionRef.current
    );
    hairMatRef.current = hairMaterial;

    const hairSystem = new HairPhysicsSystem(hairMaterial, presetId);
    if (builderConfig) {
      hairSystem.loadCustomBuilder(builderConfig, presetId);
    }
    if (characterHeadRef.current) hairSystem.conformToHead(characterHeadRef.current.conform);
    hairSystem.snapToHead(bust.headPivot, physicsRef.current.strandWidthScale);
    bust.setScalpPaint(hairSystem.scalpPaint);
    scene.add(hairSystem.hairMesh);
    scene.add(hairSystem.colliderDebugGroup);
    scene.add(hairSystem.boneDebugLines);
    hairSystemRef.current = hairSystem;
    onStatsChange?.(hairSystem.getStats());

    if (captureMode) {
      const urlParams = new URLSearchParams(window.location.search);
      const simParam = urlParams.get('sim');
      const framesParam = parseInt(urlParams.get('frames') || '300', 10);
      const stepCount = Number.isFinite(framesParam) ? Math.max(1, Math.min(600, framesParam)) : 300;
      const viewParam = urlParams.get('view') as CameraPresetId | '4up' | null;
      const singleView: CameraPresetId | '4up' =
        viewParam && VALID_SINGLE_VIEWS.includes(viewParam as CameraPresetId)
          ? (viewParam as CameraPresetId)
          : '4up';

      let activeSimMode: MotionMode = 'idle';
      const shouldStep = Boolean(simParam && simParam !== 'rest' && simParam !== '0');
      let worstAudit: HairQualityAudit | null = null;
      if (shouldStep) {
        if (simParam === 'turn' || simParam === 'walk' || simParam === 'gust' || simParam === 'idle') {
          activeSimMode = simParam;
        }
        const simDt = 1 / 60;
        for (let f = 0; f < stepCount; f++) {
          applyMotionPose(bust, hairSystem, activeSimMode, f * simDt);
          hairSystem.step(simDt, bust.headPivot, bust.rootGroup, physicsRef.current);
          if ((f + 1) % 15 === 0 || f === stepCount - 1) {
            worstAudit = mergeWorstAudit(worstAudit, hairSystem.auditQuality(bust.headPivot, activeSimMode));
          }
        }
      }

      if (urlParams.get('nobust') === '1') bust.rootGroup.visible = false;
      const audit = worstAudit ?? hairSystem.auditQuality(bust.headPivot, activeSimMode);
      const dataUrl = renderCaptureDataUrl(
        renderer,
        scene,
        camera,
        controls,
        bust,
        hairSystem,
        false,
        !shouldStep,
        singleView
      );

      // Immediately release WebGL resources and lose context so headless CPU usage drops to zero
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      hairSystem.dispose();
      hairMaterial.dispose();
      texturePack.dispose();
      bust.dispose();
      envTarget.dispose();
      renderer.getContext().getExtension('WEBGL_lose_context')?.loseContext();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      renderRigRef.current = null;

      if (dataUrl) {
        onCaptureComplete?.(dataUrl, audit);
      }

      return () => {
        // Already disposed synchronously
      };
    }

    onAuditChange?.(hairSystem.auditQuality(bust.headPivot, motionRef.current));

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    let frameId = 0;
    let disposed = false;
    let lastTime = performance.now();
    let lastAuditAt = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;

      const now = performance.now();
      const rawDt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (!pausedRef.current) {
        simClockRef.current += rawDt;
        applyMotionPose(bust, hairSystem, motionRef.current, simClockRef.current);
        hairSystem.step(rawDt, bust.headPivot, bust.rootGroup, physicsRef.current);

        if (now - lastAuditAt > 500) {
          lastAuditAt = now;
          onAuditChange?.(hairSystem.auditQuality(bust.headPivot, motionRef.current));
        }
      }

      const camTr = cameraTransitionRef.current;
      if (camTr.active) {
        const lambda = 7.0;
        const currOffset = camera.position.clone().sub(controls.target);
        const destOffset = camTr.pos.clone().sub(camTr.target);
        const currSph = new THREE.Spherical().setFromVector3(currOffset);
        const destSph = new THREE.Spherical().setFromVector3(destOffset);

        let dTheta = destSph.theta - currSph.theta;
        while (dTheta > Math.PI) dTheta -= Math.PI * 2;
        while (dTheta < -Math.PI) dTheta += Math.PI * 2;

        const nextRadius = THREE.MathUtils.damp(currSph.radius, destSph.radius, lambda, rawDt);
        const nextPhi = THREE.MathUtils.damp(currSph.phi, destSph.phi, lambda, rawDt);
        const nextTheta = currSph.theta + (1 - Math.exp(-lambda * rawDt)) * dTheta;

        controls.target.x = THREE.MathUtils.damp(controls.target.x, camTr.target.x, lambda, rawDt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, camTr.target.y, lambda, rawDt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, camTr.target.z, lambda, rawDt);

        currSph.set(nextRadius, nextPhi, nextTheta);
        camera.position.setFromSpherical(currSph).add(controls.target);

        if (
          camera.position.distanceTo(camTr.pos) < 0.01 &&
          controls.target.distanceTo(camTr.target) < 0.01
        ) {
          camera.position.copy(camTr.pos);
          controls.target.copy(camTr.target);
          camTr.active = false;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      renderRigRef.current = null;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      hairSystem.dispose();
      hairMaterial.dispose();
      texturePack.dispose();
      bust.dispose();
      envTarget.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#12141a] text-[#eceff4] p-6">
          <div className="max-w-md text-center space-y-2">
            <h2 className="font-display text-lg font-semibold">WebGL Viewport Suspended</h2>
            <p className="text-sm text-slate-400">
              Graphics context was interrupted. You can still configure and export the Unity and Blender plugin files from the top navigation.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
