"use client";

import { useEffect, useMemo, useState } from "react";
import {
  annotationGroups,
  defaultGroupPair,
  volcanoForGroups,
} from "@/lib/stats";
import type { FragPipeDataset } from "@/lib/types";
import { DownstreamPanel } from "./DownstreamPanel";

const MODULES = ["volcano", "results", "go"] as const;

/** Shared contrast controls + simultaneous volcano / results / GO grid cells. */
export function DownstreamMultiples({
  dataset,
  selectedProteinIds = [],
  onSelectProteins,
}: {
  dataset: FragPipeDataset;
  selectedProteinIds?: string[];
  onSelectProteins?: (ids: string[]) => void;
}) {
  const groups = useMemo(() => annotationGroups(dataset), [dataset]);
  const defaults = useMemo(() => defaultGroupPair(groups), [groups]);
  const [groupA, setGroupA] = useState(defaults.groupA);
  const [groupB, setGroupB] = useState(defaults.groupB);
  const [fcThr, setFcThr] = useState(1);
  const [pThr, setPThr] = useState(0.05);

  useEffect(() => {
    setGroupA(defaults.groupA);
    setGroupB(defaults.groupB);
  }, [defaults.groupA, defaults.groupB, dataset.source, dataset.annotationFileName]);

  const canCompare = Boolean(groupA && groupB && groupA !== groupB);
  const contrast = { groupA, groupB, fcThr, pThr };

  const { points, contrastLabel, approximated, ready } = useMemo(
    () =>
      volcanoForGroups(dataset, groupA, groupB, {
        log2fcThreshold: fcThr,
        adjPThreshold: pThr,
      }),
    [dataset, groupA, groupB, fcThr, pThr],
  );

  const up = points.filter((p) => p.direction === "up").length;
  const down = points.filter((p) => p.direction === "down").length;
  const sig = points.filter((p) => p.significant).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[color:var(--portal-border)] bg-white px-3 py-2 text-sm">
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

      <div className="plot-multiples" data-testid="downstream-plot-multiples">
        {MODULES.map((module) => (
          <div
            key={module}
            className="plot-multiples__cell"
            data-testid={`downstream-cell-${module}`}
          >
            <DownstreamPanel
              dataset={dataset}
              module={module}
              selectedProteinIds={selectedProteinIds}
              onSelectProteins={onSelectProteins}
              contrast={contrast}
              onContrastChange={(patch) => {
                if (patch.groupA !== undefined) setGroupA(patch.groupA);
                if (patch.groupB !== undefined) setGroupB(patch.groupB);
                if (patch.fcThr !== undefined) setFcThr(patch.fcThr);
                if (patch.pThr !== undefined) setPThr(patch.pThr);
              }}
              hideControls
            />
          </div>
        ))}
        <div className="plot-multiples__cell" data-testid="downstream-cell-contrast-summary">
          <h3 className="text-base font-semibold text-slate-900">
            Contrast summary
          </h3>
          {!canCompare || !ready ? (
            <p className="mt-2 text-xs text-slate-600">
              Select two groups above to summarize the shared volcano contrast.
            </p>
          ) : (
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div>
                <dt className="text-slate-500">Contrast</dt>
                <dd className="font-medium text-slate-800">{contrastLabel}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Points</dt>
                <dd className="font-medium tabular-nums text-slate-800">
                  {points.length.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Significant</dt>
                <dd className="font-medium tabular-nums text-slate-800">{sig}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Up / Down</dt>
                <dd className="font-medium tabular-nums text-slate-800">
                  {up} / {down}
                </dd>
              </div>
              {approximated && (
                <div className="col-span-2 text-amber-800">
                  Approximate MaxLFQ volcano (demo only).
                </div>
              )}
            </dl>
          )}
          {sig > 0 && onSelectProteins && (
            <button
              type="button"
              className="mt-3 text-xs underline"
              onClick={() =>
                onSelectProteins(
                  points.filter((p) => p.significant).map((p) => p.proteinId),
                )
              }
            >
              Select all significant
            </button>
          )}
        </div>
        <div className="plot-multiples__cell" data-testid="downstream-cell-selected">
          <h3 className="text-base font-semibold text-slate-900">
            Selected proteins
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Proteins chosen in volcano / results / GO scope QC plots.
          </p>
          <ul className="mt-3 max-h-40 space-y-1 overflow-auto text-xs">
            {selectedProteinIds.length === 0 ? (
              <li className="text-slate-500">None selected</li>
            ) : (
              selectedProteinIds.map((id) => (
                <li key={id} className="font-mono text-slate-800">
                  {id}
                </li>
              ))
            )}
          </ul>
          {selectedProteinIds.length > 0 && onSelectProteins && (
            <button
              type="button"
              className="mt-2 text-xs underline"
              onClick={() => onSelectProteins([])}
            >
              Clear selection
            </button>
          )}
        </div>
        <div className="plot-multiples__cell" data-testid="downstream-cell-dataset">
          <h3 className="text-base font-semibold text-slate-900">
            Dataset
          </h3>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Source</dt>
              <dd className="font-medium text-slate-800">{dataset.source}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Proteins</dt>
              <dd className="font-medium tabular-nums text-slate-800">
                {dataset.proteins.length.toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Samples</dt>
              <dd className="font-medium tabular-nums text-slate-800">
                {dataset.samples.length}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Groups</dt>
              <dd className="font-medium text-slate-800">{groups.length}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-600">
            Change source from the unified data portal on the QC page.
          </p>
        </div>
      </div>
    </div>
  );
}
