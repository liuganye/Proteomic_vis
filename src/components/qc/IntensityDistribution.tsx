"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { intensityBoxBySample, intensityLong } from "@/lib/stats";
import type { FragPipeDataset } from "@/lib/types";

type BoxRow = ReturnType<typeof intensityBoxBySample>[number];

function buildHistogram(values: number[], bins = 30) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / bins || 1;
  const counts = Array.from({ length: bins }, (_, i) => ({
    bin: min + (i + 0.5) * width,
    label: (min + i * width).toFixed(2),
    count: 0,
  }));
  for (const v of values) {
    let idx = Math.floor((v - min) / width);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx].count += 1;
  }
  return counts;
}

export function IntensityDistribution({
  dataset,
  boxes: precomputedBoxes,
}: {
  dataset: FragPipeDataset;
  boxes?: BoxRow[];
}) {
  const long = intensityLong(dataset, { log10: true, maxPoints: 20000 });
  const hist = buildHistogram(long.map((d) => d.value));
  const boxes = precomputedBoxes ?? intensityBoxBySample(dataset);

  return (
    <div className="space-y-8">
      <div>
        <header className="mb-3">
          <h3 className="text-lg font-semibold text-slate-900">
            MaxLFQ intensity distribution
          </h3>
          <p className="text-sm text-slate-600">
            Histogram of log<sub>10</sub>(MaxLFQ) across all non-zero
            protein×sample observations. Zeros are excluded (missing).
          </p>
        </header>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hist} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                label={{
                  value: "log10 MaxLFQ",
                  position: "insideBottom",
                  offset: -2,
                  style: { fontSize: 12, fill: "#64748b" },
                }}
              />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value) => [value, "Count"]}
                labelFormatter={(l) => `bin ~ ${l}`}
              />
              <Bar dataKey="count" fill="#0f766e" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <header className="mb-3">
          <h3 className="text-lg font-semibold text-slate-900">
            Per-sample log<sub>10</sub> MaxLFQ summary
          </h3>
          <p className="text-sm text-slate-600">
            Quartile summary (min / Q1 / median / Q3 / max) of positive MaxLFQ
            values per sample.
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
                <tr key={b.sample} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {b.sample}
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
