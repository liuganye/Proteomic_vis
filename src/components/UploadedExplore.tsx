"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnalysisWorkspace } from "./AnalysisWorkspace";
import { RealVolcanoPlot } from "./RealVolcanoPlot";
import { RealResultsTable } from "./RealResultsTable";
import { ProteinAbundance } from "./ProteinAbundance";
import { ProteinStructure } from "./ProteinStructure";
import { GoEnrichmentPlot } from "./downstream/GoEnrichmentPlot";
import { NetworkGraph, type NetworkGraphData } from "./RealExplore";
import { annotationGroups, defaultGroupPair, volcanoForGroups } from "@/lib/stats";
import {
  filterRealResults,
  inVolcanoBrush,
  passesVolcanoFilters,
  RESULT_PAGE_SIZE,
  type ExploreState,
  type RealResult,
} from "@/lib/visualization";
import type { WorkspaceModuleId } from "@/lib/workspace-layout";
import type { FragPipeDataset, SampleSelectionProps, VolcanoPoint } from "@/lib/types";

export function UploadedExplore({
  dataset,
  selectedSamples,
  onSelectSamples,
  analysis,
  setAnalysis,
  selectedProteinIds,
  onSelectProteins,
  onReturnQc,
}: {
  dataset: FragPipeDataset;
  analysis: ExploreState;
  setAnalysis: (state: ExploreState) => void;
  selectedProteinIds: string[];
  onSelectProteins: (ids: string[]) => void;
  onReturnQc: () => void;
} & SampleSelectionProps) {
  const groups = useMemo(() => annotationGroups(dataset), [dataset]);
  const { groupA: defaultA, groupB: defaultB } = useMemo(
    () => defaultGroupPair(groups),
    [groups],
  );
  const [groupAOverride, setGroupAOverride] = useState<string | null>(null);
  const [groupBOverride, setGroupBOverride] = useState<string | null>(null);
  const groupA = groupAOverride && groups.includes(groupAOverride) ? groupAOverride : defaultA;
  const groupB = groupBOverride && groups.includes(groupBOverride) ? groupBOverride : defaultB;

  const [reveal, setReveal] = useState<{ id: WorkspaceModuleId; token: number } | null>(null);
  const openPanel = (id: WorkspaceModuleId) =>
    setReveal((prev) => ({ id, token: (prev?.token ?? 0) + 1 }));

  const { pCutoff, fcCutoff } = analysis;
  const updateAnalysis = (patch: Partial<ExploreState>) =>
    setAnalysis({ ...analysis, ...patch });

  // Compute differential results (limma if present, otherwise Welch t-test + BH FDR).
  const contrastData = useMemo(
    () =>
      volcanoForGroups(dataset, groupA, groupB, {
        log2fcThreshold: fcCutoff,
        adjPThreshold: pCutoff,
      }),
    [dataset, groupA, groupB, fcCutoff, pCutoff],
  );

  const proteinById = useMemo(
    () => new Map(dataset.proteins.map((p) => [p.proteinId, p])),
    [dataset.proteins],
  );

  const realResults = useMemo<
    (RealResult & { p_value: number; significant: boolean })[]
  >(
    () =>
      contrastData.points.map((pt) => ({
        protein_id: pt.proteinId,
        gene: pt.gene || null,
        organism: "Homo sapiens",
        log2_fc: pt.log2fc,
        p_value: pt.adjP,
        adj_p: pt.adjP,
        significant: passesVolcanoFilters({ log2_fc: pt.log2fc, adj_p: pt.adjP }, pCutoff, fcCutoff),
      })),
    [contrastData.points, pCutoff, fcCutoff],
  );

  const defaultFocus = useMemo(() => {
    if (realResults.length === 0) return dataset.proteins[0]?.proteinId ?? "";
    const sorted = realResults
      .slice()
      .sort((a, b) => a.adj_p - b.adj_p || Math.abs(b.log2_fc) - Math.abs(a.log2_fc));
    return sorted[0]?.protein_id ?? dataset.proteins[0]?.proteinId ?? "";
  }, [realResults, dataset.proteins]);

  const [focusOverride, setFocusOverride] = useState<string>("");
  const focus = focusOverride && proteinById.has(focusOverride) ? focusOverride : defaultFocus;
  const [sharedHoverId, setSharedHoverId] = useState<string | null>(null);
  const [focusHistory, setFocusHistory] = useState<string[]>([]);
  const [scoreCutoff, setScoreCutoff] = useState(0.4);
  const [networkResponse, setNetworkResponse] = useState<{
    focus: string;
    cutoff: number;
    data: NetworkGraphData;
  } | null>(null);
  const [networkFailure, setNetworkFailure] = useState<{
    focus: string;
    cutoff: number;
    message: string;
  } | null>(null);

  const geneToProtein = useMemo(() => {
    const map = new Map<string, (typeof dataset.proteins)[number]>();
    for (const p of dataset.proteins) {
      const g = (p.gene || "").trim().toUpperCase();
      if (g && !map.has(g)) map.set(g, p);
    }
    return map;
  }, [dataset]);

  const resultsById = useMemo(
    () => new Map(realResults.map((r) => [r.protein_id, r])),
    [realResults],
  );

  useEffect(() => {
    if (!focus) return;
    setFocusHistory((prev) =>
      prev[prev.length - 1] === focus ? prev : [...prev, focus].slice(-8),
    );
  }, [focus]);

  // Fetch live STRING interaction neighborhood and keep only partners actually detected in the current dataset.
  useEffect(() => {
    const prot = proteinById.get(focus);
    if (!prot) return;
    const queryId = (prot.gene || prot.proteinId.split("-")[0]).trim();
    if (!queryId) return;
    const controller = new AbortController();
    setNetworkFailure(null);
    fetch(
      `/api/string-network?identifier=${encodeURIComponent(queryId)}&species=9606&score_cutoff=${scoreCutoff}&limit=100`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`STRING lookup failed (${res.status})`);
        return (await res.json()) as {
          query: string;
          partners: { gene: string; score: number }[];
          interEdges: { source: string; target: string; score: number }[];
        };
      })
      .then((raw) => {
        if (controller.signal.aborted) return;
        const centerId = prot.proteinId;
        const centerGene = (prot.gene || raw.query || centerId).trim();
        const geneToNodeId = new Map<string, string>([
          [centerGene.toUpperCase(), centerId],
          [raw.query.toUpperCase(), centerId],
        ]);
        const nodes: NetworkGraphData["nodes"] = [
          {
            protein_id: centerId,
            gene: centerGene,
            organism: "Homo sapiens",
            description: prot.description || "",
          },
        ];
        // Strictly retain only partners present in the current dataset (sorted by STRING score, capped at 18 for readability).
        const inDatasetPartners = raw.partners
          .filter((p) => {
            const matched = geneToProtein.get(p.gene.toUpperCase());
            return Boolean(matched && matched.proteinId !== centerId);
          })
          .sort((a, b) => b.score - a.score);
        const visiblePartners = inDatasetPartners.slice(0, 18);
        const seenNodes = new Set<string>([centerId]);
        for (const partner of visiblePartners) {
          const gKey = partner.gene.toUpperCase();
          const matched = geneToProtein.get(gKey)!;
          const nodeId = matched.proteinId;
          geneToNodeId.set(gKey, nodeId);
          if (seenNodes.has(nodeId)) continue;
          seenNodes.add(nodeId);
          nodes.push({
            protein_id: nodeId,
            gene: matched.gene || partner.gene,
            organism: "Homo sapiens",
            description: matched.description || "",
          });
        }

        const edgeSeen = new Set<string>();
        const edges: NetworkGraphData["edges"] = [];
        const addEdge = (a: string, b: string, score: number) => {
          if (!a || !b || a === b) return;
          const k = a < b ? `${a}|${b}` : `${b}|${a}`;
          if (edgeSeen.has(k)) return;
          edgeSeen.add(k);
          edges.push({ source: a, target: b, score });
        };

        for (const partner of visiblePartners) {
          const targetId = geneToNodeId.get(partner.gene.toUpperCase());
          if (targetId) addEdge(centerId, targetId, partner.score);
        }
        for (const e of raw.interEdges) {
          const sId = geneToNodeId.get(e.source.toUpperCase());
          const tId = geneToNodeId.get(e.target.toUpperCase());
          if (sId && tId) addEdge(sId, tId, e.score);
        }

        setNetworkResponse({
          focus,
          cutoff: scoreCutoff,
          data: {
            nodes,
            edges,
            total_neighbors: inDatasetPartners.length,
            truncated: inDatasetPartners.length > visiblePartners.length,
          },
        });

        // Stage 2 (non-blocking): fetch neighbor-to-neighbor chords among the visible in-dataset nodes.
        if (visiblePartners.length >= 2) {
          const chordGenes = [centerGene, ...visiblePartners.map((p) => p.gene)].join(",");
          fetch(
            `/api/string-network?chords_for=${encodeURIComponent(chordGenes)}&species=9606&score_cutoff=${scoreCutoff}`,
            { signal: controller.signal },
          )
            .then((r) => (r.ok ? r.json() : null))
            .then((chordData: { interEdges?: { source: string; target: string; score: number }[] } | null) => {
              if (controller.signal.aborted || !chordData?.interEdges?.length) return;
              const mergedEdges = [...edges];
              const mergedSeen = new Set(edgeSeen);
              for (const e of chordData.interEdges) {
                const sId = geneToNodeId.get(e.source.toUpperCase());
                const tId = geneToNodeId.get(e.target.toUpperCase());
                if (!sId || !tId || sId === tId) continue;
                const k = sId < tId ? `${sId}|${tId}` : `${tId}|${sId}`;
                if (mergedSeen.has(k)) continue;
                mergedSeen.add(k);
                mergedEdges.push({ source: sId, target: tId, score: e.score });
              }
              if (mergedEdges.length === edges.length) return;
              setNetworkResponse((prev) =>
                prev && prev.focus === focus && prev.cutoff === scoreCutoff
                  ? { ...prev, data: { ...prev.data, edges: mergedEdges } }
                  : prev,
              );
            })
            .catch(() => {
              // Keep primary star edges if chord fetch fails.
            });
        }
      })
      .catch((err) => {
        if (err?.name === "AbortError" || controller.signal.aborted) return;
        setNetworkFailure({
          focus,
          cutoff: scoreCutoff,
          message: "Could not load STRING interactions. Check network connection and try again.",
        });
      });
    return () => controller.abort();
  }, [focus, scoreCutoff, proteinById, geneToProtein]);

  const network =
    networkResponse?.focus === focus && networkResponse.cutoff === scoreCutoff
      ? networkResponse.data
      : null;
  const activeNetwork = networkResponse?.data ?? null;
  const activeNetworkFocus = networkResponse?.focus ?? focus;
  const networkError =
    networkFailure?.focus === focus && networkFailure.cutoff === scoreCutoff
      ? networkFailure.message
      : "";
  const networkLoading = !network && !networkError;
  const networkNeighborIds = useMemo(
    () =>
      new Set(
        (network?.nodes ?? [])
          .filter((n) => n.protein_id !== focus && proteinById.has(n.protein_id))
          .map((n) => n.protein_id),
      ),
    [network, focus, proteinById],
  );

  const rows = useMemo(() => filterRealResults(realResults, analysis), [realResults, analysis]);
  const matchingIds = useMemo(() => new Set(rows.map((r) => r.protein_id)), [rows]);
  const hasFilters = analysis.brush !== null || analysis.query.trim() !== "" || analysis.passingOnly;

  const choose = (id: string) => {
    setSharedHoverId(null);
    setFocusOverride(id);
    const index = rows.findIndex((r) => r.protein_id === id);
    if (index >= 0) updateAnalysis({ page: Math.floor(index / RESULT_PAGE_SIZE) });
  };

  const navigateHistory = (index: number) => {
    const targetId = focusHistory[index];
    if (!targetId) return;
    setFocusHistory((prev) => prev.slice(0, index + 1));
    choose(targetId);
  };

  // Link volcano brush directly into GO enrichment foreground.
  const goPoints = useMemo<VolcanoPoint[]>(() => {
    const brush = analysis.brush;
    return contrastData.points.map((pt) => {
      const sig = brush
        ? inVolcanoBrush({ log2_fc: pt.log2fc, adj_p: pt.adjP }, brush)
        : passesVolcanoFilters({ log2_fc: pt.log2fc, adj_p: pt.adjP }, pCutoff, fcCutoff);
      const direction: VolcanoPoint["direction"] = sig ? (pt.log2fc >= 0 ? "up" : "down") : "ns";
      return {
        ...pt,
        significant: sig,
        direction,
      };
    });
  }, [contrastData.points, analysis.brush, pCutoff, fcCutoff]);

  const brushedGoCount = useMemo(
    () => (analysis.brush ? goPoints.filter((p) => p.significant).length : 0),
    [analysis.brush, goPoints],
  );

  // Build sample abundance points for the focused protein directly from uploaded MaxLFQ.
  const sampleCondition = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of dataset.annotation) {
      if (a.sample) map.set(a.sample, a.condition);
      if (a.sampleName) map.set(a.sampleName, a.condition);
    }
    return map;
  }, [dataset.annotation]);

  const focusedProtein = proteinById.get(focus) ?? null;
  const focusedResult = useMemo(
    () => realResults.find((r) => r.protein_id === focus) ?? null,
    [realResults, focus],
  );

  const abundance = useMemo(() => {
    if (!focusedProtein) return { points: [] };
    return {
      points: dataset.samples.map((sampleId) => {
        const raw = focusedProtein.maxlfq[sampleId] ?? 0;
        return {
          sample_id: sampleId,
          display_group: sampleCondition.get(sampleId) ?? "Unassigned",
          log2_intensity: raw > 0 && Number.isFinite(raw) ? Math.log2(raw) : null,
        };
      }),
    };
  }, [focusedProtein, dataset.samples, sampleCondition]);

  const canCompare = Boolean(groupA && groupB && groupA !== groupB);
  const cleanAccession = (focusedProtein?.proteinId ?? "").split("-")[0].trim();
  const displayGene = focusedProtein?.gene || focusedProtein?.proteinId || "—";

  const panels: Record<WorkspaceModuleId, ReactNode> = {
    volcano: canCompare ? (
      <RealVolcanoPlot
        points={realResults}
        focus={focus}
        onChoose={choose}
        pCutoff={pCutoff}
        fcCutoff={fcCutoff}
        setPCutoff={(v) => updateAnalysis({ pCutoff: v, page: 0 })}
        setFcCutoff={(v) => updateAnalysis({ fcCutoff: v, page: 0 })}
        brush={analysis.brush}
        onBrush={(brush) => updateAnalysis({ brush, page: 0 })}
        matchingIds={matchingIds}
        hasFilters={hasFilters}
        onViewResults={() => openPanel("results")}
        hoveredProteinId={sharedHoverId}
        onHoverProtein={setSharedHoverId}
        networkNeighborIds={networkNeighborIds}
        selectedSamples={selectedSamples}
        focusedAbundance={abundance.points}
        onOpenPanel={openPanel}
        groupALabel={groupA}
        groupBLabel={groupB}
      />
    ) : (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-600">
        Select two different groups (Group A ≠ Group B) above to view the volcano plot.
      </div>
    ),
    results: (
      <RealResultsTable
        rows={rows}
        testedCount={realResults.length}
        brushedCount={analysis.brush ? realResults.filter((p) => inVolcanoBrush(p, analysis.brush!)).length : 0}
        state={analysis}
        update={updateAnalysis}
        focus={focus}
        focusIsTested={realResults.some((r) => r.protein_id === focus)}
        onChoose={choose}
      />
    ),
    abundance: focusedProtein ? (
      <ProteinAbundance
        abundance={abundance}
        selectedSamples={selectedSamples}
        onSelectSamples={onSelectSamples}
        proteinLabel={displayGene}
        proteinId={focusedProtein.proteinId}
      />
    ) : (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">
        Select a protein in the volcano plot or results table to inspect sample abundance.
      </div>
    ),
    go: (
      <div className="flex-1 min-h-0 overflow-auto p-3">
        {analysis.brush && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs text-teal-900">
            <span>
              Enriching <strong>{brushedGoCount.toLocaleString()}</strong> proteins from volcano box selection (background {realResults.length.toLocaleString()}).
            </span>
            <button
              type="button"
              onClick={() => updateAnalysis({ brush: null, page: 0 })}
              className="rounded border border-teal-300 bg-white px-2 py-0.5 font-medium text-teal-900 hover:bg-teal-100"
            >
              Clear box
            </button>
          </div>
        )}
        <GoEnrichmentPlot
          points={goPoints}
          contrastLabel={
            analysis.brush
              ? `${groupA} vs ${groupB} (volcano box)`
              : `${groupA} vs ${groupB}`
          }
          canCompare={canCompare}
          ready={contrastData.ready}
          groupsAvailable={groups.length}
          onSelectProteins={(ids) => {
            if (ids.length > 0) {
              setFocusOverride(ids[0]);
              onSelectProteins(ids);
            }
          }}
        />
      </div>
    ),
    details: focusedProtein ? (
      <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-auto p-3 text-xs text-slate-700">
        <div>
          <div className="text-base font-semibold text-slate-900">{displayGene}</div>
          <div className="font-mono text-slate-500">{focusedProtein.proteinId}</div>
          {focusedProtein.description && (
            <p className="mt-1 leading-relaxed text-slate-600">{focusedProtein.description}</p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <div>
            <dt className="text-slate-500">log₂FC ({groupA} − {groupB})</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
              {focusedResult ? focusedResult.log2_fc.toFixed(2) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">adj.P (BH FDR)</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
              {focusedResult ? focusedResult.adj_p.toExponential(2) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Detected samples</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
              {abundance.points.filter((p) => p.log2_intensity !== null).length} / {dataset.samples.length}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Protein probability</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
              {focusedProtein.proteinProbability != null
                ? focusedProtein.proteinProbability.toFixed(4)
                : "—"}
            </dd>
          </div>
        </dl>
        {cleanAccession && (
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://www.uniprot.org/uniprotkb/${encodeURIComponent(cleanAccession)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-teal-800 hover:bg-teal-50"
            >
              UniProt ↗
            </a>
            <a
              href={`https://alphafold.ebi.ac.uk/entry/${encodeURIComponent(cleanAccession)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-teal-800 hover:bg-teal-50"
            >
              AlphaFold 3D ↗
            </a>
            <a
              href={`https://string-db.org/cgi/network?identifiers=${encodeURIComponent(focusedProtein.gene || cleanAccession)}&species=9606`}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-teal-800 hover:bg-teal-50"
            >
              STRING ↗
            </a>
          </div>
        )}
      </div>
    ) : (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-slate-500">
        No focused protein.
      </div>
    ),
    network: (
      <section className="flex flex-1 min-h-0 min-w-0 flex-col" aria-labelledby="uploaded-network-heading">
        <h3 id="uploaded-network-heading" className="sr-only">STRING network</h3>
        {networkError && !activeNetwork ? (
          <div className="p-4 text-sm text-rose-800">{networkError}</div>
        ) : !activeNetwork ? (
          <p className="p-4 text-sm text-slate-600">Loading STRING neighborhood for {displayGene}…</p>
        ) : (
          <NetworkGraph
            network={activeNetwork}
            focus={network ? focus : activeNetworkFocus}
            isUpdating={networkLoading}
            onChoose={choose}
            candidateIds={hasFilters ? matchingIds : undefined}
            resultsById={resultsById}
            pCutoff={pCutoff}
            fcCutoff={fcCutoff}
            scoreCutoff={scoreCutoff}
            onScoreCutoffChange={setScoreCutoff}
            focusHistory={focusHistory.length ? focusHistory : [focus]}
            onNavigateHistory={navigateHistory}
            hoveredProteinId={sharedHoverId}
            onHoverProtein={setSharedHoverId}
            selectedSamples={selectedSamples}
            focusedAbundance={abundance.points}
            onOpenPanel={openPanel}
            groupALabel={groupA}
            groupBLabel={groupB}
          />
        )}
      </section>
    ),
    structure: cleanAccession ? (
      <ProteinStructure
        key={cleanAccession}
        proteinId={cleanAccession}
        references={[]}
        structureEndpoint="/api/protein-structure"
      />
    ) : (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-slate-500">
        Select a protein with a UniProt accession to view its 3D structure.
      </div>
    ),
  };

  return (
    <div>
      <AnalysisWorkspace
        reveal={reveal}
        context={
          <div
            className="flex flex-wrap items-center gap-2.5 text-xs text-teal-950"
            role="region"
            aria-label="Uploaded dataset contrast and selection controls"
          >
            <span className="rounded bg-teal-50 px-2 py-0.5 font-semibold text-teal-900 border border-teal-200">
              {dataset.source === "real"
                ? "Real sample · CCND1 AP-MS"
                : dataset.proteinFileName ?? "Uploaded TSV"}
            </span>
            <label className="flex items-center gap-1">
              <span className="text-slate-500">Group A</span>
              <select
                aria-label="Contrast group A"
                value={groupA}
                onChange={(e) => {
                  setGroupAOverride(e.target.value);
                  updateAnalysis({ brush: null, page: 0 });
                }}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-800"
              >
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-slate-400">vs</span>
            <label className="flex items-center gap-1">
              <span className="text-slate-500">Group B</span>
              <select
                aria-label="Contrast group B"
                value={groupB}
                onChange={(e) => {
                  setGroupBOverride(e.target.value);
                  updateAnalysis({ brush: null, page: 0 });
                }}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-800"
              >
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
              {contrastData.approximated ? "Welch t-test + BH FDR" : "Limma DE"}
            </span>
            <span className="border-l border-slate-200 pl-2 text-slate-600">
              Focus: <strong className="text-slate-900">{displayGene}</strong>
            </span>
            {selectedProteinIds.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900">
                QC scope: {selectedProteinIds.length}
                <button
                  type="button"
                  onClick={() => onSelectProteins([])}
                  className="ml-0.5 font-semibold hover:underline"
                  title="Clear QC protein selection"
                >
                  ×
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={onReturnQc}
              className="ml-auto rounded border border-slate-300 bg-white px-2 py-0.5 text-slate-700 hover:bg-slate-50"
            >
              ← QC
            </button>
          </div>
        }
        renderPanel={(id) => panels[id]}
      />
    </div>
  );
}
