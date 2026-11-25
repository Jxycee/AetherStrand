import { useCallback, useState } from 'react';
import { HairShellEditor } from './HairShellEditor';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  FileJson2,
  Link2,
  Palette,
  Play,
  RotateCcw,
  Scissors,
  Shuffle,
  Wind,
} from 'lucide-react';
import { ARCHETYPE_METADATA, CURATED_HAIR_PALETTES } from '../engine/hairBuilder';
import {
  BackdropMode,
  CameraPresetId,
  DEFAULT_BUILDER_BY_PRESET,
  HAIR_PRESETS,
  HairBuilderConfig,
  HairShellGrid,
  HairPresetId,
  HairQualityAudit,
  LightingPresetId,
  MotionMode,
  PhysicsConfig,
  ShaderConfig,
  VisionDebugMode,
} from '../types/hair';
import { SHEEN_DEFAULTS, type HairSheenSettings } from '../engine/hairShadingModel';
import { CARD_BAKE_DEFAULTS, type CardBakeSettings } from '../engine/cardBake';

const SHEEN_SLIDERS: [keyof HairSheenSettings, string, number, number, number][] = [
  ['primaryTint', 'Primary Hair Tint', 0, 1, 0.02],
  ['secondaryTint', 'Secondary Hair Tint', 0, 1, 0.02],
  ['sheenStrength', 'Sheen Band', 0, 1.5, 0.02],
  ['sheenPower', 'Sheen Sharpness', 4, 60, 1],
  ['sheenShift', 'Sheen Shift', -0.5, 0.5, 0.01],
  ['sheenTint', 'Sheen Hair Tint', 0, 1, 0.02],
  ['shiftJitter', 'Highlight Jitter', 0, 1, 0.02],
  ['specBreakup', 'Highlight Breakup', 0, 1, 0.02],
  ['flowStrength', 'Strand Flow', 0, 1.5, 0.02],
  ['shadowLift', 'Shadow Lift', 0, 1, 0.02],
  ['clumpVariation', 'Clump Variation', 0, 0.5, 0.01],
  ['tipLighten', 'Tip Lighten', 0, 0.5, 0.01],
];

const CARD_BAKE_SLIDERS: [keyof CardBakeSettings, string, number, number, number][] = [
  ['strands', 'Strands', 120, 1200, 10],
  ['clumps', 'Clumps', 3, 32, 1],
  ['clumpTightness', 'Clump Tightness', 0, 1, 0.02],
  ['strandWidthPx', 'Strand Width (px)', 1, 6, 0.1],
  ['frizz', 'Frizz', 0, 0.02, 0.0005],
  ['wave', 'Clump Wave', 0, 0.05, 0.001],
  ['tipStagger', 'Tip Stagger', 0, 1, 0.02],
  ['strays', 'Stray Strands', 0, 0.3, 0.01],
  ['seed', 'Bake Seed', 1, 9999, 1],
];

type DockTab = 'presets' | 'builder' | 'shader' | 'physics' | 'scene' | 'inspect';

interface BottomControlDockProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  presetId: HairPresetId;
  onSelectPreset: (id: HairPresetId) => void;
  builderConfig: HairBuilderConfig | null;
  /** The builder config as the hair is built (with the loaded head's ears), for the shape shell editor. */
  buildConfig?: HairBuilderConfig | null;
  onShellPreview?: (shell: HairShellGrid | null) => void;
  customStyleName: string | null;
  onChangeBuilder: (patch: Partial<HairBuilderConfig>) => void;
  onRandomizeStyle: () => void;
  onRandomizeShape: () => void;
  onRandomizeColor: () => void;
  onSelectPalette: (paletteId: string) => void;
  onResetToPreset: () => void;
  shader: ShaderConfig;
  onChangeShader: (patch: Partial<ShaderConfig>) => void;
  physics: PhysicsConfig;
  onChangePhysics: (patch: Partial<PhysicsConfig>) => void;
  motionMode: MotionMode;
  onChangeMotion: (mode: MotionMode) => void;
  lightingPreset: LightingPresetId;
  onChangeLighting: (preset: LightingPresetId) => void;
  cameraPreset: CameraPresetId;
  onChangeCamera: (preset: CameraPresetId) => void;
  visionMode: VisionDebugMode;
  onChangeVisionMode: (mode: VisionDebugMode) => void;
  backdropMode: BackdropMode;
  onChangeBackdropMode: (mode: BackdropMode) => void;
  qualityAudit: HairQualityAudit | null;
  onRunDeterministicAudit: () => void;
  onCopyRecipeJson: () => Promise<boolean>;
  onImportRecipeJson: (raw: string) => { ok: boolean; error?: string };
  onCopyCaptureUrl: () => Promise<boolean>;
  onTriggerImpulse: () => void;
  onResetCamera: () => void;
  onCaptureTurnaround: () => void;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (val: number) => void;
}

function SliderRow({ label, value, min, max, step, unit = '', onChange }: SliderRowProps) {
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-300 truncate">{label}</span>
        <span className="font-mono tabular-nums text-slate-400">
          {value.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        className="studio-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

interface ColorSwatchInputProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}

function ColorSwatchInput({ label, value, onChange }: ColorSwatchInputProps) {
  return (
    <label className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-[#161a24] border border-white/8 cursor-pointer hover:border-white/20 transition-colors">
      <span className="text-xs text-slate-300 whitespace-nowrap">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase text-slate-400 tabular-nums hidden sm:inline">
          {value}
        </span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-5 h-5 rounded border border-white/15 bg-transparent cursor-pointer p-0"
        />
      </div>
    </label>
  );
}

export function BottomControlDock({
  collapsed,
  onToggleCollapse,
  presetId,
  onSelectPreset,
  builderConfig,
  buildConfig,
  onShellPreview,
  customStyleName,
  onChangeBuilder,
  onRandomizeStyle,
  onRandomizeShape,
  onRandomizeColor,
  onSelectPalette,
  onResetToPreset,
  shader,
  onChangeShader,
  physics,
  onChangePhysics,
  motionMode,
  onChangeMotion,
  lightingPreset,
  onChangeLighting,
  cameraPreset,
  onChangeCamera,
  visionMode,
  onChangeVisionMode,
  backdropMode,
  onChangeBackdropMode,
  qualityAudit,
  onRunDeterministicAudit,
  onCopyRecipeJson,
  onImportRecipeJson,
  onCopyCaptureUrl,
  onTriggerImpulse,
  onResetCamera,
  onCaptureTurnaround,
}: BottomControlDockProps) {
  const [activeTab, setActiveTab] = useState<DockTab>('presets');
  const [copiedRecipe, setCopiedRecipe] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [showImportBox, setShowImportBox] = useState(false);
  const [importDraft, setImportDraft] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [shellOpen, setShellOpen] = useState(false);
  const noPreview = useCallback(() => {}, []);

  const activeBuilder: HairBuilderConfig = builderConfig ?? DEFAULT_BUILDER_BY_PRESET[presetId];

  const tabs: { id: DockTab; label: string }[] = [
    { id: 'presets', label: 'Presets' },
    { id: 'builder', label: 'Builder' },
    { id: 'shader', label: 'Shader' },
    { id: 'physics', label: 'Physics' },
    { id: 'scene', label: 'Scene' },
    { id: 'inspect', label: 'AI / Inspect' },
  ];

  const archetypeOptions = ARCHETYPE_METADATA;

  const motionModes: { id: MotionMode; label: string }[] = [
    { id: 'idle', label: 'Idle' },
    { id: 'walk', label: 'Walk' },
    { id: 'turn', label: 'Head Turn' },
    { id: 'gust', label: 'Wind Surge' },
  ];

  const lightingOptions: { id: LightingPresetId; label: string }[] = [
    { id: 'studio', label: 'Neutral Studio' },
    { id: 'midgar', label: 'Night Rim' },
    { id: 'sunset', label: 'Golden Hour' },
  ];

  const cameraOptions: { id: CameraPresetId; label: string }[] = [
    { id: 'hero', label: '3/4 Hero' },
    { id: 'front', label: 'Front' },
    { id: 'left', label: 'Left' },
    { id: 'right', label: 'Right' },
    { id: 'back', label: 'Back' },
  ];

  const visionOptions: { id: VisionDebugMode; label: string }[] = [
    { id: 'shaded', label: 'Shaded' },
    { id: 'zones', label: 'Strand ID' },
    { id: 'clearance', label: 'Clearance' },
    { id: 'normals', label: 'Normals' },
    { id: 'uv', label: 'UV Flow' },
    { id: 'silhouette', label: 'Silhouette' },
    { id: 'motion', label: 'Motion' },
  ];

  const backdropOptions: { id: BackdropMode; label: string }[] = [
    { id: 'lighting', label: 'Scene' },
    { id: 'matte-gray', label: 'Matte Gray' },
    { id: 'high-contrast', label: 'Contrast' },
    { id: 'chroma-green', label: 'Chroma' },
  ];

  const handleCopyRecipe = async () => {
    const ok = await onCopyRecipeJson();
    if (ok) {
      setCopiedRecipe(true);
      window.setTimeout(() => setCopiedRecipe(false), 1800);
    }
  };

  const handleCopyUrl = async () => {
    const ok = await onCopyCaptureUrl();
    if (ok) {
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 1800);
    }
  };

  const handleApplyImport = () => {
    const res = onImportRecipeJson(importDraft);
    if (res.ok) {
      setImportError(null);
      setImportDraft('');
      setShowImportBox(false);
    } else {
      setImportError(res.error ?? 'Invalid JSON recipe');
    }
  };

  const verdictColorClass =
    qualityAudit?.verdict === 'FAIL'
      ? 'text-rose-400'
      : qualityAudit?.verdict === 'WARN'
        ? 'text-amber-300'
        : 'text-emerald-400';

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(980px,95vw)] pointer-events-none flex flex-col items-center">
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-1.5 mb-2 rounded-md bg-[#11141c] border border-white/12 text-xs font-medium text-slate-300 hover:text-white hover:border-white/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        <span>{collapsed ? 'Show Controls' : 'Hide Controls'}</span>
      </button>

      <div
        className={`pointer-events-auto w-full rounded-xl bg-[#0f1219] border border-white/12 shadow-2xl transition-all duration-200 origin-bottom ${
          collapsed
            ? 'opacity-0 translate-y-6 pointer-events-none h-0 overflow-hidden border-0'
            : 'opacity-100 translate-y-0'
        }`}
      >
        {/* Dock Tab Row */}
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-white/8">
          <div className="flex items-center gap-1 bg-[#161a24] p-1 rounded-lg overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-[#e5a93c] text-[#0b0d12]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={onRandomizeStyle}
              title="Generate a random procedural Final Fantasy hairstyle"
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-md bg-[#231d12] text-amber-200 border border-amber-400/40 hover:bg-[#2d2415] hover:border-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>Randomize</span>
            </button>
            <button
              type="button"
              onClick={onCaptureTurnaround}
              title="Capture 4-view turnaround sheet"
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-md bg-[#191e2b] text-slate-200 border border-white/10 hover:border-amber-400/50 hover:text-amber-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              <span className="hidden md:inline">4-View Capture</span>
            </button>
            <button
              type="button"
              onClick={onTriggerImpulse}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-md bg-[#191e2b] text-slate-200 border border-white/10 hover:border-amber-400/50 hover:text-amber-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Wind className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Wind Gust</span>
            </button>
            <button
              type="button"
              onClick={onResetCamera}
              title="Reset camera angle"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#191e2b] text-slate-300 border border-white/10 hover:text-white hover:border-white/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Reset View</span>
            </button>
          </div>
        </div>

        {/* Active Tab Content */}
        <div className="p-3.5 sm:p-4 max-h-[46vh] overflow-y-auto studio-scroll">
          {activeTab === 'presets' && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {(Object.keys(HAIR_PRESETS) as HairPresetId[]).map((id) => {
                  const p = HAIR_PRESETS[id];
                  const active = !builderConfig && presetId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSelectPreset(id)}
                      className={`text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#1a1f2d] border-[#e5a93c] text-white'
                          : 'bg-[#141822] border-white/8 text-slate-300 hover:border-white/20 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold truncate">{p.name}</span>
                        <span
                          className="w-3 h-3 rounded-full shrink-0 border border-white/20"
                          style={{ background: p.shader.baseColor }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">{p.subtitle}</p>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1.5 border-t border-white/8">
                <span className="text-xs text-slate-400">Character Motion</span>
                <div className="flex items-center gap-1 bg-[#161a24] p-1 rounded-lg">
                  {motionModes.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onChangeMotion(m.id)}
                      className={`px-2.5 sm:px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        motionMode === m.id
                          ? 'bg-[#262d3f] text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'builder' && (
            <div className="space-y-3">
              {/* Row 1: 12 Iconic FF/JRPG Silhouette Archetypes */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Hair Archetype (12 Silhouettes)</span>
                  <span className="text-[11px] text-slate-500">
                    {archetypeOptions.find((a) => a.id === activeBuilder.archetype)?.inspiration ?? ''}
                  </span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
                  {archetypeOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      title={`${opt.label} (${opt.inspiration})`}
                      onClick={() => onChangeBuilder({ archetype: opt.id })}
                      className={`py-1.5 px-2 text-xs font-medium rounded-md border transition-colors truncate cursor-pointer ${
                        activeBuilder.archetype === opt.id
                          ? 'bg-[#1a1f2d] border-[#e5a93c] text-white'
                          : 'bg-[#141822] border-white/8 text-slate-300 hover:text-white hover:border-white/20'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 1b: 20 Curated FF/JRPG Color Palettes */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-white/8">
                <span className="text-xs text-slate-400 shrink-0">Curated Palettes</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {CURATED_HAIR_PALETTES.map((pal) => {
                    const isActive = shader.baseColor.toLowerCase() === pal.shader.baseColor.toLowerCase();
                    return (
                      <button
                        key={pal.id}
                        type="button"
                        title={pal.label}
                        onClick={() => onSelectPalette(pal.id)}
                        className={`w-5 h-5 rounded-md border transition-transform cursor-pointer ${
                          isActive
                            ? 'border-[#e5a93c] scale-110 ring-1 ring-[#e5a93c]/60'
                            : 'border-white/20 hover:scale-110 hover:border-white/50'
                        }`}
                        style={{
                          background: `linear-gradient(135deg, ${pal.shader.rootColor} 0%, ${pal.shader.baseColor} 55%, ${pal.shader.tipColor} 100%)`,
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Row 2: Parametric Sculpting Sliders */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-3 pt-2 border-t border-white/8">
                <SliderRow
                  label="Parting"
                  value={activeBuilder.partPosition}
                  min={-0.8}
                  max={0.8}
                  step={0.05}
                  onChange={(partPosition) => onChangeBuilder({ partPosition })}
                />
                <SliderRow
                  label="Bangs Length"
                  value={activeBuilder.bangsLength}
                  min={0.2}
                  max={1.0}
                  step={0.02}
                  onChange={(bangsLength) => onChangeBuilder({ bangsLength })}
                />
                <SliderRow
                  label="Bangs Sweep"
                  value={activeBuilder.bangsSweep}
                  min={-1.0}
                  max={1.0}
                  step={0.05}
                  onChange={(bangsSweep) => onChangeBuilder({ bangsSweep })}
                />
                <SliderRow
                  label="Crown Volume"
                  value={activeBuilder.crownVolume}
                  min={0.1}
                  max={1.0}
                  step={0.02}
                  onChange={(crownVolume) => onChangeBuilder({ crownVolume })}
                />
                <SliderRow
                  label="Spike Lift"
                  value={activeBuilder.spikeLift}
                  min={0.0}
                  max={1.0}
                  step={0.02}
                  onChange={(spikeLift) => onChangeBuilder({ spikeLift })}
                />
                <SliderRow
                  label="Side Length"
                  value={activeBuilder.sideLength}
                  min={0.15}
                  max={1.0}
                  step={0.02}
                  onChange={(sideLength) => onChangeBuilder({ sideLength })}
                />
                <SliderRow
                  label="Back Length"
                  value={activeBuilder.backLength}
                  min={0.2}
                  max={1.0}
                  step={0.02}
                  onChange={(backLength) => onChangeBuilder({ backLength })}
                />
                <SliderRow
                  label="Layer Shag"
                  value={activeBuilder.layerShag}
                  min={0.0}
                  max={1.0}
                  step={0.02}
                  onChange={(layerShag) => onChangeBuilder({ layerShag })}
                />
                <SliderRow
                  label="Density"
                  value={activeBuilder.density}
                  min={0.7}
                  max={1.2}
                  step={0.05}
                  unit="x"
                  onChange={(density) => onChangeBuilder({ density })}
                />
                <SliderRow
                  label="Lock Width"
                  value={activeBuilder.strandWidth}
                  min={0.75}
                  max={1.25}
                  step={0.02}
                  unit="x"
                  onChange={(strandWidth) => onChangeBuilder({ strandWidth })}
                />
                <SliderRow
                  label="Hairline Softness"
                  value={activeBuilder.hairlineSoftness ?? 0.5}
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  onChange={(hairlineSoftness) => onChangeBuilder({ hairlineSoftness })}
                />
                <SliderRow
                  label="Hairline Unevenness"
                  value={activeBuilder.hairlineIrregularity ?? 0.5}
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  onChange={(hairlineIrregularity) => onChangeBuilder({ hairlineIrregularity })}
                />
                <SliderRow
                  label="Fade Height"
                  value={activeBuilder.fadeHeight ?? 0.4}
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  onChange={(fadeHeight) => onChangeBuilder({ fadeHeight })}
                />
                <SliderRow
                  label="Fade Blend"
                  value={activeBuilder.fadeBlend ?? 0.75}
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  onChange={(fadeBlend) => onChangeBuilder({ fadeBlend })}
                />
                <div className="flex flex-col gap-1">
                  <ColorSwatchInput
                    label={activeBuilder.scalpColor ? 'Hairline Tint' : 'Hairline: hair colour'}
                    value={activeBuilder.scalpColor ?? '#3a2a20'}
                    onChange={(scalpColor) => onChangeBuilder({ scalpColor })}
                  />
                  {activeBuilder.scalpColor && (
                    <button
                      type="button"
                      onClick={() => onChangeBuilder({ scalpColor: undefined })}
                      className="text-[11px] text-slate-400 hover:text-slate-200 text-left cursor-pointer"
                    >
                      Match hair colour
                    </button>
                  )}
                </div>
              </div>

              {/* Shape shell: the outer shape as an editable thickness grid (hairShell.ts) */}
              <div className="pt-2 border-t border-white/8">
                <button
                  type="button"
                  onClick={() => setShellOpen((o) => !o)}
                  aria-expanded={shellOpen}
                  className="text-xs text-slate-300 hover:text-white cursor-pointer"
                >
                  {shellOpen ? 'Hide shape shell' : `Shape shell${activeBuilder.shell ? ' (on)' : ''}: edit the outer shape`}
                </button>
                {shellOpen && (
                  <HairShellEditor
                    config={buildConfig ?? activeBuilder}
                    onChange={(shell) => onChangeBuilder({ shell })}
                    onPreview={onShellPreview ?? noPreview}
                  />
                )}
              </div>

              {/* Row 3: Procedural Generator & Live Sculpt Status */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/8">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono tabular-nums text-slate-400">
                  <span className="text-slate-200 font-sans font-medium">
                    {customStyleName ?? `${HAIR_PRESETS[presetId].name} (Base)`}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Seed #{String(activeBuilder.seed % 10000).padStart(4, '0')}</span>
                  {qualityAudit && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className={verdictColorClass}>
                        Judge {qualityAudit.verdict} {qualityAudit.score}/100
                      </span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onRandomizeStyle}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-[#e5a93c] text-[#0b0d12] hover:bg-[#f0b84d] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                    <span>Randomize All</span>
                  </button>
                  <button
                    type="button"
                    onClick={onRandomizeShape}
                    title="Randomize silhouette & sliders while keeping current color"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#191e2b] text-slate-200 border border-white/10 hover:border-amber-400/50 hover:text-amber-200 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Scissors className="w-3.5 h-3.5" />
                    <span>Random Shape</span>
                  </button>
                  <button
                    type="button"
                    onClick={onRandomizeColor}
                    title="Randomize curated FF hair color palette while keeping current sculpt"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#191e2b] text-slate-200 border border-white/10 hover:border-amber-400/50 hover:text-amber-200 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Palette className="w-3.5 h-3.5" />
                    <span>Random Color</span>
                  </button>
                  {builderConfig && (
                    <button
                      type="button"
                      onClick={onResetToPreset}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#161a24] text-slate-300 border border-white/10 hover:text-white hover:border-white/25 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset Preset</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'shader' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <ColorSwatchInput
                  label="Root"
                  value={shader.rootColor}
                  onChange={(rootColor) => onChangeShader({ rootColor })}
                />
                <ColorSwatchInput
                  label="Base"
                  value={shader.baseColor}
                  onChange={(baseColor) => onChangeShader({ baseColor })}
                />
                <ColorSwatchInput
                  label="Tip"
                  value={shader.tipColor}
                  onChange={(tipColor) => onChangeShader({ tipColor })}
                />
                <ColorSwatchInput
                  label="Spec 1"
                  value={shader.primarySpecColor}
                  onChange={(primarySpecColor) => onChangeShader({ primarySpecColor })}
                />
                <ColorSwatchInput
                  label="Spec 2"
                  value={shader.secondarySpecColor}
                  onChange={(secondarySpecColor) => onChangeShader({ secondarySpecColor })}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3">
                <SliderRow
                  label="Primary Shift"
                  value={shader.primaryShift}
                  min={-0.45}
                  max={0.45}
                  step={0.01}
                  onChange={(primaryShift) => onChangeShader({ primaryShift })}
                />
                <SliderRow
                  label="Primary Gloss"
                  value={shader.primaryPower}
                  min={24}
                  max={220}
                  step={2}
                  onChange={(primaryPower) => onChangeShader({ primaryPower })}
                />
                <SliderRow
                  label="Secondary Shift"
                  value={shader.secondaryShift}
                  min={-0.45}
                  max={0.45}
                  step={0.01}
                  onChange={(secondaryShift) => onChangeShader({ secondaryShift })}
                />
                <SliderRow
                  label="Secondary Spec"
                  value={shader.secondaryIntensity}
                  min={0}
                  max={1.2}
                  step={0.02}
                  onChange={(secondaryIntensity) => onChangeShader({ secondaryIntensity })}
                />
                <SliderRow
                  label="Rim Backlight"
                  value={shader.rimIntensity}
                  min={0}
                  max={1.5}
                  step={0.02}
                  onChange={(rimIntensity) => onChangeShader({ rimIntensity })}
                />
                <SliderRow
                  label="Root Occlusion"
                  value={shader.rootAO}
                  min={0}
                  max={0.95}
                  step={0.02}
                  onChange={(rootAO) => onChangeShader({ rootAO })}
                />
                <SliderRow
                  label="Fiber Grooves"
                  value={shader.grooveDepth}
                  min={0.15}
                  max={1.0}
                  step={0.02}
                  onChange={(grooveDepth) => onChangeShader({ grooveDepth })}
                />
                <SliderRow
                  label="Strand Variation"
                  value={shader.strandVariation}
                  min={0}
                  max={0.4}
                  step={0.01}
                  onChange={(strandVariation) => onChangeShader({ strandVariation })}
                />
                <SliderRow
                  label="Primary Spec"
                  value={shader.primaryIntensity}
                  min={0}
                  max={1.5}
                  step={0.02}
                  onChange={(primaryIntensity) => onChangeShader({ primaryIntensity })}
                />
                <SliderRow
                  label="Secondary Gloss"
                  value={shader.secondaryPower}
                  min={8}
                  max={120}
                  step={1}
                  onChange={(secondaryPower) => onChangeShader({ secondaryPower })}
                />
              </div>

              {/* Hair sheen look (engine/hairShadingModel.ts SHEEN_DEFAULTS; docs/SHARED_TOOLS.md "Hair sheen") */}
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Sheen look</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3">
                {SHEEN_SLIDERS.map(([key, label, min, max, step]) => (
                  <SliderRow
                    key={key}
                    label={label}
                    value={(shader[key] as number | undefined) ?? SHEEN_DEFAULTS[key]}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(v) => onChangeShader({ [key]: v } as Partial<ShaderConfig>)}
                  />
                ))}
              </div>

              {/* Hair-card strand maps (engine/cardBake.ts; docs/SHARED_TOOLS.md "Hair-card baking") */}
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-slate-400">
                <span>Card strands</span>
                <button
                  type="button"
                  className="rounded border border-slate-600 px-2 py-0.5 normal-case tracking-normal text-slate-200"
                  onClick={() => onChangeShader({ cardTextures: shader.cardTextures === 'procedural' ? 'baked' : 'procedural' })}
                >
                  {shader.cardTextures === 'procedural' ? 'Procedural (old)' : 'Baked from strands'}
                </button>
              </div>
              {shader.cardTextures !== 'procedural' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3">
                  {CARD_BAKE_SLIDERS.map(([key, label, min, max, step]) => (
                    <SliderRow
                      key={key}
                      label={label}
                      value={(shader.cardBake?.[key] as number | undefined) ?? CARD_BAKE_DEFAULTS[key]}
                      min={min}
                      max={max}
                      step={step}
                      onChange={(v) => onChangeShader({ cardBake: { ...(shader.cardBake ?? {}), [key]: v } })}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'physics' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3">
                <SliderRow
                  label="Shape Stiffness"
                  value={physics.stiffness}
                  min={0.05}
                  max={0.95}
                  step={0.01}
                  onChange={(stiffness) => onChangePhysics({ stiffness })}
                />
                <SliderRow
                  label="Gravity"
                  value={physics.gravity}
                  min={0}
                  max={16}
                  step={0.2}
                  unit=" m/s²"
                  onChange={(gravity) => onChangePhysics({ gravity })}
                />
                <SliderRow
                  label="Wind Strength"
                  value={physics.windStrength}
                  min={0}
                  max={12}
                  step={0.2}
                  onChange={(windStrength) => onChangePhysics({ windStrength })}
                />
                <SliderRow
                  label="Turbulence"
                  value={physics.windTurbulence}
                  min={0}
                  max={1.5}
                  step={0.05}
                  onChange={(windTurbulence) => onChangePhysics({ windTurbulence })}
                />
                <SliderRow
                  label="Wind Angle"
                  value={physics.windAzimuth}
                  min={0}
                  max={360}
                  step={5}
                  unit="°"
                  onChange={(windAzimuth) => onChangePhysics({ windAzimuth })}
                />
                <SliderRow
                  label="Damping"
                  value={physics.damping}
                  min={0.01}
                  max={0.25}
                  step={0.005}
                  onChange={(damping) => onChangePhysics({ damping })}
                />
                <SliderRow
                  label="Head Inertia"
                  value={physics.inertia}
                  min={0}
                  max={1.5}
                  step={0.05}
                  onChange={(inertia) => onChangePhysics({ inertia })}
                />
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => onChangePhysics({ collisionEnabled: !physics.collisionEnabled })}
                    className={`flex-1 py-1.5 px-2.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                      physics.collisionEnabled
                        ? 'bg-[#1c2434] border-sky-400/50 text-sky-200'
                        : 'bg-[#141822] border-white/10 text-slate-400'
                    }`}
                  >
                    Collisions: {physics.collisionEnabled ? 'On' : 'Off'}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/8">
                <span className="text-xs text-slate-400">Unity Rig Debug Overlays</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onChangePhysics({ showColliders: !physics.showColliders })}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                      physics.showColliders
                        ? 'bg-[#172638] border-sky-400/60 text-sky-200'
                        : 'bg-[#161a24] border-white/10 text-slate-300 hover:text-white'
                    }`}
                  >
                    {physics.showColliders ? 'Hide Colliders' : 'Show Colliders'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangePhysics({ showBones: !physics.showBones })}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                      physics.showBones
                        ? 'bg-[#2c2214] border-amber-400/60 text-amber-200'
                        : 'bg-[#161a24] border-white/10 text-slate-300 hover:text-white'
                    }`}
                  >
                    {physics.showBones ? 'Hide Bone Chains' : 'Show Bone Chains'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'scene' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="block text-xs text-slate-400">Camera Angle</span>
                <div className="grid grid-cols-5 gap-1.5">
                  {cameraOptions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onChangeCamera(c.id)}
                      className={`py-2 px-2.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                        cameraPreset === c.id
                          ? 'bg-[#1a1f2d] border-[#e5a93c] text-white'
                          : 'bg-[#141822] border-white/8 text-slate-300 hover:text-white'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-xs text-slate-400">Lighting Environment</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {lightingOptions.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => onChangeLighting(l.id)}
                      className={`py-2 px-2.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                        lightingPreset === l.id
                          ? 'bg-[#1a1f2d] border-[#e5a93c] text-white'
                          : 'bg-[#141822] border-white/8 text-slate-300 hover:text-white'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'inspect' && (
            <div className="space-y-3.5">
              {/* Row 1: Vision Shading & Backdrop Override */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                <div className="lg:col-span-8 space-y-1.5">
                  <span className="block text-xs text-slate-400">Vision Diagnostic Shader</span>
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                    {visionOptions.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onChangeVisionMode(opt.id)}
                        className={`py-1.5 px-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                          visionMode === opt.id
                            ? 'bg-[#1a1f2d] border-[#e5a93c] text-white'
                            : 'bg-[#141822] border-white/8 text-slate-300 hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-4 space-y-1.5">
                  <span className="block text-xs text-slate-400">Backdrop Segmentation</span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {backdropOptions.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onChangeBackdropMode(opt.id)}
                        className={`py-1.5 px-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                          backdropMode === opt.id
                            ? 'bg-[#1a1f2d] border-[#e5a93c] text-white'
                            : 'bg-[#141822] border-white/8 text-slate-300 hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Row 2: Solver Quality & Anti-Kink Precision */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-3 pt-2 border-t border-white/8">
                <SliderRow
                  label="Anti-Kink Smooth"
                  value={physics.bendingSmoothness}
                  min={0}
                  max={0.95}
                  step={0.02}
                  onChange={(bendingSmoothness) => onChangePhysics({ bendingSmoothness })}
                />
                <SliderRow
                  label="Skull Margin"
                  value={physics.collisionMarginMm}
                  min={2}
                  max={20}
                  step={1}
                  unit=" mm"
                  onChange={(collisionMarginMm) => onChangePhysics({ collisionMarginMm })}
                />
                <SliderRow
                  label="Root Anchor"
                  value={physics.rootAnchor}
                  min={0.1}
                  max={1.0}
                  step={0.02}
                  onChange={(rootAnchor) => onChangePhysics({ rootAnchor })}
                />
                <SliderRow
                  label="Strand Width"
                  value={physics.strandWidthScale}
                  min={0.7}
                  max={1.4}
                  step={0.02}
                  unit="x"
                  onChange={(strandWidthScale) => onChangePhysics({ strandWidthScale })}
                />
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-slate-300">Solver Substeps</span>
                  <div className="grid grid-cols-4 gap-1 bg-[#161a24] p-0.5 rounded-md border border-white/8">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => onChangePhysics({ solverSubsteps: n })}
                        className={`py-1 text-xs font-mono tabular-nums rounded transition-colors cursor-pointer ${
                          physics.solverSubsteps === n
                            ? 'bg-[#e5a93c] text-[#0b0d12] font-semibold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {n}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Row 3: Verifiable AI Judge Scorecard & Actions */}
              <div className="space-y-2 pt-2.5 border-t border-white/8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs font-mono tabular-nums">
                    <span className={`font-semibold ${verdictColorClass}`}>
                      {qualityAudit ? `${qualityAudit.verdict} ${qualityAudit.score}/100` : 'READY'}
                    </span>
                    <span className={qualityAudit && qualityAudit.scalpCoveragePct < 96 ? 'text-rose-400' : 'text-emerald-400'}>
                      Scalp: {qualityAudit ? `${qualityAudit.scalpCoveragePct.toFixed(1)}%` : '100.0%'}
                    </span>
                    <span className={qualityAudit && qualityAudit.oscillatingNodes > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                      Bounce: {qualityAudit ? qualityAudit.oscillatingNodes : 0}
                    </span>
                    <span className={qualityAudit && qualityAudit.interLockClipPct > 8.5 ? 'text-amber-300' : 'text-slate-300'}>
                      Clip: {qualityAudit ? `${qualityAudit.interLockClipPct.toFixed(1)}%` : '0.0%'}
                    </span>
                    <span className={qualityAudit && qualityAudit.penetratingNodes > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                      Pen: {qualityAudit ? qualityAudit.penetratingNodes : 0}
                    </span>
                    <span className={qualityAudit && (qualityAudit.floatingRootCount > 0 || qualityAudit.crownHookCount > 0) ? 'text-rose-400' : 'text-slate-300'}>
                      Float/Hook: {qualityAudit ? `${qualityAudit.floatingRootCount}/${qualityAudit.crownHookCount}` : '0/0'}
                    </span>
                    <span className={qualityAudit && qualityAudit.maxKinkAngleDeg > 28 ? 'text-amber-300' : 'text-slate-300'}>
                      Kink: {qualityAudit ? `${qualityAudit.maxKinkAngleDeg.toFixed(1)}°` : '0.0°'}
                    </span>
                    <span className="text-slate-300">
                      Smooth: {qualityAudit ? `${qualityAudit.swaySmoothnessPct.toFixed(0)}%` : '100%'}
                    </span>
                    <span className="text-slate-400">
                      Sway: {qualityAudit ? `${qualityAudit.meanTipSwayCm.toFixed(2)}cm` : '0.00cm'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={onRunDeterministicAudit}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#191e2b] text-slate-200 border border-white/10 hover:border-amber-400/50 hover:text-amber-200 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Play className="w-3 h-3" />
                      <span>Judge 5s (300f)</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyRecipe}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#161a24] text-slate-200 border border-white/10 hover:text-white hover:border-white/25 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      {copiedRecipe ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
                      <span>{copiedRecipe ? 'Copied JSON' : 'Copy JSON'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowImportBox((v) => !v);
                        setImportError(null);
                      }}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                        showImportBox
                          ? 'bg-[#1a1f2d] border-[#e5a93c] text-white'
                          : 'bg-[#161a24] text-slate-200 border-white/10 hover:text-white hover:border-white/25'
                      }`}
                    >
                      <FileJson2 className="w-3.5 h-3.5" />
                      <span>Import JSON</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyUrl}
                      title="Copy zero-loop headless capture URL for current style, motion, and vision mode"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#161a24] text-slate-200 border border-white/10 hover:text-white hover:border-white/25 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Link2 className="w-3.5 h-3.5" />}
                      <span>{copiedUrl ? 'Copied URL' : 'Capture URL'}</span>
                    </button>
                  </div>
                </div>

                {qualityAudit && qualityAudit.issues.length > 0 && (
                  <p className="text-[11px] font-mono text-slate-400 truncate">
                    {qualityAudit.issues.join(' · ')}
                  </p>
                )}
              </div>

              {showImportBox && (
                <div className="pt-2 border-t border-white/8 space-y-2">
                  <textarea
                    value={importDraft}
                    onChange={(e) => setImportDraft(e.target.value)}
                    placeholder='Paste AetherStrand Recipe JSON ({"schemaVersion":"2.0", ...})'
                    rows={3}
                    className="w-full rounded-md bg-[#0a0d13] border border-white/12 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-[#e5a93c]"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-rose-400">{importError ?? ''}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowImportBox(false)}
                        className="px-2.5 py-1 text-xs text-slate-400 hover:text-white cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleApplyImport}
                        className="px-3 py-1 rounded-md bg-[#e5a93c] text-[#0b0d12] text-xs font-semibold hover:bg-[#f0b84d] cursor-pointer"
                      >
                        Apply Recipe
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
