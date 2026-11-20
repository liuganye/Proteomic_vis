"use client";

import { useState } from "react";
import type { BrushBounds } from "@/lib/visualization";

export function VolcanoBrushInputs({ bounds, onApply }: { bounds: BrushBounds; onApply: (bounds: BrushBounds) => void }) {
  const [values, setValues] = useState(Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, String(v)])));
  const [error, setError] = useState("");
  return <details className="text-xs">
    <summary className="cursor-pointer select-none rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50" title="Set exact selection bounds by keyboard">Bounds</summary>
    <form className="mt-1.5 flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-slate-50 p-2" onSubmit={e => {
      e.preventDefault();
      const next = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])) as BrushBounds;
      if (Object.values(values).some(v => !v.trim()) || Object.values(next).some(v => !Number.isFinite(v)) || next.minFc > next.maxFc || next.minY < 0 || next.minY > next.maxY) { setError("Invalid bounds."); return; }
      setError(""); onApply(next);
    }}>
      {([["minFc", "Min FC"], ["maxFc", "Max FC"], ["minY", "Min −logP"], ["maxY", "Max −logP"]] as const).map(([key, label]) => <label key={key} className="text-[11px] text-slate-600">{label}<input type="number" step="any" required value={values[key]} onChange={e => setValues({ ...values, [key]: e.target.value })} className="mt-0.5 block w-20 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs" /></label>)}
      <button type="submit" className="rounded bg-teal-800 px-2.5 py-1 text-xs text-white">Apply</button>
      {error && <p role="alert" className="w-full text-red-800">{error}</p>}
    </form>
  </details>;
}
