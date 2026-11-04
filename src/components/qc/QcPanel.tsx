"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { computeQcBundle } from "@/lib/stats";
import type { FragPipeDataset, QcPlotId, SampleSelectionProps } from "@/lib/types";
import { IntensityDistribution } from "./IntensityDistribution";
import { MedianVsMissingness } from "./MedianVsMissingness";
import { MissingnessPlot } from "./MissingnessPlot";
import { QcSummary } from "./QcSummary";
import { SampleCorrelation } from "./SampleCorrelation";

const PLOT_ANCHOR: Record<QcPlotId, string> = {
  missingness: "qc-plot-missingness",
  intensity: "qc-plot-intensity",
  correlation: "qc-plot-correlation",
  "median-vs-missing": "qc-plot-median-vs-missing",
};

export function QcPanel({
  dataset,
  focusPlotId,
  focusToken = 0,
  selectedSamples,
  onSelectSamples,
}: {
  dataset: FragPipeDataset;
  focusPlotId?: QcPlotId | null;
  focusToken?: number;
} & SampleSelectionProps) {
  // Single metrics pass shared by summary + all plots (critical after large uploads).
  const bundle = useMemo(() => computeQcBundle(dataset), [dataset]);
  const [highlight, setHighlight] = useState<QcPlotId | null>(null);
  // Mount plot cards after summary paints so upload → first paint feels snappier.
  const [plotsReady, setPlotsReady] = useState(false);
  useEffect(() => {
    setPlotsReady(false);
    const id = window.requestAnimationFrame(() => setPlotsReady(true));
    return () => window.cancelAnimationFrame(id);
  }, [dataset]);

  const jumpToPlot = useCallback((plotId: QcPlotId) => {
    const id = PLOT_ANCHOR[plotId];
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <p data-testid="qc-selected-samples" aria-live="polite"><strong>Selected samples:</strong> {selectedSamples.length ? selectedSamples.join(" + ") : "None"}</p>
        <button type="button" onClick={() => onSelectSamples([])} disabled={!selectedSamples.length} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40">Clear sample selection</button>
        <p className="w-full text-xs text-slate-600">Select a bar, point, or sample row. A correlation cell selects both samples. Outlines mark selected samples across QC and protein abundance; the data and statistical analysis stay unchanged.</p>
      </div>
      {dataset.source === "real" ? <div id="qc-summary" className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950"><strong>Real HYE dataset · descriptive QC</strong><p className="mt-1">Sample groups are inferred and unreviewed. Zero or blank intensities are treated as missing, without imputation. Cross-condition differences are not quality verdicts.</p></div> : <QcSummary conclusions={bundle.conclusions} onJump={jumpToPlot} />}

      {!plotsReady ? (
        <p className="text-sm text-slate-500" role="status">
          Preparing QC plots…
        </p>
      ) : (
        <>
          <section aria-labelledby="qc-conventional-heading" className="space-y-6">
            <div className="border-b border-slate-200 pb-2">
              <h2
                id="qc-conventional-heading"
                className="font-serif text-xl text-slate-900"
              >
                Conventional plots
              </h2>
              <p className="text-sm text-slate-600">
                Standard FragPipe Analyst–style QC: missingness, intensity
                distribution, and sample correlation.
              </p>
            </div>

            <PlotCard
              anchorId={PLOT_ANCHOR.missingness}
              highlighted={highlight === "missingness"}
            >
              <MissingnessPlot dataset={dataset} rows={bundle.miss} selectedSamples={selectedSamples} onSelectSamples={onSelectSamples} />
            </PlotCard>

            <PlotCard
              anchorId={PLOT_ANCHOR.intensity}
              highlighted={highlight === "intensity"}
            >
              <IntensityDistribution dataset={dataset} boxes={bundle.boxes} selectedSamples={selectedSamples} onSelectSamples={onSelectSamples} />
            </PlotCard>

            <PlotCard
              anchorId={PLOT_ANCHOR.correlation}
              highlighted={highlight === "correlation"}
            >
              <SampleCorrelation
                dataset={dataset}
                matrix={bundle.correlation}
                selectedSamples={selectedSamples}
                onSelectSamples={onSelectSamples}
              />
            </PlotCard>
          </section>

          <section aria-labelledby="qc-custom-heading" className="space-y-6">
            <div className="border-b border-amber-200/80 pb-2">
              <h2
                id="qc-custom-heading"
                className="font-serif text-xl text-slate-900"
              >
                Custom plots
              </h2>
              <p className="text-sm text-slate-600">
                Project-specific QC views beyond the standard Analyst suite.
              </p>
            </div>

            <PlotCard
              anchorId={PLOT_ANCHOR["median-vs-missing"]}
              highlighted={highlight === "median-vs-missing"}
              tone="custom"
            >
              <MedianVsMissingness dataset={dataset} rows={bundle.scatter} selectedSamples={selectedSamples} onSelectSamples={onSelectSamples} />
            </PlotCard>
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
