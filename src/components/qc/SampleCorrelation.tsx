"use client";

import { sampleCorrelationMatrix } from "@/lib/stats";
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
}: {
  dataset: FragPipeDataset;
  matrix?: ReturnType<typeof sampleCorrelationMatrix>;
}) {
  const { samples, matrix } = precomputed ?? sampleCorrelationMatrix(dataset);

  return (
    <div>
      <header className="mb-3">
        <h3 className="text-lg font-semibold text-slate-900">
          Sample correlation
        </h3>
        <p className="text-sm text-slate-600">
          Pairwise Pearson correlation of log<sub>10</sub>(MaxLFQ) across
          proteins (pairwise-complete; zeros excluded). A PCA-style overview of
          sample similarity without a full dimension-reduction stack.
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="p-1" />
              {samples.map((s) => (
                <th
                  key={s}
                  className="max-w-[4.5rem] truncate p-1 font-medium text-slate-600"
                  title={s}
                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                >
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {samples.map((row, i) => (
              <tr key={row}>
                <th className="whitespace-nowrap pr-2 text-right font-medium text-slate-700">
                  {row}
                </th>
                {samples.map((col, j) => {
                  const r = matrix[i][j];
                  return (
                    <td key={col} className="p-0.5">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-sm text-[10px] font-medium text-white"
                        style={{ background: colorForR(r) }}
                        title={`${row} × ${col}: ${Number.isFinite(r) ? r.toFixed(3) : "NA"}`}
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
        Color scale: lower r → amber, higher r → teal. Diagonal is 1.00.
      </p>
    </div>
  );
}
