"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { computeQcBundle } from "@/lib/stats";
import type { FragPipeDataset, QcPlotId } from "@/lib/types";
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
}: {
  dataset: FragPipeDataset;
  focusPlotId?: QcPlotId | null;
  focusToken?: number;
}) {
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
      <QcSummary conclusions={bundle.conclusions} onJump={jumpToPlot} />

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
                Standard FragPipe Analyst–style QC across all annotation groups:
                missingness, intensity distribution, and sample correlation.
              </p>
            </div>

            <PlotCard
              anchorId={PLOT_ANCHOR.missingness}
              highlighted={highlight === "missingness"}
            >
              <MissingnessPlot
                dataset={dataset}
                rows={bundle.miss}
                colorMap={bundle.colorMap}
              />
            </PlotCard>

            <PlotCard
              anchorId={PLOT_ANCHOR.intensity}
              highlighted={highlight === "intensity"}
            >
              <IntensityDistribution
                dataset={dataset}
                boxes={bundle.boxes}
                groups={bundle.groups}
                colorMap={bundle.colorMap}
              />
            </PlotCard>

            <PlotCard
              anchorId={PLOT_ANCHOR.correlation}
              highlighted={highlight === "correlation"}
            >
              <SampleCorrelation
                dataset={dataset}
                matrix={bundle.correlation}
                colorMap={bundle.colorMap}
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
              <MedianVsMissingness
                dataset={dataset}
                rows={bundle.scatter}
                colorMap={bundle.colorMap}
              />
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
