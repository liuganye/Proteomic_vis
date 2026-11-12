"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  enrichGoTerms,
  GO_ASPECT_LABELS,
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

interface Props {
  points: VolcanoPoint[];
  contrastLabel: string;
  canCompare: boolean;
  ready: boolean;
  groupsAvailable: number;
}

type RankMode = "negLog10AdjP" | "enrichment";

export function GoEnrichmentPlot({
  points,
  contrastLabel,
  canCompare,
  ready,
  groupsAvailable,
}: Props) {
  const [aspect, setAspect] = useState<GoAspect | "all">("BP");
  const [direction, setDirection] = useState<GoDirectionFilter>("significant");
  const [ranking, setRanking] = useState<RankMode>("negLog10AdjP");
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

  const chartRows = useMemo(() => {
    if (!result) return [];
    // Recharts horizontal bars: reverse so top-ranked sits at the top.
    return [...result.terms]
      .reverse()
      .map((t) => ({
        ...t,
        label: truncateLabel(t.name, 42),
        score:
          ranking === "enrichment" ? t.enrichment : t.negLog10AdjP,
      }));
  }, [result, ranking]);

  const xLabel =
    ranking === "enrichment" ? "Fold enrichment" : "−log10(adj.P)";

  return (
    <div>
      <header className="mb-3">
        <h3 className="text-lg font-semibold text-slate-900">
          GO enrichment
        </h3>
        <p className="text-sm text-slate-600">
          Horizontal bar chart of enriched Gene Ontology terms among significant
          proteins for{" "}
          <span className="font-medium text-slate-800">
            {contrastLabel || "—"}
          </span>
          . Terms ranked by {ranking === "enrichment" ? "fold enrichment" : "−log10(adj.P)"}{" "}
          (hypergeometric test + BH FDR). Uses the same Group A / B and
          thresholds as Volcano / Results.
        </p>
      </header>

      <p className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
        <strong className="font-medium text-slate-800">Demo mapping:</strong>{" "}
        enrichment runs client-side against a bundled gene→GO table (mock genes +
        common pathway symbols), not a full UniProt/GOA database. Uploaded IDs
        match on the FragPipe <code className="rounded bg-white px-1">Gene</code>{" "}
        column (case-insensitive). Unmapped significant genes are listed below
        the chart. Not a substitute for clusterProfiler / g:Profiler / DAVID.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-slate-600">GO aspect</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1"
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
        <label className="flex flex-col gap-1">
          <span className="text-slate-600">Protein set</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1"
            value={direction}
            onChange={(e) =>
              setDirection(e.target.value as GoDirectionFilter)
            }
            aria-label="Protein set for enrichment"
          >
            <option value="significant">
              Significant (n={sigCounts.significant})
            </option>
            <option value="up">Up only (n={sigCounts.up})</option>
            <option value="down">Down only (n={sigCounts.down})</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-600">Rank by</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1"
            value={ranking}
            onChange={(e) => setRanking(e.target.value as RankMode)}
            aria-label="GO term ranking"
          >
            <option value="negLog10AdjP">−log10(adj.P)</option>
            <option value="enrichment">Fold enrichment</option>
          </select>
        </label>
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
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
          {sigCounts[direction === "significant" ? "significant" : direction] ===
          0
            ? `No ${direction === "significant" ? "significant" : direction} proteins at the current thresholds. Relax |log2FC| / adj.P or switch protein set.`
            : `None of the ${direction} proteins map to the bundled GO table for this aspect. Try “All aspects”, Load mock data, or upload a table whose Gene symbols overlap the demo mapping.`}
        </p>
      ) : result.terms.length === 0 ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
          Annotated foreground has {result.annotatedForeground} gene(s) (background{" "}
          {result.annotatedBackground}), but no term passed the minimum hit
          filter (≥2). Broaden the protein set or aspect.
        </p>
      ) : (
        <>
          <div className="h-[min(28rem,70vh)] w-full min-h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={chartRows}
                margin={{ top: 8, right: 16, bottom: 28, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11 }}
                  label={{
                    value: xLabel,
                    position: "insideBottom",
                    offset: -4,
                    style: { fontSize: 12, fill: "#64748b" },
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={168}
                  tick={{ fontSize: 11 }}
                  interval={0}
                />
                <Tooltip
                  content={({ payload }) => {
                    const row = payload?.[0]?.payload as
                      | (typeof chartRows)[number]
                      | undefined;
                    if (!row) return null;
                    return (
                      <div className="max-w-xs rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                        <div className="font-semibold text-slate-900">
                          {row.name}
                        </div>
                        <div className="text-slate-500">{row.id}</div>
                        <div>
                          {GO_ASPECT_LABELS[row.aspect]} · k={row.k}/{row.n},
                          K={row.K}/{row.N}
                        </div>
                        <div>Enrichment: {row.enrichment.toFixed(2)}×</div>
                        <div>p: {row.pValue.toExponential(2)}</div>
                        <div>adj.P: {row.adjP.toExponential(2)}</div>
                        <div className="mt-1 text-slate-600">
                          Hits: {row.hitGenes.join(", ")}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="score" name={xLabel} radius={[0, 4, 4, 0]}>
                  {chartRows.map((row) => (
                    <Cell
                      key={row.id}
                      fill={ASPECT_COLORS[row.aspect]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ul className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
            <li className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: ASPECT_COLORS.BP }}
              />
              BP
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: ASPECT_COLORS.MF }}
              />
              MF
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: ASPECT_COLORS.CC }}
              />
              CC
            </li>
            <li>
              Annotated FG {result.annotatedForeground} / BG{" "}
              {result.annotatedBackground} · showing top {result.terms.length}
            </li>
          </ul>

          {result.unmappedForeground.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              Unmapped in significant set ({result.unmappedForeground.length}):{" "}
              {result.unmappedForeground.slice(0, 24).join(", ")}
              {result.unmappedForeground.length > 24 ? "…" : ""}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function truncateLabel(name: string, max: number): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}
