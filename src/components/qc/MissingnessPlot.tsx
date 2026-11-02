"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { missingnessBySample } from "@/lib/stats";
import type { FragPipeDataset } from "@/lib/types";

const CONDITION_COLORS: Record<string, string> = {
  Human: "#0f766e",
  QC: "#b45309",
  Unknown: "#64748b",
};

type MissRow = ReturnType<typeof missingnessBySample>[number];

export function MissingnessPlot({
  dataset,
  rows,
}: {
  dataset: FragPipeDataset;
  /** Precomputed rows from computeQcBundle (avoids a second pass after upload). */
  rows?: MissRow[];
}) {
  const data = (rows ?? missingnessBySample(dataset)).map((d) => ({
    ...d,
    pct: Math.round(d.missingFraction * 1000) / 10,
  }));

  return (
    <div>
      <header className="mb-3">
        <h3 className="text-lg font-semibold text-slate-900">
          Missingness by sample
        </h3>
        <p className="text-sm text-slate-600">
          Fraction of proteins with MaxLFQ intensity = 0 (treated as missing)
          per sample. Bars colored by condition from annotation.
        </p>
      </header>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 48 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="sample"
              angle={-35}
              textAnchor="end"
              interval={0}
              tick={{ fontSize: 11 }}
              height={60}
            />
            <YAxis
              unit="%"
              domain={[0, 100]}
              tick={{ fontSize: 12 }}
              label={{
                value: "% missing",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 12, fill: "#64748b" },
              }}
            />
            <Tooltip
              formatter={(value) => [`${value}%`, "Missing"]}
              labelFormatter={(label) => `Sample: ${label}`}
            />
            <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
              {data.map((d) => (
                <Cell
                  key={d.sample}
                  fill={CONDITION_COLORS[d.condition] ?? CONDITION_COLORS.Unknown}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        {Object.entries(CONDITION_COLORS).map(([k, c]) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
            {k}
          </li>
        ))}
      </ul>
    </div>
  );
}
