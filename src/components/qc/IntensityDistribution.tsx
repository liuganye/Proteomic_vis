"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildConditionColorMap,
  conditionColor,
  groupQcStats,
  intensityBoxBySample,
  intensityHistogram,
  missingnessBySample,
} from "@/lib/stats";
import type { FragPipeDataset, SampleSelectionProps } from "@/lib/types";
import { SampleIntensitySummary } from "./SampleIntensitySummary";
import { paddedDomain } from "@/lib/qc-plot";

type BoxRow = ReturnType<typeof intensityBoxBySample>[number];

export function IntensityDistribution({
  dataset,
  boxes: precomputedBoxes,
  groups: precomputedGroups,
  colorMap: colorMapProp,
  selectedSamples,
  onSelectSamples,
  compact = false,
}: {
  dataset: FragPipeDataset;
  boxes?: BoxRow[];
  groups?: ReturnType<typeof groupQcStats>;
  colorMap?: Record<string, string>;
  compact?: boolean;
} & SampleSelectionProps) {
  const [groupFilter, setGroupFilter] = useState("");
  const [binCount, setBinCount] = useState(30);
  const fullHistogram = useMemo(() => intensityHistogram(dataset, binCount), [dataset, binCount]);
  const filteredDataset = useMemo(() => groupFilter ? {
    ...dataset,
    samples: dataset.samples.filter(sample => (dataset.annotation.find(a => a.sample === sample)?.condition ?? "Unknown") === groupFilter),
  } : dataset, [dataset, groupFilter]);
  const histogram = useMemo(() => {
    if (!groupFilter || !fullHistogram.bins.length) return fullHistogram;
    return intensityHistogram(filteredDataset, fullHistogram.bins.length, [fullHistogram.bins[0].lower, fullHistogram.bins[fullHistogram.bins.length - 1].upper]);
  }, [filteredDataset, binCount, groupFilter, fullHistogram]);
  const hist = histogram.bins;
  const boxes = precomputedBoxes ?? intensityBoxBySample(dataset);
  const groups = useMemo(() => {
    if (precomputedGroups) return precomputedGroups;
    return groupQcStats(missingnessBySample(dataset), boxes);
  }, [precomputedGroups, dataset, boxes]);
  const colorMap =
    colorMapProp ?? buildConditionColorMap(groups.map((g) => g.condition));
  const visibleBoxes = boxes.filter(b => !groupFilter || b.condition === groupFilter);

  const histogramBlock = (
      <div>
        <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-900">
            MaxLFQ intensity distribution
          </h3>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700" data-testid="histogram-total">
            {histogram.total.toLocaleString()} obs · {hist.length} bins
          </span>
        </header>
        <div className={`mb-3 flex flex-wrap items-center gap-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ${compact ? "gap-2 px-2 py-1.5" : ""}`}>
          <label className="flex items-center gap-2">Intensity group
            <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1.5">
              <option value="">All groups</option>
              {groups.map(g => <option key={g.condition} value={g.condition}>{g.condition}</option>)}
            </select>
          </label>
          {!compact && (
            <label className="flex items-center gap-2">Histogram bins
              <select value={binCount} onChange={e => setBinCount(Number(e.target.value))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5">
                {[20, 30, 60].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          <span>{filteredDataset.samples.length} / {dataset.samples.length} samples · {groupFilter || "All groups"}</span>
        </div>
        {histogram.total === 0 ? <p className="text-sm text-slate-600">No positive, finite intensities to plot.</p> :
        <div className={`${compact ? "chart-frame h-48" : "h-72"} w-full`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hist} barCategoryGap={0} margin={{ top: 8, right: 12, left: compact ? 4 : 12, bottom: compact ? 8 : 20 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid, #d7e0e6)" />
              <XAxis
                dataKey="midpoint"
                tickFormatter={(value: number) => value.toFixed(2)}
                tick={{ fontSize: 10 }}
                interval={Math.max(0, Math.ceil(hist.length / 8) - 1)}
                minTickGap={24}
                label={compact ? undefined : {
                  value: "log10 MaxLFQ",
                  position: "insideBottom",
                  offset: -12,
                  style: { fontSize: 12, fill: "var(--chart-muted, #5a6b76)" },
                }}
              />
              <YAxis width={compact ? 40 : 65} allowDecimals={false} tick={{ fontSize: compact ? 10 : 12 }} label={compact ? undefined : { value: "Observations", angle: -90, position: "insideLeft", offset: -5, style: { fontSize: 11 } }} />
              <Tooltip
                content={({ active, payload }) => {
                  const bin = payload?.[0]?.payload as (typeof hist)[number] | undefined;
                  if (!active || !bin) return null;
                  return <div className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-800 shadow-sm">
                    <p>log₁₀ MaxLFQ: [{bin.lower.toFixed(3)}, {bin.upper.toFixed(3)}{bin.upper === hist[hist.length - 1].upper ? "]" : ")"}</p>
                    <p>{bin.count.toLocaleString()} observations</p>
                  </div>;
                }}
              />
              <Bar dataKey="count" fill={groupFilter ? conditionColor(groupFilter, colorMap) : "var(--chart-accent, #0d7377)"} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>}
      </div>
  );

  const quartileDetails = (
    <details className={compact ? "mt-2" : undefined}>
      <summary className="cursor-pointer text-sm font-medium text-teal-800">
        Show exact per-sample statistics ({visibleBoxes.length} samples)
      </summary>
      <header className="mb-2 mt-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">
          Per-sample log<sub>10</sub> MaxLFQ quartiles
        </h3>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {visibleBoxes.length} samples · click to highlight
        </span>
      </header>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Sample</th>
              <th className="px-3 py-2">Condition</th>
              <th className="px-3 py-2">n</th>
              <th className="px-3 py-2">Median</th>
              <th className="px-3 py-2">Q1–Q3</th>
              <th className="px-3 py-2">Range</th>
            </tr>
          </thead>
          <tbody>
            {visibleBoxes.map((b) => (
              <tr key={b.sample} className={`border-t border-slate-100 ${selectedSamples.includes(b.sample) ? "bg-teal-50" : ""}`} data-selected={selectedSamples.includes(b.sample)}>
                <td className="px-3 py-2 font-medium text-slate-900">
                  <button type="button" aria-label={`Select sample ${b.sample} in intensity summary`} aria-pressed={selectedSamples.includes(b.sample)} onClick={() => onSelectSamples([b.sample])} className="rounded underline underline-offset-4 focus-visible:outline-teal-700">{b.sample}</button>
                </td>
                <td className="px-3 py-2 text-slate-700">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{
                        background: conditionColor(b.condition, colorMap),
                      }}
                    />
                    {b.condition}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums">{b.n}</td>
                <td className="px-3 py-2 tabular-nums">
                  {b.n > 0 ? b.median.toFixed(2) : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {b.n > 0 ? `${b.q1.toFixed(2)} – ${b.q3.toFixed(2)}` : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {b.n > 0 ? `${b.min.toFixed(2)} – ${b.max.toFixed(2)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );

  if (compact) {
    return (
      <div>
        {histogramBlock}
        {quartileDetails}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {histogramBlock}

      <SampleIntensitySummary boxes={visibleBoxes} domain={paddedDomain(boxes.filter(b => b.n > 0).flatMap(b => [b.min, b.max]))} colorMap={colorMap} selectedSamples={selectedSamples} onSelectSamples={onSelectSamples} />

      <div>
        <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-900">
            Per-group intensity summary
          </h3>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {groups.length} group{groups.length === 1 ? "" : "s"}
          </span>
        </header>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Group</th>
                <th className="px-3 py-2">n samples</th>
                <th className="px-3 py-2">Mean missing %</th>
                <th className="px-3 py-2">Mean median log₁₀</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.condition} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{
                          background: conditionColor(g.condition, colorMap),
                        }}
                      />
                      {g.condition}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{g.nSamples}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {g.meanMissingPct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {g.medianOfMedians.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {quartileDetails}
    </div>
  );
}
