"use client";

import { useEffect, useId, useRef, useState } from "react";

type SearchProtein = { protein_id: string; gene: string | null; organism: string };

export function ProteinSearch({ apiOrigin, focus, label, onChoose, autoFocus = false }: {
  apiOrigin: string; focus: string; label: string; onChoose: (id: string) => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchProtein[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);

  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);

  useEffect(() => {
    setQuery(""); setItems([]); setStatus("idle"); setOpen(false); setActive(-1);
  }, [focus]);

  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${apiOrigin}/api/v1/proteins?q=${encodeURIComponent(query.trim())}&limit=10`, { signal: controller.signal });
        if (!response.ok) throw new Error("Search failed");
        const data = await response.json() as { items: SearchProtein[] };
        if (controller.signal.aborted) return;
        setItems(data.items); setStatus("ready"); setActive(data.items.length ? 0 : -1);
      } catch {
        if (!controller.signal.aborted) { setItems([]); setStatus("error"); setActive(-1); }
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, apiOrigin, retry]);

  const choose = (id: string) => {
    setQuery(""); setItems([]); setStatus("idle"); setOpen(false); setActive(-1);
    input.current?.focus();
    onChoose(id);
  };
  const expanded = open && !!query.trim();
  useEffect(() => {
    if (expanded && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [expanded, active, id, items]);
  return <div className="relative min-w-0 max-w-xl" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
    <input ref={input} id={id} type="search" role="combobox" autoComplete="off"
      aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-results` : undefined}
      aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
      aria-describedby={`${id}-hint`} value={query} placeholder="Protein ID or gene, e.g. VMA8"
      onFocus={() => { if (query.trim()) setOpen(true); }}
      onChange={event => { setQuery(event.target.value); setItems([]); setActive(-1); setOpen(true); setStatus(event.target.value.trim() ? "loading" : "idle"); }}
      onKeyDown={event => {
        if (event.key === "Escape") { setOpen(false); if (expanded) event.stopPropagation(); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
          setActive(index => items.length ? Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))) : -1);
        } else if (event.key === "Enter" && expanded && active >= 0 && items[active]) {
          event.preventDefault(); choose(items[active].protein_id);
        }
      }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus-visible:outline-teal-700" />
    <p id={`${id}-hint`} className="mt-1 text-xs text-slate-600">Search all real proteins. Switching keeps the current candidate filters and QC samples.</p>
    {expanded && <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-300 bg-white shadow-lg">
      <ul id={`${id}-results`} role="listbox" aria-label={`${label} results`}>
        {items.map((protein, index) => <li key={protein.protein_id} role="presentation">
          <button type="button" id={`${id}-option-${index}`} role="option" aria-selected={active === index} tabIndex={-1}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(protein.protein_id)}
            className={`w-full break-words px-3 py-2 text-left text-sm hover:bg-teal-50 ${active === index ? "bg-teal-50" : ""}`}>
            <strong>{protein.gene || protein.protein_id}</strong> · {protein.protein_id}<span className="block text-xs text-slate-600">{protein.organism}</span>
          </button>
        </li>)}
      </ul>
      {status === "loading" && <p role="status" className="p-3 text-sm">Searching proteins…</p>}
      {status === "ready" && !items.length && <p role="status" className="p-3 text-sm">No proteins found. Try another gene or protein ID.</p>}
      {status === "error" && <div className="p-3 text-sm"><p role="alert">Could not search proteins. Check the backend connection.</p><button type="button" onClick={() => { setStatus("loading"); setRetry(n => n + 1); }} className="mt-2 rounded border border-slate-300 px-3 py-1">Retry protein search</button></div>}
    </div>}
  </div>;
}
