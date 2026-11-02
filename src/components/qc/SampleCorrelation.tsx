"use client";

import { useMemo } from "react";
import {
  buildConditionColorMap,
  conditionColor,
  sampleCorrelationMatrix,
} from "@/lib/stats";
import type { FragPipeDataset } from "@/lib/types";

function colorForR(r: number): string {
  if (!Number.isFinite(r)) return "#e2e8f0";
  const t = Math.max(0, Math.min(1, (r - 0.5) / 0.5));
  const rC = Math.round(180 - t * 140);
  const gC = Math.round(100 + t * 60);
  const bC = Math.round(40 + t * 70);
  return `rgb(${rC},${gC},${bC})`;
}

export function SampleCorrelation({
  dataset,
  matrix: precomputed,
  colorMap: colorMapProp,
}: {
  dataset: FragPipeDataset;
  matrix?: ReturnType<typeof sampleCorrelationMatrix>;
  colorMap?: Record<string, string>;
}) {
  const { samples, matrix, conditions } =
    precomputed ?? sampleCorrelationMatrix(dataset);
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of conditions) {
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
    return out;
  }, [conditions]);
  const colorMap = colorMapProp ?? buildConditionColorMap(groups);

  return (
    <div>
      <header className="mb-3">
        <h3 className="text-lg font-semibold text-slate-900">
          Sample correlation
        </h3>
        <p className="text-sm text-slate-600">
          Pairwise Pearson correlation of log<sub>10</sub>(MaxLFQ) across
          proteins (pairwise-complete; zeros excluded). Samples are ordered by
          annotation group so within-group blocks sit on the diagonal.
        </p>
      </header>

      <ul className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
        {groups.map((g) => (
          <li key={g} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: conditionColor(g, colorMap) }}
            />
            {g}
          </li>
        ))}
      </ul>

      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="p-1" />
              {samples.map((s, i) => (
                <th
                  key={s}
                  className="max-w-[4.5rem] truncate p-1 font-medium"
                  title={`${s} (${conditions[i]})`}
                  style={{
                    writingMode: "vertical-rl",
                    transform: "rotate(180deg)",
                    color: conditionColor(conditions[i], colorMap),
                  }}
                >
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {samples.map((row, i) => (
              <tr key={row}>
                <th
                  className="whitespace-nowrap pr-2 text-right font-medium"
                  title={`${row} (${conditions[i]})`}
                  style={{ color: conditionColor(conditions[i], colorMap) }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{
                        background: conditionColor(conditions[i], colorMap),
                      }}
                    />
                    {row}
                  </span>
                </th>
                {samples.map((col, j) => {
                  const r = matrix[i][j];
                  return (
                    <td key={col} className="p-0.5">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-sm text-[10px] font-medium text-white"
                        style={{ background: colorForR(r) }}
                        title={`${row} (${conditions[i]}) × ${col} (${conditions[j]}): ${Number.isFinite(r) ? r.toFixed(3) : "NA"}`}
                      >
                        {Number.isFinite(r) ? r.toFixed(2) : "—"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Color scale: lower r → amber, higher r → teal. Diagonal is 1.00. Axis
        labels use annotation-group colors.
      </p>
    </div>
  );
}
