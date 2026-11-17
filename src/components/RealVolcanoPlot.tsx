"use client";

import { useId, useRef, useState, type PointerEvent } from "react";
import { brushFromPixels, negativeLogP, passesVolcanoFilters, volcanoAxes, type BrushBounds } from "@/lib/visualization";
import { VolcanoBrushInputs } from "./VolcanoBrushInputs";

type Point = { protein_id: string; gene: string | null; log2_fc: number; adj_p: number };

export function RealVolcanoPlot({ points, focus, onChoose, pCutoff, fcCutoff, setPCutoff, setFcCutoff, brush, onBrush, matchingIds, hasFilters, onViewResults }: {
  points: Point[];
  focus: string;
  onChoose: (id: string) => void;
  pCutoff: number;
  fcCutoff: number;
  setPCutoff: (value: number) => void;
  setFcCutoff: (value: number) => void;
  brush: BrushBounds | null;
  onBrush: (bounds: BrushBounds | null) => void;
  matchingIds: Set<string>;
  hasFilters: boolean;
  onViewResults?: () => void;
}) {
  const { xMax, yMax, xTicks, yTicks } = volcanoAxes(points, pCutoff, fcCutoff);
  const left = 72, right = 738, top = 34, bottom = 330;
  const [boxSelect, setBoxSelect] = useState(false);
  const [preview, setPreview] = useState<BrushBounds | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const clipId = useId();
  const pointerPosition = (event: PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    return matrix ? point.matrixTransform(matrix.inverse()) : null;
  };
  const axes = { left, right, top, bottom, xMax, yMax };
  const x = (value: number) => left + ((value + xMax) / (2 * xMax)) * (right - left);
  const y = (value: number) => bottom - (value / yMax) * (bottom - top);
  const pass = (p: Point) => passesVolcanoFilters(p, pCutoff, fcCutoff);
  const selected = points.find(p => p.protein_id === focus);
  const tick = (value: number) => Math.abs(value) >= 10000 ? value.toExponential(0) : Number(value.toPrecision(6)).toString();
  const pointTitle = (p: Point) => `${p.gene || p.protein_id} (${p.protein_id}) · log₂FC ${p.log2_fc.toFixed(2)} · adj p ${p.adj_p.toExponential(2)}`;
  const bounds = preview ?? brush;
  const manualBounds = brush ?? { minFc: -xMax, maxFc: xMax, minY: 0, maxY: yMax };

  return <section id="real-volcano" className="min-w-0 scroll-mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h3 className="text-lg font-semibold">Human − QC volcano</h3>
        <p className="text-sm text-slate-600" data-testid="volcano-counts">{points.length.toLocaleString()} tested proteins · {points.filter(pass).length} pass the filters. Adjusted p-values are not recalculated.</p>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <ThresholdInput label="Adjusted p <" value={pCutoff} min={1e-300} max={1} onChange={setPCutoff} />
        <ThresholdInput label="|log₂FC| >" value={fcCutoff} min={0} max={1000000} onChange={setFcCutoff} />
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
      <button type="button" aria-pressed={!boxSelect} onClick={() => setBoxSelect(false)} className={`rounded border px-3 py-2 ${!boxSelect ? "bg-teal-800 text-white" : "border-slate-300"}`}>Inspect points</button>
      <button type="button" aria-pressed={boxSelect} onClick={() => setBoxSelect(true)} className={`rounded border px-3 py-2 ${boxSelect ? "bg-teal-800 text-white" : "border-slate-300"}`}>Box select</button>
      <button type="button" disabled={!brush} onClick={() => { onBrush(null); setPreview(null); }} className="rounded border border-slate-300 px-3 py-2 disabled:opacity-40">Clear box selection</button>
      <a href="#real-results" onClick={e => { if (onViewResults) { e.preventDefault(); onViewResults(); } }} className="rounded px-2 py-1 text-teal-900 underline underline-offset-4">View matching results ({matchingIds.size.toLocaleString()})</a>
    </div>
    <p className="mt-2 text-xs text-slate-600">{boxSelect ? "Drag a rectangle inside the axes to select proteins. Each drag replaces the previous region; Escape cancels an unfinished drag." : "Select a point to inspect its protein. Use Box select to choose a group for the results table."} Search and table filters also highlight matching points. Selection does not change the statistical results.</p>
    <VolcanoBrushInputs key={JSON.stringify(manualBounds)} bounds={manualBounds} onApply={onBrush} />
    {brush && <p className="mt-2 text-xs text-slate-700" data-testid="brush-bounds">Selected region: log₂FC {brush.minFc.toFixed(2)} to {brush.maxFc.toFixed(2)} · −log₁₀ adjusted p {brush.minY.toFixed(2)} to {brush.maxY.toFixed(2)}</p>}
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-700" aria-label="Volcano legend">
      <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-teal-700" />Passes both thresholds</li>
      <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-400" />Does not pass</li>
      <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-slate-900 bg-white" />Focused protein</li>
      <li className="flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-amber-800" />Current thresholds</li>
      {hasFilters && <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-orange-700" />Matches table filters</li>}
    </ul>
    <div className="mt-3 max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Human minus QC volcano chart. Scroll horizontally on narrow screens.">
      <svg viewBox="0 0 780 410" className="block w-full min-w-[560px]" style={{ touchAction: boxSelect ? "none" : "auto", cursor: boxSelect ? "crosshair" : undefined }} role="group" tabIndex={0} aria-label="Volcano plot of Human minus QC with numeric axes and current threshold lines. Select a point or draw a selection in Box select mode."
        onPointerDown={e => {
          if (!boxSelect || e.button !== 0) return;
          const point = pointerPosition(e);
          if (!point || point.x < left || point.x > right || point.y < top || point.y > bottom) return;
          e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = point; setPreview(brushFromPixels(point, point, axes));
        }}
        onPointerMove={e => { const point = pointerPosition(e); if (drag.current && point) setPreview(brushFromPixels(drag.current, point, axes)); }}
        onPointerUp={e => {
          const point = pointerPosition(e), start = drag.current;
          drag.current = null; setPreview(null);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          if (start && point && Math.hypot(point.x - start.x, point.y - start.y) >= 5) onBrush(brushFromPixels(start, point, axes));
        }}
        onPointerCancel={() => { drag.current = null; setPreview(null); }}
        onKeyDown={e => { if (e.key === "Escape") { drag.current = null; setPreview(null); setBoxSelect(false); } }}>
        <defs><clipPath id={clipId}><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath></defs>
        {yTicks.map(value => <g key={value}>
          <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#e2e8f0" />
          <text x={left - 10} y={y(value) + 4} textAnchor="end" fontSize="12" fill="#475569">{tick(value)}</text>
        </g>)}
        {xTicks.map(value => <g key={value}>
          <line x1={x(value)} x2={x(value)} y1={top} y2={bottom} stroke={value === 0 ? "#64748b" : "#e2e8f0"} strokeDasharray={value === 0 ? "3 3" : undefined} />
          <text x={x(value)} y={bottom + 20} textAnchor="middle" fontSize="12" fill="#475569">{tick(value)}</text>
        </g>)}
        {points.map(p => <circle key={p.protein_id} data-protein-id={p.protein_id} data-matches-table={matchingIds.has(p.protein_id)} cx={x(p.log2_fc)} cy={y(negativeLogP(p.adj_p))} r={2.5} fill={pass(p) ? "#0f766e" : "#94a3b8"} opacity={hasFilters && !matchingIds.has(p.protein_id) ? 0.15 : 0.7} stroke={hasFilters && matchingIds.has(p.protein_id) ? "#c2410c" : "none"} strokeWidth="1.2" onClick={() => { if (!boxSelect) onChoose(p.protein_id); }} style={{ cursor: boxSelect ? "crosshair" : "pointer" }}><title>{pointTitle(p)}</title></circle>)}
        {bounds && <g clipPath={`url(#${clipId})`} pointerEvents="none"><rect data-testid="volcano-selection" x={x(bounds.minFc)} y={y(bounds.maxY)} width={x(bounds.maxFc) - x(bounds.minFc)} height={y(bounds.minY) - y(bounds.maxY)} fill="#c2410c" fillOpacity="0.08" stroke="#c2410c" strokeWidth="2" strokeDasharray="4 3" /></g>}
        {[...new Set([-fcCutoff, fcCutoff])].map(value => <line key={value} data-testid="volcano-fc-threshold" data-value={value} x1={x(value)} x2={x(value)} y1={top} y2={bottom} stroke="#92400e" strokeWidth="1.5" strokeDasharray="6 4" pointerEvents="none" />)}
        <line data-testid="volcano-p-threshold" data-value={pCutoff} x1={left} x2={right} y1={y(negativeLogP(pCutoff))} y2={y(negativeLogP(pCutoff))} stroke="#92400e" strokeWidth="1.5" strokeDasharray="6 4" pointerEvents="none" />
        <text x={x(-fcCutoff) - 5} y={top - 9} textAnchor="end" fontSize="11" fill="#92400e">{fcCutoff === 0 ? "" : "−"}{tick(fcCutoff)}</text>
        {fcCutoff > 0 && <text x={x(fcCutoff) + 5} y={top - 9} fontSize="11" fill="#92400e">+{tick(fcCutoff)}</text>}
        <text x={right - 4} y={Math.max(top + 13, y(negativeLogP(pCutoff)) - 7)} textAnchor="end" fontSize="11" fill="#92400e" paintOrder="stroke" stroke="white" strokeWidth="3" pointerEvents="none">adjusted p = {pCutoff}</text>
        {selected && <circle cx={x(selected.log2_fc)} cy={y(negativeLogP(selected.adj_p))} r={5} fill={pass(selected) ? "#0f766e" : "#94a3b8"} stroke="#0f172a" strokeWidth="2" pointerEvents="none"><title>{pointTitle(selected)} · focused</title></circle>}
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#64748b" />
        <line x1={left} x2={left} y1={top} y2={bottom} stroke="#64748b" />
        <text x={(left + right) / 2} y="384" textAnchor="middle" fontSize="13" fill="#334155">log₂ fold change (Human − QC)</text>
        <text x={left} y="405" fontSize="11" fill="#475569">← Higher in QC</text>
        <text x={right} y="405" textAnchor="end" fontSize="11" fill="#475569">Higher in Human →</text>
        <text transform="translate(20 182) rotate(-90)" textAnchor="middle" fontSize="13" fill="#334155">−log₁₀ adjusted p</text>
      </svg>
    </div>
    <p className="mt-2 text-xs text-slate-600">All tested proteins remain plotted. Passing requires adjusted p &lt; {pCutoff} and |log₂FC| &gt; {fcCutoff}; values exactly on a threshold do not pass. Axes include the data and current thresholds. Zero p-values are plotted at 10⁻³⁰⁰. Search provides keyboard access to proteins.</p>
  </section>;
}

function ThresholdInput({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const valid = draft.trim() !== "" && Number.isFinite(Number(draft)) && Number(draft) >= min && Number(draft) <= max;
  return <div className="max-w-64">
    <label className="flex items-center gap-2">{label}<input type="number" required min={min} max={max} step="any" value={draft} aria-invalid={!valid} onChange={e => {
      const next = e.target.value;
      setDraft(next);
      if (next.trim() !== "" && Number.isFinite(Number(next)) && Number(next) >= min && Number(next) <= max) onChange(Number(next));
    }} className="w-24 rounded border border-slate-300 p-1 focus-visible:outline-teal-700" /></label>
    {!valid && <p className="mt-1 text-xs text-red-800" role="status">Enter {min === 0 ? "a non-negative value" : "a value greater than 0"} up to {max}. Keeping cutoff {value}.</p>}
  </div>;
}
