import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2 } from 'lucide-react';
import { canvasToPngBlob, HairTexturePack } from '../engine/hairTextures';
import { PluginFileEntry, RenderPipeline, WorkspaceView } from '../types/hair';

interface PluginStudioPanelProps {
  mode: Exclude<WorkspaceView, 'viewport'>;
  files: PluginFileEntry[];
  pipeline: RenderPipeline;
  onChangePipeline: (p: RenderPipeline) => void;
  texturePack: HairTexturePack | null;
  onExportZip: () => void;
  exporting: boolean;
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function PluginStudioPanel({
  mode,
  files,
  pipeline,
  onChangePipeline,
  texturePack,
  onExportZip,
  exporting,
}: PluginStudioPanelProps) {
  const filteredFiles = useMemo(() => {
    if (mode === 'unity') return files.filter((f) => f.category === 'unity');
    if (mode === 'blender') return files.filter((f) => f.category === 'blender');
    return [];
  }, [files, mode]);

  const [selectedPath, setSelectedPath] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (filteredFiles.length > 0 && !filteredFiles.some((f) => f.path === selectedPath)) {
      setSelectedPath(filteredFiles[0].path);
    }
  }, [filteredFiles, selectedPath]);

  const activeFile = filteredFiles.find((f) => f.path === selectedPath) ?? filteredFiles[0];

  const texturePreviews = useMemo(() => {
    if (!texturePack) return [];
    return [
      {
        id: 'groove',
        filename: 'AetherStrand_GrooveAO.png',
        title: 'Carved Strand Groove AO',
        specs: '512 × 1024 · Seamless X · Fiber Crevice Depth',
        usage: 'Assign to _GrooveAoMap in Unity (sRGB Off). Gives sculpted 3D locks carved individual hair furrows and shadow crevices.',
        canvas: texturePack.grooveAoCanvas,
        dataUrl: texturePack.grooveAoCanvas.toDataURL('image/png'),
      },
      {
        id: 'flow',
        filename: 'AetherStrand_FlowIDShift.png',
        title: 'Flow / Strand ID / Shift Map',
        specs: '512 × 1024 · Linear · R=ID · G=Grad · B=Shift',
        usage: 'Assign to _FlowIdMap (sRGB Off). Breaks Kajiya-Kay anisotropic sheen into natural gleaming fiber bands.',
        canvas: texturePack.flowIdCanvas,
        dataUrl: texturePack.flowIdCanvas.toDataURL('image/png'),
      },
      {
        id: 'normal',
        filename: 'AetherStrand_Normal.png',
        title: 'Strand Tangent Normal Map',
        specs: '512 × 1024 · Normal Map · Analytical Fiber Ridges',
        usage: 'Assign to _NormalMap (Texture Type: Normal map). Drives cylindrical micro-strand specular lighting.',
        canvas: texturePack.normalCanvas,
        dataUrl: texturePack.normalCanvas.toDataURL('image/png'),
      },
      {
        id: 'alpha',
        filename: 'AetherStrand_AlphaCard.png',
        title: 'Optional Alpha-Card Mask',
        specs: '512 × 1024 · Linear · Tapered Flyaway Card',
        usage: 'Optional mask for hybrid flyaway cards when _UseAlphaClip is enabled in Unity.',
        canvas: texturePack.alphaCardCanvas,
        dataUrl: texturePack.alphaCardCanvas.toDataURL('image/png'),
      },
    ];
  }, [texturePack]);

  const handleCopy = async () => {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const handleDownloadPng = async (canvas: HTMLCanvasElement, filename: string) => {
    const blob = await canvasToPngBlob(canvas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (mode === 'textures') {
    return (
      <div className="fixed inset-0 top-14 z-30 bg-[#0b0d12] overflow-y-auto studio-scroll">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
            <div className="space-y-1">
              <h1 className="font-display text-2xl font-semibold text-white">
                Sculpted Hair Fiber Texture Pack
              </h1>
              <p className="text-sm text-slate-400">
                Seamless carved-fiber Groove AO, Flow/Shift, Tangent Normal, and optional Alpha Card maps bundled inside your ZIP export.
              </p>
            </div>
            <button
              type="button"
              onClick={onExportZip}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#e5a93c] text-[#0b0d12] text-xs font-semibold hover:bg-[#f0b84d] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{exporting ? 'Bundling ZIP...' : 'Export Complete Plugin ZIP'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {texturePreviews.map((tex) => (
              <div
                key={tex.id}
                className="flex flex-col rounded-xl bg-[#11141d] border border-white/10 overflow-hidden"
              >
                <div className="aspect-[3/4] bg-[#080a0f] flex items-center justify-center p-3 border-b border-white/8">
                  <img
                    src={tex.dataUrl}
                    alt={tex.title}
                    className="h-full w-auto object-contain rounded border border-white/10"
                  />
                </div>
                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold text-white">{tex.title}</h2>
                    <p className="text-[11px] font-mono text-slate-400 tabular-nums">{tex.specs}</p>
                    <p className="text-xs text-slate-300 leading-relaxed pt-1">{tex.usage}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownloadPng(tex.canvas, tex.filename)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#1a1f2d] border border-white/10 text-xs font-medium text-slate-200 hover:text-white hover:border-white/25 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span className="truncate">Download PNG</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 top-14 z-30 bg-[#0b0d12] flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5 bg-[#0f1219] border-b border-white/10">
        <div className="space-y-0.5 min-w-0">
          <h1 className="font-display text-lg font-semibold text-white">
            {mode === 'unity' ? 'Unity Hair Plugin Source' : 'Blender 4.x Sculpted Hair Addon'}
          </h1>
          <p className="text-xs text-slate-400 truncate">
            {mode === 'unity'
              ? 'Live viewport shader colors, carved groove depth, specular shifts, and Verlet physics settings are synced directly into these files.'
              : 'Install in Blender via Preferences -> Add-ons -> Install from Disk to generate 3D volumetric diamond-profile Final Fantasy locks and Unity Hair_ bone rigs.'}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {mode === 'unity' && (
            <div className="flex items-center gap-1 p-1 rounded-lg bg-[#161a24] border border-white/8">
              <button
                type="button"
                onClick={() => onChangePipeline('urp')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  pipeline === 'urp'
                    ? 'bg-[#e5a93c] text-[#0b0d12]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Unity URP (HLSL)
              </button>
              <button
                type="button"
                onClick={() => onChangePipeline('builtin')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  pipeline === 'builtin'
                    ? 'bg-[#e5a93c] text-[#0b0d12]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Built-in RP (CG)
              </button>
            </div>
          )}

          {activeFile && (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#181d29] border border-white/10 text-xs font-medium text-slate-200 hover:text-white hover:border-white/25 transition-colors whitespace-nowrap cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy Code'}</span>
              </button>
              <button
                type="button"
                onClick={() => downloadTextFile(activeFile.name, activeFile.content)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#181d29] border border-white/10 text-xs font-medium text-slate-200 hover:text-white hover:border-white/25 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download File</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <aside className="w-full md:w-72 shrink-0 bg-[#0d1017] border-b md:border-b-0 md:border-r border-white/10 overflow-y-auto studio-scroll p-3 space-y-1">
          {filteredFiles.map((file) => {
            const selected = activeFile?.path === file.path;
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                  selected
                    ? 'bg-[#171c29] border-[#e5a93c]/60 text-white'
                    : 'bg-transparent border-transparent text-slate-300 hover:bg-[#131722] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <FileCode2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs font-mono font-medium truncate">{file.name}</span>
                </div>
                <p className="text-[11px] text-slate-400 line-clamp-2 pl-5">{file.description}</p>
              </button>
            );
          })}
        </aside>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#090b10]">
          {activeFile && (
            <>
              <div className="px-5 py-2.5 border-b border-white/8 flex items-center justify-between text-xs text-slate-400 bg-[#0c0f16]">
                <span className="font-mono truncate">{activeFile.path}</span>
                <span className="font-mono tabular-nums shrink-0">
                  {activeFile.content.split('\n').length} lines
                </span>
              </div>
              <div className="flex-1 overflow-auto studio-scroll p-5">
                <pre className="font-mono text-[12.5px] leading-relaxed text-slate-200 whitespace-pre">
                  <code>{activeFile.content}</code>
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
