"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
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
import type { FragPipeDataset, SampleSelectionProps } from "@/lib/types";

type MissRow = ReturnType<typeof missingnessBySample>[number];

export function MissingnessPlot({
  dataset,
  rows,
  colorMap: colorMapProp,
  selectedSamples,
  onSelectSamples,
}: {
  dataset: FragPipeDataset;
  /** Precomputed rows from computeQcBundle (avoids a second pass after upload). */
  rows?: MissRow[];
  colorMap?: Record<string, string>;
} & SampleSelectionProps) {
  const data = useMemo(
    () =>
      (rows ?? missingnessBySample(dataset)).map((d) => ({
        ...d,
        pct: Math.round(d.missingFraction * 1000) / 10,
      })),
    [rows, dataset],
  );
  const [threshold, setThreshold] = useState(30);
  const [dragging, setDragging] = useState(false);
  const dragRectRef = useRef<{ bottom: number; height: number } | null>(null);

  const exceedingSamples = useMemo(
    () => data.filter((d) => d.pct > threshold).map((d) => d.sample),
    [data, threshold],
  );
  const exceedingSet = useMemo(() => new Set(exceedingSamples), [exceedingSamples]);

  const updateThresholdFromClientY = useCallback((clientY: number) => {
    const rect = dragRectRef.current;
    if (!rect || rect.height <= 0) return;
    const raw = ((rect.bottom - clientY) / rect.height) * 100;
    setThreshold(Math.round(Math.max(0, Math.min(100, raw))));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      updateThresholdFromClientY(e.clientY);
    };
    const onEnd = () => {
      dragRectRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [dragging, updateThresholdFromClientY]);

  const handleLinePointerDown = useCallback(
    (e: React.PointerEvent<SVGGElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const svg = e.currentTarget.closest("svg");
      const grid = svg?.querySelector(".recharts-cartesian-grid");
      const rect = grid?.getBoundingClientRect();
      if (!rect || rect.height <= 0) return;
      dragRectRef.current = { bottom: rect.bottom, height: rect.height };
      setDragging(true);
      updateThresholdFromClientY(e.clientY);
    },
    [updateThresholdFromClientY],
  );

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
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">
          Missingness by sample
        </h3>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          % MaxLFQ = 0 · {groups.length} group{groups.length === 1 ? "" : "s"}
        </span>
      </header>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 font-medium" htmlFor="missingness-cutoff-slider">
            <span>QC cutoff</span>
            <input
              id="missingness-cutoff-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="h-1.5 w-28 cursor-pointer accent-[#c45c56]"
              aria-label="Missingness QC cutoff percentage"
            />
            <span className="w-9 tabular-nums font-semibold text-[#991b1b]">{threshold}%</span>
          </label>
          <span className="text-slate-400">· drag dashed line</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 tabular-nums font-medium ${
              exceedingSamples.length > 0
                ? "border border-[#e8ae9e] bg-[#fff5f5] text-[#991b1b]"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {exceedingSamples.length} / {data.length} &gt; {threshold}%
          </span>
          {exceedingSamples.length > 0 && (
            <button
              type="button"
              onClick={() => onSelectSamples(exceedingSamples)}
              className="rounded border border-[#e8ae9e] bg-white px-2 py-0.5 font-medium text-[#991b1b] hover:bg-[#fff5f5]"
            >
              Select flagged
            </button>
          )}
        </div>
      </div>
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
              labelFormatter={(label) => {
                const row = data.find((d) => d.sample === label);
                return row
                  ? `${row.sample} (${row.condition})`
                  : `Sample: ${label}`;
              }}
            />
            <Bar dataKey="pct" isAnimationActive={false} shape={(props: unknown) => {
              const { x, y, width, height, fill, payload } = props as { x: number; y: number; width: number; height: number; fill: string; payload: MissRow & { pct: number } };
              const selected = selectedSamples.includes(payload.sample);
              const exceeds = exceedingSet.has(payload.sample);
              const dimmed = exceedingSamples.length > 0 && !exceeds && !selected;
              return <g
                role="button" tabIndex={0} aria-label={`Select sample ${payload.sample} in missingness chart`} aria-pressed={selected} data-sample={payload.sample}
                className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900"
                onClick={() => onSelectSamples([payload.sample])} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectSamples([payload.sample]); } }}>
                <title>{payload.sample}: {payload.pct}% missing{exceeds ? ` (above ${threshold}% cutoff)` : ""}</title>
                <rect x={x} y={y - (height === 0 ? 3 : 0)} width={width} height={Math.max(height, 6)} fill="transparent" pointerEvents="all" />
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill={fill}
                  fillOpacity={dimmed ? 0.5 : 1}
                  stroke={selected ? "#0f172a" : exceeds ? "#c45c56" : "none"}
                  strokeWidth={selected ? 3 : exceeds ? 1.5 : 0}
                  pointerEvents="none"
                />
              </g>;
            }}>
              {data.map((d) => (
                <Cell
                  key={d.sample}
                  fill={conditionColor(d.condition, colorMap)}
                />
              ))}
            </Bar>
            <ReferenceLine
              y={threshold}
              stroke={dragging ? "#b91c1c" : "#c45c56"}
              strokeWidth={dragging ? 2.5 : 1.75}
              strokeDasharray="6 4"
              label={(props: { viewBox?: { x?: number; y?: number; width?: number } }) => {
                const vx = props.viewBox?.x ?? 0;
                const vy = props.viewBox?.y ?? 0;
                const vw = props.viewBox?.width ?? 0;
                if (vw <= 0) return <g />;
                const badgeW = 60;
                const badgeH = 20;
                const badgeX = vx + vw - badgeW - 4;
                const badgeY = Math.max(2, vy - badgeH / 2);
                return (
                  <g
                    role="slider"
                    aria-label="Drag missingness threshold line"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={threshold}
                    style={{ cursor: "ns-resize" }}
                    onPointerDown={handleLinePointerDown}
                  >
                    <title>Drag up or down to adjust missingness cutoff ({threshold}%)</title>
                    <rect x={vx} y={vy - 8} width={vw} height={16} fill="transparent" />
                    <rect
                      x={badgeX}
                      y={badgeY}
                      width={badgeW}
                      height={badgeH}
                      rx={10}
                      fill={dragging ? "#b91c1c" : "#fff5f5"}
                      stroke="#c45c56"
                      strokeWidth={1.25}
                    />
                    <text
                      x={badgeX + badgeW / 2}
                      y={badgeY + 13.5}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill={dragging ? "#ffffff" : "#991b1b"}
                      style={{ userSelect: "none", pointerEvents: "none" }}
                    >
                      ↕ {threshold}%
                    </text>
                  </g>
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
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
