"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AnalysisWorkspace } from "./AnalysisWorkspace";
import type { WorkspaceModuleId } from "@/lib/workspace-layout";
import { RealVolcanoPlot } from "./RealVolcanoPlot";
import {
  curvedChordGeometry,
  filterRealResults,
  inVolcanoBrush,
  layoutStringNeighborhood,
  LOCAL_STRUCTURE_PDB,
  passesVolcanoFilters,
  pickRingLabelPositions,
  RESULT_PAGE_SIZE,
  volcanoDirection,
  type ExploreState,
  type RingBoxObstacle,
  type StringGroup,
} from "@/lib/visualization";
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
  const activeNetwork = networkResponse?.data ?? null;
  const activeNetworkFocus = networkResponse?.focus ?? focus;
  const networkError = networkFailure?.focus === focus && networkFailure.cutoff === scoreCutoff ? networkFailure.message : "";
  const networkLoading = !network && !networkError;
  const { pCutoff, fcCutoff } = analysis;
  const [resultsStatus, setResultsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [resultsRetry, setResultsRetry] = useState(0);
  const [focusHistory, setFocusHistory] = useState<string[]>([focus]);
  const [sharedHoverId, setSharedHoverId] = useState<string | null>(null);
  const rows = useMemo(() => filterRealResults(points, analysis), [points, analysis]);
  const resultsById = useMemo(() => new Map(points.map(p => [p.protein_id, p])), [points]);
  const networkNeighborIds = useMemo(
    () => new Set((network?.nodes ?? []).filter(n => n.protein_id !== focus).map(n => n.protein_id)),
    [network, focus],
  );
  const matchingIds = useMemo(() => new Set(rows.map(p => p.protein_id)), [rows]);
  const hasFilters = analysis.brush !== null || analysis.query.trim() !== "" || analysis.passingOnly;
  const updateAnalysis = (patch: Partial<ExploreState>) => setAnalysis({ ...analysis, ...patch });
  useEffect(() => {
    setFocusHistory(prev => (prev[prev.length - 1] === focus ? prev : [...prev, focus].slice(-8)));
  }, [focus]);
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
    setNetworkFailure(null);
    get<Network>(`/api/v1/networks/${encodeURIComponent(focus)}/neighbors?max_nodes=30&score_cutoff=${scoreCutoff}`, c.signal)
      .then(n => { if (!c.signal.aborted) setNetworkResponse({ focus, cutoff: scoreCutoff, data: n }); })
      .catch(e => { if (e.name !== "AbortError" && !c.signal.aborted) setNetworkFailure({ focus, cutoff: scoreCutoff, message: "Could not load the STRING neighborhood. Check the backend connection." }); });
    return () => c.abort();
  }, [focus, scoreCutoff]);
  const selected = points.find(p => p.protein_id === focus);
  const significant = (p: Point) => passesVolcanoFilters(p, pCutoff, fcCutoff);
  const choose = (id: string) => {
    setSharedHoverId(null);
    setFocus(id);
    const index = rows.findIndex(p => p.protein_id === id);
    if (index >= 0) updateAnalysis({ page: Math.floor(index / RESULT_PAGE_SIZE) });
  };
  const navigateHistory = (index: number) => {
    const targetId = focusHistory[index];
    if (!targetId) return;
    setFocusHistory(prev => prev.slice(0, index + 1));
    choose(targetId);
  };
  const resultsState = resultsStatus === "loading" ? <p role="status" className="p-5 text-sm">Loading imported Human − QC results…</p> : resultsStatus === "error" ? <div role="alert" className="p-5 text-sm"><p>Could not load imported results. Check the backend connection.</p><button type="button" onClick={() => setResultsRetry(n => n + 1)} className="mt-3 rounded border px-3 py-2">Retry results</button></div> : null;
  const evidenceState = <div className="p-5 text-sm">{loading ? <p role="status">Loading evidence for {focus}…</p> : <><p role="alert">{error || "Evidence is unavailable for this protein."}</p><button type="button" className="mt-3 rounded border px-3 py-2" onClick={() => setEvidenceRetry(n => n+1)}>Retry protein evidence</button></>}</div>;
  const panels: Record<WorkspaceModuleId, ReactNode> = {
    volcano: resultsState ?? (
      <RealVolcanoPlot
        points={points}
        focus={focus}
        onChoose={choose}
        pCutoff={pCutoff}
        fcCutoff={fcCutoff}
        setPCutoff={value => updateAnalysis({ pCutoff: value, page: 0 })}
        setFcCutoff={value => updateAnalysis({ fcCutoff: value, page: 0 })}
        brush={analysis.brush}
        onBrush={brush => updateAnalysis({ brush, page: 0 })}
        matchingIds={matchingIds}
        hasFilters={hasFilters}
        onViewResults={() => openPanel("results")}
        hoveredProteinId={sharedHoverId}
        onHoverProtein={setSharedHoverId}
        networkNeighborIds={networkNeighborIds}
        selectedSamples={selectedSamples}
        focusedAbundance={abundance?.points ?? null}
        onOpenPanel={openPanel}
      />
    ),
    results: resultsState ?? (<RealResultsTable rows={rows} testedCount={points.length} brushedCount={points.filter(p => inVolcanoBrush(p, analysis.brush)).length} state={analysis} update={updateAnalysis} focus={focus} focusIsTested={!!selected} onChoose={id => { choose(id);  }} />),
    details: (<section id="protein-evidence" className="flex flex-1 min-h-0 flex-col gap-2 scroll-mt-6" aria-labelledby="protein-evidence-heading">
      <h3 id="protein-evidence-heading" className="sr-only">Focused protein</h3>
      <ProteinFocusControls apiOrigin={API} focus={focus} rows={rows} sort={analysis.sort} resultsStatus={resultsStatus} onChoose={choose} />
      <div className="min-h-0 flex-1 overflow-auto" aria-live="polite" aria-busy={loading}>
        {loading ? <p className="text-xs text-slate-500">Loading {focus}…</p> : detail && <>
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <strong className="text-xl text-teal-900">{detail.gene || detail.protein_id}</strong>
            <span className="font-mono text-xs text-slate-600">{detail.protein_id}</span>
            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-700">{detail.organism}</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">{detail.description}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {resultsStatus === "ready" && (selected ? (
              <span className={`rounded px-2 py-0.5 font-medium ${significant(selected) ? "bg-teal-100 text-teal-900" : "bg-slate-100 text-slate-700"}`}>
                Human − QC: log₂FC {selected.log2_fc.toFixed(3)} · adj.p {selected.adj_p.toExponential(2)}
              </span>
            ) : (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">Not tested in Human − QC</span>
            ))}
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">
              Location: {detail.locations.length ? detail.locations.join(", ") : "NA"}
            </span>
          </div>
          <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold text-teal-900">Sequence ({detail.sequence.length} aa)</summary><p className="mt-1.5 break-all rounded bg-slate-50 p-2 font-mono text-[11px]">{detail.sequence || "Not available"}</p></details>
        </>}
        {!loading && error && <div className="mt-2 text-xs"><p role="alert" className="text-red-800">{error}</p><button type="button" onClick={() => setEvidenceRetry(n => n + 1)} className="mt-1 rounded border border-slate-300 px-2 py-1">Retry</button></div>}
      </div>
    </section>),
    abundance: abundance ? <ProteinAbundance abundance={abundance} selectedSamples={selectedSamples} onSelectSamples={onSelectSamples}/> : evidenceState,
    network: (<section className="flex flex-1 min-h-0 flex-col">
      {networkLoading && !activeNetwork && <p className="p-2 text-xs text-slate-600" role="status">Loading network for {focus}…</p>}
      {networkError && <p className="p-2 text-xs text-red-800" role="alert">{networkError}</p>}
      {activeNetwork && (
        <NetworkGraph
          network={activeNetwork}
          focus={activeNetworkFocus}
          isUpdating={networkLoading}
          onChoose={choose}
          candidateIds={hasFilters ? matchingIds : undefined}
          resultsById={resultsById}
          pCutoff={pCutoff}
          fcCutoff={fcCutoff}
          scoreCutoff={scoreCutoff}
          onScoreCutoffChange={setScoreCutoff}
          focusHistory={focusHistory}
          onNavigateHistory={navigateHistory}
          hoveredProteinId={sharedHoverId}
          onHoverProtein={setSharedHoverId}
          selectedSamples={selectedSamples}
          focusedAbundance={abundance?.points ?? null}
          onOpenPanel={openPanel}
        />
      )}
    </section>),
    structure: detail ? <ProteinStructure key={detail.protein_id} proteinId={detail.protein_id} references={detail.structures}/> : evidenceState,
    go: <section className="flex flex-1 min-h-0 flex-col justify-center gap-3 p-4" aria-labelledby="go-pending-heading">
      <div className="flex items-center gap-2">
        <span className="go-status">Not connected</span>
        <h3 id="go-pending-heading" className="text-sm font-semibold text-slate-800">GO enrichment</h3>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] text-slate-500">Current candidates</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-teal-900">{resultsStatus === "ready" ? rows.length.toLocaleString() : "—"}</div>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
          <span className="rounded bg-white px-1.5 py-0.5 border border-slate-200 font-medium">BP</span>
          <span className="rounded bg-white px-1.5 py-0.5 border border-slate-200 font-medium">MF</span>
          <span className="rounded bg-white px-1.5 py-0.5 border border-slate-200 font-medium">CC</span>
        </div>
      </div>
    </section>,
  };
  return <div>
    <AnalysisWorkspace reveal={reveal} context={(
      <div className="flex flex-wrap items-center gap-2 text-xs text-teal-950" role="region" aria-label="Shared sample and protein selection">
        <ProteinPicker apiOrigin={API} current={detail ?? selected ?? { protein_id: focus, gene: null, organism: "" }} candidates={rows} candidatesStatus={resultsStatus} totalProteins={totalProteins} onChoose={choose} />
        <div className="flex flex-wrap items-center gap-1.5 border-l border-slate-200 pl-2">
          <span className="font-semibold text-slate-600">QC:</span>
          {selectedSamples.length ? selectedSamples.map(sampleId => (
            <button
              key={sampleId}
              type="button"
              onClick={() => onSelectSamples(selectedSamples.filter(s => s !== sampleId))}
              className="inline-flex items-center gap-1 rounded-full border border-teal-700/40 bg-teal-50 px-2 py-0.5 font-medium text-teal-900 hover:bg-teal-100"
              title={`Remove ${sampleId}`}
            >
              {sampleId} <span aria-hidden="true">×</span>
            </button>
          )) : <span className="text-slate-500">None</span>}
          {selectedSamples.length > 0 && (
            <button type="button" onClick={() => onSelectSamples([])} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-600 hover:bg-slate-50">Clear</button>
          )}
          <button type="button" onClick={onReturnQc} className="rounded border border-teal-700/50 bg-white px-2 py-0.5 font-medium text-teal-900 hover:bg-teal-50">← QC</button>
        </div>
      </div>
    )} renderPanel={id => panels[id]}/>
  </div>;
}

function NetworkGraph({
  network,
  focus,
  isUpdating,
  onChoose,
  candidateIds,
  resultsById,
  pCutoff,
  fcCutoff,
  scoreCutoff,
  onScoreCutoffChange,
  focusHistory,
  onNavigateHistory,
  hoveredProteinId,
  onHoverProtein,
  selectedSamples,
  focusedAbundance,
  onOpenPanel,
}: {
  network: Network;
  focus: string;
  isUpdating?: boolean;
  onChoose: (id: string) => void;
  candidateIds?: Set<string>;
  resultsById: Map<string, Point>;
  pCutoff: number;
  fcCutoff: number;
  scoreCutoff: number;
  onScoreCutoffChange: (score: number) => void;
  focusHistory: string[];
  onNavigateHistory: (index: number) => void;
  hoveredProteinId?: string | null;
  onHoverProtein?: (id: string | null) => void;
  selectedSamples?: string[];
  focusedAbundance?: { sample_id: string; display_group: string; log2_intensity: number | null }[] | null;
  onOpenPanel?: (id: WorkspaceModuleId) => void;
}) {
  const [viewport, setViewport] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const { zoom, pan } = viewport;
  const [wheelActive, setWheelActive] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [showNeighborEdges, setShowNeighborEdges] = useState(false);
  const [testedOnly, setTestedOnly] = useState(false);
  const [viewMode, setViewMode] = useState<"graph" | "matrix" | "bars">("graph");
  const [pinnedControls, setPinnedControls] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const netContainerRef = useRef<HTMLDivElement>(null);
  const [netSize, setNetSize] = useState({ w: 720, h: 480 });
  const panDrag = useRef<{ clientX: number; clientY: number; startX: number; startY: number } | null>(null);
  const wheelMetaRef = useRef({ wheelActive: false, netCx: 360, netCy: 240, netW: 720, netH: 480 });

  useEffect(() => {
    setViewport(v => ({ ...v, pan: { x: 0, y: 0 } }));
    setHoveredNode(null);
  }, [focus]);

  useEffect(() => {
    if (!wheelActive) return;
    const onOutsideDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest("[data-panel-kind='network']")) setWheelActive(false);
    };
    window.addEventListener("pointerdown", onOutsideDown);
    return () => window.removeEventListener("pointerdown", onOutsideDown);
  }, [wheelActive]);

  const groupOf = useCallback(
    (id: string): StringGroup => {
      const diff = resultsById.get(id);
      return diff ? volcanoDirection(diff, pCutoff, fcCutoff) : "untested";
    },
    [resultsById, pCutoff, fcCutoff],
  );

  const neighbors = useMemo(() => network.nodes.filter(node => node.protein_id !== focus), [network.nodes, focus]);
  const summary = useMemo(() => {
    let up = 0;
    let down = 0;
    let ns = 0;
    let untested = 0;
    for (const node of neighbors) {
      const grp = groupOf(node.protein_id);
      if (grp === "up") up += 1;
      else if (grp === "down") down += 1;
      else if (grp === "ns") ns += 1;
      else untested += 1;
    }
    return { up, down, ns, untested, testedCount: up + down + ns, total: neighbors.length };
  }, [neighbors, groupOf]);

  const effectiveTestedOnly = testedOnly && summary.testedCount > 0;
  const visibleNeighbors = useMemo(
    () => (effectiveTestedOnly ? neighbors.filter(n => groupOf(n.protein_id) !== "untested") : neighbors),
    [effectiveTestedOnly, neighbors, groupOf],
  );
  const visibleNodes = useMemo(
    () => (effectiveTestedOnly ? network.nodes.filter(n => n.protein_id === focus || groupOf(n.protein_id) !== "untested") : network.nodes),
    [effectiveTestedOnly, network.nodes, focus, groupOf],
  );
  const visibleNodeSet = useMemo(() => new Set(visibleNodes.map(n => n.protein_id)), [visibleNodes]);
  const prevFocusId = focusHistory.length > 1 ? focusHistory[focusHistory.length - 2] : null;

  useEffect(() => {
    const el = netContainerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const nw = Math.max(280, Math.round(rect.width));
      const nh = Math.max(220, Math.round(rect.height));
      setNetSize(curr => (Math.abs(curr.w - nw) >= 1 || Math.abs(curr.h - nh) >= 1) ? { w: nw, h: nh } : curr);
    };
    update();
    const observer = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const nw = Math.max(280, Math.round(cr.width));
      const nh = Math.max(220, Math.round(cr.height));
      setNetSize(curr => (Math.abs(curr.w - nw) >= 1 || Math.abs(curr.h - nh) >= 1) ? { w: nw, h: nh } : curr);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode, visibleNeighbors.length]);
  const positions = useMemo(
    () => layoutStringNeighborhood(focus, visibleNodes, network.edges, { groupBy: groupOf }),
    [focus, visibleNodes, network.edges, groupOf],
  );
  const visibleEdges = useMemo(
    () =>
      network.edges.filter(
        edge =>
          visibleNodeSet.has(edge.source) &&
          visibleNodeSet.has(edge.target) &&
          (edge.source === focus || edge.target === focus || showNeighborEdges || edge.score >= 0.7),
      ),
    [network.edges, visibleNodeSet, showNeighborEdges, focus],
  );

  const rankedNeighbors = useMemo(() => {
    return visibleNeighbors
      .map(node => {
        const direct = network.edges
          .filter(e => (e.source === focus && e.target === node.protein_id) || (e.target === focus && e.source === node.protein_id))
          .map(e => e.score);
        const score = direct.length ? Math.max(...direct) : 0;
        return { node, score };
      })
      .sort((a, b) => (b.score - a.score) || a.node.protein_id.localeCompare(b.node.protein_id));
  }, [visibleNeighbors, network.edges, focus]);

  const edgeScoreMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of network.edges) {
      const key = e.source < e.target ? `${e.source}::${e.target}` : `${e.target}::${e.source}`;
      const prev = map.get(key) ?? 0;
      if (e.score > prev) map.set(key, e.score);
    }
    return map;
  }, [network.edges]);

  const matrixNodes = useMemo(() => {
    const orderRank: Record<StringGroup, number> = { up: 0, down: 1, ns: 2, untested: 3 };
    const focusNode = network.nodes.find(n => n.protein_id === focus);
    const sorted = [...rankedNeighbors].sort(
      (a, b) =>
        orderRank[groupOf(a.node.protein_id)] - orderRank[groupOf(b.node.protein_id)] ||
        b.score - a.score ||
        a.node.protein_id.localeCompare(b.node.protein_id),
    );
    return focusNode ? [{ node: focusNode, score: 1 }, ...sorted] : sorted;
  }, [network.nodes, focus, rankedNeighbors, groupOf]);

  const externalHover = hoveredProteinId && network.nodes.some(n => n.protein_id === hoveredProteinId) ? hoveredProteinId : null;
  const activeHover = hoveredNode ?? externalHover;

  const activeNodeIds = useMemo(() => {
    if (!activeHover || activeHover === focus) return null;
    const connected = new Set<string>([activeHover]);
    for (const edge of visibleEdges) {
      if (edge.source === activeHover) connected.add(edge.target);
      else if (edge.target === activeHover) connected.add(edge.source);
    }
    return connected;
  }, [activeHover, focus, visibleEdges]);

  const inspectedNode = useMemo(() => {
    const id = activeHover ?? focus;
    return network.nodes.find(n => n.protein_id === id) ?? null;
  }, [activeHover, focus, network.nodes]);

  const inspectedScoreToFocus = useMemo(() => {
    if (!inspectedNode || inspectedNode.protein_id === focus) return null;
    const directScores = network.edges
      .filter(e => (e.source === focus && e.target === inspectedNode.protein_id) || (e.target === focus && e.source === inspectedNode.protein_id))
      .map(e => e.score);
    return directScores.length ? Math.max(...directScores) : null;
  }, [inspectedNode, focus, network.edges]);

  const nodeLabel = (id: string) => {
    const fromNetwork = network.nodes.find(n => n.protein_id === id)?.gene;
    const fromResults = resultsById.get(id)?.gene;
    return fromNetwork || fromResults || id;
  };

  const isEdgeHighlighted = (edge: { source: string; target: string }) => {
    if (!activeHover) return false;
    if (activeHover === focus) return edge.source === focus || edge.target === focus;
    return edge.source === activeHover || edge.target === activeHover;
  };

  const handleSvgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || zoom <= 1) return;
    if ((e.target as Element).closest("[data-network-node='true']")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsPanning(true);
    panDrag.current = { clientX: e.clientX, clientY: e.clientY, startX: pan.x, startY: pan.y };
  };

  const handleSvgPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!panDrag.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const unitScale = rect.width / netSize.w || 1;
    const dx = (e.clientX - panDrag.current.clientX) / unitScale;
    const dy = (e.clientY - panDrag.current.clientY) / unitScale;
    setViewport(v => ({
      ...v,
      pan: {
        x: panDrag.current!.startX + dx,
        y: panDrag.current!.startY + dy,
      },
    }));
  };

  const handleSvgPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (panDrag.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    panDrag.current = null;
    setIsPanning(false);
  };

  const candidateCountInNet = candidateIds ? visibleNodes.filter(n => candidateIds.has(n.protein_id)).length : 0;
  const netW = netSize.w;
  const netH = netSize.h;
  const compactLegend = netW < 460 || netH < 340;
  let maxUsedRadius = 125;
  for (const p of positions.values()) {
    if (p.radius > maxUsedRadius) maxUsedRadius = p.radius;
  }
  const maxSpread = Math.max(170, maxUsedRadius + 30);
  const ringScale = Math.max(0.32, Math.min((netW - 60) / (maxSpread * 2), (netH - 64) / (maxSpread * 2)));
  const nodeScale = Math.max(0.84, Math.min(1.65, ringScale * 1.15));
  const fontScale = Math.max(1, Math.min(1.35, ringScale * 1.12));
  const netCx = netW / 2;
  const netCy = netH / 2;

  useEffect(() => {
    wheelMetaRef.current = { wheelActive, netCx, netCy, netW, netH };
  }, [wheelActive, netCx, netCy, netW, netH]);

  useEffect(() => {
    const el = netContainerRef.current;
    if (!el || viewMode !== "graph") return;
    const onWheel = (e: globalThis.WheelEvent) => {
      const { wheelActive: active, netCx: cx, netCy: cy, netW: vw, netH: vh } = wheelMetaRef.current;
      const isSolo = Boolean(el.closest("[data-panel-solo='true']"));
      if (!active && !isSolo && !e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const mx = ((e.clientX - rect.left) / rect.width) * vw;
      const my = ((e.clientY - rect.top) / rect.height) * vh;
      const factor = Math.exp(-e.deltaY * 0.0014);
      setViewport(curr => {
        let nextZoom = Math.max(0.6, Math.min(2.6, curr.zoom * factor));
        if ((curr.zoom > 1 && nextZoom <= 1.03 && factor < 1) || (curr.zoom < 1 && nextZoom >= 0.97 && factor > 1) || Math.abs(nextZoom - 1) < 0.025) {
          nextZoom = 1;
        }
        if (nextZoom === 1) {
          return { zoom: 1, pan: { x: 0, y: 0 } };
        }
        const ratio = nextZoom / curr.zoom;
        return {
          zoom: nextZoom,
          pan: {
            x: mx - cx - (mx - cx - curr.pan.x) * ratio,
            y: my - cy - (my - cy - curr.pan.y) * ratio,
          },
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [viewMode, visibleNeighbors.length]);
  const scaledPositions = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    for (const [id, p] of positions.entries()) {
      out.set(id, { x: netCx + (p.x - 500) * ringScale, y: netCy + (p.y - 380) * ringScale });
    }
    return out;
  }, [positions, netCx, netCy, ringScale]);

  const labelSizeScale = Math.min(1.28, fontScale);
  const visibleRings = useMemo(
    () =>
      [
        { rawR: 125, r: 125 * ringScale, label: "1.0" },
        { rawR: 205, r: 205 * ringScale, label: "0.7" },
        { rawR: 284, r: 284 * ringScale, label: "0.4" },
      ].filter(ring => ring.rawR <= maxSpread),
    [ringScale, maxSpread],
  );
  const ringLabels = useMemo(() => {
    const obstacles: RingBoxObstacle[] = [];
    const spokes: { x: number; y: number }[] = [];
    for (const node of visibleNodes) {
      const pos = scaledPositions.get(node.protein_id);
      if (!pos) continue;
      const isFocus = node.protein_id === focus;
      const diff = resultsById.get(node.protein_id);
      const fcBoost = diff ? 1 + Math.min(0.45, Math.abs(diff.log2_fc) / 6) : 0.8;
      const nr = (isFocus ? 21 : 16 * fcBoost) * nodeScale;
      obstacles.push({ x: pos.x, y: pos.y, halfW: nr + 8, halfH: nr + 8 });
      const labelY = pos.y + nr + Math.round((isFocus ? 16 : 14) * fontScale);
      const shortText = node.gene || node.protein_id;
      const textHalfW = Math.min(14, shortText.length) * 4.2 * fontScale + 6;
      obstacles.push({ x: pos.x, y: labelY - 4, halfW: textHalfW, halfH: 11 * fontScale });
      if (!isFocus) spokes.push(pos);
    }
    return pickRingLabelPositions(
      visibleRings.map(({ r, label }) => ({ r, label })),
      netCx,
      netCy,
      {
        obstacles,
        spokes,
        bounds: { width: netW, height: netH },
        labelScale: labelSizeScale,
      },
    );
  }, [visibleRings, visibleNodes, scaledPositions, focus, resultsById, nodeScale, fontScale, labelSizeScale, netCx, netCy, netW, netH]);

  const [animState, setAnimState] = useState<{
    positions: Map<string, { x: number; y: number }>;
    alphas: Map<string, number>;
    rings: { r: number; label: string; x: number; y: number; angle: number; alpha: number }[];
  } | null>(null);
  const prevAnimMetaRef = useRef<{ focus: string; key: string; ringScale: number } | null>(null);
  const livePosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const liveRingsRef = useRef<{ r: number; label: string; x: number; y: number; angle: number }[]>([]);
  const layoutKey = useMemo(
    () => `${focus}|${scoreCutoff}|${effectiveTestedOnly ? 1 : 0}|${visibleNodes.map(n => n.protein_id).join(",")}`,
    [focus, scoreCutoff, effectiveTestedOnly, visibleNodes],
  );

  useLayoutEffect(() => {
    const prev = prevAnimMetaRef.current;
    const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!prev || viewMode !== "graph" || prev.key === layoutKey || reducedMotion) {
      prevAnimMetaRef.current = { focus, key: layoutKey, ringScale };
      livePosRef.current = scaledPositions;
      liveRingsRef.current = ringLabels;
      setAnimState(null);
      return;
    }

    const startPositions = livePosRef.current;
    const prevRingByLabel = new Map(liveRingsRef.current.map(r => [r.label, r]));
    const fallbackAngle = liveRingsRef.current[0]?.angle ?? Math.PI * 0.25;
    const focusChanged = prev.focus !== focus;
    const clickedOrigin = startPositions.get(focus) ?? { x: netCx, y: netCy };
    const fromMap = new Map<string, { x: number; y: number }>();
    const initAlphas = new Map<string, number>();
    const isEntering = new Map<string, boolean>();
    for (const [id, target] of scaledPositions.entries()) {
      const existing = startPositions.get(id);
      if (existing) {
        fromMap.set(id, existing);
        isEntering.set(id, false);
        initAlphas.set(id, 1);
      } else {
        const origin = focusChanged ? clickedOrigin : { x: netCx, y: netCy };
        fromMap.set(id, {
          x: origin.x + (target.x - origin.x) * 0.25,
          y: origin.y + (target.y - origin.y) * 0.25,
        });
        isEntering.set(id, true);
        initAlphas.set(id, 0.15);
      }
    }

    const rawRingRadii: Record<string, number> = { "1.0": 125, "0.7": 205, "0.4": 284 };
    const ringTransitions = ringLabels.map(target => {
      const prevRing = prevRingByLabel.get(target.label);
      const fromR = prevRing?.r ?? (rawRingRadii[target.label] ?? 125) * prev.ringScale;
      const fromAngle = prevRing?.angle ?? fallbackAngle;
      const deltaAngle = Math.atan2(Math.sin(target.angle - fromAngle), Math.cos(target.angle - fromAngle));
      return {
        label: target.label,
        fromR,
        toR: target.r,
        fromAngle,
        deltaAngle,
        isNew: !prevRing,
      };
    });

    const buildRings = (ease: number) =>
      ringTransitions.map(rt => {
        const r = rt.fromR + (rt.toR - rt.fromR) * ease;
        const angle = rt.fromAngle + rt.deltaAngle * ease;
        const anchorR = r + 10 * labelSizeScale;
        return {
          r,
          label: rt.label,
          angle,
          x: netCx + anchorR * Math.cos(angle),
          y: netCy + anchorR * Math.sin(angle),
          alpha: rt.isNew ? 0.1 + 0.9 * ease : 1,
        };
      });

    const initRings = buildRings(0);
    prevAnimMetaRef.current = { focus, key: layoutKey, ringScale };
    livePosRef.current = fromMap;
    liveRingsRef.current = initRings;
    setAnimState({ positions: fromMap, alphas: initAlphas, rings: initRings });

    const duration = focusChanged ? 360 : 240;
    const t0 = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const raw = Math.min(1, (now - t0) / duration);
      const ease = 1 - Math.pow(1 - raw, 3);
      const curPos = new Map<string, { x: number; y: number }>();
      const curAlpha = new Map<string, number>();
      for (const [id, target] of scaledPositions.entries()) {
        const from = fromMap.get(id) ?? target;
        curPos.set(id, {
          x: from.x + (target.x - from.x) * ease,
          y: from.y + (target.y - from.y) * ease,
        });
        curAlpha.set(id, isEntering.get(id) ? 0.15 + 0.85 * ease : 1);
      }
      const curRings = buildRings(ease);
      livePosRef.current = curPos;
      liveRingsRef.current = curRings;
      if (raw < 1) {
        setAnimState({ positions: curPos, alphas: curAlpha, rings: curRings });
        rafId = requestAnimationFrame(tick);
      } else {
        setAnimState(null);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [focus, layoutKey, scaledPositions, ringLabels, ringScale, labelSizeScale, viewMode, netCx, netCy]);

  const renderPositions = animState?.positions ?? scaledPositions;
  const renderRings: (typeof ringLabels[number] & { alpha?: number })[] = animState?.rings ?? ringLabels;

  const isTableView = viewMode !== "graph";

  const controlsBar = (
    <div
      className={isTableView
        ? "mb-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
        : `absolute bottom-[calc(100%+36px)] left-0 right-0 z-40 flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-slate-200/90 bg-white/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-sm transition-opacity duration-150 after:content-[''] after:absolute after:inset-x-0 after:top-full after:h-2 ${pinnedControls ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none group-hover/panel:opacity-100 group-hover/panel:pointer-events-auto group-hover:opacity-100 group-hover:pointer-events-auto"}`}
      aria-label="STRING network parameters toolbar"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="inline-flex items-center overflow-hidden rounded border border-slate-300 bg-white" role="group" aria-label="Minimum STRING score">
          <span className="bg-slate-50 px-2 py-0.5 font-medium text-slate-600">Score ≥</span>
          {[0, 0.4, 0.6, 0.7, 0.9].map(score => {
            const active = Math.abs(scoreCutoff - score) < 0.001;
            return (
              <button
                key={score}
                type="button"
                aria-pressed={active}
                onClick={() => onScoreCutoffChange(score)}
                className={`border-l border-slate-200 px-1.5 py-0.5 tabular-nums transition-colors ${active ? "bg-teal-800 font-semibold text-white" : "bg-white text-slate-700 hover:bg-teal-50"}`}
              >
                {score.toFixed(1)}
              </button>
            );
          })}
        </div>
        <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700" title="Local STRING export">
          {network.total_neighbors} neighbors{network.truncated ? " (top 29)" : ""}
        </span>
        {summary.testedCount > 0 && summary.untested > 0 && (
          <button
            type="button"
            aria-pressed={effectiveTestedOnly}
            onClick={() => setTestedOnly(t => !t)}
            className={`rounded border px-2 py-0.5 font-medium transition-colors ${effectiveTestedOnly ? "border-teal-700 bg-teal-800 text-white" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-teal-50"}`}
            title="Show only STRING neighbors quantified in the proteomics differential table"
          >
            Tested ({summary.testedCount})
          </button>
        )}
        {candidateIds && candidateCountInNet > 0 && (
          <span className="rounded border border-orange-200 bg-orange-50 px-2 py-0.5 font-medium text-orange-900">
            {candidateCountInNet} candidate{candidateCountInNet === 1 ? "" : "s"}
          </span>
        )}
        {viewMode === "graph" && visibleNeighbors.length > 1 && (
          <label
            className="flex cursor-pointer select-none items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-700"
            title="Show all neighbor–neighbor edges (high-confidence ≥ 0.7 module chords shown subtly by default)"
          >
            <input type="checkbox" checked={showNeighborEdges} onChange={e => setShowNeighborEdges(e.target.checked)} />
            Neighbor edges
          </label>
        )}
        {focusHistory.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 border-l border-slate-200 pl-2" data-testid="network-focus-history">
            <button type="button" onClick={() => onNavigateHistory(focusHistory.length - 2)} className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-800 hover:bg-teal-50">← Back</button>
            {focusHistory.slice(-4).map((id, idx, arr) => {
              const realIdx = focusHistory.length - arr.length + idx;
              const isCurrent = realIdx === focusHistory.length - 1;
              return <span key={`${id}-${realIdx}`} className="inline-flex items-center gap-0.5">
                {idx > 0 && <span className="text-slate-400">→</span>}
                <button
                  type="button"
                  disabled={isCurrent}
                  onClick={() => onNavigateHistory(realIdx)}
                  className={`rounded px-1.5 py-0.5 ${isCurrent ? "bg-teal-800 font-semibold text-white" : "border border-slate-200 bg-white text-teal-900 hover:bg-teal-50"}`}
                  title={id}
                >
                  {nodeLabel(id)}
                </button>
              </span>;
            })}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="inline-flex overflow-hidden rounded border border-slate-300" role="group" aria-label="STRING view mode">
          <button type="button" aria-pressed={viewMode === "graph"} onClick={() => setViewMode("graph")} className={`px-2 py-0.5 ${viewMode === "graph" ? "bg-teal-800 text-white font-medium" : "bg-white text-slate-700 hover:bg-slate-50"}`}>Graph</button>
          <button type="button" aria-pressed={viewMode === "matrix"} onClick={() => setViewMode("matrix")} className={`border-l border-slate-300 px-2 py-0.5 ${viewMode === "matrix" ? "bg-teal-800 text-white font-medium" : "bg-white text-slate-700 hover:bg-slate-50"}`}>Matrix</button>
          <button type="button" aria-pressed={viewMode === "bars"} onClick={() => setViewMode("bars")} className={`border-l border-slate-300 px-2 py-0.5 ${viewMode === "bars" ? "bg-teal-800 text-white font-medium" : "bg-white text-slate-700 hover:bg-slate-50"}`}>Bars</button>
        </div>
        {viewMode === "graph" && <>
          <button type="button" onClick={() => setViewport(v => ({ ...v, zoom: Math.min(2.6, Number((v.zoom + 0.2).toFixed(2))) }))} className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50" aria-label="Zoom in">+</button>
          <button type="button" onClick={() => setViewport(v => { const nz = Math.max(0.6, Number((v.zoom - 0.2).toFixed(2))); return Math.abs(nz - 1) < 0.05 ? { zoom: 1, pan: { x: 0, y: 0 } } : { ...v, zoom: nz }; })} className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50" aria-label="Zoom out">−</button>
          <button type="button" onClick={() => setViewport({ zoom: 1, pan: { x: 0, y: 0 } })} className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50">Reset</button>
          <button
            type="button"
            aria-pressed={pinnedControls}
            onClick={() => setPinnedControls(p => !p)}
            className={`rounded border px-2 py-0.5 ${pinnedControls ? "border-teal-700 bg-teal-50 font-semibold text-teal-900" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
            title="Keep parameter bar open"
          >
            {pinnedControls ? "Pinned" : "Pin"}
          </button>
        </>}
        {isUpdating && <span className="text-[11px] text-teal-700">…</span>}
      </div>
    </div>
  );

  const inspectorHud = inspectedNode ? (
    <div
      className={isTableView
        ? "mb-1.5 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
        : `pointer-events-none absolute top-[calc(100%+6px)] left-2 right-2 z-30 flex flex-wrap items-center gap-1.5 transition-opacity duration-150 before:content-[''] before:absolute before:inset-x-0 before:bottom-full before:h-3 [&_button]:pointer-events-auto ${activeHover && activeHover !== focus ? "opacity-100" : "opacity-0 group-hover/panel:opacity-100 group-hover:opacity-100"}`}
      data-testid="network-inspector"
      aria-live="polite"
    >
      <div className={isTableView
        ? "flex flex-wrap items-center gap-2"
        : "flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200/90 bg-white/90 px-2 py-1 text-[11px] text-slate-700 shadow-sm backdrop-blur-sm"}>
        {(() => {
          const diff = resultsById.get(inspectedNode.protein_id);
          const dir = diff ? volcanoDirection(diff, pCutoff, fcCutoff) : null;
          const localPdb = LOCAL_STRUCTURE_PDB[inspectedNode.protein_id];
          const fromVolcanoHover = Boolean(externalHover && !hoveredNode);
          return <>
            <span className="font-semibold text-slate-900">
              {fromVolcanoHover ? "Volcano:" : activeHover && activeHover !== focus ? "Neighbor:" : "Focus:"} {inspectedNode.gene || inspectedNode.protein_id}
            </span>
            <span className="font-mono text-[10.5px] text-slate-500">{inspectedNode.protein_id}</span>
            <span className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px]">{inspectedNode.organism.split(" ")[0]}</span>
            {inspectedScoreToFocus !== null && <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-medium">score {inspectedScoreToFocus.toFixed(3)}</span>}
            {diff ? (
              <span className={`rounded px-1.5 py-0.5 font-medium ${dir === "up" ? "bg-teal-100 text-teal-900" : dir === "down" ? "bg-amber-100 text-amber-900" : "bg-slate-200 text-slate-700"}`}>
                FC {diff.log2_fc.toFixed(2)} · p {diff.adj_p.toExponential(1)}
              </span>
            ) : (
              <span className="rounded border border-dashed border-slate-400 bg-white px-1.5 py-0.5 text-[10px] text-slate-600">Not evaluated</span>
            )}
            {diff && onOpenPanel && (
              <button type="button" onClick={() => { onChoose(inspectedNode.protein_id); onOpenPanel("results"); }} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-teal-900 hover:bg-teal-50">
                Table
              </button>
            )}
            {localPdb && onOpenPanel && (
              <button type="button" onClick={() => { onChoose(inspectedNode.protein_id); onOpenPanel("structure"); }} className="rounded border border-teal-700 bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-teal-900 hover:bg-teal-50">
                3D:{localPdb}
              </button>
            )}
          </>;
        })()}
        {selectedSamples && selectedSamples.length > 0 && (
          <span className="flex flex-wrap items-center gap-1 border-l border-slate-300 pl-1.5 text-[10.5px]">
            {selectedSamples.map(sampleId => {
              const obs = focusedAbundance?.find(a => a.sample_id === sampleId);
              return <span key={sampleId} className="rounded border border-slate-200 bg-white px-1 py-0.5">{sampleId}: {obs ? (obs.log2_intensity === null ? <em className="text-amber-800">NA</em> : <strong>{obs.log2_intensity.toFixed(2)}</strong>) : "…"}</span>;
            })}
            {onOpenPanel && <button type="button" onClick={() => onOpenPanel("abundance")} className="text-teal-900 underline underline-offset-2">D2</button>}
          </span>
        )}
      </div>
    </div>
  ) : null;

  return <div className="group relative flex flex-1 min-h-0 min-w-0 flex-col">
    {controlsBar}
    {isTableView && inspectorHud}
    {neighbors.length === 0 ? (
      <div ref={netContainerRef} className="relative flex flex-1 min-h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-300/70 bg-transparent p-6 text-xs text-slate-500">
        No STRING neighbors at confidence ≥ {scoreCutoff.toFixed(1)}.
        {viewMode === "graph" && inspectorHud}
      </div>
    ) : visibleNeighbors.length === 0 ? (
      <div ref={netContainerRef} className="relative flex flex-1 min-h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300/70 bg-transparent p-6 text-xs text-slate-500">
        <span>All {neighbors.length} STRING neighbors at confidence ≥ {scoreCutoff.toFixed(1)} are Not evaluated.</span>
        <button type="button" onClick={() => setTestedOnly(false)} className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-teal-900 hover:bg-teal-50">
          Show all {neighbors.length} neighbors
        </button>
        {viewMode === "graph" && inspectorHud}
      </div>
    ) : viewMode === "graph" ? (
      <>
        <div
          ref={netContainerRef}
          onPointerDownCapture={() => setWheelActive(true)}
          className="relative flex-1 min-h-[180px] w-full overflow-visible bg-transparent"
        >
          <svg
            viewBox={`0 0 ${netW} ${netH}`}
            data-no-panel-drag={zoom > 1 ? "true" : undefined}
            className="block h-full w-full select-none touch-none"
            preserveAspectRatio="none"
            style={{ cursor: isPanning ? "grabbing" : "grab" }}
            role="group"
            aria-label="Interactive STRING network. Select a neighbor to change the focused protein."
            onPointerDown={handleSvgPointerDown}
            onPointerMove={handleSvgPointerMove}
            onPointerUp={handleSvgPointerUp}
            onPointerCancel={handleSvgPointerUp}
          >
            <g transform={`translate(${netCx + pan.x} ${netCy + pan.y}) scale(${zoom}) translate(${-netCx} ${-netCy})`}>
              {renderRings.map(ring => (
                <g key={ring.label} pointerEvents="none" opacity={ring.alpha ?? 1}>
                  <circle cx={netCx} cy={netCy} r={ring.r} fill="none" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4 6" />
                  <text
                    x={ring.x}
                    y={ring.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={Math.round(11.5 * Math.min(1.25, fontScale))}
                    fontWeight="500"
                    fill="#475569"
                    paintOrder="stroke"
                    stroke="#f8fafc"
                    strokeWidth="3.5"
                  >
                    score {ring.label}
                  </text>
                </g>
              ))}
              {visibleEdges.map((edge, i) => {
                const source = renderPositions.get(edge.source), target = renderPositions.get(edge.target);
                if (!source || !target) return null;
                const isCenterEdge = edge.source === focus || edge.target === focus;
                const highlighted = isEdgeHighlighted(edge);
                const dimmed = Boolean(activeHover && activeHover !== focus && !highlighted);
                const tierHigh = edge.score >= 0.9;
                const tierMid = edge.score >= 0.7 && edge.score < 0.9;
                const stroke = highlighted
                  ? "#0f766e"
                  : isCenterEdge
                    ? (tierHigh ? "#0f172a" : tierMid ? "#475569" : "#94a3b8")
                    : "#94a3b8";
                const edgeFade = Math.min(animState?.alphas.get(edge.source) ?? 1, animState?.alphas.get(edge.target) ?? 1);
                const baseOpacity = dimmed
                  ? (isCenterEdge ? 0.12 : 0.08)
                  : highlighted
                    ? 0.95
                    : isCenterEdge
                      ? (tierHigh ? 0.9 : tierMid ? 0.72 : 0.56)
                      : showNeighborEdges
                        ? 0.42
                        : 0.24;
                const strokeOpacity = baseOpacity * edgeFade;
                const strokeDasharray = highlighted
                  ? undefined
                  : isCenterEdge
                    ? (tierHigh || tierMid ? undefined : "5 4")
                    : showNeighborEdges
                      ? "4 4"
                      : "3 4";
                const wScale = Math.min(1.25, Math.max(0.85, nodeScale));
                const strokeWidth = highlighted
                  ? 2.2 + edge.score * 3.4
                  : isCenterEdge
                    ? (tierHigh ? 4.4 * wScale : tierMid ? 2.6 * wScale : 1.5 * wScale)
                    : showNeighborEdges
                      ? 1 + edge.score * 1.8
                      : 1 + edge.score * 1.4;

                if (isCenterEdge) {
                  return <line
                    aria-hidden="true"
                    key={`${edge.source}-${edge.target}-${i}`}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeDasharray={strokeDasharray}
                    strokeWidth={strokeWidth}
                  >
                    <title>{edge.source} ↔ {edge.target}: confidence {edge.score.toFixed(3)}</title>
                  </line>;
                }
                const chord = curvedChordGeometry(source, target, netCx, netCy);
                return <path
                  aria-hidden="true"
                  key={`${edge.source}-${edge.target}-${i}`}
                  d={chord.d}
                  fill="none"
                  stroke={stroke}
                  strokeOpacity={strokeOpacity}
                  strokeDasharray={strokeDasharray}
                  strokeWidth={strokeWidth}
                >
                  <title>{edge.source} ↔ {edge.target}: confidence {edge.score.toFixed(3)}</title>
                </path>;
              })}
              {!activeHover && visibleNeighbors.length <= 16 && visibleEdges.map((edge, i) => {
                if (edge.source !== focus && edge.target !== focus) return null;
                const source = renderPositions.get(edge.source), target = renderPositions.get(edge.target);
                if (!source || !target) return null;
                const focusPos = edge.source === focus ? source : target;
                const neighborPos = edge.source === focus ? target : source;
                const t = i % 2 === 0 ? 0.52 : 0.62;
                const sx = focusPos.x + (neighborPos.x - focusPos.x) * t;
                const sy = focusPos.y + (neighborPos.y - focusPos.y) * t;
                const edgeFade = Math.min(animState?.alphas.get(edge.source) ?? 1, animState?.alphas.get(edge.target) ?? 1);
                return (
                  <text
                    key={`spoke-score-${edge.source}-${edge.target}-${i}`}
                    x={sx}
                    y={sy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={Math.round(11 * Math.min(1.25, fontScale))}
                    fontWeight={edge.score >= 0.9 ? "700" : "600"}
                    fill={edge.score >= 0.9 ? "#0f172a" : edge.score >= 0.7 ? "#475569" : "#64748b"}
                    opacity={edgeFade}
                    paintOrder="stroke"
                    stroke="#f8fafc"
                    strokeWidth="4"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  >
                    {edge.score.toFixed(2)}
                  </text>
                );
              })}
              {activeHover && activeHover !== focus && visibleEdges.map((edge, i) => {
                if (!isEdgeHighlighted(edge)) return null;
                const source = renderPositions.get(edge.source), target = renderPositions.get(edge.target);
                if (!source || !target) return null;
                const isCenterEdge = edge.source === focus || edge.target === focus;
                const mid = isCenterEdge
                  ? { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 }
                  : (() => {
                      const g = curvedChordGeometry(source, target, netCx, netCy);
                      return { x: g.midX, y: g.midY };
                    })();
                return <g key={`pill-${edge.source}-${edge.target}-${i}`} pointerEvents="none">
                  <rect x={mid.x - 21} y={mid.y - 10} width="42" height="20" rx="4" fill="#ffffff" stroke="#0f766e" strokeWidth="1.2" />
                  <text x={mid.x} y={mid.y + 4.5} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#0f766e">
                    {edge.score.toFixed(2)}
                  </text>
                </g>;
              })}
              {visibleNodes.map(node => {
                const pos = renderPositions.get(node.protein_id); if (!pos) return null;
                const isFocus = node.protein_id === focus;
                const isPrevFocus = !isFocus && prevFocusId === node.protein_id;
                const isHovered = activeHover === node.protein_id;
                const dimmed = Boolean(activeNodeIds && !activeNodeIds.has(node.protein_id) && !isFocus);
                const label = node.gene || node.protein_id;
                const diff = resultsById.get(node.protein_id);
                const dir = diff ? volcanoDirection(diff, pCutoff, fcCutoff) : null;
                const isCandidate = Boolean(candidateIds?.has(node.protein_id));
                const hasLocal3D = Boolean(LOCAL_STRUCTURE_PDB[node.protein_id]);
                const fcBoost = diff ? 1 + Math.min(0.45, Math.abs(diff.log2_fc) / 6) : 0.8;
                const baseRadius = (isFocus ? 21 : 16 * fcBoost) * nodeScale;
                const fill = dir === "up" ? "#ccfbf1" : dir === "down" ? "#fef3c7" : dir === "ns" ? "#f8fafc" : "#ffffff";
                const stroke = dir === "up" ? "#0f766e" : dir === "down" ? "#b45309" : dir === "ns" ? "#64748b" : "#94a3b8";
                const strokeDasharray = dir === null ? "4 3" : undefined;
                const enterAlpha = animState?.alphas.get(node.protein_id) ?? 1;
                const nodeOpacity = (dimmed ? 0.22 : !isFocus && !diff ? 0.72 : 1) * enterAlpha;
                return <g
                  key={node.protein_id}
                  data-network-node="true"
                  role="button"
                  tabIndex={0}
                  opacity={nodeOpacity}
                  aria-label={`${isFocus ? "Focused protein" : "Focus protein"}: ${label}, ${node.protein_id}, ${node.organism}`}
                  onPointerDown={e => e.stopPropagation()}
                  onPointerEnter={() => { setHoveredNode(node.protein_id); onHoverProtein?.(node.protein_id); }}
                  onPointerLeave={() => { setHoveredNode(curr => curr === node.protein_id ? null : curr); onHoverProtein?.(null); }}
                  onFocus={() => { setHoveredNode(node.protein_id); onHoverProtein?.(node.protein_id); }}
                  onBlur={() => { setHoveredNode(curr => curr === node.protein_id ? null : curr); onHoverProtein?.(null); }}
                  onClick={() => onChoose(node.protein_id)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChoose(node.protein_id); } }}
                  className="group/node cursor-pointer focus:outline-none"
                >
                  <title>{`${label} (${node.protein_id}) · ${node.organism}${diff ? ` · log₂FC ${diff.log2_fc.toFixed(2)}, adj p ${diff.adj_p.toExponential(2)}` : " · Not evaluated"}${hasLocal3D ? ` · Local 3D: ${LOCAL_STRUCTURE_PDB[node.protein_id]}` : ""}`}</title>
                  {isCandidate && (
                    <circle cx={pos.x} cy={pos.y} r={baseRadius + (isFocus ? 8.5 : 4) * Math.min(1.3, nodeScale)} fill="none" stroke="#c2410c" strokeWidth="2.2" />
                  )}
                  {isFocus && (
                    <circle cx={pos.x} cy={pos.y} r={baseRadius + 4.5 * Math.min(1.3, nodeScale)} fill="none" stroke="#0f172a" strokeWidth="2.8" />
                  )}
                  <circle
                    className="group-focus-visible/node:stroke-orange-600 group-focus-visible/node:[stroke-width:5]"
                    cx={pos.x}
                    cy={pos.y}
                    r={isHovered && !isFocus ? baseRadius + 2 : baseRadius}
                    fill={fill}
                    stroke={stroke}
                    strokeDasharray={strokeDasharray}
                    strokeWidth={isFocus ? 2.5 : dir ? 2.2 : 1.8}
                  />
                  {hasLocal3D && (
                    <text x={pos.x} y={pos.y + Math.round(4 * Math.min(1.35, nodeScale))} textAnchor="middle" fontSize={Math.round(10.5 * Math.min(1.4, nodeScale))} fontWeight="700" fill={dir === "down" ? "#92400e" : "#0f766e"} pointerEvents="none">
                      3D
                    </text>
                  )}
                  {isPrevFocus && (
                    <g pointerEvents="none" transform={`translate(${pos.x + baseRadius * 0.74}, ${pos.y - baseRadius * 0.74})`}>
                      <title>Previous focus protein — click node to return</title>
                      <circle r={Math.max(7.5, Math.round(7.5 * Math.min(1.2, nodeScale)))} fill="#f1f5f9" stroke="#475569" strokeWidth="1.2" />
                      <path
                        d="M -3 -1.2 H 1 A 2.2 2.2 0 0 1 1 3.2 H -1.5 M -1.1 -3.0 L -3.2 -1.2 L -1.1 0.6"
                        fill="none"
                        stroke="#0f172a"
                        strokeWidth="1.45"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  )}
                  <text x={pos.x} y={pos.y + baseRadius + Math.round((isFocus ? 16 : 14) * fontScale)} textAnchor="middle" fontSize={compactLegend ? Math.round(12 * fontScale) : Math.round((isFocus ? 14 : 13) * fontScale)} fontWeight={isFocus || isHovered ? "700" : "600"} fill="#0f172a" paintOrder="stroke" stroke="#f8fafc" strokeWidth="4" strokeLinejoin="round">
                    {label.length > 14 ? `${label.slice(0, 13)}…` : label}
                  </text>
                </g>;
              })}
            </g>
          </svg>
          {Math.abs(zoom - 1) > 0.02 && (
            <button
              type="button"
              onClick={() => setViewport({ zoom: 1, pan: { x: 0, y: 0 } })}
              className="absolute bottom-2 left-2 z-20 rounded border border-slate-300/90 bg-white/90 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-700 shadow-sm backdrop-blur-sm hover:bg-teal-50 hover:text-teal-900"
              title="Reset zoom & pan"
            >
              {Math.round(zoom * 100)}% · Reset
            </button>
          )}
        </div>
        <div
          aria-label="STRING network legend"
          className="mt-1 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-slate-200/80 bg-white/85 px-2.5 py-1.5 text-xs text-slate-700 backdrop-blur-sm"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-slate-900">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-600" />
              </span>
              Focus
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full border-[1.5px] border-teal-700 bg-teal-100" />
              ↑ Human ({summary.up})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full border-[1.5px] border-amber-700 bg-amber-100" />
              ↑ QC ({summary.down})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full border-[1.5px] border-slate-500 bg-slate-50" />
              NS ({summary.ns})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full border-[1.5px] border-dashed border-slate-400 bg-white" />
              Not eval ({summary.untested})
            </span>
            {candidateIds && (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border-[1.5px] border-orange-700 bg-white" />
                Match
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {summary.total > 0 && (
              <span className="inline-flex h-2 w-16 overflow-hidden rounded-full bg-slate-200" title={`Co-regulation mix across ${summary.total} neighbors`}>
                <span style={{ width: `${(summary.up / summary.total) * 100}%` }} className="bg-teal-700" />
                <span style={{ width: `${(summary.down / summary.total) * 100}%` }} className="bg-amber-600" />
                <span style={{ width: `${(summary.ns / summary.total) * 100}%` }} className="bg-slate-500" />
              </span>
            )}
            <span className="inline-flex items-center gap-1.5" title="Line style encodes STRING confidence">
              <svg width="46" height="10" aria-hidden="true" className="shrink-0">
                <line x1="0" y1="5" x2="12" y2="5" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 2" />
                <line x1="16" y1="5" x2="29" y2="5" stroke="#475569" strokeWidth="2.5" />
                <line x1="33" y1="5" x2="46" y2="5" stroke="#0f172a" strokeWidth="4" />
              </svg>
              <span>0.4 → 0.7 → 0.9+ · r = |FC|</span>
            </span>
          </div>
        </div>
        {inspectorHud}
      </>
    ) : viewMode === "matrix" ? (
      <div className="mt-1 flex-1 min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white" data-testid="network-matrix">
        <table className="border-collapse text-[11px] tabular-nums">
          <thead>
            <tr className="sticky top-0 z-20 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
              <th className="sticky left-0 z-30 min-w-[136px] bg-slate-50 px-2.5 py-1.5 text-left font-semibold text-slate-700">
                Node ({matrixNodes.length})
              </th>
              {matrixNodes.map(({ node }) => {
                const isHoveredCol = activeHover === node.protein_id;
                const shortLabel = (node.gene || node.protein_id).slice(0, 8);
                return (
                  <th
                    key={`col-${node.protein_id}`}
                    className={`h-16 w-7 min-w-[28px] p-0 align-bottom font-medium transition-colors ${isHoveredCol ? "bg-teal-50 text-teal-900" : "text-slate-600"}`}
                    onPointerEnter={() => { setHoveredNode(node.protein_id); onHoverProtein?.(node.protein_id); }}
                    onPointerLeave={() => { setHoveredNode(curr => curr === node.protein_id ? null : curr); onHoverProtein?.(null); }}
                    title={`${node.gene || node.protein_id} (${node.protein_id})`}
                  >
                    <button
                      type="button"
                      onClick={() => onChoose(node.protein_id)}
                      className="flex h-full w-full items-end justify-center pb-1 focus:outline-none"
                    >
                      <span className="inline-block origin-bottom-left -rotate-45 whitespace-nowrap text-[10px]">
                        {shortLabel}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th className="min-w-[130px] border-l border-slate-200 px-2 py-1.5 text-right font-semibold text-slate-700">
                log₂FC (Human − QC)
              </th>
            </tr>
          </thead>
          <tbody>
            {matrixNodes.map(({ node: rowNode, score: directScore }) => {
              const rowId = rowNode.protein_id;
              const isFocusRow = rowId === focus;
              const isHoveredRow = activeHover === rowId;
              const diff = resultsById.get(rowId);
              const dir = diff ? volcanoDirection(diff, pCutoff, fcCutoff) : null;
              const dotClass = dir === "up" ? "bg-teal-600" : dir === "down" ? "bg-amber-600" : dir === "ns" ? "bg-slate-400" : "border border-dashed border-slate-400 bg-white";
              const fcNorm = diff ? Math.min(1, Math.abs(diff.log2_fc) / 6) : 0;
              return (
                <tr
                  key={`row-${rowId}`}
                  className={`border-t border-slate-100 transition-colors ${isFocusRow ? "bg-teal-50/45" : isHoveredRow ? "bg-teal-50/35" : "hover:bg-slate-50/70"}`}
                  onPointerEnter={() => { setHoveredNode(rowId); onHoverProtein?.(rowId); }}
                  onPointerLeave={() => { setHoveredNode(curr => curr === rowId ? null : curr); onHoverProtein?.(null); }}
                >
                  <th className={`sticky left-0 z-10 border-r border-slate-200 px-2 py-1 text-left font-medium ${isFocusRow ? "bg-teal-50/95 text-teal-950" : isHoveredRow ? "bg-teal-50/90 text-teal-900" : "bg-white text-slate-800"}`}>
                    <button
                      type="button"
                      onClick={() => onChoose(rowId)}
                      className="flex w-full items-center gap-1.5 text-left"
                      title={`${rowNode.gene || rowId} (${rowId})`}
                    >
                      <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} />
                      <span className={`truncate max-w-[92px] ${isFocusRow ? "font-bold" : "font-semibold"}`}>
                        {rowNode.gene || rowId}
                      </span>
                      {isFocusRow && <span className="rounded bg-slate-900 px-1 text-[9px] font-bold text-white">F</span>}
                    </button>
                  </th>
                  {matrixNodes.map(({ node: colNode }) => {
                    const colId = colNode.protein_id;
                    if (rowId === colId) {
                      return <td key={`${rowId}-${colId}`} className="h-7 w-7 border border-slate-100 bg-slate-200/70" />;
                    }
                    const key = rowId < colId ? `${rowId}::${colId}` : `${colId}::${rowId}`;
                    const edgeScore = edgeScoreMap.get(key) ?? 0;
                    const cellCross = activeHover === rowId || activeHover === colId;
                    return (
                      <td
                        key={`${rowId}-${colId}`}
                        className={`h-7 w-7 border text-center text-[9.5px] font-semibold ${cellCross ? "border-teal-500/60" : "border-slate-100"}`}
                        style={
                          edgeScore > 0
                            ? {
                                backgroundColor: `rgba(15, 118, 110, ${(0.14 + edgeScore * 0.78).toFixed(2)})`,
                                color: edgeScore >= 0.68 ? "#ffffff" : "#0f172a",
                              }
                            : undefined
                        }
                        title={edgeScore > 0 ? `${rowNode.gene || rowId} ↔ ${colNode.gene || colId}: ${edgeScore.toFixed(3)}` : `${rowNode.gene || rowId} ↔ ${colNode.gene || colId}: none`}
                      >
                        {edgeScore > 0 ? edgeScore.toFixed(1) : ""}
                      </td>
                    );
                  })}
                  <td className="border-l border-slate-200 px-2 py-1">
                    {diff ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <span className={`w-11 text-right font-medium ${dir === "up" ? "text-teal-800" : dir === "down" ? "text-amber-800" : "text-slate-600"}`}>
                          {diff.log2_fc >= 0 ? "+" : ""}{diff.log2_fc.toFixed(2)}
                        </span>
                        <div className="relative h-2.5 w-16 overflow-hidden rounded bg-slate-100">
                          <div className="absolute inset-y-0 left-1/2 w-px bg-slate-300" />
                          <div
                            className={`absolute inset-y-0 rounded-sm ${dir === "up" ? "bg-teal-700" : dir === "down" ? "bg-amber-600" : "bg-slate-400"}`}
                            style={
                              diff.log2_fc >= 0
                                ? { left: "50%", width: `${Math.max(4, fcNorm * 50)}%` }
                                : { right: "50%", width: `${Math.max(4, fcNorm * 50)}%` }
                            }
                          />
                        </div>
                        {!isFocusRow && <span className="w-8 text-right text-[10px] text-slate-400">{directScore.toFixed(2)}</span>}
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5 text-[10px] text-slate-400">
                        <span>Not eval</span>
                        {!isFocusRow && <span className="w-8 text-right">{directScore.toFixed(2)}</span>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="mt-2 flex-1 min-h-0 space-y-1.5 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5" data-testid="network-ranked-bars">
        {rankedNeighbors.map(({ node, score }) => {
          const label = node.gene || node.protein_id;
          const diff = resultsById.get(node.protein_id);
          const dir = diff ? volcanoDirection(diff, pCutoff, fcCutoff) : null;
          const isCandidate = Boolean(candidateIds?.has(node.protein_id));
          const isHovered = activeHover === node.protein_id;
          const localPdb = LOCAL_STRUCTURE_PDB[node.protein_id];
          const barColor = dir === "up" ? "bg-teal-700" : dir === "down" ? "bg-amber-600" : dir === "ns" ? "bg-slate-400" : "bg-slate-300";
          return (
            <button
              key={node.protein_id}
              type="button"
              onClick={() => onChoose(node.protein_id)}
              onPointerEnter={() => { setHoveredNode(node.protein_id); onHoverProtein?.(node.protein_id); }}
              onPointerLeave={() => { setHoveredNode(curr => curr === node.protein_id ? null : curr); onHoverProtein?.(null); }}
              className={`w-full rounded border bg-white px-2.5 py-1.5 text-left text-xs transition-colors ${isHovered ? "border-teal-700 bg-teal-50/40" : isCandidate ? "border-orange-600" : "border-slate-200 hover:bg-teal-50/30"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">
                  {label} <span className="font-mono font-normal text-slate-500">({node.protein_id})</span>
                  {localPdb && <span className="ml-1.5 rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-900">3D:{localPdb}</span>}
                  {isCandidate && <span className="ml-1.5 rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-900">Candidate</span>}
                </span>
                <span className="tabular-nums text-slate-700">
                  <strong>{score.toFixed(3)}</strong>
                  {diff ? ` · FC ${diff.log2_fc.toFixed(2)} · p ${diff.adj_p.toExponential(1)}` : " · Not eval"}
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded bg-slate-100">
                <div className={`h-full rounded ${barColor} ${dir === null ? "border border-dashed border-slate-500" : ""}`} style={{ width: `${Math.max(4, Math.min(100, score * 100))}%` }} />
              </div>
            </button>
          );
        })}
      </div>
    )}
  </div>;
}
