"use client";

import { useMemo, useState } from "react";
import { buildConditionColorMap, conditionColor, sampleCorrelationMatrix } from "@/lib/stats";
import { correlationColor, correlationTextColor } from "@/lib/visualization";
import type { FragPipeDataset, SampleSelectionProps } from "@/lib/types";

export function SampleCorrelation({
  dataset,
  matrix: precomputed,
  colorMap: colorMapProp,
  selectedSamples,
  onSelectSamples,
}: {
  dataset: FragPipeDataset;
  matrix?: ReturnType<typeof sampleCorrelationMatrix>;
  colorMap?: Record<string, string>;
} & SampleSelectionProps) {
  const { samples, matrix, conditions } = precomputed ?? sampleCorrelationMatrix(dataset);
  const groups = useMemo(() => [...new Set(conditions)], [conditions]);
  const colorMap = colorMapProp ?? buildConditionColorMap(groups);
  const [showValues, setShowValues] = useState(false);
  const [activeCell, setActiveCell] = useState(0);

  return (
    <div>
      <header className="mb-3">
        <h3 className="text-lg font-semibold text-slate-900">
          Sample correlation
        </h3>
        <p className="text-sm text-slate-600">
          Pairwise Pearson correlation of log<sub>10</sub>(MaxLFQ) across
          proteins observed in both samples. Zero and blank values are excluded;
          different pairs can use different sets of proteins. Samples are ordered by annotation group.
        </p>
      </header>

      <ul className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600" aria-label="Sample groups">
        {groups.map(group => <li key={group} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: conditionColor(group, colorMap) }} />{group}</li>)}
      </ul>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-700">
        <div className="w-64 max-w-full" aria-label="Pearson r color scale: orange at minus one, neutral at zero, blue at plus one">
          <p className="mb-1 font-medium">Pearson r · full range</p>
          <div className="h-3 rounded-sm border border-slate-300" style={{ background: "linear-gradient(to right, rgb(179, 88, 6), rgb(247, 247, 247), rgb(33, 102, 172))" }} />
          <div className="mt-1 flex justify-between"><span>−1</span><span>0</span><span>+1</span></div>
        </div>
        <span className="flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center bg-slate-200 text-slate-700">—</span> NA / undefined</span>
        <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showValues} onChange={e => setShowValues(e.target.checked)} /> Show cell values</label>
      </div>
      <div className="relative max-h-[48rem] max-w-full overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700" tabIndex={0} role="region" aria-label="Sample correlation matrix. Scroll within the matrix to inspect all samples.">
        <table className="border-collapse text-xs">
          <caption className="sr-only">Sample–sample Pearson correlation of log10 MaxLFQ. Rows and columns identify samples.</caption>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-white p-1"><span className="sr-only">Sample</span></th>
              {samples.map((s, columnIndex) => (
                <th
                  key={s}
                  scope="col"
                  className="sticky top-0 z-10 bg-white p-0 text-[10px] leading-none font-medium text-slate-600"
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
                <th scope="row" className="sticky left-0 z-10 bg-white pr-2 text-right font-medium text-slate-700" title={`${row} (${conditions[i]})`}>
                  <button type="button" aria-label={`Select row sample ${row}`} aria-pressed={selectedSamples.includes(row)} onClick={() => onSelectSamples([row])} className={`block max-w-32 truncate ${selectedSamples.includes(row) ? "bg-teal-100 font-bold text-slate-900" : ""}`}><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: conditionColor(conditions[i], colorMap) }} />{row}</button>
                </th>
                {samples.map((col, j) => {
                  const r = matrix[i][j];
                  const marked = selectedSamples.includes(row) || selectedSamples.includes(col);
                  const pairSelected = selectedSamples.includes(row) && selectedSamples.includes(col);
                  return (
                    <td key={col} className="p-px">
                      <button type="button"
                        className={`flex items-center justify-center text-[10px] font-medium tabular-nums ${showValues ? "h-9 w-9" : "h-3.5 w-3.5"}`}
                        style={{ background: correlationColor(r), color: correlationTextColor(r), boxShadow: marked ? `inset 0 0 0 ${pairSelected ? 2 : 1}px #0f172a` : undefined }}
                        title={`${row} × ${col}: ${Number.isFinite(r) ? r.toFixed(3) : "NA"}`}
                        aria-label={`Select samples ${row} and ${col}; r ${Number.isFinite(r) ? r.toFixed(3) : "NA"}`}
                        aria-pressed={pairSelected}
                        data-cell-index={i * samples.length + j}
                        tabIndex={activeCell === i * samples.length + j ? 0 : -1}
                        onFocus={() => setActiveCell(i * samples.length + j)}
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
      <p className="mt-3 text-xs text-slate-500">
        Orange: negative correlation. Neutral: zero. Blue: positive correlation.
        Select a label for one sample or a cell for both. Use arrow keys between cells and Enter to select. Outlines mark selected rows and columns. Scroll stays inside this matrix.
      </p>
    </div>
  );
}
