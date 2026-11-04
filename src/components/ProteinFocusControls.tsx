"use client";

import type { ExploreState, RealResult } from "@/lib/visualization";
import { ProteinSearch } from "./ProteinSearch";

export function ProteinFocusControls({ apiOrigin, focus, rows, sort, resultsStatus, onChoose }: {
  apiOrigin: string; focus: string; rows: RealResult[]; sort: ExploreState["sort"];
  resultsStatus: "loading" | "ready" | "error"; onChoose: (id: string) => void;
}) {
  const index = rows.findIndex(row => row.protein_id === focus);
  const ready = resultsStatus === "ready";
  const previous = ready && index > 0 ? rows[index - 1] : undefined;
  const next = ready && index >= 0 ? rows[index + 1] : undefined;
  const order = { adj_p: "adjusted p, smallest first", effect: "|log₂FC|, largest first", gene: "gene / ID, A–Z" }[sort];

  return <div className="my-4 border-b border-slate-200 pb-4">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" disabled={!previous} onClick={() => { if (previous) onChoose(previous.protein_id); }} className="rounded border border-slate-300 px-3 py-2 hover:bg-slate-50 focus-visible:outline-teal-700 disabled:opacity-40">Previous candidate</button>
      <p data-testid="candidate-position" aria-live="polite" className="px-1 font-semibold tabular-nums">
        {!ready ? resultsStatus === "loading" ? "Loading candidates…" : "Candidates unavailable" : !rows.length ? "No matching candidates" : index >= 0 ? `Candidate ${(index + 1).toLocaleString()} / ${rows.length.toLocaleString()}` : "Outside candidate set"}
      </p>
      <button type="button" disabled={!next} onClick={() => { if (next) onChoose(next.protein_id); }} className="rounded border border-slate-300 px-3 py-2 hover:bg-slate-50 focus-visible:outline-teal-700 disabled:opacity-40">Next candidate</button>
      {ready && index < 0 && rows.length > 0 && <button type="button" onClick={() => onChoose(rows[0].protein_id)} className="rounded border border-teal-700 px-3 py-2 text-teal-900 hover:bg-teal-50">Start with first candidate</button>}
      {ready && <a href="#real-results" className="px-1 text-teal-900 underline underline-offset-4">View candidate table</a>}
    </div>
    <p className="mt-2 text-xs text-slate-600">{ready ? `Follows all ${rows.length.toLocaleString()} matching table rows across pages, sorted by ${order}.` : "Candidate navigation needs the imported results. Protein search remains available."}</p>
    {ready && index < 0 && rows.length > 0 && <p className="mt-2 text-sm text-slate-700" data-testid="candidate-outside">{focus} is outside the current candidate set. Its evidence remains visible; start with the first candidate to resume the filtered list.</p>}
    {ready && !rows.length && <p className="mt-2 text-sm text-slate-700">No proteins match the current table filters. Adjust the filters or search all real proteins below.</p>}
    <div className="mt-4"><ProteinSearch apiOrigin={apiOrigin} focus={focus} label="Switch focused protein" onChoose={onChoose} /></div>
  </div>;
}
