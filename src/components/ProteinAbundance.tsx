"use client";

import { useEffect, useRef, useState } from "react";
import { abundanceDomain, abundanceGroups, type AbundancePoint } from "@/lib/abundance";
import type { SampleSelectionProps } from "@/lib/types";

function isObserved(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/** Display precision only; underlying values and positions stay unrounded. */
function formatIntensity(value: number) {
  return value.toFixed(2);
}

function tickLabel(value: number, step: number) {
  const digits = Math.max(0, Math.min(2, Math.ceil(-Math.log10(Math.max(step, 1e-6))) + 1));
  return value.toFixed(digits);
}

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
  abundance: { points: AbundancePoint[] };
} & SampleSelectionProps) {
  const groups = abundanceGroups(abundance.points);
  const domain = abundanceDomain(abundance.points.map(point => point.log2_intensity));
  const tickStep = domain && domain.ticks.length > 1 ? domain.ticks[1] - domain.ticks[0] : 1;
  let tickLabels = domain ? domain.ticks.map(tick => tickLabel(tick, tickStep)) : [];
  if (domain && new Set(tickLabels).size !== tickLabels.length) {
    tickLabels = domain.ticks.map(tick => formatIntensity(tick));
  }

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
  }, [domain !== null]);

  const abW = size.w;
  const abH = size.h;
  const uiScale = Math.max(0.9, Math.min(1.9, Math.sqrt((abW * abH) / (580 * 240))));
  const left = Math.round(52 * uiScale);
  const right = Math.max(left + 120, abW - Math.round(16 * uiScale));
  const top = Math.round(18 * uiScale);
  const bottom = Math.max(top + 60, abH - Math.round(54 * uiScale));
  const y = (value: number) => domain
    ? bottom - ((value - domain.min) / Math.max(domain.max - domain.min, 1e-9)) * (bottom - top)
    : bottom;

  const totalRawWidth = Math.max(1, groups.reduce((sum, group) => sum + group.width, 0));
  const plotW = right - left;
  let offset = left;
  const positionedGroups = groups.map(group => {
    const scaledW = (group.width / totalRawWidth) * plotW;
    const positioned = { ...group, left: offset, scaledW };
    offset += scaledW;
    return positioned;
  });

  const groupLabelY = bottom + Math.round(18 * uiScale);
  const missingY = bottom + Math.round(38 * uiScale);
  const tickFontSize = Math.round(12 * uiScale);
  const axisTitleSize = Math.round(12.5 * uiScale);
  const groupLabelSize = Math.round(12.5 * uiScale);
  const badgeFontSize = Math.round(11 * uiScale);
  const badgeW = Math.round(58 * uiScale);
  const badgeH = Math.round(20 * uiScale);

  return <section className="flex flex-1 min-h-0 min-w-0 flex-col" aria-labelledby="abundance-heading">
    <h3 id="abundance-heading" className="sr-only">Observed abundance by sample</h3>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs" data-testid="abundance-selected-samples" aria-live="polite">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-slate-700">QC selected samples:</span>
        {!selectedSamples.length ? <span className="text-slate-500">None</span> : selectedSamples.map(id => {
          const point = abundance.points.find(p => p.sample_id === id);
          const status = !point ? "not in response" : isObserved(point.log2_intensity) ? formatIntensity(point.log2_intensity) : "missing";
          return <span key={id} className="rounded border border-orange-300 bg-orange-50 px-1.5 py-0.5 font-medium text-orange-950">
            {id}: {point && isObserved(point.log2_intensity) ? <strong>{status}</strong> : <em className="text-amber-800">{status}</em>}
          </span>;
        })}
      </div>
      <span className="text-[11px] text-slate-500">log₂ MaxLFQ · median &amp; IQR</span>
    </div>
    {domain ? (
      <div ref={chartRef} className="mt-1.5 flex-1 min-h-[170px] w-full overflow-hidden" tabIndex={0} role="region" aria-label="Protein abundance chart">
        <svg viewBox={`0 0 ${abW} ${abH}`} className="block h-full w-full" preserveAspectRatio="none" role="group" aria-label="Observed abundance by sample group">
          {domain.ticks.map((t, idx) => (
            <g key={t}>
              <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray={idx > 0 && idx < domain.ticks.length - 1 ? "3 3" : undefined} />
              <text x={left - Math.round(6 * uiScale)} y={y(t) + tickFontSize * 0.35} textAnchor="end" fontSize={tickFontSize} fill="#64748b">{tickLabels[idx]}</text>
            </g>
          ))}
          <text transform={`translate(${Math.round(15 * uiScale)} ${(top + bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize={axisTitleSize} fill="#64748b">log₂ MaxLFQ</text>
          <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#94a3b8" />
          <line x1={left} x2={left} y1={top} y2={bottom} stroke="#94a3b8" />
          <text x={left - Math.round(6 * uiScale)} y={missingY + badgeFontSize * 0.35} textAnchor="end" fontSize={badgeFontSize} fill="#64748b">Obs</text>
          {positionedGroups.map(group => {
            const cxGroup = group.left + group.scaledW / 2;
            const observed = group.points.filter((p): p is typeof p & { log2_intensity: number } => isObserved(p.log2_intensity));
            const missingCount = group.points.length - observed.length;
            const sortedVals = observed.map(p => p.log2_intensity).sort((a, b) => a - b);
            const med = sortedVals.length ? medianOf(sortedVals) : null;
            const q1 = sortedVals.length ? quantile(sortedVals, 0.25) : null;
            const q3 = sortedVals.length ? quantile(sortedVals, 0.75) : null;
            const isContrastGroup = group.name === "Human" || group.name === "QC";
            const colFill = group.name === "Human" ? "#f0fdfa" : group.name === "QC" ? "#fffbeb" : "#f8fafc";
            const dotColor = group.name === "Human" ? "#0f766e" : group.name === "QC" ? "#b45309" : "#475569";
            const iqrHalfW = Math.min(group.scaledW * 0.25, Math.round(16 * uiScale));
            const medHalfW = Math.min(group.scaledW * 0.32, Math.round(20 * uiScale));
            const labelLength = Math.max(5, Math.floor((group.scaledW - 8) / (7 * uiScale)));

            return <g key={group.name}>
              <rect x={group.left + 3} y={top} width={Math.max(10, group.scaledW - 6)} height={bottom - top} rx="4" fill={colFill} opacity={isContrastGroup ? 0.45 : 0.25} />
              {q1 !== null && q3 !== null && sortedVals.length >= 2 && (
                <rect x={cxGroup - iqrHalfW} y={y(q3)} width={iqrHalfW * 2} height={Math.max(2, y(q1) - y(q3))} rx="2" fill={dotColor} fillOpacity="0.14" stroke={dotColor} strokeOpacity="0.4" strokeWidth="1" />
              )}
              {med !== null && (
                <line x1={cxGroup - medHalfW} x2={cxGroup + medHalfW} y1={y(med)} y2={y(med)} stroke="#0f172a" strokeWidth={2.2 * uiScale} />
              )}
              {observed.map(p => {
                const selected = selectedSamples.includes(p.sample_id);
                const px = group.left + (p.x / group.width) * group.scaledW;
                const py = y(p.log2_intensity);
                return <g key={p.sample_id}>
                  <circle
                    data-sample={p.sample_id}
                    cx={px}
                    cy={py}
                    r={(selected ? 6.5 : 4.5) * uiScale}
                    fill={selected ? "#c2410c" : dotColor}
                    opacity={selected ? 1 : 0.88}
                    stroke={selected ? "#0f172a" : "#ffffff"}
                    strokeWidth={(selected ? 2 : 0.9) * uiScale}
                    role="button"
                    tabIndex={0}
                    aria-label={`Select sample ${p.sample_id}, ${group.name}, log₂ intensity ${formatIntensity(p.log2_intensity)}`}
                    aria-pressed={selected}
                    onClick={() => onSelectSamples([p.sample_id])}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectSamples([p.sample_id]); } }}
                    className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900"
                  >
                    <title>{`${p.sample_id}: ${formatIntensity(p.log2_intensity)}`}</title>
                  </circle>
                  {selected && (
                    <text x={px} y={Math.max(top + 10 * uiScale, py - 9 * uiScale)} textAnchor="middle" fontSize={badgeFontSize} fontWeight="700" fill="#9a3412" paintOrder="stroke" stroke="#ffffff" strokeWidth="3" pointerEvents="none">
                      {p.sample_id}: {formatIntensity(p.log2_intensity)}
                    </text>
                  )}
                </g>;
              })}
              <text x={cxGroup} y={groupLabelY} textAnchor="middle" fontSize={groupLabelSize} fontWeight={isContrastGroup ? "700" : "500"} fill={group.name === "Human" ? "#0f766e" : group.name === "QC" ? "#92400e" : "#475569"}>
                <title>{group.name}</title>
                {group.name.length > labelLength ? `${group.name.slice(0, labelLength - 1)}…` : group.name}
              </text>
              <g transform={`translate(${cxGroup}, ${missingY})`}>
                <rect x={-badgeW / 2} y={-badgeH / 2} width={badgeW} height={badgeH} rx={badgeH / 2} fill={missingCount > 0 ? "#fff7ed" : "#f1f5f9"} stroke={missingCount > 0 ? "#fdba74" : "#cbd5e1"} />
                <text x="0" y={badgeFontSize * 0.35} textAnchor="middle" fontSize={badgeFontSize} fontWeight="600" fill={missingCount > 0 ? "#9a3412" : "#64748b"}>
                  {observed.length}/{group.points.length}
                </text>
              </g>
            </g>;
          })}
        </svg>
      </div>
    ) : (
      <p className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700" role="status">
        No observed abundance values are available for this protein.
      </p>
    )}
    <details className="mt-2 shrink-0 text-xs">
      <summary className="cursor-pointer font-semibold text-teal-900">Sample details ({abundance.points.length})</summary>
      <div className="mt-1.5 max-h-48 max-w-full overflow-auto rounded border border-slate-200">
        <table className="w-full min-w-[380px] border-collapse text-left">
          <caption className="sr-only">Abundance and missing status for every sample. Selecting a sample updates QC.</caption>
          <thead className="sticky top-0 bg-slate-50">
            <tr className="border-b border-slate-200 text-slate-600">
              <th scope="col" className="px-2 py-1.5">Sample</th>
              <th scope="col" className="px-2 py-1.5">Group</th>
              <th scope="col" className="px-2 py-1.5">log₂ MaxLFQ</th>
              <th scope="col" className="px-2 py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {abundance.points.map(point => {
              const observed = isObserved(point.log2_intensity);
              const selected = selectedSamples.includes(point.sample_id);
              return <tr key={point.sample_id} className={`border-b border-slate-100 ${selected ? "bg-orange-50" : ""}`}>
                <td className="px-2 py-1">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelectSamples([point.sample_id])}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-left text-teal-900 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
                  >
                    {point.sample_id}
                  </button>
                </td>
                <td className="px-2 py-1 text-slate-700">{point.display_group}</td>
                <td className="px-2 py-1 tabular-nums">{isObserved(point.log2_intensity) ? formatIntensity(point.log2_intensity) : "—"}</td>
                <td className="px-2 py-1">{observed ? "Observed" : "Missing"}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </details>
  </section>;
}
