"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDataset } from "@/hooks/use-dataset";
import type {
  DownstreamModuleId,
  QcPlotId,
  SectionId,
} from "@/lib/types";
import { DownstreamPanel } from "./downstream/DownstreamPanel";
import { FileUploadPanel } from "./FileUploadPanel";
import { QcPanel } from "./qc/QcPanel";
import { RealExplore } from "./RealExplore";
import { initialExploreState, type ExploreState } from "@/lib/visualization";

const QC_NAV: { id: QcPlotId; label: string; blurb: string; group: "conventional" | "custom" }[] = [
  {
    id: "missingness",
    label: "Missingness",
    blurb: "Zero MaxLFQ rate by sample",
    group: "conventional",
  },
  {
    id: "intensity",
    label: "Intensity",
    blurb: "log10 MaxLFQ distributions",
    group: "conventional",
  },
  {
    id: "correlation",
    label: "Correlation",
    blurb: "Sample–sample Pearson matrix",
    group: "conventional",
  },
  {
    id: "median-vs-missing",
    label: "Median vs missing",
    blurb: "Custom: median × % missing",
    group: "custom",
  },
];

const DOWNSTREAM_MODULES: {
  id: DownstreamModuleId;
  label: string;
  blurb: string;
}[] = [
  {
    id: "volcano",
    label: "Volcano",
    blurb: "Human vs QC DE overview",
  },
  {
    id: "results",
    label: "Results table",
    blurb: "Ranked adj.P / log2FC",
  },
];

export function AppShell() {
  const { state, loadMock, loadFiles, loadReal, clear } = useDataset();
  const [proteinFocus, setProteinFocus] = useState("O00148");
  const [selectedSamples, setSelectedSamples] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<ExploreState>(initialExploreState);
  useEffect(() => { const timer = window.setTimeout(() => void loadReal(), 0); return () => window.clearTimeout(timer); }, [loadReal]);
  const linkedSamples = selectedSamples.filter(sample => state.dataset?.samples.includes(sample));
  useEffect(() => {
    setSelectedSamples([]);
    setAnalysis(initialExploreState);
    setProteinFocus("O00148");
  }, [state.dataset]);
  const [section, setSection] = useState<SectionId>("qc");
  const [showRealExplore, setShowRealExplore] = useState(false);
  const [qcFocus, setQcFocus] = useState<QcPlotId | null>(null);
  const [qcFocusToken, setQcFocusToken] = useState(0);
  const [dsModule, setDsModule] = useState<DownstreamModuleId>("volcano");

  const jumpQc = (id: QcPlotId) => {
    setSection("qc");
    setQcFocus(id);
    setQcFocusToken((t) => t + 1);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#ecfdf5_0%,_#f8fafc_45%,_#f1f5f9_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col lg:flex-row">
        <aside className="border-b border-slate-200/80 bg-white/80 backdrop-blur lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="px-5 py-6">
            <p className="text-xs font-semibold tracking-[0.2em] text-teal-800 uppercase">
              Proteomics Viz
            </p>
            <h1 className="mt-1 font-serif text-2xl leading-tight text-slate-900">
              FragPipe-style analyst
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              QC summary → jump to plots, plus downstream modules over MaxLFQ
              and annotation tables.
            </p>
          </div>

          <nav className="px-3 pb-4" aria-label="Sections">
            <button
              type="button"
              aria-pressed={showRealExplore}
              onClick={() => setShowRealExplore(true)}
              className={showRealExplore
                ? "mb-3 w-full rounded-lg bg-teal-800 px-3 py-2 text-left text-sm font-semibold text-white"
                : "mb-3 w-full rounded-lg bg-slate-100 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-200"}
            >
              Real data explore
            </button>
            <div className="mb-2 flex gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  ["qc", "QC"],
                  ["downstream", "Downstream"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => { setShowRealExplore(false); setSection(id); }}
                  className={
                    !showRealExplore && section === id
                      ? "flex-1 rounded-md bg-white px-2 py-1.5 text-sm font-semibold text-teal-900 shadow-sm"
                      : "flex-1 rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {!showRealExplore && (section === "qc" ? (
              <div className="space-y-3">
                <NavGroup label="Summary">
                  <button
                    type="button"
                    onClick={() => {
                      setSection("qc");
                      document
                        .getElementById("qc-summary")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                  >
                    <div className="font-medium">QC conclusions</div>
                    <div className="text-slate-500">Click items → jump to plots</div>
                  </button>
                </NavGroup>
                <NavGroup label="Conventional">
                  {QC_NAV.filter((m) => m.group === "conventional").map((m) => (
                    <NavButton
                      key={m.id}
                      label={m.label}
                      blurb={m.blurb}
                      selected={section === "qc" && qcFocus === m.id}
                      onClick={() => jumpQc(m.id)}
                    />
                  ))}
                </NavGroup>
                <NavGroup label="Custom">
                  {QC_NAV.filter((m) => m.group === "custom").map((m) => (
                    <NavButton
                      key={m.id}
                      label={m.label}
                      blurb={m.blurb}
                      selected={section === "qc" && qcFocus === m.id}
                      onClick={() => jumpQc(m.id)}
                    />
                  ))}
                </NavGroup>
              </div>
            ) : (
              <ul className="space-y-1">
                {DOWNSTREAM_MODULES.map((m) => (
                  <li key={m.id}>
                    <NavButton
                      label={m.label}
                      blurb={m.blurb}
                      selected={dsModule === m.id}
                      onClick={() => {
                        setDsModule(m.id);
                        document.getElementById(m.id === "results" ? "real-results" : "real-volcano")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    />
                  </li>
                ))}
              </ul>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {showRealExplore || (section === "downstream" && state.dataset?.source === "real") ? state.status === "ready" && state.dataset?.source === "real" ? <RealExplore totalProteins={state.dataset.proteins.length} focus={proteinFocus} setFocus={setProteinFocus} selectedSamples={linkedSamples} onSelectSamples={setSelectedSamples} analysis={analysis} setAnalysis={setAnalysis} focusResults={!showRealExplore && dsModule === "results"} onReturnQc={() => { setShowRealExplore(false); setSection("qc"); }} /> : <div className="rounded-xl border bg-white p-6"><h2 className="text-xl font-semibold">Real data explore</h2><p className="mt-2 text-sm">{state.status === "loading" ? "Loading the real dataset…" : state.status === "error" ? state.error : "Load the real dataset to connect this view to QC. Your uploaded or mock data remains separate."}</p><button type="button" disabled={state.status === "loading"} onClick={() => void loadReal()} className="mt-4 rounded bg-teal-800 px-3 py-2 text-white disabled:opacity-50">Load real dataset</button></div> : <>
          <FileUploadPanel
            state={state}
            onLoadMock={loadMock}
            onLoadReal={loadReal}
            onLoadFiles={loadFiles}
            onClear={clear}
          />

          <section className="mt-6">
            {state.status !== "ready" || !state.dataset ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                <EmptyAnalysis
                  section={section}
                  moduleLabel={
                    section === "qc"
                      ? "QC summary + plots"
                      : (DOWNSTREAM_MODULES.find((m) => m.id === dsModule)
                          ?.label ?? "")
                  }
                />
              </div>
            ) : section === "qc" ? (<>
              {state.dataset.source === "real" && <div className="mb-4 rounded-xl border border-teal-200 bg-white p-4 text-sm"><label htmlFor="linked-sample" className="block font-semibold">Sample shared with Real data explore</label><select id="linked-sample" className="mt-2 max-w-full rounded border border-slate-300 p-2" value={linkedSamples[0] ?? ""} onChange={e => setSelectedSamples(e.target.value ? [e.target.value] : [])}><option value="">No sample selected</option>{state.dataset.annotation.map(a => <option key={a.sample} value={a.sample}>{a.sample} · {a.condition} (unreviewed)</option>)}</select><p className="mt-2">Focused protein in explore: <strong>{proteinFocus}</strong>. QC plots summarize all proteins.</p></div>}
              <QcPanel
                dataset={state.dataset}
                focusPlotId={qcFocus}
                focusToken={qcFocusToken}
                selectedSamples={linkedSamples}
                onSelectSamples={setSelectedSamples}
              /></>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                <DownstreamPanel dataset={state.dataset} module={dsModule} />
              </div>
            )}
          </section>

          <footer className="mt-8 pb-6 text-xs text-slate-500">
            Optional omics / Mac data path:{" "}
            <code className="rounded bg-white/80 px-1">
              ~/Protein_visualization
            </code>{" "}
            or{" "}
            <code className="rounded bg-white/80 px-1">
              /data/ganye/Protein_visualization/
            </code>{" "}
            — upload <code>combined_protein.tsv</code> and{" "}
            <code>experiment_annotation.tsv</code>. This app reimplements
            FragPipe Analyst–style structure in JS; it is not a fork of the Shiny
            source.
          </footer>
          </>}
        </main>
      </div>
    </div>
  );
}

function NavGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 px-3 text-[10px] font-semibold tracking-widest text-slate-400 uppercase">
        {label}
      </p>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function NavButton({
  label,
  blurb,
  selected,
  onClick,
}: {
  label: string;
  blurb: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        selected
          ? "w-full rounded-lg bg-teal-800 px-3 py-2 text-left text-sm text-white"
          : "w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
      }
    >
      <div className="font-medium">{label}</div>
      <div className={selected ? "text-teal-100" : "text-slate-500"}>{blurb}</div>
    </button>
  );
}

function EmptyAnalysis({
  section,
  moduleLabel,
}: {
  section: SectionId;
  moduleLabel: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-xs font-semibold tracking-widest text-teal-800 uppercase">
        {section === "qc" ? "QC" : "Downstream"} · {moduleLabel}
      </p>
      <h3 className="mt-2 font-serif text-2xl text-slate-900">
        Load data to explore this module
      </h3>
      <p className="mt-2 max-w-md text-sm text-slate-600">
        Click <strong>Load mock data</strong> above for a built-in demo table,
        or upload FragPipe outputs. Empty, loading, and error states are handled
        in the data panel.
      </p>
    </div>
  );
}
