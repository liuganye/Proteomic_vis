import type { FragPipeDataset } from "./types";

/** A padded linear domain; constant and empty data still have a usable axis. */
export function paddedDomain(
  values: number[],
  minimumPadding = 0.15,
): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (min === Infinity) return [0, 1];
  const padding = Math.max(minimumPadding, (max - min) * 0.08);
  return [
    Math.floor((min - padding) * 10) / 10,
    Math.ceil((max + padding) * 10) / 10,
  ];
}

/** Use exactly the positive, finite observations used for Pearson correlation. */
export function sharedProteinCount(
  dataset: FragPipeDataset,
  a: string,
  b: string,
): number {
  return dataset.proteins.reduce((count, protein) => {
    const x = protein.maxlfq[a];
    const y = protein.maxlfq[b];
    return (
      count + Number(x > 0 && Number.isFinite(x) && y > 0 && Number.isFinite(y))
    );
  }, 0);
}
