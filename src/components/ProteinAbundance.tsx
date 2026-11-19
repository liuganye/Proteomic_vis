"use client";

import { useEffect, useRef, useState } from "react";
import type { SampleSelectionProps } from "@/lib/types";

function medianOf(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

export function ProteinAbundance({ abundance, selectedSamples, onSelectSamples }: {
  abundance: { points: { sample_id: string; display_group: string; log2_intensity: number | null }[] };
} & SampleSelectionProps) {
  const groups = [...new Set(abundance.points.map(p => p.display_group))];
  const vals = abundance.points.flatMap(p => p.log2_intensity === null ? [] : [p.log2_intensity]);
  const rawMin = vals.length ? Math.min(...vals) : 0;
  const rawMax = vals.length ? Math.max(...vals) : 1;
  const rawSpan = Math.max(rawMax - rawMin, 0.25);
  const pad = Math.max(rawSpan * 0.15, 0.08);
  const step = rawSpan <= 1.2 ? 0.1 : rawSpan <= 3 ? 0.2 : 0.5;
  const min = Math.max(0, Math.floor((rawMin - pad) / step) * step);
  const max = Math.ceil((rawMax + pad) / step) * step;
  const span = Math.max(max - min, 0.1);

  const chartRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 700, h: 242 });
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const nw = Math.max(260, Math.round(rect.width));
      const nh = Math.max(170, Math.round(rect.height));
      setSize(curr => (Math.abs(curr.w - nw) >= 1 || Math.abs(curr.h - nh) >= 1) ? { w: nw, h: nh } : curr);
    };
    update();
    const observer = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const nw = Math.max(260, Math.round(cr.width));
      const nh = Math.max(170, Math.round(cr.height));
      setSize(curr => (Math.abs(curr.w - nw) >= 1 || Math.abs(curr.h - nh) >= 1) ? { w: nw, h: nh } : curr);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const abW = size.w;
  const abH = size.h;
  const uiScale = Math.max(0.9, Math.min(1.9, Math.sqrt((abW * abH) / (580 * 240))));
  const left = Math.round(48 * uiScale);
  const right = Math.max(left + 120, abW - Math.round(16 * uiScale));
  const top = Math.round(18 * uiScale);
  const bottom = Math.max(top + 60, abH - Math.round(54 * uiScale));
  const y = (v: number) => bottom - ((v - min) / span) * (bottom - top);
  const colW = (right - left) / Math.max(groups.length, 1);
  const tickCount = bottom - top > 300 ? 6 : bottom - top > 190 ? 5 : 3;
  const yTicks = Array.from({ length: tickCount }, (_, i) => min + (i / (tickCount - 1)) * (max - min));
  const tickStep = (max - min) / Math.max(1, tickCount - 1);
  const tickDecimals = tickStep < 0.99 && Math.abs(Math.round(tickStep * 10) - tickStep * 10) > 0.05 ? 2 : 1;
  const groupLabelY = bottom + Math.round(18 * uiScale);
  const missingY = bottom + Math.round(38 * uiScale);
  const tickFontSize = Math.round(12 * uiScale);
  const axisTitleSize = Math.round(12.5 * uiScale);
  const groupLabelSize = Math.round(12.5 * uiScale);
  const badgeFontSize = Math.round(11 * uiScale);
  const badgeW = Math.round(56 * uiScale);
  const badgeH = Math.round(20 * uiScale);
  const iqrHalfW = Math.min(colW * 0.25, Math.round(16 * uiScale));
  const medHalfW = Math.min(colW * 0.32, Math.round(20 * uiScale));
  const jitterWidth = Math.min(colW * 0.5, Math.round(44 * uiScale));

  return <section className="flex flex-1 min-h-0 min-w-0 flex-col" aria-labelledby="abundance-heading">
    <h3 id="abundance-heading" className="sr-only">Observed abundance by sample</h3>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs" data-testid="abundance-selected-samples" aria-live="polite">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-slate-600">Selected:</span>
        {!selectedSamples.length ? <span className="text-slate-500">None (click dot)</span> : selectedSamples.map(id => {
          const point = abundance.points.find(p => p.sample_id === id);
          return <span key={id} className="rounded border border-orange-300 bg-orange-50 px-1.5 py-0.5 font-medium text-orange-950">
            {id}: {point?.log2_intensity == null ? <em className="text-amber-800">missing</em> : <strong>{point.log2_intensity.toFixed(2)}</strong>}
          </span>;
        })}
      </div>
      <span className="text-[11px] text-slate-500">log₂ MaxLFQ · group median &amp; IQR</span>
    </div>
    <div ref={chartRef} className="mt-1.5 flex-1 min-h-[170px] w-full overflow-hidden" tabIndex={0} role="region" aria-label="Protein abundance chart">
      <svg viewBox={`0 0 ${abW} ${abH}`} className="block h-full w-full" preserveAspectRatio="none" role="group" aria-label="Observed abundance by sample group">
        {yTicks.map((t, idx) => (
          <g key={idx}>
            <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray={idx > 0 && idx < yTicks.length - 1 ? "3 3" : undefined} />
            <text x={left - Math.round(6 * uiScale)} y={y(t) + tickFontSize * 0.35} textAnchor="end" fontSize={tickFontSize} fill="#64748b">{t.toFixed(tickDecimals)}</text>
          </g>
        ))}
        <text transform={`translate(${Math.round(15 * uiScale)} ${(top + bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize={axisTitleSize} fill="#64748b">log₂ MaxLFQ</text>
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#94a3b8" />
        <line x1={left} x2={left} y1={top} y2={bottom} stroke="#94a3b8" />
        <text x={left - Math.round(6 * uiScale)} y={missingY + badgeFontSize * 0.35} textAnchor="end" fontSize={badgeFontSize} fill="#64748b">Missing</text>
        {groups.map((group, i) => {
          const cxGroup = left + (i + 0.5) * colW;
          const groupPts = abundance.points.filter(p => p.display_group === group);
          const observed = groupPts.filter((p): p is { sample_id: string; display_group: string; log2_intensity: number } => p.log2_intensity !== null);
          const missingCount = groupPts.length - observed.length;
          const sortedVals = observed.map(p => p.log2_intensity).sort((a, b) => a - b);
          const med = sortedVals.length ? medianOf(sortedVals) : null;
          const q1 = sortedVals.length ? quantile(sortedVals, 0.25) : null;
          const q3 = sortedVals.length ? quantile(sortedVals, 0.75) : null;
          const isContrastGroup = group === "Human" || group === "QC";
          const colFill = group === "Human" ? "#f0fdfa" : group === "QC" ? "#fffbeb" : "#f8fafc";
          const dotColor = group === "Human" ? "#0f766e" : group === "QC" ? "#b45309" : "#475569";

          return <g key={group}>
            <rect x={left + i * colW + 3} y={top} width={Math.max(10, colW - 6)} height={bottom - top} rx="4" fill={colFill} opacity={isContrastGroup ? 0.45 : 0.25} />
            {q1 !== null && q3 !== null && sortedVals.length >= 2 && (
              <rect x={cxGroup - iqrHalfW} y={y(q3)} width={iqrHalfW * 2} height={Math.max(2, y(q1) - y(q3))} rx="2" fill={dotColor} fillOpacity="0.14" stroke={dotColor} strokeOpacity="0.4" strokeWidth="1" />
            )}
            {med !== null && (
              <line x1={cxGroup - medHalfW} x2={cxGroup + medHalfW} y1={y(med)} y2={y(med)} stroke="#0f172a" strokeWidth={2.2 * uiScale} />
            )}
            {observed.map((p, j) => {
              const selected = selectedSamples.includes(p.sample_id);
              const jitter = observed.length > 1 ? ((j / (observed.length - 1)) - 0.5) * jitterWidth : 0;
              const px = cxGroup + jitter;
              const py = y(p.log2_intensity);
              return <g key={p.sample_id}>
                <circle
                  data-sample={p.sample_id}
                  cx={px}
                  cy={py}
                  r={(selected ? 6.5 : 4.5) * uiScale}
                  fill={selected ? "#c2410c" : dotColor}
                  opacity={selected ? 1 : 0.85}
                  stroke={selected ? "#0f172a" : "#ffffff"}
                  strokeWidth={(selected ? 2 : 0.9) * uiScale}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select sample ${p.sample_id} in protein abundance`}
                  aria-pressed={selected}
                  onClick={() => onSelectSamples([p.sample_id])}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectSamples([p.sample_id]); } }}
                  className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900"
                >
                  <title>{p.sample_id}: {p.log2_intensity.toFixed(2)}</title>
                </circle>
                {selected && (
                  <text x={px} y={Math.max(top + 10 * uiScale, py - 9 * uiScale)} textAnchor="middle" fontSize={badgeFontSize} fontWeight="700" fill="#9a3412" paintOrder="stroke" stroke="#ffffff" strokeWidth="3" pointerEvents="none">
                    {p.sample_id}: {p.log2_intensity.toFixed(1)}
                  </text>
                )}
              </g>;
            })}
            <text x={cxGroup} y={groupLabelY} textAnchor="middle" fontSize={groupLabelSize} fontWeight={isContrastGroup ? "700" : "500"} fill={group === "Human" ? "#0f766e" : group === "QC" ? "#92400e" : "#475569"}>
              {group}
            </text>
            <g transform={`translate(${cxGroup}, ${missingY})`}>
              <rect x={-badgeW / 2} y={-badgeH / 2} width={badgeW} height={badgeH} rx={badgeH / 2} fill={missingCount > 0 ? "#fff7ed" : "#f1f5f9"} stroke={missingCount > 0 ? "#fdba74" : "#cbd5e1"} />
              <text x="0" y={badgeFontSize * 0.35} textAnchor="middle" fontSize={badgeFontSize} fontWeight="600" fill={missingCount > 0 ? "#9a3412" : "#64748b"}>
                {missingCount}/{groupPts.length} NA
              </text>
            </g>
          </g>;
        })}
      </svg>
    </div>
  </section>;
}
