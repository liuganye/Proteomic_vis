"use client";

import { passesVolcanoFilters, RESULT_PAGE_SIZE, type ExploreState, type RealResult } from "@/lib/visualization";

export function RealResultsTable({ rows, testedCount, brushedCount, state, update, focus, focusIsTested, onChoose }: {
  rows: RealResult[]; testedCount: number; brushedCount: number;
  state: ExploreState; update: (patch: Partial<ExploreState>) => void;
  focus: string; focusIsTested: boolean; onChoose: (id: string) => void;
}) {
  const pages = Math.max(1, Math.ceil(rows.length / RESULT_PAGE_SIZE));
  const page = Math.min(state.page, pages - 1);
  const visible = rows.slice(page * RESULT_PAGE_SIZE, (page + 1) * RESULT_PAGE_SIZE);
  const filtered = state.brush !== null || state.query.trim() !== "" || state.passingOnly;
  return <section id="real-results" className="min-w-0 scroll-mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="real-results-heading">
    <h3 id="real-results-heading" className="text-lg font-semibold">Real results table</h3>
    <p className="mt-1 text-sm text-slate-600">Imported Human − QC results. A box selection limits this table; search and threshold filters narrow it further. Inspect a row to update protein evidence.</p>
    <div className="mt-4 flex flex-wrap items-end gap-4 text-sm">
      <label className="min-w-0">Search these results<input aria-label="Search real results" value={state.query} onChange={e => update({ query: e.target.value, page: 0 })} placeholder="Gene or protein ID" className="mt-1 block max-w-full rounded border border-slate-300 p-2" /></label>
      <label>Sort results<select value={state.sort} onChange={e => update({ sort: e.target.value as ExploreState["sort"], page: 0 })} className="mt-1 block rounded border border-slate-300 p-2"><option value="adj_p">Adjusted p: smallest first</option><option value="effect">|log₂FC|: largest first</option><option value="gene">Gene / ID: A–Z</option></select></label>
      <label className="flex items-center gap-2 py-2"><input type="checkbox" checked={state.passingOnly} onChange={e => update({ passingOnly: e.target.checked, page: 0 })} />Only proteins passing thresholds</label>
      <button type="button" disabled={!filtered} onClick={() => update({ brush: null, query: "", passingOnly: false, page: 0 })} className="rounded border border-slate-300 px-3 py-2 disabled:opacity-40">Clear table filters</button>
    </div>
    <p className="my-3 text-sm font-medium" data-testid="real-results-count" aria-live="polite">{rows.length.toLocaleString()} matching proteins / {testedCount.toLocaleString()} tested{state.brush ? ` · ${brushedCount.toLocaleString()} in selected region` : " · no box selection"}</p>
    {!rows.some(p => p.protein_id === focus) && <p className="mb-3 text-sm text-slate-600" data-testid="focus-outside-results">{focusIsTested ? `Focused protein ${focus} is outside the current table filters. Its evidence remains available below.` : `Focused protein ${focus} has no imported Human − QC result. This is not a non-significant result.`}</p>}
    <div className="relative max-h-96 max-w-full overflow-auto" tabIndex={0} role="region" aria-label="Real differential results table">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="sticky top-0 bg-slate-100 text-xs text-slate-700"><tr><th className="p-2">Protein / gene</th><th className="p-2">Organism</th><th className="p-2 text-right">log₂FC</th><th className="p-2 text-right">Adjusted p</th><th className="p-2">Threshold status</th></tr></thead>
        <tbody>{visible.map(p => <tr key={p.protein_id} data-protein-id={p.protein_id} data-focused={p.protein_id === focus} className={`border-b border-slate-100 ${p.protein_id === focus ? "bg-teal-50" : "hover:bg-slate-50"}`}>
          <th scope="row" className="p-2 font-normal"><button type="button" onClick={() => onChoose(p.protein_id)} aria-label={`Inspect ${p.gene || p.protein_id} (${p.protein_id})`} aria-current={p.protein_id === focus ? "true" : undefined} className="rounded text-left text-teal-900 underline underline-offset-4 focus-visible:outline-teal-700"><strong>{p.gene || p.protein_id}</strong><span className="block text-xs">{p.protein_id}{p.protein_id === focus ? " · focused" : ""}</span></button></th>
          <td className="max-w-56 p-2 text-xs">{p.organism}</td><td className="p-2 text-right tabular-nums">{p.log2_fc.toFixed(3)}</td><td className="p-2 text-right tabular-nums">{p.adj_p.toExponential(3)}</td><td className="p-2 text-xs">{passesVolcanoFilters(p, state.pCutoff, state.fcCutoff) ? "Passes" : "Does not pass"}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {!rows.length && <p className="my-4 text-sm" role="status">No proteins match this region and these filters. Draw another region or clear table filters.</p>}
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm"><button type="button" disabled={page === 0} onClick={() => update({ page: page - 1 })} className="rounded border px-3 py-1 disabled:opacity-40">Previous results</button><span>Page {page + 1} of {pages}</span><button type="button" disabled={page >= pages - 1} onClick={() => update({ page: page + 1 })} className="rounded border px-3 py-1 disabled:opacity-40">Next results</button></div>
  </section>;
}
