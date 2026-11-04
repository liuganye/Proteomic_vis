"use client";

import type { SampleSelectionProps } from "@/lib/types";

export function ProteinAbundance({ abundance, selectedSamples, onSelectSamples }: {
  abundance: { points: { sample_id: string; display_group: string; log2_intensity: number | null }[] };
} & SampleSelectionProps) {
  const groups = [...new Set(abundance.points.map(p => p.display_group))];
  const vals = abundance.points.flatMap(p => p.log2_intensity === null ? [] : [p.log2_intensity]);
  const min = Math.min(...vals, 0), max = Math.max(...vals, 1);
  return <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="abundance-heading">
    <h3 id="abundance-heading" className="text-lg font-semibold">Observed abundance by sample</h3>
    <p className="mt-1 text-sm text-slate-600">log₂ MaxLFQ; each dot is a sample. Select a dot to update the QC sample selection. Zero and blank values are missing, with no imputation. Group labels are unreviewed.</p>
    <div className="mt-2 text-sm" data-testid="abundance-selected-samples" aria-live="polite">
      <strong>QC selected samples:</strong> {!selectedSamples.length && "None"}
      {selectedSamples.map(id => {
        const point = abundance.points.find(p => p.sample_id === id);
        return <p key={id}>{id} · {point?.log2_intensity == null ? "missing" : `log₂ intensity ${point.log2_intensity.toFixed(2)}`}</p>;
      })}
    </div>
    <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Protein abundance chart">
      <svg viewBox="0 0 700 230" className="mt-3 block w-full min-w-[520px]" role="group" aria-label="Observed abundance by sample group">
        <line x1="60" y1="180" x2="680" y2="180" stroke="#94a3b8" />
        {groups.map((group, i) => <g key={group}>
          <text x={70 + (i + 0.5) * 600 / groups.length} y="202" textAnchor="middle" fontSize="11" fill="#475569">{group}</text>
          {abundance.points.filter(p => p.display_group === group && p.log2_intensity !== null).map((p, j) => {
            const selected = selectedSamples.includes(p.sample_id);
            return <circle key={p.sample_id} data-sample={p.sample_id} cx={70 + (i + 0.5) * 600 / groups.length + ((j % 7) - 3) * 5} cy={175 - ((p.log2_intensity! - min) / (max - min)) * 145} r={selected ? 7 : 4} fill={selected ? "#c2410c" : "#0f766e"} opacity="0.85" stroke={selected ? "#0f172a" : "none"} strokeWidth="2"
              role="button" tabIndex={0} aria-label={`Select sample ${p.sample_id} in protein abundance`} aria-pressed={selected} onClick={() => onSelectSamples([p.sample_id])} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectSamples([p.sample_id]); } }} className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">
              <title>{p.sample_id}: {p.log2_intensity!.toFixed(2)}</title>
            </circle>;
          })}
        </g>)}
        <text x="5" y="30" fontSize="10">{max.toFixed(1)}</text><text x="5" y="180" fontSize="10">{min.toFixed(1)}</text>
      </svg>
    </div>
    <p className="text-xs text-slate-600">{groups.map(g => `${g}: ${abundance.points.filter(p => p.display_group === g && p.log2_intensity === null).length} missing`).join(" · ")}</p>
  </section>;
}
