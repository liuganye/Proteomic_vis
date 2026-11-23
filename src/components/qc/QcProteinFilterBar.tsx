"use client";

import { useMemo } from "react";
import {
  discoverQcFilterFeatures,
  type QcFilterFeatureId,
  type QcProteinFilter,
} from "@/lib/qc-protein-filter";
import type { FragPipeDataset } from "@/lib/types";

export function QcProteinFilterBar({
  dataset,
  filter,
  onChange,
  downstreamSelectedCount,
  onClearDownstream,
  scopeLabel,
  scopedProteinCount,
  empty,
}: {
  dataset: FragPipeDataset;
  filter: QcProteinFilter;
  onChange: (next: QcProteinFilter) => void;
  downstreamSelectedCount: number;
  onClearDownstream: () => void;
  scopeLabel: string;
  scopedProteinCount: number;
  empty: boolean;
}) {
  const features = useMemo(
    () => discoverQcFilterFeatures(dataset),
    [dataset],
  );
  const active = features.find((f) => f.id === filter.featureId);

  return (
    <div
      className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm"
      data-testid="qc-protein-filter"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[10rem] flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            QC protein filter
          </span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
            value={filter.featureId ?? ""}
            aria-label="QC protein filter feature"
            onChange={(e) => {
              const featureId = (e.target.value || null) as
                | QcFilterFeatureId
                | null;
              onChange({ featureId, value: null });
            }}
          >
            <option value="">All proteins (no feature filter)</option>
            {features.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Value</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 disabled:opacity-40"
            value={filter.value ?? ""}
            disabled={!active}
            aria-label="QC protein filter value"
            onChange={(e) =>
              onChange({
                featureId: filter.featureId,
                value: e.target.value || null,
              })
            }
          >
            <option value="">
              {active ? "Select a value…" : "Choose a feature first"}
            </option>
            {active?.values.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label} ({v.count})
              </option>
            ))}
          </select>
        </label>

        {(filter.featureId || downstreamSelectedCount > 0) && (
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50"
            onClick={() => {
              onChange({ featureId: null, value: null });
              onClearDownstream();
            }}
          >
            Clear scope
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-600">
        Filter QC plots by GO annotation, gene symbol, protein probability, or
        differential status.{" "}
        <span className="font-medium text-slate-800">
          Scope: {scopeLabel} · {scopedProteinCount.toLocaleString()} proteins
        </span>
        {downstreamSelectedCount > 0 ? (
          <>
            {" "}
            · Downstream selection active ({downstreamSelectedCount})
            <button
              type="button"
              className="ml-2 underline"
              onClick={onClearDownstream}
            >
              Clear selection
            </button>
          </>
        ) : null}
      </p>

      {active ? (
        <p className="mt-1 text-xs text-slate-500">{active.description}</p>
      ) : null}

      {empty ? (
        <p
          className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950"
          role="status"
        >
          No proteins match the current QC filter or Downstream selection. Clear
          the filter or choose another value.
        </p>
      ) : null}
    </div>
  );
}
