"use client";

import { useMemo } from "react";
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
import {
  buildConditionColorMap,
  conditionColor,
  missingnessBySample,
} from "@/lib/stats";
import type { FragPipeDataset } from "@/lib/types";

type MissRow = ReturnType<typeof missingnessBySample>[number];

export function MissingnessPlot({
  dataset,
  rows,
  colorMap: colorMapProp,
}: {
  dataset: FragPipeDataset;
  /** Precomputed rows from computeQcBundle (avoids a second pass after upload). */
  rows?: MissRow[];
  colorMap?: Record<string, string>;
}) {
  const data = (rows ?? missingnessBySample(dataset)).map((d) => ({
    ...d,
    pct: Math.round(d.missingFraction * 1000) / 10,
  }));
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const d of data) {
      if (seen.has(d.condition)) continue;
      seen.add(d.condition);
      out.push(d.condition);
    }
    return out;
  }, [data]);
  const colorMap = colorMapProp ?? buildConditionColorMap(groups);

  return (
    <div>
      <header className="mb-3">
        <h3 className="text-lg font-semibold text-slate-900">
          Missingness by sample
        </h3>
        <p className="text-sm text-slate-600">
          Fraction of proteins with MaxLFQ intensity = 0 (treated as missing)
          per sample. Samples ordered by annotation group; bars colored by
          condition ({groups.length} group{groups.length === 1 ? "" : "s"}).
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
              labelFormatter={(label) => {
                const row = data.find((d) => d.sample === label);
                return row
                  ? `${row.sample} (${row.condition})`
                  : `Sample: ${label}`;
              }}
            />
            <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
              {data.map((d) => (
                <Cell
                  key={d.sample}
                  fill={conditionColor(d.condition, colorMap)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        {groups.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: conditionColor(k, colorMap) }}
            />
            {k}
          </li>
        ))}
      </ul>
    </div>
  );
}
