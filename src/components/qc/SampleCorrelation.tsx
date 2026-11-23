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
}: {
  dataset: FragPipeDataset;
  matrix?: ReturnType<typeof sampleCorrelationMatrix>;
  colorMap?: Record<string, string>;
} & SampleSelectionProps) {
  const { samples, matrix, conditions } = precomputed ?? sampleCorrelationMatrix(dataset);
  const groups = useMemo(() => [...new Set(conditions)], [conditions]);
  const colorMap = colorMapProp ?? buildConditionColorMap(groups);
  const isSmall = samples.length <= 12;
  const isMedium = samples.length > 12 && samples.length <= 24;
  const [showValuesOverride, setShowValuesOverride] = useState<boolean | null>(null);
  const showValues = showValuesOverride ?? isSmall;
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
    return {
      a: samples[i],
      b: samples[j],
      r: matrix[i][j],
      n: sharedProteinCount(dataset, samples[i], samples[j]),
    };
  }, [dataset, inspectedCell, samples, matrix]);

  const groupRuns = conditions.reduce<{ condition: string; start: number; count: number }[]>(
    (runs, condition, i) => {
      const last = runs[runs.length - 1];
      if (last?.condition === condition) last.count++;
      else runs.push({ condition, start: i, count: 1 });
      return runs;
    },
    [],
  );

  const cellSizeClass = isSmall
    ? "h-10 w-10 rounded-[4px] text-[11px]"
    : showValues
      ? "h-9 w-9 rounded-[3px] text-[10px]"
      : isMedium
        ? "h-6 w-6 rounded-[2px] text-[10px]"
        : "h-4 w-4 text-[10px]";

  const groupGapPx = isSmall ? 8 : 4;

  return (
    <div className="flex flex-col gap-2.5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-base font-semibold text-slate-900">
            Sample correlation
          </h3>
          <ul className="flex flex-wrap items-center gap-2.5 text-xs text-slate-600" aria-label="Sample groups">
            {groups.map((group) => (
              <li key={group} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: conditionColor(group, colorMap) }}
                />
                {group}
              </li>
            ))}
          </ul>
        </div>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          Pearson r · log₁₀(MaxLFQ)
        </span>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3 text-xs text-slate-700">
        <div
          className="w-56 max-w-full"
          aria-label="Pearson r color scale: blue for lowest correlation, ivory at midpoint, red for highest correlation"
        >
          <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
            <span className="font-medium text-slate-700">Pearson r</span>
            <span className="tabular-nums">
              {scaleMode === "full"
                ? "−1.00 to +1.00"
                : `${observedRange.min.toFixed(2)} to ${observedRange.max.toFixed(2)}`}
            </span>
          </div>
          <div
            className="h-2.5 rounded-full border border-slate-200"
            style={{
              background:
                "linear-gradient(to right, #4a72a0 0%, #8faece 25%, #f6f7f8 50%, #e8ae9e 75%, #c45c56 100%)",
            }}
          />
          <div className="mt-0.5 flex justify-between text-[10.5px] tabular-nums text-slate-500">
            <span>{scaleMode === "full" ? "−1" : observedRange.min.toFixed(2)}</span>
            <span>
              {scaleMode === "full"
                ? "0"
                : ((observedRange.min + observedRange.max) / 2).toFixed(2)}
            </span>
            <span>{scaleMode === "full" ? "+1" : observedRange.max.toFixed(2)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div
            className="inline-flex overflow-hidden rounded-md border border-slate-300"
            role="group"
            aria-label="Heatmap color scale"
          >
            <button
              type="button"
              aria-pressed={scaleMode === "auto"}
              onClick={() => setScaleMode("auto")}
              className={`px-2 py-0.5 text-[11px] ${
                scaleMode === "auto"
                  ? "bg-teal-800 font-medium text-white"
                  : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              Auto range
            </button>
            <button
              type="button"
              aria-pressed={scaleMode === "full"}
              onClick={() => setScaleMode("full")}
              className={`border-l border-slate-300 px-2 py-0.5 text-[11px] ${
                scaleMode === "full"
                  ? "bg-teal-800 font-medium text-white"
                  : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              Full (−1..1)
            </button>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
            <input
              type="checkbox"
              checked={showValues}
              onChange={(e) => setShowValuesOverride(e.target.checked)}
              className="accent-teal-800"
            />
            Values
          </label>
        </div>
      </div>

      {/* Single unified stage: crisp inline inspector header + centered adaptive heatmap */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/40">
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-white/80 px-3 py-1.5 text-xs text-slate-600"
          role="status"
          aria-live="polite"
          data-testid="correlation-inspector"
        >
          {inspected ? (
            <>
              <span className="font-semibold text-slate-900">
                {inspected.a} × {inspected.b}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums">
                <span>
                  r ={" "}
                  <strong className="text-slate-900">
                    {Number.isFinite(inspected.r) ? inspected.r.toFixed(4) : "NA"}
                  </strong>
                </span>
                <span>
                  <strong className="text-slate-900">
                    {inspected.n.toLocaleString()}
                  </strong>{" "}
                  shared proteins
                </span>
              </span>
            </>
          ) : (
            <span className="text-slate-500">
              Hover any cell to inspect Pearson r &amp; shared proteins · click to select pair
            </span>
          )}
        </div>

        <div
          className="relative flex max-h-[36rem] max-w-full justify-center overflow-auto p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
          tabIndex={0}
          role="region"
          aria-label="Sample correlation matrix. Scroll within the matrix to inspect all samples."
        >
          <table className="border-separate border-spacing-0 text-xs">
            <caption className="sr-only">
              Sample–sample Pearson correlation of log10 MaxLFQ. Rows and columns identify samples.
            </caption>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 bg-transparent" />
                {groupRuns.map((run) => (
                  <th
                    key={run.start}
                    colSpan={run.count}
                    scope="colgroup"
                    className="pb-1 text-center text-[11px] font-semibold text-slate-700"
                    style={{
                      paddingLeft: run.start > 0 ? `${groupGapPx}px` : undefined,
                    }}
                    title={run.condition}
                  >
                    <div
                      className="border-b-[3px] pb-1"
                      style={{ borderColor: conditionColor(run.condition, colorMap) }}
                    >
                      <span className="block truncate">{run.condition}</span>
                    </div>
                  </th>
                ))}
              </tr>
              <tr>
                <th className="p-1 pr-2 text-right align-bottom text-[10.5px] font-medium text-slate-400">
                  Sample
                </th>
                {samples.map((s, columnIndex) => {
                  const isGroupBoundary =
                    columnIndex > 0 && conditions[columnIndex] !== conditions[columnIndex - 1];
                  return (
                    <th
                      key={s}
                      scope="col"
                      className={`align-bottom font-medium text-slate-600 ${
                        isSmall ? "pt-2 pb-1.5 text-[10.5px]" : "pt-1.5 pb-1 text-[10px]"
                      }`}
                      style={{
                        paddingLeft: isGroupBoundary ? `${groupGapPx}px` : undefined,
                      }}
                      title={`${s} (${conditions[columnIndex]})`}
                    >
                      <button
                        type="button"
                        aria-label={`Select column sample ${s}`}
                        aria-pressed={selectedSamples.includes(s)}
                        onClick={() => onSelectSamples([s])}
                        className={`mx-auto block rounded px-0.5 py-0.5 transition-colors hover:bg-slate-200/70 ${
                          selectedSamples.includes(s)
                            ? "bg-teal-100 font-bold text-slate-900"
                            : ""
                        }`}
                        style={{
                          writingMode: "vertical-rl",
                          transform: "rotate(180deg)",
                          maxHeight: isSmall ? "5.25rem" : "7rem",
                        }}
                      >
                        <span className="truncate">{s}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {samples.map((row, i) => {
                const isRowBoundary = i > 0 && conditions[i] !== conditions[i - 1];
                return (
                  <tr key={row}>
                    <th
                      scope="row"
                      className="pr-2.5 text-right font-medium text-slate-700"
                      style={{
                        paddingTop: isRowBoundary ? `${groupGapPx}px` : undefined,
                      }}
                      title={`${row} (${conditions[i]})`}
                    >
                      <button
                        type="button"
                        aria-label={`Select row sample ${row}`}
                        aria-pressed={selectedSamples.includes(row)}
                        onClick={() => onSelectSamples([row])}
                        className={`inline-flex max-w-32 items-center gap-1.5 truncate rounded px-1 py-0.5 transition-colors hover:bg-slate-200/70 ${
                          selectedSamples.includes(row)
                            ? "bg-teal-100 font-bold text-slate-900"
                            : ""
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 shrink-0 rounded-sm"
                          style={{ background: conditionColor(conditions[i], colorMap) }}
                        />
                        <span className="truncate">{row}</span>
                      </button>
                    </th>
                    {samples.map((col, j) => {
                      const r = matrix[i][j];
                      const marked = selectedSamples.includes(row) || selectedSamples.includes(col);
                      const pairSelected =
                        selectedSamples.includes(row) && selectedSamples.includes(col);
                      const isColBoundary =
                        j > 0 && conditions[j] !== conditions[j - 1];
                      const isInspected = inspectedCell?.i === i && inspectedCell?.j === j;
                      return (
                        <td
                          key={col}
                          className={isSmall ? "p-[2px]" : "p-px"}
                          style={{
                            paddingTop: isRowBoundary ? `${groupGapPx}px` : undefined,
                            paddingLeft: isColBoundary ? `${groupGapPx}px` : undefined,
                          }}
                        >
                          <button
                            type="button"
                            className={`flex items-center justify-center font-medium tabular-nums transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 ${cellSizeClass}`}
                            style={{
                              background: correlationColor(colorValue(r)),
                              color: correlationTextColor(colorValue(r)),
                              boxShadow: isInspected
                                ? "inset 0 0 0 2px #0f172a"
                                : marked
                                  ? `inset 0 0 0 ${pairSelected ? 2 : 1.5}px #0f172a`
                                  : undefined,
                            }}
                            title={`${row} × ${col}: ${Number.isFinite(r) ? r.toFixed(3) : "NA"}`}
                            aria-label={`Select samples ${row} and ${col}; r ${Number.isFinite(r) ? r.toFixed(3) : "NA"}`}
                            aria-pressed={pairSelected}
                            data-cell-index={i * samples.length + j}
                            tabIndex={activeCell === i * samples.length + j ? 0 : -1}
                            onFocus={() => {
                              setActiveCell(i * samples.length + j);
                              setInspectedCell({ i, j });
                            }}
                            onMouseEnter={() => setInspectedCell({ i, j })}
                            onClick={() => onSelectSamples([...new Set([row, col])])}
                            onKeyDown={(e) => {
                              const step = {
                                ArrowRight: [0, 1],
                                ArrowLeft: [0, -1],
                                ArrowDown: [1, 0],
                                ArrowUp: [-1, 0],
                              }[e.key];
                              if (!step) return;
                              e.preventDefault();
                              const next =
                                Math.max(0, Math.min(samples.length - 1, i + step[0])) *
                                  samples.length +
                                Math.max(0, Math.min(samples.length - 1, j + step[1]));
                              e.currentTarget
                                .closest("table")
                                ?.querySelector<HTMLButtonElement>(`[data-cell-index="${next}"]`)
                                ?.focus();
                            }}
                          >
                            <span className={showValues || !Number.isFinite(r) ? "" : "sr-only"}>
                              {Number.isFinite(r) ? r.toFixed(2) : "—"}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
