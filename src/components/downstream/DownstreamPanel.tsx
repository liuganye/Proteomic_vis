"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  approximateHumanVsQc,
  buildVolcano,
  preferHumanVsQcContrast,
} from "@/lib/stats";
import type {
  DownstreamModuleId,
  FragPipeDataset,
  VolcanoPoint,
} from "@/lib/types";
import { ResultsTable } from "./ResultsTable";

const COLORS = {
  up: "#0f766e",
  down: "#b45309",
  ns: "#94a3b8",
};

interface Props {
  dataset: FragPipeDataset;
  module: DownstreamModuleId;
}

export function DownstreamPanel({ dataset, module }: Props) {
  const preferred = preferHumanVsQcContrast(dataset.contrasts);
  const [contrast, setContrast] = useState<string>(
    preferred ?? (dataset.contrasts[0] ?? "__approx__"),
  );
  const [fcThr, setFcThr] = useState(1);
  const [pThr, setPThr] = useState(0.05);

  const { points, contrastLabel, approximated } = useMemo(() => {
    if (contrast === "__approx__" || dataset.contrasts.length === 0) {
      const approx = approximateHumanVsQc(dataset);
      if (!approx) {
        return {
          points: [] as VolcanoPoint[],
          contrastLabel: "—",
          approximated: true,
        };
      }
      // re-threshold approx points with UI thresholds
      const pts = approx.points.map((p) => {
        const significant =
          Math.abs(p.log2fc) >= fcThr && p.adjP <= pThr;
        return {
          ...p,
          significant,
          direction: (!significant
            ? "ns"
            : p.log2fc > 0
              ? "up"
              : "down") as VolcanoPoint["direction"],
        };
      });
      return {
        points: pts,
        contrastLabel: approx.contrast,
        approximated: true,
      };
    }
    return {
      points: buildVolcano(dataset, contrast, {
        log2fcThreshold: fcThr,
        adjPThreshold: pThr,
      }),
      contrastLabel: contrast,
      approximated: false,
    };
  }, [dataset, contrast, fcThr, pThr]);

  if (module === "results") {
    return <ResultsTable points={points} contrastLabel={contrastLabel} />;
  }

  const up = points.filter((p) => p.direction === "up");
  const down = points.filter((p) => p.direction === "down");
  const ns = points.filter((p) => p.direction === "ns");

  return (
    <div>
      <header className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Volcano plot</h3>
          <p className="text-sm text-slate-600">
            Human vs QC when annotation / contrast columns are present. Uses
            adjusted p-value and log<sub>2</sub> fold change from FragPipe
            protein output.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <span className="text-slate-600">Contrast</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
              value={dataset.contrasts.length === 0 ? "__approx__" : contrast}
              onChange={(e) => setContrast(e.target.value)}
            >
              {dataset.contrasts.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {dataset.contrasts.length === 0 && (
                <option value="__approx__">
                  Human vs QC (approx from MaxLFQ)
                </option>
              )}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-slate-600">|log2FC| ≥</span>
            <input
              type="number"
              step="0.1"
              min="0"
              className="w-16 rounded-md border border-slate-300 px-2 py-1"
              value={fcThr}
              onChange={(e) => setFcThr(Number(e.target.value))}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-slate-600">adj.P ≤</span>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              className="w-20 rounded-md border border-slate-300 px-2 py-1"
              value={pThr}
              onChange={(e) => setPThr(Number(e.target.value))}
            />
          </label>
        </div>
      </header>

      {approximated && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No adjusted p-value columns detected. Showing an approximate Human vs
          QC volcano from MaxLFQ means (demo only — not a limma DE result).
        </p>
      )}

      {points.length === 0 ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
          No volcano points available. Need log2 fold change + adjusted p-value
          columns, or Human/QC labels in the annotation to approximate.
        </p>
      ) : (
        <>
          <div className="h-96 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 12, right: 16, bottom: 12, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  type="number"
                  dataKey="log2fc"
                  name="log2FC"
                  tick={{ fontSize: 12 }}
                  label={{
                    value: "log2 fold change",
                    position: "insideBottom",
                    offset: -4,
                    style: { fontSize: 12, fill: "#64748b" },
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="negLog10AdjP"
                  name="-log10(adj.P)"
                  tick={{ fontSize: 12 }}
                  label={{
                    value: "−log10(adj.P)",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 12, fill: "#64748b" },
                  }}
                />
                <ZAxis range={[40, 40]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ payload }) => {
                    const p = payload?.[0]?.payload as VolcanoPoint | undefined;
                    if (!p) return null;
                    return (
                      <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                        <div className="font-semibold">{p.gene}</div>
                        <div className="text-slate-500">{p.proteinId}</div>
                        <div>log2FC: {p.log2fc.toFixed(3)}</div>
                        <div>adj.P: {p.adjP.toExponential(2)}</div>
                      </div>
                    );
                  }}
                />
                <ReferenceLine x={fcThr} stroke="#cbd5e1" strokeDasharray="4 4" />
                <ReferenceLine x={-fcThr} stroke="#cbd5e1" strokeDasharray="4 4" />
                <ReferenceLine
                  y={-Math.log10(Math.max(pThr, 1e-300))}
                  stroke="#cbd5e1"
                  strokeDasharray="4 4"
                />
                <Scatter data={ns} fill={COLORS.ns} name="NS" />
                <Scatter data={up} fill={COLORS.up} name="Up" />
                <Scatter data={down} fill={COLORS.down} name="Down" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
            <li className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: COLORS.up }}
              />
              Up ({up.length})
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: COLORS.down }}
              />
              Down ({down.length})
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: COLORS.ns }}
              />
              NS ({ns.length})
            </li>
            <li className="text-slate-500">Contrast: {contrastLabel}</li>
          </ul>
        </>
      )}
    </div>
  );
}
