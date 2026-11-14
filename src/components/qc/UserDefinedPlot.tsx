"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  buildSampleMetricRows,
  metricLabel,
  type SampleMetricRow,
} from "@/lib/custom-plot-metrics";
import {
  buildConditionColorMap,
  conditionColor,
} from "@/lib/stats";
import type { FragPipeDataset, UserCustomPlotSpec } from "@/lib/types";

function buildHistogram(values: number[], bins = 20) {
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

export function UserDefinedPlot({
  dataset,
  spec,
  rows: precomputed,
  colorMap: colorMapProp,
  onRemove,
}: {
  dataset: FragPipeDataset;
  spec: UserCustomPlotSpec;
  rows?: SampleMetricRow[];
  colorMap?: Record<string, string>;
  onRemove: (id: string) => void;
}) {
  const rows = precomputed ?? buildSampleMetricRows(dataset);
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      if (seen.has(r.group)) continue;
      seen.add(r.group);
      out.push(r.group);
    }
    return out;
  }, [rows]);
  const colorMap = colorMapProp ?? buildConditionColorMap(groups);
  const colorByGroup = (spec.colorBy ?? "group") === "group";
  const defaultFill = "#0f766e";

  return (
    <div>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-amber-800 uppercase">
            User custom plot · {spec.kind}
          </p>
          <h3 className="text-lg font-semibold text-slate-900">{spec.title}</h3>
          <p className="text-sm text-slate-600">
            Session-defined QC view over sample metrics
            {colorByGroup ? ", colored by annotation group" : ""}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRemove(spec.id)}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          aria-label={`Remove plot ${spec.title}`}
        >
          Remove
        </button>
      </header>

      {spec.kind === "scatter" && spec.xKey && spec.yKey ? (
        <ScatterView
          rows={rows}
          xKey={spec.xKey}
          yKey={spec.yKey}
          colorByGroup={colorByGroup}
          colorMap={colorMap}
          defaultFill={defaultFill}
        />
      ) : null}

      {spec.kind === "bar" && spec.xKey && spec.yKey ? (
        <BarView
          rows={rows}
          xKey={spec.xKey}
          yKey={spec.yKey}
          colorByGroup={colorByGroup}
          colorMap={colorMap}
          defaultFill={defaultFill}
        />
      ) : null}

      {spec.kind === "histogram" && spec.valueKey ? (
        <HistogramView rows={rows} valueKey={spec.valueKey} />
      ) : null}

      {colorByGroup && spec.kind !== "histogram" ? (
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

function ScatterView({
  rows,
  xKey,
  yKey,
  colorByGroup,
  colorMap,
  defaultFill,
}: {
  rows: SampleMetricRow[];
  xKey: keyof SampleMetricRow;
  yKey: keyof SampleMetricRow;
  colorByGroup: boolean;
  colorMap: Record<string, string>;
  defaultFill: string;
}) {
  const byGroup = useMemo(() => {
    const map = new Map<string, SampleMetricRow[]>();
    for (const row of rows) {
      const key = colorByGroup ? row.group : "all";
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, [rows, colorByGroup]);

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            type="number"
            dataKey={xKey}
            name={metricLabel(xKey as never)}
            tick={{ fontSize: 12 }}
            label={{
              value: metricLabel(xKey as never),
              position: "insideBottom",
              offset: -4,
              style: { fontSize: 12, fill: "#64748b" },
            }}
          />
          <YAxis
            type="number"
            dataKey={yKey}
            name={metricLabel(yKey as never)}
            tick={{ fontSize: 12 }}
            label={{
              value: metricLabel(yKey as never),
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
              const d = payload[0]?.payload as SampleMetricRow | undefined;
              if (!d) return null;
              return (
                <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
                  <div className="font-semibold text-slate-900">{d.sample}</div>
                  <div className="text-slate-600">{d.group}</div>
                  <div className="mt-1 tabular-nums text-slate-700">
                    {metricLabel(xKey as never)}: {String(d[xKey])} ·{" "}
                    {metricLabel(yKey as never)}: {String(d[yKey])}
                  </div>
                </div>
              );
            }}
          />
          {[...byGroup.entries()].map(([group, data]) => (
            <Scatter
              key={group}
              name={group}
              data={data}
              fill={
                colorByGroup
                  ? conditionColor(group, colorMap)
                  : defaultFill
              }
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function BarView({
  rows,
  xKey,
  yKey,
  colorByGroup,
  colorMap,
  defaultFill,
}: {
  rows: SampleMetricRow[];
  xKey: keyof SampleMetricRow;
  yKey: keyof SampleMetricRow;
  colorByGroup: boolean;
  colorMap: Record<string, string>;
  defaultFill: string;
}) {
  // Aggregate when X is group: mean of numeric Y per group.
  const data = useMemo(() => {
    if (xKey !== "group") {
      return rows.map((r) => ({
        category: String(r[xKey]),
        value: Number(r[yKey]),
        group: r.group,
        sample: r.sample,
      }));
    }
    const by = new Map<string, number[]>();
    for (const r of rows) {
      const list = by.get(r.group) ?? [];
      list.push(Number(r[yKey]));
      by.set(r.group, list);
    }
    return [...by.entries()].map(([group, vals]) => ({
      category: group,
      value:
        vals.length === 0
          ? 0
          : Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) /
            100,
      group,
      sample: group,
    }));
  }, [rows, xKey, yKey]);

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 48 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="category"
            angle={-35}
            textAnchor="end"
            interval={0}
            tick={{ fontSize: 11 }}
            height={60}
            label={{
              value: metricLabel(xKey as never),
              position: "insideBottom",
              offset: -2,
              style: { fontSize: 12, fill: "#64748b" },
            }}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            label={{
              value: metricLabel(yKey as never),
              angle: -90,
              position: "insideLeft",
              style: { fontSize: 12, fill: "#64748b" },
            }}
          />
          <Tooltip
            formatter={(value) => [value, metricLabel(yKey as never)]}
            labelFormatter={(label) => `${metricLabel(xKey as never)}: ${label}`}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell
                key={`${d.category}-${d.sample}`}
                fill={
                  colorByGroup
                    ? conditionColor(d.group, colorMap)
                    : defaultFill
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HistogramView({
  rows,
  valueKey,
}: {
  rows: SampleMetricRow[];
  valueKey: keyof SampleMetricRow;
}) {
  const hist = useMemo(() => {
    const values = rows
      .map((r) => Number(r[valueKey]))
      .filter((v) => Number.isFinite(v));
    return buildHistogram(values);
  }, [rows, valueKey]);

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={hist} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            interval="preserveStartEnd"
            label={{
              value: metricLabel(valueKey as never),
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
  );
}
