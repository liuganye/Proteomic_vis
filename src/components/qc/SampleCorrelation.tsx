"use client";

import { useMemo, useState } from "react";
import { buildConditionColorMap, conditionColor, sampleCorrelationMatrix } from "@/lib/stats";
import { correlationColor, correlationTextColor } from "@/lib/visualization";
import { sharedProteinCount } from "@/lib/qc-plot";
import type { FragPipeDataset, SampleSelectionProps } from "@/lib/types";

export function SampleCorrelation({
  dataset,
  matrix: precomputed,
  colorMap: colorMapProp,
  selectedSamples,
  onSelectSamples,
  compact = false,
}: {
  dataset: FragPipeDataset;
  matrix?: ReturnType<typeof sampleCorrelationMatrix>;
  colorMap?: Record<string, string>;
  compact?: boolean;
} & SampleSelectionProps) {
  const { samples, matrix, conditions } = precomputed ?? sampleCorrelationMatrix(dataset);
  const groups = useMemo(() => [...new Set(conditions)], [conditions]);
  const colorMap = colorMapProp ?? buildConditionColorMap(groups);
  const [showValues, setShowValues] = useState(false);
  const [scaleMode, setScaleMode] = useState<"auto" | "full">("auto");
  const [activeCell, setActiveCell] = useState(0);
  const [inspectedCell, setInspectedCell] = useState<{ i: number; j: number } | null>(null);
  const observedRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        const v = matrix[i][j];
        if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-6) {
      return { min: -1, max: 1 };
    }
    return { min, max };
  }, [matrix]);
  const colorValue = (r: number) => {
    if (!Number.isFinite(r)) return r;
    if (scaleMode === "full") return r;
    const span = observedRange.max - observedRange.min;
    if (span < 1e-6) return r;
    return -1 + ((r - observedRange.min) / span) * 2;
  };
  const inspected = useMemo(() => {
    if (!inspectedCell) return null;
    const { i, j } = inspectedCell;
    if (!samples[i] || !samples[j]) return null;
    return { a: samples[i], b: samples[j], r: matrix[i][j], n: sharedProteinCount(dataset, samples[i], samples[j]) };
  }, [dataset, inspectedCell, samples, matrix]);
  const groupRuns = conditions.reduce<{ condition: string; start: number; count: number }[]>((runs, condition, i) => {
    const last = runs[runs.length - 1];
    if (last?.condition === condition) last.count++;
    else runs.push({ condition, start: i, count: 1 });
    return runs;
  }, []);

  return (
    <div>
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">
          Sample correlation
        </h3>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          Pairwise Pearson r · log₁₀(MaxLFQ)
        </span>
      </header>

      <ul className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600" aria-label="Sample groups">
        {groups.map(group => <li key={group} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: conditionColor(group, colorMap) }} />{group}</li>)}
      </ul>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-700">
        <div className="w-64 max-w-full" aria-label="Pearson r color scale: blue for lowest correlation, ivory at midpoint, red for highest correlation">
          <p className="mb-1 font-medium">
            Pearson r · {scaleMode === "full" ? "full range (−1 to +1)" : `observed (${observedRange.min.toFixed(2)} to ${observedRange.max.toFixed(2)})`}
          </p>
          <div
            className="h-3 rounded-sm border border-slate-300"
            style={{
              background: "linear-gradient(to right, #4a72a0 0%, #8faece 25%, #f6f7f8 50%, #e8ae9e 75%, #c45c56 100%)",
            }}
          />
          <div className="mt-1 flex justify-between tabular-nums">
            <span>{scaleMode === "full" ? "−1" : observedRange.min.toFixed(2)}</span>
            <span>{scaleMode === "full" ? "0" : ((observedRange.min + observedRange.max) / 2).toFixed(2)}</span>
            <span>{scaleMode === "full" ? "+1" : observedRange.max.toFixed(2)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex overflow-hidden rounded border border-slate-300" role="group" aria-label="Heatmap color scale">
            <button
              type="button"
              aria-pressed={scaleMode === "auto"}
              onClick={() => setScaleMode("auto")}
              className={`px-2 py-0.5 ${scaleMode === "auto" ? "bg-teal-800 font-medium text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              Auto range
            </button>
            <button
              type="button"
              aria-pressed={scaleMode === "full"}
              onClick={() => setScaleMode("full")}
              className={`border-l border-slate-300 px-2 py-0.5 ${scaleMode === "full" ? "bg-teal-800 font-medium text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              Full (−1..1)
            </button>
          </div>
          <span className="flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center bg-slate-200 text-slate-700">—</span> NA</span>
          <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={showValues} onChange={e => setShowValues(e.target.checked)} /> Show cell values</label>
        </div>
      </div>
      <div className="mb-3 min-h-[4.5rem] rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600" role="status" aria-live="polite" data-testid="correlation-inspector">
        {inspected ? <>
          <p className="break-words font-semibold text-slate-900">{inspected.a} × {inspected.b}</p>
          <p className="mt-1 flex flex-wrap gap-x-5 gap-y-1"><span>Pearson r <strong className="tabular-nums text-slate-900">{Number.isFinite(inspected.r) ? inspected.r.toFixed(4) : "NA / undefined"}</strong></span><span><strong className="tabular-nums text-slate-900">{inspected.n.toLocaleString()}</strong> shared observed proteins</span></p>
        </> : <><p className="font-medium text-slate-800">Inspect a sample pair</p><p className="mt-1">Hover or focus a cell for its correlation and shared protein count. Click to select both samples.</p></>}
      </div>
      <div className={`relative max-w-full overflow-auto rounded-lg border border-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${compact ? "max-h-[14rem]" : "max-h-[42rem]"}`} tabIndex={0} role="region" aria-label="Sample correlation matrix. Scroll within the matrix to inspect all samples.">
        <table className="border-separate border-spacing-0 text-xs">
          <caption className="sr-only">Sample–sample Pearson correlation of log10 MaxLFQ. Rows and columns identify samples.</caption>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-white" />
              {groupRuns.map(run => <th key={run.start} colSpan={run.count} scope="colgroup" className="sticky top-0 z-20 h-6 border-b-4 bg-white px-0.5 text-[9px] font-semibold text-slate-700" style={{ borderColor: conditionColor(run.condition, colorMap), borderLeft: run.start > 0 ? "3px solid white" : undefined }} title={run.condition}><span className="block max-w-full truncate">{run.condition}</span></th>)}
            </tr>
            <tr>
              <th className="sticky left-0 top-6 z-30 bg-white p-1 text-left align-bottom text-[10px] text-slate-500">Sample</th>
              {samples.map((s, columnIndex) => (
                <th
                  key={s}
                  scope="col"
                  className="sticky top-6 z-10 bg-white p-0 text-[10px] leading-none font-medium text-slate-600"
                  style={{ borderLeft: columnIndex > 0 && conditions[columnIndex] !== conditions[columnIndex - 1] ? "3px solid white" : undefined }}
                  title={`${s} (${conditions[columnIndex]})`}
                >
                  <button type="button" aria-label={`Select column sample ${s}`} aria-pressed={selectedSamples.includes(s)} onClick={() => onSelectSamples([s])} className={`inline-block max-h-32 truncate ${selectedSamples.includes(s) ? "bg-teal-100 font-bold text-slate-900" : ""}`} style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: conditionColor(conditions[columnIndex], colorMap) }} />{s}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {samples.map((row, i) => (
              <tr key={row}>
                <th scope="row" className="sticky left-0 z-10 bg-white pr-2 text-right font-medium text-slate-700" style={{ borderTop: i > 0 && conditions[i] !== conditions[i - 1] ? "3px solid white" : undefined }} title={`${row} (${conditions[i]})`}>
                  <button type="button" aria-label={`Select row sample ${row}`} aria-pressed={selectedSamples.includes(row)} onClick={() => onSelectSamples([row])} className={`block max-w-32 truncate ${selectedSamples.includes(row) ? "bg-teal-100 font-bold text-slate-900" : ""}`}><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: conditionColor(conditions[i], colorMap) }} />{row}</button>
                </th>
                {samples.map((col, j) => {
                  const r = matrix[i][j];
                  const marked = selectedSamples.includes(row) || selectedSamples.includes(col);
                  const pairSelected = selectedSamples.includes(row) && selectedSamples.includes(col);
                  return (
                    <td key={col} className="p-px" style={{ borderTop: i > 0 && conditions[i] !== conditions[i - 1] ? "3px solid white" : undefined, borderLeft: j > 0 && conditions[j] !== conditions[j - 1] ? "3px solid white" : undefined }}>
                      <button type="button"
                        className={`flex items-center justify-center text-[10px] font-medium tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 ${showValues ? "h-9 w-9" : "h-4 w-4"}`}
                        style={{ background: correlationColor(colorValue(r)), color: correlationTextColor(colorValue(r)), boxShadow: inspectedCell?.i === i && inspectedCell?.j === j ? "inset 0 0 0 2px #0f172a" : marked ? `inset 0 0 0 ${pairSelected ? 2 : 1}px #0f172a` : undefined }}
                        title={`${row} × ${col}: ${Number.isFinite(r) ? r.toFixed(3) : "NA"}`}
                        aria-label={`Select samples ${row} and ${col}; r ${Number.isFinite(r) ? r.toFixed(3) : "NA"}`}
                        aria-pressed={pairSelected}
                        data-cell-index={i * samples.length + j}
                        tabIndex={activeCell === i * samples.length + j ? 0 : -1}
                        onFocus={() => { setActiveCell(i * samples.length + j); setInspectedCell({ i, j }); }}
                        onMouseEnter={() => setInspectedCell({ i, j })}
                        onClick={() => onSelectSamples([...new Set([row, col])])}
                        onKeyDown={e => {
                          const step = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
                          if (!step) return;
                          e.preventDefault();
                          const next = Math.max(0, Math.min(samples.length - 1, i + step[0])) * samples.length + Math.max(0, Math.min(samples.length - 1, j + step[1]));
                          e.currentTarget.closest("table")?.querySelector<HTMLButtonElement>(`[data-cell-index="${next}"]`)?.focus();
                        }}
                      >
                        <span className={showValues || !Number.isFinite(r) ? "" : "sr-only"}>{Number.isFinite(r) ? r.toFixed(2) : "—"}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
