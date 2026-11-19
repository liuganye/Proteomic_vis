"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

type Choice = { protein_id: string; gene: string | null; organism: string };
type RemotePage = { key: string; status: "loading" | "ready" | "error"; items: Choice[]; total: number };
const PAGE_SIZE = 20;

export function ProteinPicker({ apiOrigin, current, candidates, candidatesStatus, totalProteins, onChoose }: {
  apiOrigin: string; current: Choice; candidates: Choice[];
  candidatesStatus: "loading" | "ready" | "error"; totalProteins: number; onChoose: (id: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"candidates" | "all">("candidates");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<RemotePage | null>(null);
  const [retry, setRetry] = useState(0);
  const [placement, setPlacement] = useState({ above: false, height: 512 });
  const normalizedQuery = query.trim().toLowerCase();
  const matching = useMemo(() => candidates.filter(p => !normalizedQuery || p.protein_id.toLowerCase().includes(normalizedQuery) || p.gene?.toLowerCase().includes(normalizedQuery)), [candidates, normalizedQuery]);
  const candidatePage = Math.min(page, Math.max(0, Math.ceil(matching.length / PAGE_SIZE) - 1));
  const requestKey = JSON.stringify([query.trim(), page]);
  const readyRemote = remote?.key === requestKey ? remote : null;
  const status = scope === "candidates" ? candidatesStatus : readyRemote?.status ?? "loading";
  const total = scope === "candidates" ? matching.length : readyRemote?.total ?? 0;
  const currentPage = scope === "candidates" ? candidatePage : page;
  const items = scope === "candidates" ? matching.slice(candidatePage * PAGE_SIZE, (candidatePage + 1) * PAGE_SIZE) : readyRemote?.items ?? [];
  const activeIndex = Math.min(active, items.length - 1);
  const outsideCandidates = candidatesStatus === "ready" && !candidates.some(p => p.protein_id === current.protein_id);

  useLayoutEffect(() => {
    if (!open) return;
    const fitViewport = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
      const placeAbove = below < 320 && above > below;
      const height = Math.max(180, Math.min(512, placeAbove ? above : below));
      setPlacement(previous => previous.above === placeAbove && previous.height === height ? previous : { above: placeAbove, height });
    };
    fitViewport();
    window.addEventListener("resize", fitViewport);
    window.addEventListener("scroll", fitViewport, true);
    return () => { window.removeEventListener("resize", fitViewport); window.removeEventListener("scroll", fitViewport, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const closeOutside = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    if (!open || scope !== "all") return;
    const controller = new AbortController();
    setRemote({ key: requestKey, status: "loading", items: [], total: 0 });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${apiOrigin}/api/v1/proteins?q=${encodeURIComponent(query.trim())}&offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Search failed");
        const data = await response.json() as { items: Choice[]; total: number };
        if (!controller.signal.aborted) setRemote({ key: requestKey, status: "ready", items: data.items, total: data.total });
      } catch {
        if (!controller.signal.aborted) setRemote({ key: requestKey, status: "error", items: [], total: 0 });
      }
    }, query.trim() ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, scope, requestKey, query, page, apiOrigin, retry]);

  useEffect(() => {
    if (open && activeIndex >= 0) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, currentPage, requestKey, status, id]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (protein: Choice) => { onChoose(protein.protein_id); close(); };
  const switchScope = (next: "candidates" | "all") => { setScope(next); setPage(0); setActive(0); search.current?.focus(); };
  return <div ref={root} className="relative flex min-w-0 items-center gap-2" onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <label id={`${id}-label`} className="shrink-0 text-xs font-semibold text-slate-600">Focus:</label>
    <button ref={trigger} type="button" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined}
      onClick={() => {
        if (open) { close(); return; }
        const index = candidates.findIndex(p => p.protein_id === current.protein_id);
        setScope("candidates"); setQuery(""); setPage(Math.floor(Math.max(0, index) / PAGE_SIZE)); setActive(Math.max(0, index) % PAGE_SIZE); setOpen(true);
      }} className="flex min-h-8 min-w-[220px] max-w-xs items-center justify-between gap-2 rounded-md border border-teal-700 bg-white px-2.5 py-1 text-left text-sm text-teal-950 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
      <span id={`${id}-value`} className="min-w-0 truncate"><strong>{current.gene || current.protein_id}</strong>{current.gene && <span className="ml-1.5 text-xs text-slate-500">{current.protein_id}</span>}</span>
      <svg viewBox="0 0 20 20" aria-hidden="true" className={`h-4 w-4 shrink-0 ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m5 7.5 5 5 5-5" /></svg>
    </button>
    {open && <div id={`${id}-panel`} role="dialog" aria-label="Choose focused protein" style={{ maxHeight: placement.height, ...(placement.above ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 8px)" }) }} className="absolute left-0 z-30 flex w-80 max-w-[90vw] flex-col overflow-hidden rounded-lg border border-slate-300 bg-white text-slate-900 shadow-lg">
      <div className="shrink-0 border-b border-slate-200 p-2.5">
        <div role="group" aria-label="Protein search scope" className="mb-2 flex gap-1 rounded-md bg-slate-100 p-1">
          <button type="button" aria-pressed={scope === "candidates"} onClick={() => switchScope("candidates")} className={`min-w-0 flex-1 rounded px-2 py-1.5 text-xs font-medium ${scope === "candidates" ? "bg-teal-800 text-white" : "text-slate-700 hover:bg-white"}`}>Candidates ({candidates.length.toLocaleString()})</button>
          <button type="button" aria-pressed={scope === "all"} onClick={() => switchScope("all")} className={`min-w-0 flex-1 rounded px-2 py-1.5 text-xs font-medium ${scope === "all" ? "bg-teal-800 text-white" : "text-slate-700 hover:bg-white"}`}>All ({totalProteins.toLocaleString()})</button>
        </div>
        <label htmlFor={`${id}-search`} className="sr-only">{scope === "candidates" ? "Search current candidates" : "Search all proteins"}</label>
        <input ref={search} id={`${id}-search`} type="search" role="combobox" autoComplete="off" maxLength={100} value={query} placeholder="Gene or Protein ID…"
          aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={status === "ready" && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
          onChange={event => { setQuery(event.target.value); setPage(0); setActive(0); }}
          onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); }
            if (event.key === "Enter" && status === "ready" && items[activeIndex]) { event.preventDefault(); choose(items[activeIndex]); }
          }} className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus-visible:outline-teal-700" />
        {outsideCandidates && <p className="mt-1.5 text-[11px] text-amber-900">Outside candidate set</p>}
      </div>
      <ul id={`${id}-options`} role="listbox" aria-label="Protein choices" aria-busy={status === "loading"} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {status === "ready" && items.map((protein, index) => <li key={protein.protein_id} role="presentation">
          <button id={`${id}-option-${index}`} type="button" role="option" aria-selected={protein.protein_id === current.protein_id} tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => choose(protein)}
            className={`flex w-full items-start justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left hover:bg-teal-50 ${protein.protein_id === current.protein_id ? "bg-teal-50" : ""} ${activeIndex === index ? "outline outline-2 -outline-offset-2 outline-teal-700" : ""}`}>
            <span className="min-w-0"><span className="block break-words text-sm"><strong>{protein.gene || protein.protein_id}</strong>{protein.gene && <span className="ml-2 text-slate-600">{protein.protein_id}</span>}</span><span className="mt-0.5 block break-words text-xs text-slate-500">{protein.organism || "Organism unavailable"}</span></span>
            {protein.protein_id === current.protein_id && <span className="shrink-0 text-xs font-semibold text-teal-900">Selected</span>}
          </button>
        </li>)}
      </ul>
      {status === "loading" && <p role="status" className="p-3 text-xs">Loading…</p>}
      {status === "error" && <div className="p-3 text-xs"><p role="alert">Load failed.</p>{scope === "all" && <button type="button" onClick={() => setRetry(n => n + 1)} className="mt-2 rounded border px-2 py-1">Retry</button>}</div>}
      {status === "ready" && !items.length && <div className="p-3 text-xs"><p role="status">No matches.</p>{scope === "candidates" && <button type="button" onClick={() => switchScope("all")} className="mt-1 font-medium text-teal-900 underline underline-offset-4">Search all proteins</button>}</div>}
      <div className="shrink-0 border-t border-slate-200 px-3 py-1.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><p role="status">{status === "ready" ? total ? `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, total)} / ${total.toLocaleString()}` : "0" : "…"}</p>
          <div className="flex gap-1.5"><button type="button" disabled={status !== "ready" || currentPage === 0} onClick={() => { search.current?.focus(); setPage(currentPage - 1); setActive(0); }} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40" aria-label="Previous protein choices">Prev</button><button type="button" disabled={status !== "ready" || (currentPage + 1) * PAGE_SIZE >= total} onClick={() => { search.current?.focus(); setPage(currentPage + 1); setActive(0); }} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40" aria-label="Next protein choices">Next</button></div>
        </div>
      </div>
    </div>}
  </div>;
}
