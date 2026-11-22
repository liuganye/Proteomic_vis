"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  buildSampleMetricRows,
  userPlotAnchorId,
} from "@/lib/custom-plot-metrics";
import {
  EMPTY_QC_PROTEIN_FILTER,
  resolveQcProteinIds,
  subsetDatasetProteins,
  type QcProteinFilter,
} from "@/lib/qc-protein-filter";
import { computeQcBundle } from "@/lib/stats";
import type {
  FragPipeDataset,
  QcPlotId,
  SampleSelectionProps,
  UserCustomPlotSpec,
} from "@/lib/types";
import { CustomPlotBuilder } from "./CustomPlotBuilder";
import { IntensityDistribution } from "./IntensityDistribution";
import { MedianVsMissingness } from "./MedianVsMissingness";
import { MissingnessPlot } from "./MissingnessPlot";
import { QcProteinFilterBar } from "./QcProteinFilterBar";
import { QcSummary } from "./QcSummary";
import { SampleCorrelation } from "./SampleCorrelation";
import { SampleIntensitySummary } from "./SampleIntensitySummary";
import { UserDefinedPlot } from "./UserDefinedPlot";
import { paddedDomain } from "@/lib/qc-plot";
import { conditionColor } from "@/lib/stats";

const BUILTIN_PLOT_ANCHOR: Record<
  Exclude<QcPlotId, `user-${string}`>,
  string
> = {
  missingness: "qc-plot-missingness",
  intensity: "qc-plot-intensity",
  correlation: "qc-plot-correlation",
  "median-vs-missing": "qc-plot-median-vs-missing",
};

function plotAnchor(plotId: QcPlotId): string {
  if (plotId.startsWith("user-")) return userPlotAnchorId(plotId);
  return BUILTIN_PLOT_ANCHOR[plotId as keyof typeof BUILTIN_PLOT_ANCHOR];
}

export function QcPanel({
  dataset,
  focusPlotId,
  focusToken = 0,
  userCustomPlots,
  onAddUserPlot,
  onRemoveUserPlot,
  onUpdateUserPlot,
  selectedSamples,
  onSelectSamples,
  selectedProteinIds = [],
  onClearProteinSelection,
  proteinFilter,
  onProteinFilterChange,
}: {
  dataset: FragPipeDataset;
  focusPlotId?: QcPlotId | null;
  focusToken?: number;
  userCustomPlots: UserCustomPlotSpec[];
  onAddUserPlot: (spec: UserCustomPlotSpec) => void;
  onRemoveUserPlot: (id: string) => void;
  onUpdateUserPlot?: (
    id: string,
    patch: Pick<UserCustomPlotSpec, "chartSpec">,
  ) => void;
  selectedProteinIds?: string[];
  onClearProteinSelection?: () => void;
  proteinFilter?: QcProteinFilter;
  onProteinFilterChange?: (next: QcProteinFilter) => void;
} & SampleSelectionProps) {
  const [localFilter, setLocalFilter] = useState<QcProteinFilter>(
    EMPTY_QC_PROTEIN_FILTER,
  );
  const filter = proteinFilter ?? localFilter;
  const setFilter = onProteinFilterChange ?? setLocalFilter;

  const scope = useMemo(
    () => resolveQcProteinIds(dataset, filter, selectedProteinIds),
    [dataset, filter, selectedProteinIds],
  );
  const scopedDataset = useMemo(
    () => subsetDatasetProteins(dataset, scope.ids),
    [dataset, scope.ids],
  );

  const bundle = useMemo(
    () => computeQcBundle(scopedDataset),
    [scopedDataset],
  );
  const sampleMetricRows = useMemo(
    () => buildSampleMetricRows(scopedDataset, bundle.miss, bundle.boxes),
    [scopedDataset, bundle.miss, bundle.boxes],
  );
  const [highlight, setHighlight] = useState<QcPlotId | null>(null);
  const [plotsReady, setPlotsReady] = useState(false);
  useEffect(() => {
    setPlotsReady(false);
    const id = window.requestAnimationFrame(() => setPlotsReady(true));
    return () => window.cancelAnimationFrame(id);
  }, [scopedDataset]);

  const jumpToPlot = useCallback((plotId: QcPlotId) => {
    const id = plotAnchor(plotId);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setHighlight(plotId);
      window.setTimeout(() => {
        setHighlight((cur) => (cur === plotId ? null : cur));
      }, 2200);
      if (typeof el.focus === "function") {
        el.focus({ preventScroll: true });
      }
    }
  }, []);

  useEffect(() => {
    if (focusPlotId && focusToken > 0 && plotsReady) jumpToPlot(focusPlotId);
  }, [focusPlotId, focusToken, jumpToPlot, plotsReady]);

  const boxDomain = useMemo(
    () =>
      paddedDomain(
        bundle.boxes.filter((b) => b.n > 0).flatMap((b) => [b.min, b.max]),
      ),
    [bundle.boxes],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--portal-border)] bg-white px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <p data-testid="qc-selected-samples" aria-live="polite">
            <strong className="text-slate-700">Selected samples:</strong>{" "}
            {selectedSamples.length ? selectedSamples.join(" + ") : "None"}
          </p>
          <button
            type="button"
            onClick={() => onSelectSamples([])}
            disabled={!selectedSamples.length}
            className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40 hover:bg-slate-50"
          >
            Clear
          </button>
        </div>
        {dataset.source === "real" && (
          <span
            id="qc-summary"
            className="rounded border border-teal-200 bg-teal-50 px-2 py-0.5 font-medium text-teal-900"
          >
            HYE snapshot · descriptive QC
          </span>
        )}
      </div>

      <QcProteinFilterBar
        dataset={dataset}
        filter={filter}
        onChange={setFilter}
        downstreamSelectedCount={selectedProteinIds.length}
        onClearDownstream={() => onClearProteinSelection?.()}
        scopeLabel={scope.label}
        scopedProteinCount={
          scope.ids ? scope.ids.length : dataset.proteins.length
        }
        empty={scope.empty}
      />

      {scope.empty ? null : dataset.source !== "real" ? (
        <QcSummary conclusions={bundle.conclusions} onJump={jumpToPlot} />
      ) : null}

      {scope.empty ? (
        <p
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-8 text-center text-sm text-slate-600"
          role="status"
        >
          QC plots are hidden while the protein scope is empty. Clear the filter
          or Downstream selection to restore conventional and custom plots.
        </p>
      ) : !plotsReady ? (
        <p className="text-sm text-slate-500" role="status">
          Preparing QC plots…
        </p>
      ) : (
        <section aria-labelledby="qc-multiples-heading" className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2
              id="qc-multiples-heading"
              className="font-serif text-lg text-slate-900"
            >
              QC small multiples
            </h2>
            <p className="text-xs text-[color:var(--chart-muted)]">
              ~9 views on one screen · 3×3 on desktop, stacks on narrow
            </p>
          </div>

          <div className="plot-multiples" data-testid="qc-plot-multiples">
            <PlotCell
              anchorId={BUILTIN_PLOT_ANCHOR.missingness}
              highlighted={highlight === "missingness"}
            >
              <MissingnessPlot
                dataset={scopedDataset}
                rows={bundle.miss}
                colorMap={bundle.colorMap}
                selectedSamples={selectedSamples}
                onSelectSamples={onSelectSamples}
                compact
              />
            </PlotCell>

            <PlotCell
              anchorId={BUILTIN_PLOT_ANCHOR.intensity}
              highlighted={highlight === "intensity"}
            >
              <IntensityDistribution
                dataset={scopedDataset}
                boxes={bundle.boxes}
                groups={bundle.groups}
                colorMap={bundle.colorMap}
                selectedSamples={selectedSamples}
                onSelectSamples={onSelectSamples}
                compact
              />
            </PlotCell>

            <PlotCell anchorId="qc-plot-intensity-boxes" highlighted={false}>
              <SampleIntensitySummary
                boxes={bundle.boxes}
                domain={boxDomain}
                colorMap={bundle.colorMap}
                selectedSamples={selectedSamples}
                onSelectSamples={onSelectSamples}
                compact
              />
            </PlotCell>

            <PlotCell
              anchorId={BUILTIN_PLOT_ANCHOR.correlation}
              highlighted={highlight === "correlation"}
            >
              <SampleCorrelation
                dataset={scopedDataset}
                matrix={bundle.correlation}
                colorMap={bundle.colorMap}
                selectedSamples={selectedSamples}
                onSelectSamples={onSelectSamples}
                compact
              />
            </PlotCell>

            <PlotCell
              anchorId={BUILTIN_PLOT_ANCHOR["median-vs-missing"]}
              highlighted={highlight === "median-vs-missing"}
              tone="custom"
            >
              <MedianVsMissingness
                dataset={scopedDataset}
                rows={bundle.scatter}
                colorMap={bundle.colorMap}
                selectedSamples={selectedSamples}
                onSelectSamples={onSelectSamples}
                compact
              />
            </PlotCell>

            <PlotCell anchorId="qc-plot-group-summary" highlighted={false}>
              <GroupIntensityTable
                groups={bundle.groups}
                colorMap={bundle.colorMap}
              />
            </PlotCell>

            <PlotCell
              anchorId="qc-plot-custom-builder"
              highlighted={false}
              tone="custom"
              className="plot-multiples__cell--builder"
            >
              <CustomPlotBuilder
                onAdd={onAddUserPlot}
                sampleRows={sampleMetricRows}
                compact
              />
            </PlotCell>

            {userCustomPlots.map((spec) => (
              <PlotCell
                key={spec.id}
                anchorId={userPlotAnchorId(spec.id)}
                highlighted={highlight === spec.id}
                tone="custom"
              >
                <UserDefinedPlot
                  dataset={scopedDataset}
                  spec={spec}
                  rows={sampleMetricRows}
                  colorMap={bundle.colorMap}
                  onRemove={onRemoveUserPlot}
                  onUpdate={onUpdateUserPlot}
                  compact
                />
              </PlotCell>
            ))}

            {userCustomPlots.length < 2 &&
              Array.from({ length: 2 - userCustomPlots.length }).map((_, i) => (
                <PlotCell
                  key={`slot-${i}`}
                  anchorId={`qc-plot-slot-${i}`}
                  highlighted={false}
                  tone="custom"
                >
                  <div className="flex h-full min-h-[10rem] flex-col items-center justify-center gap-1 px-3 text-center text-xs text-[color:var(--chart-muted)]">
                    <strong className="text-sm text-slate-700">
                      Custom plot slot
                    </strong>
                    <span>
                      Build a chart or script plot — it lands here in the grid.
                    </span>
                  </div>
                </PlotCell>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PlotCell({
  anchorId,
  highlighted,
  children,
  tone = "conventional",
  className = "",
}: {
  anchorId: string;
  highlighted: boolean;
  children: ReactNode;
  tone?: "conventional" | "custom";
  className?: string;
}) {
  return (
    <div
      id={anchorId}
      tabIndex={-1}
      className={`plot-multiples__cell ${tone === "custom" ? "plot-multiples__cell--custom" : ""} ${highlighted ? "is-highlighted" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

function GroupIntensityTable({
  groups,
  colorMap,
}: {
  groups: { condition: string; nSamples: number; meanMissingPct: number; medianOfMedians: number }[];
  colorMap: Record<string, string>;
}) {
  return (
    <div>
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">
          Per-group intensity
        </h3>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {groups.length} group{groups.length === 1 ? "" : "s"}
        </span>
      </header>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-1.5">Group</th>
              <th className="px-2 py-1.5">n</th>
              <th className="px-2 py-1.5">Miss %</th>
              <th className="px-2 py-1.5">Med log₁₀</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.condition} className="border-t border-slate-100">
                <td className="px-2 py-1.5 font-medium text-slate-900">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{
                        background: conditionColor(g.condition, colorMap),
                      }}
                    />
                    {g.condition}
                  </span>
                </td>
                <td className="px-2 py-1.5 tabular-nums">{g.nSamples}</td>
                <td className="px-2 py-1.5 tabular-nums">
                  {g.meanMissingPct.toFixed(1)}
                </td>
                <td className="px-2 py-1.5 tabular-nums">
                  {g.medianOfMedians.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
