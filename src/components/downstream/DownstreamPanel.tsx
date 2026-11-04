"use client";

import { useEffect, useMemo, useState } from "react";
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
  annotationGroups,
  defaultGroupPair,
  volcanoForGroups,
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
  const groups = useMemo(() => annotationGroups(dataset), [dataset]);
  const defaults = useMemo(() => defaultGroupPair(groups), [groups]);

  const [groupA, setGroupA] = useState(defaults.groupA);
  const [groupB, setGroupB] = useState(defaults.groupB);
  const [fcThr, setFcThr] = useState(1);
  const [pThr, setPThr] = useState(0.05);

  // Re-default when a new dataset / annotation arrives
  useEffect(() => {
    setGroupA(defaults.groupA);
    setGroupB(defaults.groupB);
  }, [defaults.groupA, defaults.groupB, dataset.source, dataset.annotationFileName]);

  const canCompare = Boolean(groupA && groupB && groupA !== groupB);

  const { points, contrastLabel, approximated, ready, emptyReason } = useMemo(
    () =>
      volcanoForGroups(dataset, groupA, groupB, {
        log2fcThreshold: fcThr,
        adjPThreshold: pThr,
      }),
    [dataset, groupA, groupB, fcThr, pThr],
  );

  const groupControls = (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-slate-600">Group A</span>
        <select
          className="rounded-md border border-slate-300 bg-white px-2 py-1"
          value={groupA}
          onChange={(e) => setGroupA(e.target.value)}
          aria-label="Group A"
        >
          <option value="">Select group…</option>
          {groups.map((g) => (
            <option key={`a-${g}`} value={g} disabled={g === groupB}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-slate-600">Group B</span>
        <select
          className="rounded-md border border-slate-300 bg-white px-2 py-1"
          value={groupB}
          onChange={(e) => setGroupB(e.target.value)}
          aria-label="Group B"
        >
          <option value="">Select group…</option>
          {groups.map((g) => (
            <option key={`b-${g}`} value={g} disabled={g === groupA}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <span
        className={
          canCompare
            ? "rounded-md bg-teal-50 px-2 py-1 text-xs font-medium text-teal-900"
            : "rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500"
        }
        title={
          canCompare
            ? `Comparing ${groupA} vs ${groupB}`
            : "Choose two different groups to compare"
        }
      >
        {canCompare ? `Compare: ${groupA} vs ${groupB}` : "Compare disabled"}
      </span>
      <label className="flex items-center gap-1.5">
        <span className="text-slate-600">|log2FC| ≥</span>
        <input
          type="number"
          step="0.1"
          min="0"
          className="w-16 rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
          value={fcThr}
          disabled={!canCompare}
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
          className="w-20 rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
          value={pThr}
          disabled={!canCompare}
          onChange={(e) => setPThr(Number(e.target.value))}
        />
      </label>
    </div>
  );

  if (module === "results") {
    return (
      <div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-slate-600">
              Groups from{" "}
              <code className="rounded bg-slate-100 px-1">
                experiment_annotation.tsv
              </code>{" "}
              condition/group column (aligned to MaxLFQ sample prefixes). Results
              follow the selected contrast; Protein Probability is shown when
              present in the protein table.
            </p>
          </div>
          {groupControls}
        </div>
        {dataset.annotationWarning && (
          <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {dataset.annotationWarning}
          </p>
        )}
        {!canCompare ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
            Select two different groups (Group A and Group B) to compare before
            viewing DE results.
          </p>
        ) : (
          <ResultsTable points={points} contrastLabel={contrastLabel} />
        )}
      </div>
    );
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
            Choose any two annotation groups. MaxLFQ columns are autodetected
            (`{"{sample} MaxLFQ Intensity"}`) and mapped to groups via sample ID,
            Control↔CTRK-style synonyms, or residual size matching. Uses limma
            when that contrast exists; otherwise approximates from MaxLFQ group
            means.
          </p>
        </div>
        {groupControls}
      </header>

      {dataset.annotationWarning && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {dataset.annotationWarning}
        </p>
      )}

      {!canCompare || !ready ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
          {groups.length < 2
            ? "Need at least two condition/group labels that map to MaxLFQ samples to build a contrast."
            : "Select two different groups (Group A ≠ Group B) to enable the comparison."}
        </p>
      ) : (
        <>
          {approximated && (
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              No limma adjusted p-value columns for {groupA} vs {groupB}.
              Showing an approximate volcano from MaxLFQ group means (demo only
              — not a limma DE result).
            </p>
          )}

          {points.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
              No volcano points for {groupA} vs {groupB}.{" "}
              {emptyReason ??
                "Need matching log2FC + adj.P columns, or MaxLFQ intensities for samples in both groups."}
            </p>
          ) : (
            <>
              <div className="h-96 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart
                    margin={{ top: 12, right: 16, bottom: 12, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      type="number"
                      dataKey="log2fc"
                      name="log2FC"
                      tick={{ fontSize: 12 }}
                      label={{
                        value: `log2 fold change (${groupA} / ${groupB})`,
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
                        const p = payload?.[0]?.payload as
                          | VolcanoPoint
                          | undefined;
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
                    <ReferenceLine
                      x={fcThr}
                      stroke="#cbd5e1"
                      strokeDasharray="4 4"
                    />
                    <ReferenceLine
                      x={-fcThr}
                      stroke="#cbd5e1"
                      strokeDasharray="4 4"
                    />
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
        </>
      )}
    </div>
  );
}
