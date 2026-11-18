"use client";

import { abundanceDomain, abundanceGroups, type AbundancePoint } from "@/lib/abundance";
import type { SampleSelectionProps } from "@/lib/types";

const PLOT_TOP = 24;
const PLOT_BOTTOM = 194;
const LEFT = 76;

function isObserved(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/** Display precision only; underlying values and positions stay unrounded. */
function formatIntensity(value: number) {
  return value.toFixed(2);
}

function tickLabel(value: number, step: number) {
  const digits = Math.max(0, Math.min(15, Math.ceil(-Math.log10(step)) + 1));
  return value.toFixed(digits);
}
export function ProteinAbundance({ abundance, selectedSamples, onSelectSamples }: {
  abundance: { points: AbundancePoint[] };
} & SampleSelectionProps) {
  const groups = abundanceGroups(abundance.points);
  const domain = abundanceDomain(abundance.points.map(point => point.log2_intensity));
  let labels = domain ? domain.ticks.map(tick => tickLabel(tick, domain.ticks[1] - domain.ticks[0])) : [];
  // Very close values at a large magnitude can need more digits than fixed-point permits.
  if (domain && new Set(labels).size !== labels.length) labels = domain.ticks.map(tick => String(tick));
  const chartWidth = LEFT + groups.reduce((sum, group) => sum + group.width, 0) + 20;
  const plotWidth = chartWidth - LEFT - 20;
  let offset = LEFT;
  const positionedGroups = groups.map(group => {
    const positioned = { ...group, left: offset };
    offset += group.width;
    return positioned;
  });
  const y = (value: number) => domain
    ? PLOT_BOTTOM - (value - domain.min) / (domain.max - domain.min) * (PLOT_BOTTOM - PLOT_TOP)
    : PLOT_BOTTOM;

  return <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="abundance-heading">
    <h3 id="abundance-heading" className="text-lg font-semibold">Observed abundance by sample</h3>
    <p className="mt-1 text-sm text-slate-600">log₂ MaxLFQ; each dot is an observed sample. Select a dot or a sample in the table to update the QC sample selection. Zero and blank values are missing, with no imputation. Group labels are inferred and unreviewed.</p>
    <div className="mt-2 text-sm" data-testid="abundance-selected-samples" aria-live="polite">
      <strong>QC selected samples:</strong> {!selectedSamples.length && "None"}
      {selectedSamples.map(id => {
        const point = abundance.points.find(p => p.sample_id === id);
        const status = !point ? "not in this abundance response" : isObserved(point.log2_intensity) ? `log₂ intensity ${formatIntensity(point.log2_intensity)}` : "missing";
        return <p key={id}>{id} · {status}</p>;
      })}
    </div>
    {domain ? <>
      <p className="mt-3 text-xs text-slate-600">The vertical axis is fitted to observed values and may not start at zero. Horizontal positions separate samples and do not represent time or a numeric value. Counts are observed / total samples.</p>
      <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Protein abundance chart; scroll horizontally to see all groups">
        <svg viewBox={`0 0 ${chartWidth} 252`} style={{ minWidth: `${Math.max(chartWidth, 600)}px` }} className="mt-2 block w-full" role="group" aria-label="Observed abundance by sample group">
          <text transform="translate(16 109) rotate(-90)" textAnchor="middle" fontSize="11" fill="#334155">log₂ MaxLFQ intensity</text>
          {domain.ticks.map((tick, index) => <g key={tick}>
            <line x1={LEFT} y1={y(tick)} x2={LEFT + plotWidth} y2={y(tick)} stroke="#e2e8f0" />
            <text x={LEFT - 8} y={y(tick) + 4} textAnchor="end" fontSize="10" fill="#475569">{labels[index]}</text>
          </g>)}
          <line x1={LEFT} y1={PLOT_TOP} x2={LEFT} y2={PLOT_BOTTOM} stroke="#94a3b8" />
          <line x1={LEFT} y1={PLOT_BOTTOM} x2={LEFT + plotWidth} y2={PLOT_BOTTOM} stroke="#94a3b8" />
          {positionedGroups.map(group => {
            const labelLength = Math.max(5, Math.floor((group.width - 16) / 12));
            return <g key={group.name}>
            <text x={group.left + group.width / 2} y="214" textAnchor="middle" fontSize="11" fill="#334155">
              <title>{group.name}</title>{group.name.length > labelLength ? `${group.name.slice(0, labelLength - 1)}…` : group.name}
            </text>
            <text x={group.left + group.width / 2} y="231" textAnchor="middle" fontSize="10" fill="#64748b">{group.points.filter(p => isObserved(p.log2_intensity)).length} / {group.points.length}</text>
            {group.points.map(point => {
              if (!isObserved(point.log2_intensity)) return null;
              const selected = selectedSamples.includes(point.sample_id);
              return <circle key={point.sample_id} data-sample={point.sample_id} cx={group.left + point.x} cy={y(point.log2_intensity)} r={selected ? 6 : 4} fill={selected ? "#c2410c" : "#0f766e"} opacity="0.9" stroke={selected ? "#0f172a" : "none"} strokeWidth="2"
                role="button" tabIndex={0} aria-label={`Select sample ${point.sample_id}, ${group.name}, log₂ intensity ${formatIntensity(point.log2_intensity)}`} aria-pressed={selected} onClick={() => onSelectSamples([point.sample_id])} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectSamples([point.sample_id]); } }} className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">
                <title>{`${point.sample_id}: ${formatIntensity(point.log2_intensity)}`}</title>
              </circle>;
            })}
          </g>;})}
        </svg>
      </div>
    </> : <p className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm" role="status">No observed abundance values are available for this protein.</p>}
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer font-semibold text-teal-900">Sample details ({abundance.points.length})</summary>
      <div className="mt-2 max-w-full overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left">
          <caption className="sr-only">Abundance and missing status for every sample. Selecting a sample updates QC.</caption>
          <thead><tr className="border-b border-slate-300 text-slate-600"><th scope="col" className="px-2 py-2">Sample</th><th scope="col" className="px-2 py-2">Group</th><th scope="col" className="px-2 py-2">log₂ MaxLFQ</th><th scope="col" className="px-2 py-2">Status</th></tr></thead>
          <tbody>{abundance.points.map(point => {
            const observed = isObserved(point.log2_intensity);
            const selected = selectedSamples.includes(point.sample_id);
            return <tr key={point.sample_id} className={`border-b border-slate-100 ${selected ? "bg-orange-50" : ""}`}>
              <td className="px-2 py-2"><button type="button" aria-pressed={selected} onClick={() => onSelectSamples([point.sample_id])} className="rounded border border-slate-300 px-2 py-1 text-left text-teal-900 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700">{point.sample_id}</button></td>
              <td className="px-2 py-2">{point.display_group}</td><td className="px-2 py-2">{observed ? formatIntensity(point.log2_intensity) : "—"}</td><td className="px-2 py-2">{observed ? "Observed" : "Missing"}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </details>
  </section>;
}
