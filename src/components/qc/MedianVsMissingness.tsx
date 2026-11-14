"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { medianVsMissingness } from "@/lib/stats";
import type { FragPipeDataset, SampleSelectionProps } from "@/lib/types";

const CONDITION_COLORS: Record<string, string> = {
  "Group A": "#0f766e",
  "Group B": "#b45309",
  Human: "#0f766e",
  QC: "#b45309",
  Condition_A: "#2563eb",
  Condition_B: "#7c3aed",
  Ecoli: "#be123c",
  Yeast: "#4d7c0f",
  Unknown: "#64748b",
};

type ScatterRow = ReturnType<typeof medianVsMissingness>[number];

export function MedianVsMissingness({
  dataset,
  rows,
  selectedSamples,
  onSelectSamples,
}: {
  dataset: FragPipeDataset;
  rows?: ScatterRow[];
} & SampleSelectionProps) {
  const data = rows ?? medianVsMissingness(dataset);
  const byCondition = new Map<string, typeof data>();
  for (const row of data) {
    const list = byCondition.get(row.condition) ?? [];
    list.push(row);
    byCondition.set(row.condition, list);
  }

  return (
    <div>
      <header className="mb-3">
        <p className="text-xs font-semibold tracking-wide text-amber-800 uppercase">
          Custom plot
        </p>
        <h3 className="text-lg font-semibold text-slate-900">
          Median intensity vs missingness
        </h3>
        <p className="text-sm text-slate-600">
          Project-specific QC: each sample plotted by % MaxLFQ missing (x) and
          median log<sub>10</sub> MaxLFQ (y). Compare samples within suitable
          experimental groups; composition can affect both measures.
        </p>
      </header>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              type="number"
              dataKey="missingPct"
              name="% missing"
              unit="%"
              domain={[0, "auto"]}
              tick={{ fontSize: 12 }}
              label={{
                value: "% missing",
                position: "insideBottom",
                offset: -4,
                style: { fontSize: 12, fill: "#64748b" },
              }}
            />
            <YAxis
              type="number"
              dataKey="medianLog10"
              name="median log10"
              tick={{ fontSize: 12 }}
              label={{
                value: "median log10 MaxLFQ",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 12, fill: "#64748b" },
              }}
            />
            <ZAxis range={[80, 80]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload as ScatterRow | undefined;
                if (!d) return null;
                return (
                  <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
                    <div className="font-semibold text-slate-900">{d.sample}</div>
                    <div className="text-slate-600">{d.condition}</div>
                    <div className="mt-1 tabular-nums text-slate-700">
                      {d.missingPct}% missing · median {d.medianLog10.toFixed(2)} ·
                      n={d.nDetected}
                    </div>
                  </div>
                );
              }}
            />
            {[...byCondition.entries()].map(([condition, rowsForCond]) => (
              <Scatter
                key={condition}
                name={condition}
                data={rowsForCond}
                fill={CONDITION_COLORS[condition] ?? CONDITION_COLORS.Unknown}
                isAnimationActive={false}
                shape={(props: unknown) => {
                  const { cx, cy, fill, payload } = props as { cx: number; cy: number; fill: string; payload: ScatterRow };
                  const selected = selectedSamples.includes(payload.sample);
                  return <circle cx={cx} cy={cy} r={selected ? 7 : 5} fill={fill} stroke={selected ? "#0f172a" : "white"} strokeWidth={selected ? 2.5 : 0.5}
                    role="button" tabIndex={0} aria-label={`Select sample ${payload.sample} in median chart`} aria-pressed={selected} data-sample={payload.sample}
                    className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900"
                    onClick={() => onSelectSamples([payload.sample])} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectSamples([payload.sample]); } }}>
                    <title>{payload.sample}: {payload.missingPct}% missing, median {payload.medianLog10.toFixed(2)}</title>
                  </circle>;
                }}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        {[...byCondition.keys()].map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{
                background: CONDITION_COLORS[k] ?? CONDITION_COLORS.Unknown,
              }}
            />
            {k}
          </li>
        ))}
      </ul>
    </div>
  );
}
