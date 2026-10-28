"use client";

import { useState } from "react";
import { RealExplore } from "./RealExplore";
import { useDataset } from "@/hooks/use-dataset";
import type {
  DownstreamModuleId,
  ModuleId,
  QcModuleId,
  SectionId,
} from "@/lib/types";
import { DownstreamPanel } from "./downstream/DownstreamPanel";
import { FileUploadPanel } from "./FileUploadPanel";
import { IntensityDistribution } from "./qc/IntensityDistribution";
import { MissingnessPlot } from "./qc/MissingnessPlot";
import { SampleCorrelation } from "./qc/SampleCorrelation";

const QC_MODULES: { id: QcModuleId; label: string; blurb: string }[] = [
  {
    id: "missingness",
    label: "Missingness",
    blurb: "Zero MaxLFQ rate by sample",
  },
  {
    id: "intensity",
    label: "Intensity",
    blurb: "log10 MaxLFQ distributions",
  },
  {
    id: "correlation",
    label: "Correlation",
    blurb: "Sample–sample Pearson matrix",
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
  const { state, loadMock, loadFiles, clear } = useDataset();
  const [realExplore, setRealExplore] = useState(true);
  const [section, setSection] = useState<SectionId>("qc");
  const [qcModule, setQcModule] = useState<QcModuleId>("missingness");
  const [dsModule, setDsModule] = useState<DownstreamModuleId>("volcano");

  const activeModule: ModuleId =
    section === "qc" ? qcModule : dsModule;

  const modules = section === "qc" ? QC_MODULES : DOWNSTREAM_MODULES;

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
              QC + downstream modules over MaxLFQ and annotation tables — first
              slice inspired by FragPipe Analyst flow.
            </p>
          </div>

          <nav className="px-3 pb-4" aria-label="Sections">
            <button type="button" onClick={() => setRealExplore(true)} className={`mb-3 w-full rounded-lg px-3 py-2 text-left text-sm font-semibold ${realExplore ? "bg-teal-800 text-white" : "bg-slate-100 text-slate-700"}`}>Real data explore</button>
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
                  onClick={() => { setSection(id); setRealExplore(false); }}
                  className={
                    section === id
                      ? "flex-1 rounded-md bg-white px-2 py-1.5 text-sm font-semibold text-teal-900 shadow-sm"
                      : "flex-1 rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            <ul className="space-y-1">
              {modules.map((m) => {
                const selected = activeModule === m.id;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setRealExplore(false);
                        if (section === "qc") setQcModule(m.id as QcModuleId);
                        else setDsModule(m.id as DownstreamModuleId);
                      }}
                      className={
                        selected
                          ? "w-full rounded-lg bg-teal-800 px-3 py-2 text-left text-sm text-white"
                          : "w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                      }
                    >
                      <div className="font-medium">{m.label}</div>
                      <div
                        className={
                          selected ? "text-teal-100" : "text-slate-500"
                        }
                      >
                        {m.blurb}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {realExplore ? <RealExplore /> : <>
          <FileUploadPanel
            state={state}
            onLoadMock={loadMock}
            onLoadFiles={loadFiles}
            onClear={clear}
          />

          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            {state.status !== "ready" || !state.dataset ? (
              <EmptyAnalysis section={section} moduleLabel={
                modules.find((m) => m.id === activeModule)?.label ?? ""
              } />
            ) : section === "qc" ? (
              qcModule === "missingness" ? (
                <MissingnessPlot dataset={state.dataset} />
              ) : qcModule === "intensity" ? (
                <IntensityDistribution dataset={state.dataset} />
              ) : (
                <SampleCorrelation dataset={state.dataset} />
              )
            ) : (
              <DownstreamPanel dataset={state.dataset} module={dsModule} />
            )}
          </section>

          <footer className="mt-8 pb-6 text-xs text-slate-500">
            Optional omics data path:{" "}
            <code className="rounded bg-white/80 px-1">
              /data/ganye/Protein_visualization/
            </code>{" "}
            — upload <code>combined_protein.tsv</code> and{" "}
            <code>experiment_annotation.tsv</code> from there when available.
            This app reimplements FragPipe Analyst–style structure in JS; it is
            not a fork of the Shiny source.
          </footer>
          </>}
        </main>
      </div>
    </div>
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
