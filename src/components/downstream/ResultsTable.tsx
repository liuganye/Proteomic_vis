"use client";

import { useMemo, useState } from "react";
import { resultsTableRows } from "@/lib/stats";
import type { VolcanoPoint } from "@/lib/types";

interface Props {
  points: VolcanoPoint[];
  contrastLabel: string;
}

export function ResultsTable({ points, contrastLabel }: Props) {
  const [query, setQuery] = useState("");
  const [sigOnly, setSigOnly] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const rows = useMemo(() => {
    let r = resultsTableRows(points);
    if (sigOnly) r = r.filter((p) => p.significant);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      r = r.filter(
        (p) =>
          p.gene.toLowerCase().includes(q) ||
          p.proteinId.toLowerCase().includes(q),
      );
    }
    return r;
  }, [points, query, sigOnly]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div>
      <header className="mb-3">
        <h3 className="text-lg font-semibold text-slate-900">Results table</h3>
        <p className="text-sm text-slate-600">
          Ranked by adjusted p-value for{" "}
          <span className="font-medium text-slate-800">
            {contrastLabel || "—"}
          </span>
          . Filter by gene / protein ID or significance.
        </p>
      </header>

      {points.length === 0 ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
          No DE results to show. Open the Volcano module first or load a table
          with log2FC + adjusted p-value columns.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <input
              type="search"
              placeholder="Filter gene or Protein ID…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              className="min-w-[14rem] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={sigOnly}
                onChange={(e) => {
                  setSigOnly(e.target.checked);
                  setPage(0);
                }}
              />
              Significant only
            </label>
            <span className="text-xs text-slate-500">
              {rows.length} / {points.length} proteins
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Gene</th>
                  <th className="px-3 py-2">Protein ID</th>
                  <th className="px-3 py-2">log2FC</th>
                  <th className="px-3 py-2">adj.P</th>
                  <th className="px-3 py-2">−log10(adj.P)</th>
                  <th className="px-3 py-2">Call</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.proteinId} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 tabular-nums text-slate-500">
                      {r.rank}
                    </td>
                    <td className="px-3 py-1.5 font-medium text-slate-900">
                      {r.gene}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-700">
                      {r.proteinId}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">
                      {r.log2fc.toFixed(3)}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">
                      {r.adjP.toExponential(2)}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">
                      {r.negLog10AdjP.toFixed(2)}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={
                          r.direction === "up"
                            ? "rounded bg-teal-100 px-1.5 py-0.5 text-xs font-medium text-teal-900"
                            : r.direction === "down"
                              ? "rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900"
                              : "rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                        }
                      >
                        {r.direction === "ns" ? "NS" : r.direction}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-slate-600">
              Page {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
