"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
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
} from "@/lib/stats";
import type { ChartSpec } from "@/lib/types";

const DEFAULT_FILL = "#0f766e";

export function ChartSpecView({
  chartSpec,
}: {
  chartSpec: ChartSpec;
}) {
  const seriesKey = chartSpec.seriesKey;
  const groups = useMemo(() => {
    if (!seriesKey) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of chartSpec.data) {
      const g = String(row[seriesKey] ?? "");
      if (!g || seen.has(g)) continue;
      seen.add(g);
      out.push(g);
    }
    return out;
  }, [chartSpec.data, seriesKey]);
  const colorMap = useMemo(() => buildConditionColorMap(groups), [groups]);

  if (chartSpec.data.length === 0) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
        Script returned an empty chart.
      </p>
    );
  }

  if (chartSpec.type === "scatter") {
    const byGroup = new Map<string, typeof chartSpec.data>();
    for (const row of chartSpec.data) {
      const key = seriesKey ? String(row[seriesKey] ?? "all") : "all";
      const list = byGroup.get(key) ?? [];
      list.push(row);
      byGroup.set(key, list);
    }
    return (
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              type="number"
              dataKey={chartSpec.xKey}
              name={chartSpec.xLabel ?? chartSpec.xKey}
              tick={{ fontSize: 12 }}
              label={{
                value: chartSpec.xLabel ?? chartSpec.xKey,
                position: "insideBottom",
                offset: -4,
                style: { fontSize: 12, fill: "#64748b" },
              }}
            />
            <YAxis
              type="number"
              dataKey={chartSpec.yKey}
              name={chartSpec.yLabel ?? chartSpec.yKey}
              tick={{ fontSize: 12 }}
              label={{
                value: chartSpec.yLabel ?? chartSpec.yKey,
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 12, fill: "#64748b" },
              }}
            />
            <ZAxis range={[80, 80]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            {[...byGroup.entries()].map(([group, data]) => (
              <Scatter
                key={group}
                name={group}
                data={data}
                fill={
                  seriesKey
                    ? conditionColor(group, colorMap)
                    : DEFAULT_FILL
                }
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (chartSpec.type === "line") {
    return (
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartSpec.data}
            margin={{ top: 8, right: 12, left: 0, bottom: 48 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey={chartSpec.xKey}
              tick={{ fontSize: 11 }}
              angle={-35}
              textAnchor="end"
              height={60}
            />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey={chartSpec.yKey}
              stroke={DEFAULT_FILL}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // bar + histogram
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartSpec.data}
          margin={{ top: 8, right: 12, left: 0, bottom: 48 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey={chartSpec.xKey}
            angle={-35}
            textAnchor="end"
            interval={0}
            tick={{ fontSize: 11 }}
            height={60}
            label={{
              value: chartSpec.xLabel ?? chartSpec.xKey,
              position: "insideBottom",
              offset: -2,
              style: { fontSize: 12, fill: "#64748b" },
            }}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            label={{
              value: chartSpec.yLabel ?? chartSpec.yKey,
              angle: -90,
              position: "insideLeft",
              style: { fontSize: 12, fill: "#64748b" },
            }}
          />
          <Tooltip />
          <Bar dataKey={chartSpec.yKey} radius={[4, 4, 0, 0]}>
            {chartSpec.data.map((d, i) => {
              const group = seriesKey ? String(d[seriesKey] ?? "") : "";
              return (
                <Cell
                  key={`${String(d[chartSpec.xKey])}-${i}`}
                  fill={
                    seriesKey && group
                      ? conditionColor(group, colorMap)
                      : DEFAULT_FILL
                  }
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {seriesKey && groups.length > 0 ? (
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
      ) : null}
    </div>
  );
}
