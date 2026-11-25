// Shape shell editor: the hairstyle's outer shape as a grid of thicknesses over the scalp (hairShell.ts).
// Each cell is the height of the hair surface above the scalp in mm at one spot (rows: down from the crown, columns: round
// from the front; both sides share it). Drag a cell up or down to make the hair there thicker or thinner; the brush spreads
// the change to the neighbouring cells. The hair rebuilds when the drag ends; the green grid in the viewport follows the
// drag live. The grid is plain JSON in the recipe (builder.shell), so Copy JSON carries it and an AI can edit it too.
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildArchetypeSpecs } from '../engine/hairBuilder';
import { captureHairShell } from '../engine/hairShell';
import type { HairBuilderConfig, HairShellGrid } from '../types/hair';

interface Props {
  config: HairBuilderConfig;
  onChange: (shell: HairShellGrid | undefined) => void;
  /** The grid to draw in the viewport (null hides it). Follows a drag live. */
  onPreview: (shell: HairShellGrid | null) => void;
}

const BRUSHES = [
  { id: 0, label: 'Cell' },
  { id: 1, label: 'Soft' },
  { id: 2, label: 'Wide' },
];

const rowLabel = (p: number) => (p === 0 ? 'Crown' : p >= 130 ? 'Nape' : p >= 85 && p <= 95 ? 'Temple' : `${p}°`);
const colLabel = (a: number) => (a === 0 ? 'Front' : a === 180 ? 'Back' : a >= 80 && a <= 100 ? 'Ear' : `${a}°`);

function applyBrush(grid: HairShellGrid, built: HairShellGrid, i0: number, j0: number, delta: number, brush: number): HairShellGrid {
  const reach = brush === 0 ? 0 : brush === 1 ? 1 : 2;
  const mm = grid.mm.map((row, i) => row.map((v, j) => {
    const di = i - i0, dj = j - j0;
    if (Math.abs(di) > reach || Math.abs(dj) > reach) return v;
    const fall = reach === 0 ? 1 : Math.exp(-(di * di + dj * dj) / (reach * reach * 0.9));
    const base = v ?? built.mm[i]?.[j];
    if (base === null || base === undefined) return v; // no hair there to move
    if (v === null && !(di === 0 && dj === 0)) return v; // a cell left as built stays so unless dragged itself
    return Math.round(Math.max(0.5, Math.min(150, base + delta * fall)) * 2) / 2;
  }));
  return { ...grid, mm };
}

export function HairShellEditor({ config, onChange, onPreview }: Props) {
  // the style as the archetype builds it, without the shell: what each cell is measured against
  const baseKey = JSON.stringify({ ...config, shell: undefined });
  const built = useMemo(() => {
    const { shell: _drop, ...rest } = config;
    const az = config.shell?.azDeg, ph = config.shell?.phiDeg;
    return captureHairShell(buildArchetypeSpecs(rest as HairBuilderConfig), az, ph, config.shell?.mirror !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey]);
  const [draft, setDraft] = useState<HairShellGrid | null>(null);
  const [brush, setBrush] = useState(1);
  const [showInView, setShowInView] = useState(true);
  const drag = useRef<{ i: number; j: number; y: number; start: HairShellGrid; fine: boolean } | null>(null);
  const shown = draft ?? config.shell ?? null;

  useEffect(() => {
    onPreview(showInView ? shown ?? built : null);
  }, [showInView, shown, built, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const start = () => onChange({ azDeg: built.azDeg, phiDeg: built.phiDeg, mirror: built.mirror !== false, strength: 1, mm: built.mm.map((r) => r.slice()) });

  const onDown = (e: React.PointerEvent, i: number, j: number) => {
    if (!config.shell) return;
    if (e.shiftKey) {
      // shift-click: leave this cell as built, or take it back into the shell
      const cur = config.shell.mm[i][j];
      const mm = config.shell.mm.map((r) => r.slice());
      mm[i][j] = cur === null ? built.mm[i][j] : null;
      onChange({ ...config.shell, mm });
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { i, j, y: e.clientY, start: config.shell, fine: e.altKey };
    setDraft(config.shell);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const delta = (d.y - e.clientY) * (d.fine ? 0.1 : 0.3);
    setDraft(applyBrush(d.start, built, d.i, d.j, delta, brush));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (draft) onChange(draft);
    setDraft(null);
  };
  const onKey = (e: React.KeyboardEvent, i: number, j: number) => {
    if (!config.shell || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    onChange(applyBrush(config.shell, built, i, j, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 1), brush));
  };

  const grid = shown ?? built;
  const cols = grid.azDeg.length;
  return (
    <div className="flex flex-col gap-2 pt-2 border-t border-white/8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-slate-300 font-medium">Shape shell</div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <label className="flex items-center gap-1 text-slate-400 cursor-pointer">
            <input type="checkbox" checked={showInView} onChange={(e) => setShowInView(e.target.checked)} />
            Show in view
          </label>
          {config.shell && BRUSHES.map((b) => (
            <button key={b.id} type="button" onClick={() => setBrush(b.id)}
              className={`px-2 py-1 rounded border cursor-pointer ${brush === b.id ? 'border-emerald-400/70 text-emerald-200 bg-emerald-400/10' : 'border-white/10 text-slate-300 hover:border-white/25'}`}>
              {b.label}
            </button>
          ))}
          {config.shell ? (
            <>
              <button type="button" onClick={start} className="px-2 py-1 rounded border border-white/10 text-slate-300 hover:border-white/25 cursor-pointer">Reset to style</button>
              <button type="button" onClick={() => onChange(undefined)} className="px-2 py-1 rounded border border-white/10 text-slate-300 hover:border-rose-400/50 hover:text-rose-200 cursor-pointer">Remove shell</button>
            </>
          ) : (
            <button type="button" onClick={start} className="px-2 py-1 rounded bg-emerald-500/80 text-[#0b0d12] font-semibold hover:bg-emerald-400 cursor-pointer">Start from this style</button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-slate-400 leading-snug max-w-[70ch]">
        {config.shell
          ? 'Drag a cell up or down to make the hair there thicker or thinner (mm above the scalp; hold Alt for fine steps). Shift-click leaves a cell as built. Both sides share the grid. Warm cells are thicker than the style builds them, cool ones thinner.'
          : 'The outer shape of the hair as a grid of thicknesses over the scalp. Start from this style to edit it; the numbers are what the style builds now.'}
      </p>
      <div className="overflow-x-auto">
        <div className="inline-grid gap-px text-[10px] font-mono tabular-nums select-none" style={{ gridTemplateColumns: `3.6rem repeat(${cols}, 2.6rem)` }}>
          <div />
          {grid.azDeg.map((a) => <div key={a} className="text-center text-slate-500 py-0.5">{colLabel(a)}</div>)}
          {grid.phiDeg.map((p, i) => (
            <div key={p} className="contents">
              <div className="text-slate-500 pr-1 flex items-center justify-end">{rowLabel(p)}</div>
              {grid.azDeg.map((a, j) => {
                const v = grid.mm[i]?.[j] ?? null;
                const b = built.mm[i]?.[j] ?? null;
                if (b === null) return <div key={a} className="h-6 rounded-sm bg-white/[0.03]" title="No hair here" />;
                const asBuilt = !config.shell || v === null;
                const val = v ?? b;
                const rel = asBuilt ? 0 : Math.max(-1, Math.min(1, (val - b) / Math.max(4, b)));
                const bg = rel >= 0 ? `rgba(245, 158, 66, ${0.08 + rel * 0.6})` : `rgba(80, 160, 255, ${0.08 - rel * 0.6})`;
                return (
                  <div key={a} role="slider" tabIndex={config.shell ? 0 : -1} aria-label={`${rowLabel(p)}, ${colLabel(a)}: ${val} mm`}
                    aria-valuenow={val} aria-valuemin={0.5} aria-valuemax={150}
                    onPointerDown={(e) => onDown(e, i, j)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={(e) => onKey(e, i, j)}
                    title={asBuilt && config.shell ? `As built (${b} mm). Shift-click to edit.` : `${val} mm (style builds ${b} mm)`}
                    className={`h-6 rounded-sm flex items-center justify-center ${config.shell ? 'cursor-ns-resize' : ''} ${asBuilt ? 'text-slate-500' : 'text-slate-100'} outline-none focus-visible:ring-1 focus-visible:ring-emerald-400`}
                    style={{ background: bg, touchAction: 'none' }}>
                    {Math.round(val)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {config.shell && (
        <label className="flex items-center gap-2 text-[11px] text-slate-400 max-w-xs">
          Strength
          <input type="range" min={0} max={1} step={0.05} value={config.shell.strength ?? 1}
            onChange={(e) => onChange({ ...config.shell!, strength: Number(e.target.value) })} className="flex-1" />
          <span className="font-mono tabular-nums w-8 text-right">{(config.shell.strength ?? 1).toFixed(2)}</span>
        </label>
      )}
    </div>
  );
}
