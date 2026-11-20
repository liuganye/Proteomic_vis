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
  const maxAbsFc = Math.max(2, ...visible.map(r => Math.abs(r.log2_fc)));
  return <section id="real-results" className="flex flex-1 min-h-0 min-w-0 flex-col scroll-mt-6" aria-labelledby="real-results-heading">
    <h3 id="real-results-heading" className="sr-only">Real results table</h3>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <input aria-label="Search real results" value={state.query} onChange={e => update({ query: e.target.value, page: 0 })} placeholder="Search gene / ID…" className="min-w-[140px] flex-1 rounded border border-slate-300 px-2 py-1 text-xs" />
      <select aria-label="Sort results" value={state.sort} onChange={e => update({ sort: e.target.value as ExploreState["sort"], page: 0 })} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">
        <option value="adj_p">Sort: adj.p</option>
        <option value="effect">Sort: |log₂FC|</option>
        <option value="gene">Sort: Gene</option>
      </select>
      <label className="flex cursor-pointer select-none items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1"><input type="checkbox" checked={state.passingOnly} onChange={e => update({ passingOnly: e.target.checked, page: 0 })} />Pass only</label>
      <button type="button" disabled={!filtered} onClick={() => update({ brush: null, query: "", passingOnly: false, page: 0 })} className="rounded border border-slate-300 bg-white px-2 py-1 disabled:opacity-40 hover:bg-slate-50">Clear</button>
    </div>
    <div className="my-1.5 flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700" data-testid="real-results-count" aria-live="polite">
        {rows.length.toLocaleString()} / {testedCount.toLocaleString()}{state.brush ? ` · ${brushedCount.toLocaleString()} in box` : ""}
      </span>
      {!rows.some(p => p.protein_id === focus) && (
        <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-900 border border-amber-200" data-testid="focus-outside-results">
          {focusIsTested ? `${focus} outside filter` : `${focus} not tested`}
        </span>
      )}
    </div>
    <div className="relative flex-1 min-h-0 max-w-full overflow-auto rounded border border-slate-200 bg-white/55" tabIndex={0} role="region" aria-label="Real differential results table">
      <table className="w-full min-w-[500px] text-left text-xs">
        <thead className="sticky top-0 z-10 bg-slate-100/75 text-[11px] text-slate-700 backdrop-blur-sm">
          <tr>
            <th className="px-2 py-1.5">Protein</th>
            <th className="px-2 py-1.5">Species</th>
            <th className="px-2 py-1.5 text-right">log₂FC</th>
            <th className="px-2 py-1.5 text-right">adj.p</th>
            <th className="px-2 py-1.5">Status</th>
          </tr>
        </thead>
        <tbody>{visible.map(p => {
          const passes = passesVolcanoFilters(p, state.pCutoff, state.fcCutoff);
          const barPct = Math.min(50, (Math.abs(p.log2_fc) / maxAbsFc) * 50);
          return <tr key={p.protein_id} data-protein-id={p.protein_id} data-focused={p.protein_id === focus} className={`border-b border-slate-100 ${p.protein_id === focus ? "bg-teal-50" : "hover:bg-slate-50"}`}>
            <th scope="row" className="px-2 py-1.5 font-normal">
              <button type="button" onClick={() => onChoose(p.protein_id)} aria-label={`Inspect ${p.gene || p.protein_id} (${p.protein_id})`} aria-current={p.protein_id === focus ? "true" : undefined} className="rounded text-left text-teal-900 underline underline-offset-2 focus-visible:outline-teal-700">
                <strong>{p.gene || p.protein_id}</strong> <span className="text-[11px] text-slate-500">{p.protein_id}</span>
              </button>
            </th>
            <td className="px-2 py-1.5 text-[11px] text-slate-600">{p.organism.split(" ")[0]}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">
              <div className="inline-flex items-center gap-1.5">
                <span className="relative inline-block h-2 w-14 rounded bg-slate-100 overflow-hidden" aria-hidden="true">
                  <span className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300" />
                  <span
                    className={`absolute top-0 bottom-0 ${p.log2_fc >= 0 ? "bg-teal-600" : "bg-amber-600"}`}
                    style={{ left: p.log2_fc >= 0 ? "50%" : `${50 - barPct}%`, width: `${barPct}%` }}
                  />
                </span>
                <span className={p.log2_fc >= 0 ? "text-teal-800 font-medium" : "text-amber-800 font-medium"}>{p.log2_fc.toFixed(2)}</span>
              </div>
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">{p.adj_p.toExponential(2)}</td>
            <td className="px-2 py-1.5">
              <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${passes ? (p.log2_fc >= 0 ? "bg-teal-100 text-teal-900" : "bg-amber-100 text-amber-900") : "bg-slate-100 text-slate-500"}`}>
                {passes ? (p.log2_fc >= 0 ? "↑ Human" : "↑ QC") : "NS"}
              </span>
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {!rows.length && <p className="my-2 text-xs text-slate-600" role="status">No matching proteins.</p>}
    <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
      <button type="button" disabled={page === 0} onClick={() => update({ page: page - 1 })} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">← Prev</button>
      <span className="text-slate-600">{page + 1} / {pages}</span>
      <button type="button" disabled={page >= pages - 1} onClick={() => update({ page: page + 1 })} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">Next →</button>
    </div>
  </section>;
}
