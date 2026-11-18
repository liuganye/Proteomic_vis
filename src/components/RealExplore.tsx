"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnalysisWorkspace } from "./AnalysisWorkspace";
import type { WorkspaceModuleId } from "@/lib/workspace-layout";
import { RealVolcanoPlot } from "./RealVolcanoPlot";
import { filterRealResults, inVolcanoBrush, passesVolcanoFilters, RESULT_PAGE_SIZE, type ExploreState } from "@/lib/visualization";
import { RealResultsTable } from "./RealResultsTable";
import { ProteinAbundance } from "./ProteinAbundance";
import { ProteinStructure } from "./ProteinStructure";
import { ProteinPicker } from "./ProteinPicker";
import { ProteinFocusControls } from "./ProteinFocusControls";
import type { SampleSelectionProps } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_PROTEIN_API ?? "http://127.0.0.1:8000";
type Protein = { protein_id: string; gene: string | null; organism: string; description: string };
type Detail = Protein & { sequence: string; locations: string[]; structure_status: string; structures: { pdb_id: string; local_available: boolean; download_url: string | null }[] };
type Point = { protein_id: string; gene: string | null; organism: string; log2_fc: number; p_value: number; adj_p: number; significant: boolean };
type Abundance = { points: { sample_id: string; display_group: string; log2_intensity: number | null }[] };
type Network = { nodes: Protein[]; edges: { source: string; target: string; score: number }[]; total_neighbors: number; truncated: boolean };
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}${path}`, { signal });
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function RealExplore({ focus, setFocus, selectedSamples, onSelectSamples, analysis, setAnalysis, focusResults, onReturnQc, totalProteins }: {
  focus: string; setFocus: (id: string) => void;
  analysis: ExploreState; setAnalysis: (state: ExploreState) => void;
  focusResults: boolean; onReturnQc: () => void; totalProteins: number;
} & SampleSelectionProps) {
  const [reveal, setReveal] = useState<{ id: WorkspaceModuleId; token: number } | null>(null);
  const openPanel = (id: WorkspaceModuleId) => setReveal(previous => ({ id, token: (previous?.token ?? 0) + 1 }));
  const [points, setPoints] = useState<Point[]>([]);
  const [evidence, setEvidence] = useState<{ focus: string; detail: Detail; abundance: Abundance } | null>(null);
  const [evidenceError, setEvidenceError] = useState<{ focus: string; message: string } | null>(null);
  const [evidenceRetry, setEvidenceRetry] = useState(0);
  const [networkResponse, setNetworkResponse] = useState<{ focus: string; cutoff: number; data: Network } | null>(null);
  const [networkFailure, setNetworkFailure] = useState<{ focus: string; cutoff: number; message: string } | null>(null);
  const [scoreCutoff, setScoreCutoff] = useState(0.4);
  const detail = evidence?.focus === focus ? evidence.detail : null;
  const abundance = evidence?.focus === focus ? evidence.abundance : null;
  const error = evidenceError?.focus === focus ? evidenceError.message : "";
  const loading = !detail && !error;
  const network = networkResponse?.focus === focus && networkResponse.cutoff === scoreCutoff ? networkResponse.data : null;
  const networkError = networkFailure?.focus === focus && networkFailure.cutoff === scoreCutoff ? networkFailure.message : "";
  const networkLoading = !network && !networkError;
  const { pCutoff, fcCutoff } = analysis;
  const [resultsStatus, setResultsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [resultsRetry, setResultsRetry] = useState(0);
  const rows = useMemo(() => filterRealResults(points, analysis), [points, analysis]);
  const matchingIds = useMemo(() => new Set(rows.map(p => p.protein_id)), [rows]);
  const hasFilters = analysis.brush !== null || analysis.query.trim() !== "" || analysis.passingOnly;
  const updateAnalysis = (patch: Partial<ExploreState>) => setAnalysis({ ...analysis, ...patch });
  useEffect(() => {
    const c = new AbortController();
    setResultsStatus("loading");
    get<{items: Point[]}>("/api/v1/contrasts/human-vs-qc/results?limit=10000", c.signal)
      .then(data => { setPoints(data.items); setResultsStatus("ready"); }).catch(e => { if (e.name !== "AbortError") setResultsStatus("error"); });
    return () => c.abort();
  }, [resultsRetry]);
  useEffect(() => {
    if (focusResults && resultsStatus === "ready") setReveal(previous => ({ id: "results", token: (previous?.token ?? 0) + 1 }));
  }, [focusResults, resultsStatus]);
  useEffect(() => {
    const c = new AbortController();
    setEvidence(null); setEvidenceError(null);
    Promise.all([
      get<Detail>(`/api/v1/proteins/${encodeURIComponent(focus)}`, c.signal),
      get<Abundance>(`/api/v1/proteins/${encodeURIComponent(focus)}/abundance`, c.signal),
    ]).then(([d,a]) => { if (!c.signal.aborted) setEvidence({ focus, detail: d, abundance: a }); })
      .catch(e => { if (e.name !== "AbortError" && !c.signal.aborted) setEvidenceError({ focus, message: `Could not load ${focus}. Check the backend and try again.` }); });
    return () => c.abort();
  }, [focus, evidenceRetry]);
  useEffect(() => {
    const c = new AbortController();
    setNetworkResponse(null); setNetworkFailure(null);
    get<Network>(`/api/v1/networks/${encodeURIComponent(focus)}/neighbors?max_nodes=30&score_cutoff=${scoreCutoff}`, c.signal)
      .then(n => { if (!c.signal.aborted) setNetworkResponse({ focus, cutoff: scoreCutoff, data: n }); })
      .catch(e => { if (e.name !== "AbortError" && !c.signal.aborted) setNetworkFailure({ focus, cutoff: scoreCutoff, message: "Could not load the STRING neighborhood. Check the backend connection." }); });
    return () => c.abort();
  }, [focus, scoreCutoff]);
  const selected = points.find(p => p.protein_id === focus);
  const significant = (p: Point) => passesVolcanoFilters(p, pCutoff, fcCutoff);
  const choose = (id: string) => {
    setFocus(id);
    const index = rows.findIndex(p => p.protein_id === id);
    if (index >= 0) updateAnalysis({ page: Math.floor(index / RESULT_PAGE_SIZE) });
  };
  const resultsState = resultsStatus === "loading" ? <p role="status" className="p-5 text-sm">Loading imported Human − QC results…</p> : resultsStatus === "error" ? <div role="alert" className="p-5 text-sm"><p>Could not load imported results. Check the backend connection.</p><button type="button" onClick={() => setResultsRetry(n => n + 1)} className="mt-3 rounded border px-3 py-2">Retry results</button></div> : null;
  const evidenceState = <div className="p-5 text-sm">{loading ? <p role="status">Loading evidence for {focus}…</p> : <><p role="alert">{error || "Evidence is unavailable for this protein."}</p><button type="button" className="mt-3 rounded border px-3 py-2" onClick={() => setEvidenceRetry(n => n+1)}>Retry protein evidence</button></>}</div>;
  const panels: Record<WorkspaceModuleId, ReactNode> = {
    volcano: resultsState ?? (<RealVolcanoPlot points={points} focus={focus} onChoose={choose} pCutoff={pCutoff} fcCutoff={fcCutoff} setPCutoff={value => updateAnalysis({ pCutoff: value, page: 0 })} setFcCutoff={value => updateAnalysis({ fcCutoff: value, page: 0 })} brush={analysis.brush} onBrush={brush => updateAnalysis({ brush, page: 0 })} matchingIds={matchingIds} hasFilters={hasFilters} onViewResults={() => openPanel("results")} />),
    results: resultsState ?? (<RealResultsTable rows={rows} testedCount={points.length} brushedCount={points.filter(p => inVolcanoBrush(p, analysis.brush)).length} state={analysis} update={updateAnalysis} focus={focus} focusIsTested={!!selected} onChoose={id => { choose(id);  }} />),
    details: (<section id="protein-evidence" className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="protein-evidence-heading">
      <h3 id="protein-evidence-heading" className="text-lg font-semibold">Focused protein</h3>
      <ProteinFocusControls apiOrigin={API} focus={focus} rows={rows} sort={analysis.sort} resultsStatus={resultsStatus} onChoose={choose} />
      <div className="min-h-40" aria-live="polite" aria-busy={loading}>
        {loading ? <p className="mt-3 text-sm">Loading {focus}…</p> : detail && <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3"><strong className="text-2xl text-teal-900">{detail.gene || detail.protein_id}</strong><span>{detail.protein_id}</span><span className="text-sm text-slate-600">{detail.organism}</span></div>
          <p className="mt-1 text-sm">{detail.description}</p>
          <p className="mt-2 text-sm">{resultsStatus !== "ready" ? "Contrast results are unavailable while loading or after a connection error." : selected ? `Human − QC: log₂FC ${selected.log2_fc.toFixed(3)}, adjusted p ${selected.adj_p.toExponential(3)}${significant(selected) ? " · passes filters" : " · does not pass filters"}` : "Not evaluated in the Human − QC result."}</p>
          <p className="mt-2 text-sm"><strong>Location:</strong> {detail.locations.length ? detail.locations.join(", ") : "Not available"}</p>
          <details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold">Sequence ({detail.sequence.length} amino acids)</summary><p className="mt-2 break-all font-mono text-xs">{detail.sequence || "Not available"}</p></details>
        </>}
        {!loading && error && <div className="mt-3 text-sm"><p role="alert" className="text-red-800">{error}</p><button type="button" onClick={() => setEvidenceRetry(n => n + 1)} className="mt-2 rounded border border-slate-300 px-3 py-1">Retry protein evidence</button></div>}
      </div>
    </section>),
    abundance: abundance ? <ProteinAbundance abundance={abundance} selectedSamples={selectedSamples} onSelectSamples={onSelectSamples}/> : evidenceState,
    network: (<section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h3 className="text-lg font-semibold">STRING one-hop neighborhood</h3>
          <p className="mt-1 text-sm text-slate-600">Select a node to focus that protein. Edge width represents STRING confidence, not binding strength.</p></div>
        <label className="text-sm font-medium">Minimum confidence <select value={scoreCutoff} onChange={e => setScoreCutoff(Number(e.target.value))} className="ml-2 rounded border border-slate-300 bg-white px-2 py-1">{[0,0.4,0.6,0.7,0.9].map(score => <option key={score} value={score}>{score.toFixed(1)}</option>)}</select></label>
      </div>
      {networkLoading && <p className="mt-4 text-sm" role="status">Loading network for {focus}…</p>}
      {networkError && <p className="mt-4 text-sm text-red-800" role="alert">{networkError}</p>}
      {network && <>
        <p className="mt-2 text-sm text-slate-600">{network.total_neighbors} neighbors at confidence ≥ {scoreCutoff.toFixed(1)}. {network.truncated ? "Showing the 29 strongest neighbors; the network is truncated." : "All matching neighbors shown."} The local STRING export is incomplete.</p>
        {hasFilters && <p className="mt-2 text-xs text-slate-600">{network.nodes.filter(n => matchingIds.has(n.protein_id)).length} of {matchingIds.size} matching candidates appear in this local neighborhood. Orange outlines mark those candidates.</p>}
        <NetworkGraph network={network} focus={focus} onChoose={choose} candidateIds={hasFilters ? matchingIds : undefined} />
      </>}
    </section>),
    structure: detail ? <ProteinStructure key={detail.protein_id} proteinId={detail.protein_id} references={detail.structures}/> : evidenceState,
    go: <section className="go-pending" aria-labelledby="go-pending-heading">
      <span className="go-status">Analysis not connected</span>
      <h3 id="go-pending-heading">Functional themes of your candidates</h3>
      <p>GO enrichment will compare a candidate gene set with an appropriate background, separately for each species.</p>
      <dl><div><dt>Current candidate proteins</dt><dd>{resultsStatus === "ready" ? rows.length.toLocaleString() : "Results unavailable"}</dd></div><div><dt>Planned views</dt><dd>Biological process · Molecular function · Cellular component</dd></div></dl>
      <p className="go-next">GO annotations, ID mapping and enrichment computation have not been connected. No enrichment results are shown.</p>
      <p className="text-xs text-slate-600">This panel can be placed and resized now. It follows the candidate set, not the single focused protein.</p>
    </section>,
  };
  return <div>
    <header className="workspace-page-heading"><div><h1>Downstream workspace</h1><p>Human − QC · imported results · arrange the views around your question.</p></div><span>Real dataset</span></header>
    <AnalysisWorkspace reveal={reveal} context={(<div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950" role="region" aria-label="Shared sample and protein selection">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p><strong>QC samples:</strong> {selectedSamples.length ? selectedSamples.join(" + ") : "None selected"}</p>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={onReturnQc} className="rounded border border-teal-700 px-3 py-1">Return to QC</button><button type="button" disabled={!selectedSamples.length} onClick={() => onSelectSamples([])} className="rounded border border-teal-700 px-3 py-1 disabled:opacity-40">Clear sample selection</button></div>
      </div>
      <div className="mt-3"><ProteinPicker apiOrigin={API} current={detail ?? selected ?? { protein_id: focus, gene: null, organism: "" }} candidates={rows} candidatesStatus={resultsStatus} totalProteins={totalProteins} onChoose={choose} /></div>
    </div>)} renderPanel={id => panels[id]}/>
    <p className="mt-4 text-xs leading-relaxed text-slate-600">This benchmark compares mixture abundances, not disease effects. Sample group labels and replicate types require review. Layout changes do not recompute statistics.</p>
  </div>;
}

function NetworkGraph({ network, focus, onChoose, candidateIds }: { network: Network; focus: string; onChoose: (id: string) => void; candidateIds?: Set<string> }) {
  const [zoom, setZoom] = useState(1);
  const [showNeighborEdges, setShowNeighborEdges] = useState(false);
  const neighbors = network.nodes.filter(node => node.protein_id !== focus);
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(focus, { x: 500, y: 380 });
  // Distribute nodes across two rings to keep labels legible in the 30-node view.
  neighbors.forEach((node, index) => {
    const innerCount = Math.min(neighbors.length, 10);
    const inner = index < innerCount;
    const count = inner ? innerCount : neighbors.length - innerCount;
    const angle = -Math.PI / 2 + 2 * Math.PI * (inner ? index : index - innerCount) / count;
    const radius = inner ? 165 : 300;
    positions.set(node.protein_id, { x: 500 + radius * Math.cos(angle), y: 380 + radius * Math.sin(angle) });
  });
  return <>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-slate-600"><span className="font-semibold text-teal-900">●</span> Focused protein <span className="ml-3 font-semibold text-slate-500">●</span> Neighbor · hover over an edge for its score</p>
      <div className="flex gap-2"><button type="button" onClick={() => setZoom(z => Math.min(2, z + 0.2))} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">Zoom in</button><button type="button" onClick={() => setZoom(z => Math.max(0.6, z - 0.2))} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">Zoom out</button><button type="button" onClick={() => setZoom(1)} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">Reset</button></div>
    </div>
    {neighbors.length > 1 && <label className="mt-3 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={showNeighborEdges} onChange={e => setShowNeighborEdges(e.target.checked)} /> Show associations between neighbors</label>}
    {neighbors.length === 0 && <p className="mt-3 text-sm text-slate-600">No matching neighbors in the local export at this threshold.</p>}
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <svg viewBox="0 0 1000 760" className="block w-full" role="group" aria-label="Interactive STRING network. Select a neighbor to change the focused protein.">
        <g transform={`translate(500 380) scale(${zoom}) translate(-500 -380)`}>
          {network.edges.filter(edge => showNeighborEdges || edge.source === focus || edge.target === focus).map((edge, i) => {
            const source = positions.get(edge.source), target = positions.get(edge.target);
            if (!source || !target) return null;
            return <line aria-hidden="true" key={`${edge.source}-${edge.target}-${i}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="#64748b" strokeOpacity="0.5" strokeWidth={1 + edge.score * 3}><title>{edge.source} ↔ {edge.target}: confidence {edge.score.toFixed(3)}</title></line>;
          })}
          {network.nodes.map(node => {
            const pos = positions.get(node.protein_id); if (!pos) return null;
            const isFocus = node.protein_id === focus;
            const label = node.gene || node.protein_id;
            return <g key={node.protein_id} role="button" tabIndex={0} aria-label={`${isFocus ? "Focused protein" : "Focus protein"}: ${label}, ${node.protein_id}, ${node.organism}`} onClick={() => onChoose(node.protein_id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChoose(node.protein_id); } }} className="group cursor-pointer focus:outline-none" >
              <title>{label} ({node.protein_id}) · {node.organism}</title>
              <circle className="group-focus-visible:stroke-orange-600 group-focus-visible:[stroke-width:6]" cx={pos.x} cy={pos.y} r={isFocus ? 23 : 18} fill={isFocus ? "#115e59" : "#fff"} stroke={candidateIds?.has(node.protein_id) ? "#c2410c" : isFocus ? "#115e59" : "#64748b"} strokeWidth="3" />
              <text x={pos.x} y={pos.y + (isFocus ? 40 : 35)} textAnchor="middle" fontSize="14" fontWeight="600" fill="#0f172a" paintOrder="stroke" stroke="#f8fafc" strokeWidth="4" strokeLinejoin="round">{label.length > 14 ? `${label.slice(0, 13)}…` : label}</text>
            </g>;
          })}
        </g>
      </svg>
    </div>
    {neighbors.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-teal-900">Neighbor list and confidence scores</summary><ul className="mt-2 flex flex-wrap gap-2">{neighbors.map(node => {
      const score = Math.max(...network.edges.filter(e => (e.source === focus && e.target === node.protein_id) || (e.target === focus && e.source === node.protein_id)).map(e => e.score));
      return <li key={node.protein_id}><button type="button" onClick={() => onChoose(node.protein_id)} className="rounded border border-slate-300 px-3 py-1.5 text-left hover:bg-teal-50">{node.gene || node.protein_id} · {node.protein_id}{Number.isFinite(score) ? ` · ${score.toFixed(3)}` : ""}</button></li>;
    })}</ul></details>}
  </>;
}

