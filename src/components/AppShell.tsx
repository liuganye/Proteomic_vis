"use client";

import { useEffect, useState } from "react";
import { useDataset } from "@/hooks/use-dataset";
import { autoTitle } from "@/lib/custom-plot-metrics";
import {
  CUSTOM_PLOT_REGISTER_EVENT,
  parseScriptRegistration,
} from "@/lib/custom-plot-script";
import {
  EMPTY_QC_PROTEIN_FILTER,
  type QcProteinFilter,
} from "@/lib/qc-protein-filter";
import type {
  QcPlotId,
  SectionId,
  UserCustomPlotSpec,
} from "@/lib/types";
import { DownstreamMultiples } from "./downstream/DownstreamMultiples";
import { FileUploadPanel } from "./FileUploadPanel";
import { QcPanel } from "./qc/QcPanel";
import { RealExplore } from "./RealExplore";
import { initialExploreState, type ExploreState } from "@/lib/visualization";

const QC_NAV: { id: QcPlotId; label: string; description: string }[] = [
  { id: "missingness", label: "Missingness", description: "Quantification coverage" },
  { id: "intensity", label: "Intensity", description: "Distribution and sample summaries" },
  { id: "correlation", label: "Correlation", description: "Sample–sample similarity" },
  { id: "median-vs-missing", label: "Median vs missing", description: "Coverage and signal together" },
];

export function AppShell() {
  const { state, loadMock, loadFiles, loadReal, clear } = useDataset();
  const [proteinFocus, setProteinFocus] = useState("O00148");
  const [selectedSamples, setSelectedSamples] = useState<string[]>([]);
  const [selectedProteinIds, setSelectedProteinIds] = useState<string[]>([]);
  const [proteinFilter, setProteinFilter] = useState<QcProteinFilter>(
    EMPTY_QC_PROTEIN_FILTER,
  );
  const [analysis, setAnalysis] = useState<ExploreState>(initialExploreState);
  const [section, setSection] = useState<SectionId>("qc");
  const [qcFocus, setQcFocus] = useState<QcPlotId | null>(null);
  const [qcFocusToken, setQcFocusToken] = useState(0);
  const [userCustomPlots, setUserCustomPlots] = useState<UserCustomPlotSpec[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReal(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReal]);

  useEffect(() => {
    setSelectedSamples([]);
    setSelectedProteinIds([]);
    setProteinFilter(EMPTY_QC_PROTEIN_FILTER);
    setAnalysis(initialExploreState);
    setProteinFocus("O00148");
  }, [state.dataset]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const parsed = parseScriptRegistration(detail);
      if ("error" in parsed) {
        console.warn("[proteomics:register-custom-plot]", parsed.error);
        return;
      }
      setUserCustomPlots((previous) => [...previous, parsed.spec]);
      setQcFocus(parsed.spec.id);
      setQcFocusToken((t) => t + 1);
      setSection("qc");
    };
    window.addEventListener(CUSTOM_PLOT_REGISTER_EVENT, handler);
    return () => window.removeEventListener(CUSTOM_PLOT_REGISTER_EVENT, handler);
  }, []);

  const linkedSamples = selectedSamples.filter((sample) =>
    state.dataset?.samples.includes(sample),
  );
  const real = state.status === "ready" && state.dataset?.source === "real";
  const jumpQc = (id: QcPlotId) => {
    setQcFocus(id);
    setQcFocusToken((t) => t + 1);
  };
  const handleClear = () => {
    clear();
    setUserCustomPlots([]);
    setSelectedProteinIds([]);
    setProteinFilter(EMPTY_QC_PROTEIN_FILTER);
    setQcFocus(null);
  };
  const addUserPlot = (spec: UserCustomPlotSpec) => {
    setUserCustomPlots((previous) => [...previous, spec]);
    jumpQc(spec.id);
  };
  const removeUserPlot = (id: string) => {
    setUserCustomPlots((previous) => previous.filter((p) => p.id !== id));
    setQcFocus((current) => (current === id ? null : current));
  };
  const updateUserPlot = (
    id: string,
    patch: Pick<UserCustomPlotSpec, "chartSpec">,
  ) => {
    setUserCustomPlots((previous) =>
      previous.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };

  const dataPortal = (
    <FileUploadPanel
      state={state}
      onLoadMock={loadMock}
      onLoadReal={loadReal}
      onLoadFiles={loadFiles}
      onClear={handleClear}
    />
  );

  return (
    <div className="proteomics-app">
      <header className="app-topbar">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setSection("qc");
          }}
          className="app-brand"
        >
          Proteomics Viz
        </a>
        <nav aria-label="Analysis pages">
          <button
            type="button"
            aria-current={section === "qc" ? "page" : undefined}
            onClick={() => setSection("qc")}
          >
            QC
          </button>
          <button
            type="button"
            aria-current={section === "downstream" ? "page" : undefined}
            onClick={() => setSection("downstream")}
          >
            Downstream workspace
          </button>
        </nav>
        <div className="app-dataset-status">
          {state.status === "ready" && state.dataset ? (
            <>
              {state.dataset.source === "real"
                ? "Real dataset"
                : state.dataset.source === "mock"
                  ? "Synthetic demo"
                  : "Uploaded data"}
              <span>
                {state.dataset.proteins.length.toLocaleString()} proteins ·{" "}
                {state.dataset.samples.length} samples
                {selectedProteinIds.length
                  ? ` · ${selectedProteinIds.length} selected`
                  : ""}
              </span>
            </>
          ) : state.status === "loading" ? (
            "Loading dataset…"
          ) : (
            "Dataset not loaded"
          )}
        </div>
      </header>
      {section === "qc" ? (
        <div className="qc-page-layout">
          <aside className="qc-sidebar" aria-label="QC plots">
            <h2>Quality control</h2>
            <p>Inspect all samples before exploring candidates.</p>
            <button
              type="button"
              className="qc-nav-link"
              onClick={() =>
                document
                  .getElementById("qc-summary")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              Overview
            </button>
            {QC_NAV.map((m) => (
              <button
                key={m.id}
                type="button"
                className="qc-nav-link"
                aria-current={qcFocus === m.id ? "true" : undefined}
                onClick={() => jumpQc(m.id)}
              >
                <strong>{m.label}</strong>
                <span>{m.description}</span>
              </button>
            ))}
            {userCustomPlots.map((p) => (
              <button
                key={p.id}
                type="button"
                className="qc-nav-link"
                aria-current={qcFocus === p.id ? "true" : undefined}
                onClick={() => jumpQc(p.id)}
              >
                <strong>{p.title || autoTitle(p)}</strong>
                <span>
                  User {p.kind}
                  {p.kind === "script" && p.language ? ` · ${p.language}` : ""}
                </span>
              </button>
            ))}
            <button
              type="button"
              className="qc-continue"
              onClick={() => setSection("downstream")}
            >
              Continue to workspace
            </button>
          </aside>
          <main className="qc-page-main">
            <div className="workspace-page-heading">
              <div>
                <h1>Sample quality overview</h1>
                <p>
                  Compare coverage, intensity and similarity in a simultaneous
                  grid. Selecting a sample highlights its evidence downstream.
                </p>
              </div>
            </div>
            {dataPortal}
            {state.status === "ready" && state.dataset ? (
              <div className="mt-5">
                {real && (
                  <p className="mb-4 text-sm text-slate-600">
                    Focused protein in workspace: <strong>{proteinFocus}</strong>
                    . QC summarizes proteins in the current scope; sample
                    selection does not rerun statistics.
                  </p>
                )}
                <QcPanel
                  dataset={state.dataset}
                  focusPlotId={qcFocus}
                  focusToken={qcFocusToken}
                  userCustomPlots={userCustomPlots}
                  onAddUserPlot={addUserPlot}
                  onRemoveUserPlot={removeUserPlot}
                  onUpdateUserPlot={updateUserPlot}
                  selectedSamples={linkedSamples}
                  onSelectSamples={setSelectedSamples}
                  selectedProteinIds={selectedProteinIds}
                  onClearProteinSelection={() => setSelectedProteinIds([])}
                  proteinFilter={proteinFilter}
                  onProteinFilterChange={setProteinFilter}
                />
              </div>
            ) : (
              <p className="mt-6 rounded border border-slate-200 bg-white p-6 text-sm">
                {state.status === "loading"
                  ? "Preparing sample quality views…"
                  : "Load a dataset in the data portal above to inspect sample quality."}
              </p>
            )}
          </main>
        </div>
      ) : (
        <main className="downstream-page-main">
          {real && state.dataset ? (
            <RealExplore
              totalProteins={state.dataset.proteins.length}
              focus={proteinFocus}
              setFocus={setProteinFocus}
              selectedSamples={linkedSamples}
              onSelectSamples={setSelectedSamples}
              analysis={analysis}
              setAnalysis={setAnalysis}
              focusResults={false}
              onReturnQc={() => setSection("qc")}
            />
          ) : (
            <>
              <div className="workspace-page-heading">
                <div>
                  <h1>Downstream workspace</h1>
                  <p>
                    Use the unified data portal for mock, real HYE, or uploaded
                    FragPipe TSVs. Real HYE opens the seven-module workspace;
                    mock and uploads show volcano, results, and GO together.
                  </p>
                </div>
              </div>
              {state.status !== "ready" && (
                <FileUploadPanel
                  state={state}
                  onLoadMock={loadMock}
                  onLoadReal={loadReal}
                  onLoadFiles={loadFiles}
                  onClear={handleClear}
                  compact
                />
              )}
              {state.status === "ready" && state.dataset && (
                <section className="mt-2 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">
                      {state.dataset.source === "mock"
                        ? "Synthetic demo · Downstream multiples"
                        : "Uploaded results · Downstream multiples"}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setSection("qc")}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm"
                    >
                      ← QC / data portal
                    </button>
                  </div>
                  <p className="text-sm text-slate-600">
                    Volcano, results table, and GO enrichment share one contrast
                    and one screen. Click points, rows, or GO genes to select
                    proteins for QC.
                    {selectedProteinIds.length > 0 ? (
                      <>
                        {" "}
                        <strong>
                          {selectedProteinIds.length} protein(s) selected
                        </strong>
                        .{" "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => setSelectedProteinIds([])}
                        >
                          Clear
                        </button>
                      </>
                    ) : null}
                  </p>
                  <DownstreamMultiples
                    dataset={state.dataset}
                    selectedProteinIds={selectedProteinIds}
                    onSelectProteins={setSelectedProteinIds}
                  />
                </section>
              )}
              {state.status === "loading" && (
                <p className="mt-4 text-sm text-slate-600" role="status">
                  Loading dataset…
                </p>
              )}
              {state.status === "error" && (
                <p className="mt-4 text-sm text-red-800" role="alert">
                  {state.error}
                </p>
              )}
            </>
          )}
        </main>
      )}
    </div>
  );
}
