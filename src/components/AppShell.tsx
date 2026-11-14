"use client";

import { useEffect, useState } from "react";
import { useDataset } from "@/hooks/use-dataset";
import type { DownstreamModuleId, QcPlotId, SectionId, UserCustomPlotSpec } from "@/lib/types";
import { autoTitle } from "@/lib/custom-plot-metrics";
import { DownstreamPanel } from "./downstream/DownstreamPanel";
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
  const [analysis, setAnalysis] = useState<ExploreState>(initialExploreState);
  const [section, setSection] = useState<SectionId>("qc");
  const [qcFocus, setQcFocus] = useState<QcPlotId | null>(null);
  const [qcFocusToken, setQcFocusToken] = useState(0);
  const [dsModule, setDsModule] = useState<DownstreamModuleId>("volcano");
  const [userCustomPlots, setUserCustomPlots] = useState<UserCustomPlotSpec[]>([]);
  useEffect(() => { const timer = window.setTimeout(() => void loadReal(), 0); return () => window.clearTimeout(timer); }, [loadReal]);
  useEffect(() => { setSelectedSamples([]); setAnalysis(initialExploreState); setProteinFocus("O00148"); }, [state.dataset]);
  const linkedSamples = selectedSamples.filter(sample => state.dataset?.samples.includes(sample));
  const real = state.status === "ready" && state.dataset?.source === "real";
  const jumpQc = (id: QcPlotId) => { setQcFocus(id); setQcFocusToken(t => t+1); };
  const handleClear = () => { clear(); setUserCustomPlots([]); setQcFocus(null); };
  const addUserPlot = (spec: UserCustomPlotSpec) => { setUserCustomPlots(previous => [...previous, spec]); jumpQc(spec.id); };
  const removeUserPlot = (id: string) => { setUserCustomPlots(previous => previous.filter(p => p.id !== id)); setQcFocus(current => current === id ? null : current); };

  return <div className="proteomics-app">
    <header className="app-topbar">
      <a href="#" onClick={e => { e.preventDefault(); setSection("qc"); }} className="app-brand">Proteomics Viz</a>
      <nav aria-label="Analysis pages"><button type="button" aria-current={section === "qc" ? "page" : undefined} onClick={() => setSection("qc")}>QC</button><button type="button" aria-current={section === "downstream" ? "page" : undefined} onClick={() => setSection("downstream")}>Downstream workspace</button></nav>
      <div className="app-dataset-status">{state.status === "ready" && state.dataset ? <>{state.dataset.source === "real" ? "Real dataset" : state.dataset.source === "mock" ? "Synthetic demo" : "Uploaded data"}<span>{state.dataset.proteins.length.toLocaleString()} proteins · {state.dataset.samples.length} samples</span></> : state.status === "loading" ? "Loading dataset…" : "Dataset not loaded"}</div>
    </header>
    {section === "qc" ? <div className="qc-page-layout">
      <aside className="qc-sidebar" aria-label="QC plots"><h2>Quality control</h2><p>Inspect all samples before exploring candidates.</p>
        <button type="button" className="qc-nav-link" onClick={() => document.getElementById("qc-summary")?.scrollIntoView({behavior:"smooth",block:"start"})}>Overview</button>
        {QC_NAV.map(m => <button key={m.id} type="button" className="qc-nav-link" aria-current={qcFocus === m.id ? "true" : undefined} onClick={() => jumpQc(m.id)}><strong>{m.label}</strong><span>{m.description}</span></button>)}
        {userCustomPlots.map(p => <button key={p.id} type="button" className="qc-nav-link" aria-current={qcFocus === p.id ? "true" : undefined} onClick={() => jumpQc(p.id)}><strong>{p.title || autoTitle(p)}</strong><span>User {p.kind}</span></button>)}
        <button type="button" className="qc-continue" onClick={() => setSection("downstream")}>Continue to workspace</button>
      </aside>
      <main className="qc-page-main">
        <div className="workspace-page-heading"><div><h1>Sample quality overview</h1><p>Compare coverage, intensity and similarity. Selecting a sample highlights its evidence downstream.</p></div></div>
        <FileUploadPanel state={state} onLoadMock={loadMock} onLoadReal={loadReal} onLoadFiles={loadFiles} onClear={handleClear}/>
        {state.status === "ready" && state.dataset ? <div className="mt-6">
          {real && <p className="mb-4 text-sm text-slate-600">Focused protein in workspace: <strong>{proteinFocus}</strong>. QC summarizes all proteins; sample selection does not rerun statistics.</p>}
          <QcPanel dataset={state.dataset} focusPlotId={qcFocus} focusToken={qcFocusToken} userCustomPlots={userCustomPlots} onAddUserPlot={addUserPlot} onRemoveUserPlot={removeUserPlot} selectedSamples={linkedSamples} onSelectSamples={setSelectedSamples}/>
        </div> : <p className="mt-6 rounded border border-slate-200 bg-white p-6 text-sm">{state.status === "loading" ? "Preparing sample quality views…" : "Load a dataset above to inspect sample quality."}</p>}
      </main>
    </div> : <main className="downstream-page-main">
      {real && state.dataset ? <RealExplore totalProteins={state.dataset.proteins.length} focus={proteinFocus} setFocus={setProteinFocus} selectedSamples={linkedSamples} onSelectSamples={setSelectedSamples} analysis={analysis} setAnalysis={setAnalysis} focusResults={false} onReturnQc={() => setSection("qc")}/> : <>
        <div className="workspace-page-heading"><div><h1>Downstream workspace</h1><p>The linked workspace uses the real dataset and its packaged protein evidence.</p></div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-5"><p>{state.status === "loading" ? "Loading the real dataset…" : state.status === "error" ? state.error : "Load the real dataset to use the seven-module workspace. Mock and uploaded results remain separate below."}</p><button type="button" disabled={state.status === "loading"} onClick={() => void loadReal()} className="mt-3 rounded bg-teal-800 px-4 py-2 text-sm text-white disabled:opacity-50">Load real dataset</button><button type="button" onClick={() => setSection("qc")} className="ml-3 mt-3 rounded border px-4 py-2 text-sm">Return to QC</button></div>
        {state.status === "ready" && state.dataset && <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-2 text-lg font-semibold">{state.dataset.source === "mock" ? "Synthetic demo results" : "Uploaded results"}</h2><p className="mb-4 text-sm text-slate-600">These results are separate from the real protein evidence workspace.</p><div className="mb-4 flex gap-2">{(["volcano","results","go"] as const).map(id => <button type="button" key={id} aria-pressed={dsModule === id} className="rounded border px-3 py-2 text-sm aria-pressed:bg-teal-50" onClick={() => setDsModule(id)}>{id === "volcano" ? "Volcano" : id === "results" ? "Results table" : "GO enrichment"}</button>)}</div><DownstreamPanel dataset={state.dataset} module={dsModule}/></section>}
      </>}
    </main>}
  </div>;
}
