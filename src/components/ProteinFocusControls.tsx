"use client";

import type { ExploreState, RealResult } from "@/lib/visualization";
import { ProteinSearch } from "./ProteinSearch";

export function ProteinFocusControls({ apiOrigin, focus, rows, resultsStatus, onChoose }: {
  apiOrigin: string; focus: string; rows: RealResult[]; sort: ExploreState["sort"];
  resultsStatus: "loading" | "ready" | "error"; onChoose: (id: string) => void;
}) {
  const index = rows.findIndex(row => row.protein_id === focus);
  const ready = resultsStatus === "ready";
  const previous = ready && index > 0 ? rows[index - 1] : undefined;
  const next = ready && index >= 0 ? rows[index + 1] : undefined;

  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2 text-xs">
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" disabled={!previous} onClick={() => { if (previous) onChoose(previous.protein_id); }} className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50 disabled:opacity-40">← Prev</button>
      <span data-testid="candidate-position" aria-live="polite" className="px-1 font-semibold tabular-nums text-slate-700">
        {!ready ? "…" : !rows.length ? "0 candidates" : index >= 0 ? `${(index + 1).toLocaleString()} / ${rows.length.toLocaleString()}` : "Outside set"}
      </span>
      <button type="button" disabled={!next} onClick={() => { if (next) onChoose(next.protein_id); }} className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50 disabled:opacity-40">Next →</button>
      {ready && index < 0 && rows.length > 0 && <button type="button" onClick={() => onChoose(rows[0].protein_id)} className="rounded border border-teal-700 bg-teal-50 px-2 py-1 text-teal-900 hover:bg-teal-100">First</button>}
    </div>
    <ProteinSearch apiOrigin={apiOrigin} focus={focus} label="Search protein" onChoose={onChoose} />
  </div>;
}
