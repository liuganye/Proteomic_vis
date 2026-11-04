"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { intensityBoxBySample, intensityHistogram } from "@/lib/stats";
import type { FragPipeDataset, SampleSelectionProps } from "@/lib/types";

type BoxRow = ReturnType<typeof intensityBoxBySample>[number];

export function IntensityDistribution({
  dataset,
  boxes: precomputedBoxes,
  selectedSamples,
  onSelectSamples,
}: {
  dataset: FragPipeDataset;
  boxes?: BoxRow[];
} & SampleSelectionProps) {
  const histogram = useMemo(() => intensityHistogram(dataset), [dataset]);
  const hist = histogram.bins;
  const boxes = precomputedBoxes ?? intensityBoxBySample(dataset);

  return (
    <div className="space-y-8">
      <div>
        <header className="mb-3">
          <h3 className="text-lg font-semibold text-slate-900">
            MaxLFQ intensity distribution
          </h3>
          <p className="text-sm text-slate-600">
            Histogram of log<sub>10</sub>(MaxLFQ) across all positive, finite
            protein×sample observations. Zero and blank values are missing.
          </p>
          <p className="mt-1 text-sm font-medium text-slate-700" data-testid="histogram-total">
            {histogram.total.toLocaleString()} observations · {hist.length} bins · no sampling
          </p>
        </header>
        {histogram.total === 0 ? <p className="text-sm text-slate-600">No positive, finite intensities to plot.</p> :
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hist} barCategoryGap={0} margin={{ top: 8, right: 12, left: 12, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="midpoint"
                tickFormatter={(value: number) => value.toFixed(2)}
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                label={{
                  value: "log10 MaxLFQ",
                  position: "insideBottom",
                  offset: -12,
                  style: { fontSize: 12, fill: "#64748b" },
                }}
              />
              <YAxis width={65} allowDecimals={false} tick={{ fontSize: 12 }} label={{ value: "Observations", angle: -90, position: "insideLeft", offset: -5, style: { fontSize: 11 } }} />
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
              <Bar dataKey="count" fill="#0f766e" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>}
      </div>

      <div>
        <header className="mb-3">
          <h3 className="text-lg font-semibold text-slate-900">
            Per-sample log<sub>10</sub> MaxLFQ summary
          </h3>
          <p className="text-sm text-slate-600">
            Quartile summary (min / Q1 / median / Q3 / max) of positive MaxLFQ
            values per sample. Select a sample row to highlight it across views;
            the histogram above continues to summarize all observations.
          </p>
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
              {boxes.map((b) => (
                <tr key={b.sample} className={`border-t border-slate-100 ${selectedSamples.includes(b.sample) ? "bg-teal-50" : ""}`} data-selected={selectedSamples.includes(b.sample)}>
                  <td className="px-3 py-2 font-medium text-slate-900">
                    <button type="button" aria-label={`Select sample ${b.sample} in intensity summary`} aria-pressed={selectedSamples.includes(b.sample)} onClick={() => onSelectSamples([b.sample])} className="rounded underline underline-offset-4 focus-visible:outline-teal-700">{b.sample}</button>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{b.condition}</td>
                  <td className="px-3 py-2 tabular-nums">{b.n}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {b.median.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {b.q1.toFixed(2)} – {b.q3.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {b.min.toFixed(2)} – {b.max.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
