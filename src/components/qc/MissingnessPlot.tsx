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
import type { FragPipeDataset, SampleSelectionProps } from "@/lib/types";

const CONDITION_COLORS: Record<string, string> = {
  Human: "#0f766e",
  QC: "#b45309",
  Condition_A: "#2563eb",
  Condition_B: "#7c3aed",
  Ecoli: "#be123c",
  Yeast: "#4d7c0f",
  Unknown: "#64748b",
};

type MissRow = ReturnType<typeof missingnessBySample>[number];

export function MissingnessPlot({
  dataset,
  rows,
  selectedSamples,
  onSelectSamples,
}: {
  dataset: FragPipeDataset;
  /** Precomputed rows from computeQcBundle (avoids a second pass after upload). */
  rows?: MissRow[];
} & SampleSelectionProps) {
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
      <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Missingness by sample chart. Scroll horizontally to inspect all sample labels.">
      <div className="h-80 w-full" style={{ minWidth: Math.max(480, data.length * 18 + 80) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="sample"
              angle={-55}
              textAnchor="end"
              interval={0}
              tick={{ fontSize: 11 }}
              height={84}
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
            <Bar dataKey="pct" isAnimationActive={false} shape={(props: unknown) => {
              const { x, y, width, height, fill, payload } = props as { x: number; y: number; width: number; height: number; fill: string; payload: MissRow & { pct: number } };
              const selected = selectedSamples.includes(payload.sample);
              return <g
                role="button" tabIndex={0} aria-label={`Select sample ${payload.sample} in missingness chart`} aria-pressed={selected} data-sample={payload.sample}
                className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900"
                onClick={() => onSelectSamples([payload.sample])} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectSamples([payload.sample]); } }}>
                <title>{payload.sample}: {payload.pct}% missing</title>
                <rect x={x} y={y - (height === 0 ? 3 : 0)} width={width} height={Math.max(height, 6)} fill="transparent" pointerEvents="all" />
                <rect x={x} y={y} width={width} height={height} fill={fill} stroke={selected ? "#0f172a" : "none"} strokeWidth={selected ? 3 : 0} pointerEvents="none" />
              </g>;
            }}>
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
      </div>
      <ul className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        {[...new Set(data.map(row => row.condition))].map(k => (
          <li key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CONDITION_COLORS[k] ?? CONDITION_COLORS.Unknown }} />
            {k}
          </li>
        ))}
      </ul>
    </div>
  );
}
