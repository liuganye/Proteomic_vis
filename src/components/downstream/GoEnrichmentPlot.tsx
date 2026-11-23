"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  enrichGoTerms,
  GO_ASPECT_LABELS,
  resolveGoGene,
  type GoAspect,
  type GoDirectionFilter,
  type GoEnrichmentResult,
} from "@/lib/go-enrichment";
import type { VolcanoPoint } from "@/lib/types";

const ASPECT_COLORS: Record<GoAspect, string> = {
  BP: "#0f766e",
  MF: "#1d4ed8",
  CC: "#b45309",
};

const DEFAULT_ADJ_P = 0.05;

interface Props {
  points: VolcanoPoint[];
  contrastLabel: string;
  canCompare: boolean;
  ready: boolean;
  groupsAvailable: number;
  onSelectProteins?: (ids: string[]) => void;
}

type RankMode = "negLog10AdjP" | "enrichment";

export function GoEnrichmentPlot({
  points,
  contrastLabel,
  canCompare,
  ready,
  groupsAvailable,
  onSelectProteins,
}: Props) {
  const [aspect, setAspect] = useState<GoAspect | "all">("all");
  const [direction, setDirection] = useState<GoDirectionFilter>("significant");
  const [ranking, setRanking] = useState<RankMode>("negLog10AdjP");
  const [adjPCutoff, setAdjPCutoff] = useState(DEFAULT_ADJ_P);
  const [draggingLine, setDraggingLine] = useState(false);
  const [dragFrozenXMax, setDragFrozenXMax] = useState<number | null>(null);
  const dragAxisRef = useRef<{ left: number; width: number; xMax: number } | null>(null);
  const chartBoxRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GoEnrichmentResult | null>(null);

  const sigCounts = useMemo(() => {
    const sig = points.filter((p) => p.significant);
    return {
      significant: sig.length,
      up: points.filter((p) => p.direction === "up").length,
      down: points.filter((p) => p.direction === "down").length,
    };
  }, [points]);

  const proteinIdsForHitGenes = (hitGenes: string[]) => {
    const want = new Set(hitGenes.map((g) => g.toUpperCase()));
    const ids: string[] = [];
    for (const p of points) {
      const resolved = resolveGoGene(p);
      if (resolved.key && want.has(resolved.key.toUpperCase())) {
        ids.push(p.proteinId);
      }
    }
    return ids;
  };

  useEffect(() => {
    if (!canCompare || !ready) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    // Defer so the loading state paints; enrichment is sync but can hitch on large tables.
    const handle = window.setTimeout(() => {
      try {
        const next = enrichGoTerms(points, {
          aspect,
          direction,
          ranking,
          topN: 15,
          minHits: 2,
        });
        if (!cancelled) {
          setResult(next);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setResult(null);
          setError(
            err instanceof Error
              ? err.message
              : "GO enrichment failed unexpectedly.",
          );
          setLoading(false);
        }
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [points, aspect, direction, ranking, canCompare, ready]);

  const cutoffNegLog10 = useMemo(
    () => -Math.log10(Math.max(1e-20, Math.min(1, adjPCutoff))),
    [adjPCutoff],
  );

  const chartRows = useMemo(() => {
    if (!result) return [];
    // Recharts layout="vertical" renders index 0 at the top, so keep descending rank order.
    return result.terms.map((t) => ({
      ...t,
      label: t.name,
      score: ranking === "enrichment" ? t.enrichment : t.negLog10AdjP,
      passesCutoff: t.adjP <= adjPCutoff,
      barTag: `k=${t.k}`,
    }));
  }, [result, ranking, adjPCutoff]);

  const rowByLabel = useMemo(
    () => new Map(chartRows.map((r) => [r.label, r])),
    [chartRows],
  );

  // Measure the longest wrapped line so left GO term text is NEVER clipped at any panel width.
  const yAxisWidth = useMemo(() => {
    let maxLineChars = 16;
    for (const r of chartRows) {
      for (const line of wrapTermLines(r.label, 30)) {
        if (line.length > maxLineChars) maxLineChars = line.length;
      }
    }
    return Math.min(260, Math.max(180, Math.round(maxLineChars * 7.2 + 28)));
  }, [chartRows]);

  const sigTermCount = useMemo(
    () => chartRows.filter((r) => r.passesCutoff).length,
    [chartRows],
  );

  const xDomainMax = useMemo(() => {
    if (dragFrozenXMax !== null) return dragFrozenXMax;
    const maxDataScore = chartRows.reduce((m, r) => Math.max(m, r.score), 0);
    if (ranking === "negLog10AdjP") {
      return Number(Math.max(maxDataScore * 1.15, cutoffNegLog10 * 1.18, 2).toFixed(2));
    }
    return Number(Math.max(maxDataScore * 1.18, 1.5).toFixed(2));
  }, [chartRows, ranking, cutoffNegLog10, dragFrozenXMax]);

  const sliderMaxNegLog10 = useMemo(
    () => Math.max(4, Math.ceil(xDomainMax)),
    [xDomainMax],
  );

  const setCutoffFromNegLog10 = useCallback((negLog10: number) => {
    const clamped = Math.max(0, Math.min(20, negLog10));
    const rawP = 10 ** -clamped;
    setAdjPCutoff(roundSigP(rawP));
  }, []);

  const updateLineFromClientX = useCallback(
    (clientX: number) => {
      const info = dragAxisRef.current;
      if (!info || info.width <= 0) return;
      const frac = Math.max(0, Math.min(1, (clientX - info.left) / info.width));
      setCutoffFromNegLog10(frac * info.xMax);
    },
    [setCutoffFromNegLog10],
  );

  // Use window-level listeners during drag so Recharts SVG re-renders never drop pointer capture.
  useEffect(() => {
    if (!draggingLine) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      updateLineFromClientX(e.clientX);
    };
    const onEnd = () => {
      dragAxisRef.current = null;
      setDraggingLine(false);
      setDragFrozenXMax(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [draggingLine, updateLineFromClientX]);

  const handleLinePointerDown = useCallback(
    (e: React.PointerEvent<SVGGElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const grid = chartBoxRef.current?.querySelector(".recharts-cartesian-grid");
      const rect = grid?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      dragAxisRef.current = { left: rect.left, width: rect.width, xMax: xDomainMax };
      setDragFrozenXMax(xDomainMax);
      setDraggingLine(true);
      updateLineFromClientX(e.clientX);
    },
    [updateLineFromClientX, xDomainMax],
  );

  const isDefaultCutoff = Math.abs(adjPCutoff - DEFAULT_ADJ_P) < 1e-6;
  const xLabel =
    ranking === "enrichment" ? "Fold enrichment" : "−log10(GO adj.P)";

  return (
    <div>
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-slate-900">
            GO enrichment
          </h3>
          {contrastLabel && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {contrastLabel}
            </span>
          )}
        </div>
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer select-none hover:text-slate-700">
            Bundled human GOA ⓘ
          </summary>
          <p className="mt-1.5 max-w-md rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 leading-relaxed text-slate-600">
            Client-side hypergeometric test + BH FDR against a bundled human GOA
            table (~5k FragPipe human genes + curated mock symbols). Matches{" "}
            <code className="rounded bg-white px-1">Gene</code> first, then
            UniProt aliases. GO term adj.P is separate from volcano protein adj.P.
          </p>
        </details>
      </header>

      <div className="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">Aspect</span>
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-800"
            value={aspect}
            onChange={(e) => setAspect(e.target.value as GoAspect | "all")}
            aria-label="GO aspect"
          >
            {(Object.keys(GO_ASPECT_LABELS) as Array<GoAspect | "all">).map(
              (key) => (
                <option key={key} value={key}>
                  {GO_ASPECT_LABELS[key]}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">Set</span>
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-800"
            value={direction}
            onChange={(e) =>
              setDirection(e.target.value as GoDirectionFilter)
            }
            aria-label="Protein set for enrichment"
          >
            <option value="significant">
              Significant ({sigCounts.significant})
            </option>
            <option value="up">Up ({sigCounts.up})</option>
            <option value="down">Down ({sigCounts.down})</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">Rank</span>
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-800"
            value={ranking}
            onChange={(e) => setRanking(e.target.value as RankMode)}
            aria-label="GO term ranking"
          >
            <option value="negLog10AdjP">−log10(adj.P)</option>
            <option value="enrichment">Fold enrichment</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-1.5 border-l border-slate-200 pl-2.5">
          <label
            className="flex items-center gap-1.5 font-medium text-slate-700"
            htmlFor="go-adjp-cutoff-slider"
            title="Term-level BH FDR cutoff (independent of volcano protein adj.P)"
          >
            <span>GO adj.P ≤</span>
            <input
              id="go-adjp-cutoff-slider"
              type="range"
              min={0}
              max={sliderMaxNegLog10}
              step={0.05}
              value={Math.min(sliderMaxNegLog10, cutoffNegLog10)}
              onChange={(e) => setCutoffFromNegLog10(Number(e.target.value))}
              className="h-1.5 w-24 cursor-pointer accent-[#c45c56]"
              aria-label="GO significance adj.P cutoff"
            />
            <span className="w-11 tabular-nums font-semibold text-[#991b1b]">
              {formatAdjP(adjPCutoff)}
            </span>
          </label>
          <button
            type="button"
            disabled={isDefaultCutoff}
            onClick={() => setAdjPCutoff(DEFAULT_ADJ_P)}
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-default disabled:opacity-40"
            title="Reset GO significance threshold to 0.05"
          >
            Reset 0.05
          </button>
          {result && result.terms.length > 0 && (
            <span
              className={`rounded px-1.5 py-0.5 tabular-nums font-medium ${
                sigTermCount > 0
                  ? "border border-[#e8ae9e] bg-[#fff5f5] text-[#991b1b]"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {sigTermCount}/{chartRows.length} sig
            </span>
          )}
        </div>
      </div>

      {!canCompare || !ready ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
          {groupsAvailable < 2
            ? "Need at least two condition/group labels that map to MaxLFQ samples to build a contrast for GO enrichment."
            : "Select two different groups (Group A ≠ Group B) to enrich significant proteins from that contrast."}
        </p>
      ) : loading ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
          Computing GO enrichment…
        </p>
      ) : error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-6 text-center text-sm text-rose-900">
          {error}
        </p>
      ) : !result || result.annotatedForeground === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm text-slate-600">
          {sigCounts[direction === "significant" ? "significant" : direction] ===
          0 ? (
            <p>
              No {direction === "significant" ? "significant" : direction}{" "}
              proteins at current thresholds.
            </p>
          ) : (
            <>
              <p>
                None of the {direction} proteins map to the bundled GO table for{" "}
                {GO_ASPECT_LABELS[aspect]}.
              </p>
              <p className="mt-1.5 text-xs text-slate-500">
                Unmapped: {result?.unmappedForeground.length ?? sigCounts[direction === "significant" ? "significant" : direction]}
                {result && result.annotatedBackground > 0
                  ? ` · BG annotated ${result.annotatedBackground}`
                  : ""}
                {" · "}Try “All aspects” or broaden selection.
              </p>
            </>
          )}
        </div>
      ) : result.terms.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm text-slate-600">
          <p>
            {result.annotatedForeground} annotated foreground gene(s) (BG{" "}
            {result.annotatedBackground}), but no GO term reached ≥2 hits.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Switch to “All aspects” or broaden volcano selection.
          </p>
        </div>
      ) : (
        <>
          {/* Protect the full left GO term column; on narrow panels only the right bar side clips/scrolls. */}
          <div className="max-w-full overflow-x-auto">
            <div
              ref={chartBoxRef}
              className={`w-full ${draggingLine ? "select-none cursor-ew-resize" : ""}`}
              style={{
                minWidth: yAxisWidth + 190,
                height: Math.max(260, chartRows.length * 36 + 68),
              }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={chartRows}
                  margin={{ top: 26, right: 44, bottom: 26, left: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e2e8f0"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    domain={[0, xDomainMax]}
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    label={{
                      value: xLabel,
                      position: "insideBottom",
                      offset: -6,
                      style: { fontSize: 11, fill: "#64748b" },
                    }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={yAxisWidth}
                    interval={0}
                    tickLine={false}
                    axisLine={{ stroke: "#cbd5e1" }}
                    tick={(tickProps: { x?: number | string; y?: number | string; payload?: { value?: string } }) => {
                      const tx = Number(tickProps.x ?? 0);
                      const ty = Number(tickProps.y ?? 0);
                      const labelVal = tickProps.payload?.value ?? "";
                      const row = rowByLabel.get(labelVal);
                      const sig = row?.passesCutoff ?? false;
                      const dotColor = row ? ASPECT_COLORS[row.aspect] : "#64748b";
                      const lines = wrapTermLines(labelVal, 30);
                      const startDy = lines.length === 1 ? 4 : -2;
                      return (
                        <g transform={`translate(${tx},${ty})`}>
                          <circle
                            cx={-6}
                            cy={0}
                            r={3.2}
                            fill={dotColor}
                            fillOpacity={sig ? 1 : 0.45}
                          />
                          <text
                            x={-14}
                            y={0}
                            textAnchor="end"
                            fontSize={11.5}
                            fontWeight={sig ? 600 : 400}
                            fill={sig ? "#0f172a" : "#64748b"}
                          >
                            {lines.map((line, i) => (
                              <tspan
                                key={i}
                                x={-14}
                                dy={i === 0 ? startDy : 13}
                              >
                                {line}
                              </tspan>
                            ))}
                          </text>
                        </g>
                      );
                    }}
                  />
                  <Tooltip
                    wrapperStyle={{ pointerEvents: "none" }}
                    content={({ payload }) => {
                      if (draggingLine) return null;
                      const row = payload?.[0]?.payload as
                        | (typeof chartRows)[number]
                        | undefined;
                      if (!row) return null;
                      return (
                        <div className="max-w-xs rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                          <div className="font-semibold text-slate-900">
                            {row.name}
                          </div>
                          <div className="text-slate-500">
                            {row.id} · {GO_ASPECT_LABELS[row.aspect]}
                          </div>
                          <div className="mt-1">
                            Hits: <strong>{row.k}/{row.n}</strong> (BG {row.K}/{row.N}) ·{" "}
                            {row.enrichment.toFixed(2)}×
                          </div>
                          <div>
                            GO adj.P: <strong>{row.adjP.toExponential(2)}</strong>{" "}
                            (p={row.pValue.toExponential(2)})
                          </div>
                          <div className="mt-1 text-slate-600">
                            Genes: {row.hitGenes.join(", ")}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="score"
                    name={xLabel}
                    barSize={16}
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={false}
                    cursor={onSelectProteins ? "pointer" : undefined}
                    onClick={(data) => {
                      const row = data as unknown as (typeof chartRows)[number];
                      if (!row?.hitGenes || !onSelectProteins) return;
                      onSelectProteins(proteinIdsForHitGenes(row.hitGenes));
                    }}
                  >
                    {chartRows.map((row) => (
                      <Cell
                        key={row.id}
                        fill={ASPECT_COLORS[row.aspect]}
                        fillOpacity={row.passesCutoff ? 0.92 : 0.35}
                      />
                    ))}
                    <LabelList
                      dataKey="barTag"
                      position="right"
                      offset={6}
                      style={{ fontSize: 10.5, fill: "#475569", fontWeight: 500 }}
                    />
                  </Bar>
                  {ranking === "negLog10AdjP" && (
                    <ReferenceLine
                      x={cutoffNegLog10}
                      stroke={draggingLine ? "#b91c1c" : "#c45c56"}
                      strokeWidth={draggingLine ? 2.5 : 1.75}
                      strokeDasharray="5 4"
                      label={(props: { viewBox?: { x?: number; y?: number; height?: number } }) => {
                        const vx = props.viewBox?.x ?? 0;
                        const vy = props.viewBox?.y ?? 0;
                        const vh = props.viewBox?.height ?? 0;
                        if (vh <= 0) return <g />;
                        const badgeW = 86;
                        const badgeH = 19;
                        const badgeX = vx - badgeW / 2;
                        const badgeY = Math.max(2, vy - badgeH - 4);
                        return (
                          <g
                            role="slider"
                            aria-label="Drag GO adj.P significance threshold line"
                            aria-valuemin={0}
                            aria-valuemax={20}
                            aria-valuenow={Number(cutoffNegLog10.toFixed(2))}
                            style={{ cursor: "ew-resize" }}
                            onPointerDown={handleLinePointerDown}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setAdjPCutoff(DEFAULT_ADJ_P);
                            }}
                          >
                            <title>
                              Drag left/right to adjust GO adj.P cutoff ({formatAdjP(adjPCutoff)}) · Double-click to reset to 0.05
                            </title>
                            <rect x={vx - 10} y={vy} width={20} height={vh} fill="transparent" />
                            <rect
                              x={badgeX}
                              y={badgeY}
                              width={badgeW}
                              height={badgeH}
                              rx={9.5}
                              fill={draggingLine ? "#b91c1c" : "#fff5f5"}
                              stroke="#c45c56"
                              strokeWidth={1.25}
                            />
                            <text
                              x={vx}
                              y={badgeY + 13}
                              textAnchor="middle"
                              fontSize={10.5}
                              fontWeight={600}
                              fill={draggingLine ? "#ffffff" : "#991b1b"}
                              style={{ userSelect: "none", pointerEvents: "none" }}
                            >
                              ↔ p≤{formatAdjP(adjPCutoff)}
                            </text>
                          </g>
                        );
                      }}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
              <li className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: ASPECT_COLORS.BP }} />
                Biological Process
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: ASPECT_COLORS.MF }} />
                Molecular Function
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: ASPECT_COLORS.CC }} />
                Cellular Component
              </li>
              <li>
                FG {result.annotatedForeground} / BG {result.annotatedBackground}
              </li>
              <li>Click bar to focus gene</li>
            </ul>
            {result.unmappedForeground.length > 0 && (
              <details className="text-right">
                <summary className="cursor-pointer select-none hover:text-slate-700">
                  Unmapped: {result.unmappedForeground.length}
                </summary>
                <p className="mt-1 max-w-sm text-left text-[11px] text-slate-500">
                  {result.unmappedForeground.slice(0, 24).join(", ")}
                  {result.unmappedForeground.length > 24 ? "…" : ""}
                </p>
              </details>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Wrap long GO term names into at most 2 clean lines so SVG Y-axis text is never clipped on the left. */
function wrapTermLines(name: string, maxCharsPerLine: number): string[] {
  if (name.length <= maxCharsPerLine) return [name];
  const words = name.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (current.length + 1 + w.length <= maxCharsPerLine) {
      current = `${current} ${w}`;
    } else {
      lines.push(current);
      current = w;
      if (lines.length === 1) break;
    }
  }
  if (lines.length === 0) return [name];
  const used = lines[0].length;
  const rest = name.slice(used).trim();
  if (!rest) return lines;
  return [
    lines[0],
    rest.length <= maxCharsPerLine + 2 ? rest : `${rest.slice(0, maxCharsPerLine + 1)}…`,
  ];
}

function roundSigP(p: number): number {
  const clamped = Math.max(1e-20, Math.min(1, p));
  if (clamped >= 0.1) return Math.round(clamped * 100) / 100;
  if (clamped >= 0.01) return Math.round(clamped * 1000) / 1000;
  return Number(clamped.toPrecision(2));
}

function formatAdjP(p: number): string {
  if (p >= 0.01) return p.toFixed(2).replace(/0$/, "");
  if (p >= 0.001) return p.toFixed(3);
  return p.toExponential(0);
}
