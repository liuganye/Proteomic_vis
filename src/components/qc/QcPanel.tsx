"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  buildSampleMetricRows,
  userPlotAnchorId,
} from "@/lib/custom-plot-metrics";
import {
  BUILTIN_CELL_COUNT,
  emptySlotCountForPage,
  plotPageIndexFor,
  QC_PAGE_SIZE,
} from "@/lib/qc-grid-paging";
import { paddedDomain } from "@/lib/qc-plot";
import {
  EMPTY_QC_PROTEIN_FILTER,
  resolveQcProteinIds,
  subsetDatasetProteins,
  type QcProteinFilter,
} from "@/lib/qc-protein-filter";
import {
  computeQcBundle,
  conditionColor,
  type groupQcStats,
  type intensityBoxBySample,
} from "@/lib/stats";
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

  // Single metrics pass shared by summary + all plots (critical after large uploads).
  const bundle = useMemo(
    () => computeQcBundle(scopedDataset),
    [scopedDataset],
  );
  const sampleMetricRows = useMemo(
    () => buildSampleMetricRows(scopedDataset, bundle.miss, bundle.boxes),
    [scopedDataset, bundle.miss, bundle.boxes],
  );
  const [highlight, setHighlight] = useState<QcPlotId | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const pageIndexRef = useRef(0);
  pageIndexRef.current = pageIndex;
  const [pendingJumpId, setPendingJumpId] = useState<QcPlotId | null>(null);

  // Mount plot cards after summary paints so upload → first paint feels snappier.
  const [plotsReady, setPlotsReady] = useState(false);
  useEffect(() => {
    setPlotsReady(false);
    const id = window.requestAnimationFrame(() => setPlotsReady(true));
    return () => window.cancelAnimationFrame(id);
  }, [scopedDataset]);

  const userPlotIds = useMemo(
    () => userCustomPlots.map((s) => s.id),
    [userCustomPlots],
  );
  const realCellCount = BUILTIN_CELL_COUNT + 1 + userCustomPlots.length;
  const emptySlotCount = emptySlotCountForPage(
    realCellCount,
    userCustomPlots.length,
  );
  const totalCellCount = realCellCount + emptySlotCount;
  const pageCount = Math.max(1, Math.ceil(totalCellCount / QC_PAGE_SIZE));

  useEffect(() => {
    setPageIndex((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);

  const highlightPlot = useCallback((plotId: QcPlotId) => {
    const id = plotAnchor(plotId);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setHighlight(plotId);
    window.setTimeout(() => {
      setHighlight((cur) => (cur === plotId ? null : cur));
    }, 2200);
    if (typeof el.focus === "function") {
      el.focus({ preventScroll: true });
    }
  }, []);

  // Read pageIndex via ref so sidebar jumps flip pages cleanly without snapping back on manual paging.
  const jumpToPlot = useCallback(
    (plotId: QcPlotId) => {
      const targetPage = plotPageIndexFor(plotId, userPlotIds);
      if (targetPage !== pageIndexRef.current) {
        setPageIndex(targetPage);
        setPendingJumpId(plotId);
        return;
      }
      highlightPlot(plotId);
    },
    [highlightPlot, userPlotIds],
  );

  useEffect(() => {
    if (!pendingJumpId || !plotsReady) return;
    const id = pendingJumpId;
    setPendingJumpId(null);
    const raf = window.requestAnimationFrame(() => highlightPlot(id));
    return () => window.cancelAnimationFrame(raf);
  }, [pendingJumpId, plotsReady, pageIndex, highlightPlot]);

  useEffect(() => {
    if (focusPlotId && focusToken > 0 && plotsReady) jumpToPlot(focusPlotId);
  }, [focusPlotId, focusToken, jumpToPlot, plotsReady]);

  // Re-clicking the exact same selected sample(s) toggles selection off cleanly.
  const toggleSamples = useCallback(
    (next: string[]) => {
      if (
        next.length > 0 &&
        next.length === selectedSamples.length &&
        next.every((s) => selectedSamples.includes(s))
      ) {
        onSelectSamples([]);
      } else {
        onSelectSamples(next);
      }
    },
    [selectedSamples, onSelectSamples],
  );

  const boxDomain = useMemo(
    () =>
      paddedDomain(
        bundle.boxes.filter((b) => b.n > 0).flatMap((b) => [b.min, b.max]),
      ),
    [bundle.boxes],
  );

  const allCells = useMemo(() => {
    const cells: { key: string; node: ReactNode }[] = [
      {
        key: "missingness",
        node: (
          <PlotCard
            anchorId={BUILTIN_PLOT_ANCHOR.missingness}
            highlighted={highlight === "missingness"}
          >
            <MissingnessPlot
              dataset={scopedDataset}
              rows={bundle.miss}
              colorMap={bundle.colorMap}
              selectedSamples={selectedSamples}
              onSelectSamples={toggleSamples}
            />
          </PlotCard>
        ),
      },
      {
        key: "intensity",
        node: (
          <PlotCard
            anchorId={BUILTIN_PLOT_ANCHOR.intensity}
            highlighted={highlight === "intensity"}
          >
            <IntensityDistribution
              dataset={scopedDataset}
              boxes={bundle.boxes}
              groups={bundle.groups}
              colorMap={bundle.colorMap}
              selectedSamples={selectedSamples}
              onSelectSamples={toggleSamples}
              histogramOnly
            />
          </PlotCard>
        ),
      },
      {
        key: "intensity-boxes",
        node: (
          <PlotCard anchorId="qc-plot-intensity-boxes" highlighted={false}>
            <SampleIntensitySummary
              boxes={bundle.boxes}
              domain={boxDomain}
              colorMap={bundle.colorMap}
              selectedSamples={selectedSamples}
              onSelectSamples={toggleSamples}
            />
          </PlotCard>
        ),
      },
      {
        key: "correlation",
        node: (
          <PlotCard
            anchorId={BUILTIN_PLOT_ANCHOR.correlation}
            highlighted={highlight === "correlation"}
          >
            <SampleCorrelation
              dataset={scopedDataset}
              matrix={bundle.correlation}
              colorMap={bundle.colorMap}
              selectedSamples={selectedSamples}
              onSelectSamples={toggleSamples}
            />
          </PlotCard>
        ),
      },
      {
        key: "median-vs-missing",
        node: (
          <PlotCard
            anchorId={BUILTIN_PLOT_ANCHOR["median-vs-missing"]}
            highlighted={highlight === "median-vs-missing"}
            tone="custom"
          >
            <MedianVsMissingness
              dataset={scopedDataset}
              rows={bundle.scatter}
              colorMap={bundle.colorMap}
              selectedSamples={selectedSamples}
              onSelectSamples={toggleSamples}
            />
          </PlotCard>
        ),
      },
      {
        key: "group-summary",
        node: (
          <PlotCard anchorId="qc-plot-group-summary" highlighted={false}>
            <GroupStatisticsCard
              groups={bundle.groups}
              boxes={bundle.boxes}
              colorMap={bundle.colorMap}
              selectedSamples={selectedSamples}
              onSelectSamples={toggleSamples}
            />
          </PlotCard>
        ),
      },
      {
        key: "custom-builder",
        node: (
          <PlotCard
            anchorId="qc-plot-custom-builder"
            highlighted={false}
            tone="custom"
          >
            <CustomPlotBuilder
              onAdd={onAddUserPlot}
              sampleRows={sampleMetricRows}
            />
          </PlotCard>
        ),
      },
    ];

    for (const spec of userCustomPlots) {
      cells.push({
        key: spec.id,
        node: (
          <PlotCard
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
            />
          </PlotCard>
        ),
      });
    }

    for (let i = 0; i < emptySlotCount; i++) {
      cells.push({
        key: `slot-${i}`,
        node: (
          <div
            key={`slot-${i}`}
            className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-amber-300/90 bg-amber-50/30 p-6 text-center text-xs text-slate-500"
          >
            <strong className="text-sm font-semibold text-slate-700">
              Custom plot preview slot
            </strong>
            <p className="max-w-xs leading-relaxed">
              Use the custom plot builder beside this card to create a scatter,
              bar, histogram, or Python/JS script chart — it will appear right here.
            </p>
          </div>
        ),
      });
    }

    return cells;
  }, [
    boxDomain,
    bundle.boxes,
    bundle.colorMap,
    bundle.correlation,
    bundle.groups,
    bundle.miss,
    bundle.scatter,
    emptySlotCount,
    highlight,
    onAddUserPlot,
    onRemoveUserPlot,
    toggleSamples,
    onUpdateUserPlot,
    sampleMetricRows,
    scopedDataset,
    selectedSamples,
    userCustomPlots,
  ]);

  const pageStart = pageIndex * QC_PAGE_SIZE;
  const visibleCells = allCells.slice(pageStart, pageStart + QC_PAGE_SIZE);
  const rangeStart = totalCellCount === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + QC_PAGE_SIZE, totalCellCount);

  const pageSubtitle =
    pageIndex === 0
      ? "Core sample quality (coverage, intensity, similarity)"
      : pageIndex === 1
        ? "Group summary & custom QC builder"
        : "Additional custom QC plots";

  return (
    <div className="space-y-4">
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

      {!scope.empty && (
        <QcSummary conclusions={bundle.conclusions} onJump={jumpToPlot} />
      )}

      {scope.empty ? (
        <p
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-8 text-center text-sm text-slate-600"
          role="status"
        >
          QC plots are hidden while the protein scope is empty. Clear the filter
          or Downstream selection to restore QC plots.
        </p>
      ) : !plotsReady ? (
        <p className="text-sm text-slate-500" role="status">
          Preparing QC plots…
        </p>
      ) : (
        <section aria-labelledby="qc-grid-heading" className="space-y-3">
          {/* Sticky plot toolbar keeps title, active sample chips (+ Clear), and page controls within reach while scrolling the 2×2 grid. */}
          <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-slate-200/90 bg-white/95 px-3.5 py-2 shadow-xs backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-2.5">
              <div>
                <h2
                  id="qc-grid-heading"
                  className="font-serif text-base leading-tight text-slate-900"
                >
                  Quality control plots
                </h2>
                <p className="text-[11px] text-slate-500">
                  {pageSubtitle} · {rangeStart}–{rangeEnd} of {totalCellCount}
                </p>
              </div>
              <span
                id="qc-summary"
                className="hidden rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-900 sm:inline-block"
              >
                {dataset.source === "real"
                  ? "CCND1 AP-MS"
                  : dataset.proteinFileName ?? "Uploaded TSV"}
              </span>
            </div>

            <div
              className="flex flex-wrap items-center gap-1.5 text-xs"
              data-testid="qc-selected-samples"
              aria-live="polite"
            >
              <span className="font-medium text-slate-500">Selected:</span>
              {selectedSamples.length > 0 ? (
                <>
                  {selectedSamples.map((sampleId) => (
                    <button
                      key={sampleId}
                      type="button"
                      onClick={() =>
                        onSelectSamples(
                          selectedSamples.filter((s) => s !== sampleId),
                        )
                      }
                      title={`Deselect ${sampleId}`}
                      className="inline-flex items-center gap-1 rounded-full border border-teal-700/40 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-900 hover:bg-teal-100"
                    >
                      <span>{sampleId}</span>
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onSelectSamples([])}
                    className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Clear
                  </button>
                </>
              ) : (
                <span className="text-[11px] text-slate-400">None</span>
              )}
            </div>

            <nav
              aria-label="QC plot pages"
              className="flex flex-wrap items-center gap-1.5 text-xs"
            >
              <button
                type="button"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← Prev
              </button>
              {Array.from({ length: pageCount }, (_, idx) => {
                const active = idx === pageIndex;
                return (
                  <button
                    key={idx}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setPageIndex(idx)}
                    className={`min-w-[26px] rounded-md border px-2 py-1 text-[11px] font-medium tabular-nums transition-colors ${
                      active
                        ? "border-teal-800 bg-teal-800 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-teal-50"
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={pageIndex >= pageCount - 1}
                onClick={() =>
                  setPageIndex((p) => Math.min(pageCount - 1, p + 1))
                }
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next →
              </button>
            </nav>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {visibleCells.map((cell) => (
              <div key={cell.key} className="min-w-0">
                {cell.node}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function GroupStatisticsCard({
  groups,
  boxes,
  colorMap,
  selectedSamples,
  onSelectSamples,
}: {
  groups: ReturnType<typeof groupQcStats>;
  boxes: ReturnType<typeof intensityBoxBySample>;
  colorMap: Record<string, string>;
} & SampleSelectionProps) {
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">
          Group &amp; sample summary
        </h3>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {groups.length} group{groups.length === 1 ? "" : "s"} · {boxes.length}{" "}
          samples
        </span>
      </header>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Group</th>
              <th className="px-3 py-2">Samples</th>
              <th className="px-3 py-2">Mean missing</th>
              <th className="px-3 py-2">Median log₁₀</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.condition} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-900">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{
                        background: conditionColor(g.condition, colorMap),
                      }}
                    />
                    {g.condition}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums">{g.nSamples}</td>
                <td className="px-3 py-2 tabular-nums">
                  {g.meanMissingPct.toFixed(1)}%
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {g.medianOfMedians.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer font-medium text-teal-800 hover:underline">
          Exact per-sample quartiles ({boxes.length} samples)
        </summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2.5 py-1.5">Sample</th>
                <th className="px-2.5 py-1.5">Group</th>
                <th className="px-2.5 py-1.5">Median</th>
                <th className="px-2.5 py-1.5">Q1–Q3</th>
              </tr>
            </thead>
            <tbody>
              {boxes.map((b) => (
                <tr
                  key={b.sample}
                  className={`border-t border-slate-100 ${
                    selectedSamples.includes(b.sample) ? "bg-teal-50" : ""
                  }`}
                >
                  <td className="px-2.5 py-1.5 font-medium text-slate-900">
                    <button
                      type="button"
                      onClick={() => onSelectSamples([b.sample])}
                      className="underline underline-offset-2 hover:text-teal-800"
                    >
                      {b.sample}
                    </button>
                  </td>
                  <td className="px-2.5 py-1.5 text-slate-600">{b.condition}</td>
                  <td className="px-2.5 py-1.5 tabular-nums">
                    {b.n > 0 ? b.median.toFixed(2) : "—"}
                  </td>
                  <td className="px-2.5 py-1.5 tabular-nums">
                    {b.n > 0 ? `${b.q1.toFixed(2)}–${b.q3.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function PlotCard({
  anchorId,
  highlighted,
  children,
  tone = "conventional",
}: {
  anchorId: string;
  highlighted: boolean;
  children: ReactNode;
  tone?: "conventional" | "custom";
}) {
  return (
    <div
      id={anchorId}
      tabIndex={-1}
      className={`h-full scroll-mt-6 rounded-xl border bg-white p-4 shadow-sm outline-none transition ${
        tone === "custom" ? "border-amber-200/90" : "border-slate-200"
      } ${
        highlighted
          ? "ring-2 ring-teal-700 ring-offset-2 ring-offset-slate-50"
          : ""
      }`}
    >
      {children}
    </div>
  );
}
