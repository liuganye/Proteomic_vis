"use client";

import { useState } from "react";
import { conditionColor, intensityBoxBySample } from "@/lib/stats";
import { paddedDomain } from "@/lib/qc-plot";
import type { SampleSelectionProps } from "@/lib/types";

type BoxRow = ReturnType<typeof intensityBoxBySample>[number];

/** Five-number summary: whiskers deliberately show min/max, not 1.5 × IQR. */
export function SampleIntensitySummary({
  boxes,
  colorMap,
  domain,
  selectedSamples,
  onSelectSamples,
}: {
  boxes: BoxRow[];
  colorMap: Record<string, string>;
  domain?: [number, number];
} & SampleSelectionProps) {
  const [sort, setSort] = useState("group");
  const [inspectedSample, setInspectedSample] = useState<string | null>(null);
  const ordered =
    sort === "median"
      ? [...boxes].sort(
          (a, b) =>
            Number(b.n > 0) - Number(a.n > 0) ||
            b.median - a.median ||
            a.sample.localeCompare(b.sample),
        )
      : boxes;
  // Keep one common scale for all rows. Never draw empty samples at zero.
  const [min, max] =
    domain ??
    paddedDomain(boxes.filter((b) => b.n > 0).flatMap((b) => [b.min, b.max]));
  const x = (value: number) => ((value - min) / (max - min)) * 100;
  const ticks = Array.from(
    { length: 5 },
    (_, i) => min + ((max - min) * i) / 4,
  );
  const inspected = boxes.find((b) => b.sample === inspectedSample);

  return (
    <section aria-label="Per-sample intensity comparison" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            Compare sample distributions
          </h3>
          <p className="text-sm text-slate-600">
            Box: Q1–Q3 · dark line: median · whiskers: min–max. All rows share
            the same log₁₀ scale.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          Order samples
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
          >
            <option value="group">Annotation group</option>
            <option value="median">Median: high to low</option>
          </select>
        </label>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-[7rem_minmax(0,1fr)_3rem] gap-2 border-b border-slate-200 px-3 pb-2 pt-3 text-[11px] text-slate-500 sm:grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_4rem] sm:gap-3">
          <span>Sample</span>
          <div className="relative h-9">
            <span className="block text-center text-slate-700">
              log₁₀ MaxLFQ
            </span>
            {ticks.map((tick, i) => (
              <span
                key={i}
                className={`absolute bottom-0 ${i % 2 ? "hidden sm:inline" : ""}`}
                style={{
                  left: `${i * 25}%`,
                  transform:
                    i === 0
                      ? undefined
                      : i === 4
                        ? "translateX(-100%)"
                        : "translateX(-50%)",
                }}
              >
                {tick.toFixed(1)}
              </span>
            ))}
          </div>
          <span className="self-end text-right">Median</span>
        </div>
        <div
          className="max-h-96 overflow-y-auto"
          tabIndex={0}
          role="region"
          aria-label="Sample distribution rows; scroll to see all samples"
        >
          {ordered.map((b, i) => {
            const selected = selectedSamples.includes(b.sample);
            const color = conditionColor(b.condition, colorMap);
            const startGroup =
              sort === "group" &&
              (i === 0 || ordered[i - 1].condition !== b.condition);
            return (
              <div key={b.sample}>
                {startGroup && (
                  <div className="sticky top-0 z-10 border-y border-slate-100 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600">
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-sm"
                      style={{ background: color }}
                    />
                    {b.condition}
                  </div>
                )}
                <button
                  type="button"
                  aria-label={`Select sample ${b.sample} in intensity distribution`}
                  aria-pressed={selected}
                  onClick={() => onSelectSamples([b.sample])}
                  onMouseEnter={() => setInspectedSample(b.sample)}
                  onFocus={() => setInspectedSample(b.sample)}
                  className={`grid w-full grid-cols-[7rem_minmax(0,1fr)_3rem] items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 sm:grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_4rem] sm:gap-3 ${selected ? "bg-teal-50 font-semibold ring-1 ring-inset ring-teal-700" : ""}`}
                >
                  <span
                    className="truncate text-slate-700"
                    title={`${b.sample} (${b.condition})`}
                  >
                    {b.sample}
                  </span>
                  <span className="relative block h-4">
                    {ticks.map((_, j) => (
                      <span
                        key={j}
                        className="absolute inset-y-[-6px] border-l border-slate-100"
                        style={{ left: `${j * 25}%` }}
                      />
                    ))}
                    {b.n > 0 ? (
                      <>
                        <span
                          className="absolute top-1/2 border-t border-slate-400"
                          style={{
                            left: `${x(b.min)}%`,
                            width: `${x(b.max) - x(b.min)}%`,
                          }}
                        />
                        {[b.min, b.max].map((value, j) => (
                          <span
                            key={j}
                            className="absolute top-1 h-2 border-l border-slate-400"
                            style={{ left: `${x(value)}%` }}
                          />
                        ))}
                        <span
                          className="absolute top-0.5 h-3 rounded-sm border"
                          style={{
                            left: `${x(b.q1)}%`,
                            width: `${Math.max(0.3, x(b.q3) - x(b.q1))}%`,
                            background: `${color}33`,
                            borderColor: color,
                          }}
                        />
                        <span
                          className="absolute inset-y-0 border-l-2 border-slate-900"
                          style={{ left: `${x(b.median)}%` }}
                        />
                      </>
                    ) : (
                      <span className="absolute inset-0 text-center text-slate-400">
                        No observations
                      </span>
                    )}
                  </span>
                  <span className="text-right tabular-nums text-slate-700">
                    {b.n > 0 ? b.median.toFixed(2) : "—"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div
        className="min-h-12 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600"
        role="status"
      >
        {inspected ? (
          <>
            <strong className="text-slate-900">{inspected.sample}</strong> ·{" "}
            {inspected.condition} · {inspected.n.toLocaleString()} observed
            proteins
            {inspected.n > 0 && (
              <>
                {" "}
                · Q1 {inspected.q1.toFixed(2)} · median{" "}
                {inspected.median.toFixed(2)} · Q3 {inspected.q3.toFixed(2)} ·
                range {inspected.min.toFixed(2)}–{inspected.max.toFixed(2)}
              </>
            )}
          </>
        ) : (
          "Hover or focus a row for exact values. Select it to highlight the sample across QC and protein abundance."
        )}
      </div>
    </section>
  );
}
