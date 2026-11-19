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
import { QcSummary } from "./QcSummary";
import { SampleCorrelation } from "./SampleCorrelation";
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
  selectedSamples,
  onSelectSamples,
}: {
  dataset: FragPipeDataset;
  focusPlotId?: QcPlotId | null;
  focusToken?: number;
  userCustomPlots: UserCustomPlotSpec[];
  onAddUserPlot: (spec: UserCustomPlotSpec) => void;
  onRemoveUserPlot: (id: string) => void;
} & SampleSelectionProps) {
  // Single metrics pass shared by summary + all plots (critical after large uploads).
  const bundle = useMemo(() => computeQcBundle(dataset), [dataset]);
  const sampleMetricRows = useMemo(
    () => buildSampleMetricRows(dataset, bundle.miss, bundle.boxes),
    [dataset, bundle.miss, bundle.boxes],
  );
  const [highlight, setHighlight] = useState<QcPlotId | null>(null);
  // Mount plot cards after summary paints so upload → first paint feels snappier.
  const [plotsReady, setPlotsReady] = useState(false);
  useEffect(() => {
    setPlotsReady(false);
    const id = window.requestAnimationFrame(() => setPlotsReady(true));
    return () => window.cancelAnimationFrame(id);
  }, [dataset]);

  const jumpToPlot = useCallback((plotId: QcPlotId) => {
    const id = plotAnchor(plotId);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <p data-testid="qc-selected-samples" aria-live="polite">
            <strong className="text-slate-700">Selected samples:</strong>{" "}
            {selectedSamples.length ? selectedSamples.join(" + ") : "None"}
          </p>
          <button type="button" onClick={() => onSelectSamples([])} disabled={!selectedSamples.length} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40 hover:bg-slate-50">Clear</button>
        </div>
        {dataset.source === "real" && (
          <span id="qc-summary" className="rounded bg-teal-50 border border-teal-200 px-2 py-0.5 font-medium text-teal-900">
            HYE snapshot · descriptive QC
          </span>
        )}
      </div>
      {dataset.source !== "real" && <QcSummary conclusions={bundle.conclusions} onJump={jumpToPlot} />}

      {!plotsReady ? (
        <p className="text-sm text-slate-500" role="status">
          Preparing QC plots…
        </p>
      ) : (
        <>
          <section aria-labelledby="qc-conventional-heading" className="space-y-4">
            <h2
              id="qc-conventional-heading"
              className="border-b border-slate-200 pb-1.5 font-serif text-lg text-slate-900"
            >
              Conventional QC plots
            </h2>

            <PlotCard
              anchorId={BUILTIN_PLOT_ANCHOR.missingness}
              highlighted={highlight === "missingness"}
            >
              <MissingnessPlot
                dataset={dataset}
                rows={bundle.miss}
                colorMap={bundle.colorMap}
                selectedSamples={selectedSamples}
                onSelectSamples={onSelectSamples}
              />
            </PlotCard>

            <PlotCard
              anchorId={BUILTIN_PLOT_ANCHOR.intensity}
              highlighted={highlight === "intensity"}
            >
              <IntensityDistribution
                dataset={dataset}
                boxes={bundle.boxes}
                groups={bundle.groups}
                colorMap={bundle.colorMap}
                selectedSamples={selectedSamples}
                onSelectSamples={onSelectSamples}
              />
            </PlotCard>

            <PlotCard
              anchorId={BUILTIN_PLOT_ANCHOR.correlation}
              highlighted={highlight === "correlation"}
            >
              <SampleCorrelation
                dataset={dataset}
                matrix={bundle.correlation}
                colorMap={bundle.colorMap}
                selectedSamples={selectedSamples}
                onSelectSamples={onSelectSamples}
              />
            </PlotCard>
          </section>

          <section aria-labelledby="qc-custom-heading" className="space-y-4">
            <h2
              id="qc-custom-heading"
              className="border-b border-amber-200/80 pb-1.5 font-serif text-lg text-slate-900"
            >
              Custom QC plots
            </h2>

            <PlotCard
              anchorId={BUILTIN_PLOT_ANCHOR["median-vs-missing"]}
              highlighted={highlight === "median-vs-missing"}
              tone="custom"
            >
              <MedianVsMissingness
                dataset={dataset}
                rows={bundle.scatter}
                colorMap={bundle.colorMap}
                selectedSamples={selectedSamples}
                onSelectSamples={onSelectSamples}
              />
            </PlotCard>

            <CustomPlotBuilder onAdd={onAddUserPlot} />

            {userCustomPlots.map((spec) => (
              <PlotCard
                key={spec.id}
                anchorId={userPlotAnchorId(spec.id)}
                highlighted={highlight === spec.id}
                tone="custom"
              >
                <UserDefinedPlot
                  dataset={dataset}
                  spec={spec}
                  rows={sampleMetricRows}
                  colorMap={bundle.colorMap}
                  onRemove={onRemoveUserPlot}
                />
              </PlotCard>
            ))}
          </section>
        </>
      )}
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
      className={`scroll-mt-6 rounded-xl border bg-white p-4 shadow-sm outline-none transition sm:p-5 ${
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
