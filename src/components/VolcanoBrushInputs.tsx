"use client";

import { useState } from "react";
import type { BrushBounds } from "@/lib/visualization";

export function VolcanoBrushInputs({ bounds, onApply }: { bounds: BrushBounds; onApply: (bounds: BrushBounds) => void }) {
  const [values, setValues] = useState(Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, String(v)])));
  const [error, setError] = useState("");
  return <details className="mt-3 text-sm"><summary className="cursor-pointer text-teal-900">Set selection bounds with keyboard</summary>
    <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={e => {
      e.preventDefault();
      const next = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])) as BrushBounds;
      if (Object.values(values).some(v => !v.trim()) || Object.values(next).some(v => !Number.isFinite(v)) || next.minFc > next.maxFc || next.minY < 0 || next.minY > next.maxY) { setError("Enter finite bounds in increasing order; −log₁₀ adjusted p must be non-negative."); return; }
      setError(""); onApply(next);
    }}>
      {([["minFc", "Minimum log₂FC"], ["maxFc", "Maximum log₂FC"], ["minY", "Minimum −log₁₀ adjusted p"], ["maxY", "Maximum −log₁₀ adjusted p"]] as const).map(([key, label]) => <label key={key} className="text-xs">{label}<input type="number" step="any" required value={values[key]} onChange={e => setValues({ ...values, [key]: e.target.value })} className="mt-1 block w-28 rounded border border-slate-300 p-2 text-sm" /></label>)}
      <button type="submit" className="rounded bg-teal-800 px-3 py-2 text-white">Apply selection</button>
      {error && <p role="alert" className="w-full text-red-800">{error}</p>}
    </form>
  </details>;
}
