"use client";

import { useMemo } from "react";
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
import {
  buildConditionColorMap,
  conditionColor,
  medianVsMissingness,
} from "@/lib/stats";
import type { FragPipeDataset, SampleSelectionProps } from "@/lib/types";

type ScatterRow = ReturnType<typeof medianVsMissingness>[number];

export function MedianVsMissingness({
  dataset,
  rows,
  colorMap: colorMapProp,
  selectedSamples,
  onSelectSamples,
  compact = false,
}: {
  dataset: FragPipeDataset;
  rows?: ScatterRow[];
  colorMap?: Record<string, string>;
  compact?: boolean;
} & SampleSelectionProps) {
  const data = rows ?? medianVsMissingness(dataset);
  const byCondition = useMemo(() => {
    const map = new Map<string, ScatterRow[]>();
    for (const row of data) {
      const list = map.get(row.condition) ?? [];
      list.push(row);
      map.set(row.condition, list);
    }
    return map;
  }, [data]);
  const groups = [...byCondition.keys()];
  const colorMap = colorMapProp ?? buildConditionColorMap(groups);

  return (
    <div>
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">
          Median intensity vs missingness
        </h3>
        <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-900">
          Sample overview · click dot
        </span>
      </header>
      <div className={`${compact ? "chart-frame h-48" : "h-80"} w-full`}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: compact ? 4 : 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #d7e0e6)" />
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
                fill={conditionColor(condition, colorMap)}
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
        {groups.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: conditionColor(k, colorMap) }}
            />
            {k}
          </li>
        ))}
      </ul>
    </div>
  );
}
