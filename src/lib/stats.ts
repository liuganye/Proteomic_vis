import type {
  ExperimentAnnotation,
  FragPipeDataset,
  ProteinRow,
  QcConclusion,
  VolcanoPoint,
} from "./types";

export function missingnessBySample(dataset: FragPipeDataset): {
  sample: string;
  condition: string;
  missingFraction: number;
  missingCount: number;
  total: number;
}[] {
  const cond = conditionMap(dataset.annotation);
  const n = dataset.proteins.length;
  return dataset.samples.map((sample) => {
    let missing = 0;
    for (const p of dataset.proteins) {
      const v = p.maxlfq[sample] ?? 0;
      if (v === 0 || !Number.isFinite(v)) missing += 1;
    }
    return {
      sample,
      condition: cond.get(sample) ?? "Unknown",
      missingFraction: n === 0 ? 0 : missing / n,
      missingCount: missing,
      total: n,
    };
  });
}

export function intensityLong(
  dataset: FragPipeDataset,
  opts?: { log10?: boolean; maxPoints?: number },
): { sample: string; condition: string; value: number; proteinId: string }[] {
  const log10 = opts?.log10 ?? true;
  const cond = conditionMap(dataset.annotation);
  const out: {
    sample: string;
    condition: string;
    value: number;
    proteinId: string;
  }[] = [];
  for (const p of dataset.proteins) {
    for (const sample of dataset.samples) {
      const raw = p.maxlfq[sample] ?? 0;
      if (raw <= 0 || !Number.isFinite(raw)) continue;
      const value = log10 ? Math.log10(raw) : raw;
      out.push({
        sample,
        condition: cond.get(sample) ?? "Unknown",
        value,
        proteinId: p.proteinId,
      });
    }
  }
  if (opts?.maxPoints && out.length > opts.maxPoints) {
    // systematic subsample for plotting performance
    const step = Math.ceil(out.length / opts.maxPoints);
    return out.filter((_, i) => i % step === 0);
  }
  return out;
}

export function intensityBoxBySample(dataset: FragPipeDataset): {
  sample: string;
  condition: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  n: number;
}[] {
  // Per-sample accumulation — avoid materializing the full protein×sample long table.
  const cond = conditionMap(dataset.annotation);
  const bySample = new Map<string, number[]>();
  for (const sample of dataset.samples) bySample.set(sample, []);
  for (const p of dataset.proteins) {
    for (const sample of dataset.samples) {
      const raw = p.maxlfq[sample] ?? 0;
      if (raw <= 0 || !Number.isFinite(raw)) continue;
      bySample.get(sample)!.push(Math.log10(raw));
    }
  }
  return dataset.samples.map((sample) => {
    const vals = (bySample.get(sample) ?? []).sort((a, b) => a - b);
    return {
      sample,
      condition: cond.get(sample) ?? "Unknown",
      ...quartiles(vals),
      n: vals.length,
    };
  });
}

function quartiles(sorted: number[]) {
  if (sorted.length === 0) {
    return { min: 0, q1: 0, median: 0, q3: 0, max: 0 };
  }
  const q = (p: number) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
  };
  return {
    min: sorted[0],
    q1: q(0.25),
    median: q(0.5),
    q3: q(0.75),
    max: sorted[sorted.length - 1],
  };
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  let sumA = 0,
    sumB = 0,
    sumAB = 0,
    sumA2 = 0,
    sumB2 = 0;
  let used = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    used += 1;
    sumA += x;
    sumB += y;
    sumAB += x * y;
    sumA2 += x * x;
    sumB2 += y * y;
  }
  if (used < 2) return NaN;
  const num = used * sumAB - sumA * sumB;
  const den = Math.sqrt(
    (used * sumA2 - sumA * sumA) * (used * sumB2 - sumB * sumB),
  );
  if (den === 0) return NaN;
  return num / den;
}

/** Pairwise Pearson on log10 MaxLFQ (zeros treated as missing / skipped). */
export function sampleCorrelationMatrix(dataset: FragPipeDataset): {
  samples: string[];
  matrix: number[][];
} {
  const samples = dataset.samples;
  const vectors = samples.map((sample) =>
    dataset.proteins.map((p) => {
      const v = p.maxlfq[sample] ?? 0;
      return v > 0 ? Math.log10(v) : NaN;
    }),
  );
  const matrix = samples.map((_, i) =>
    samples.map((_, j) => {
      if (i === j) return 1;
      // pairwise complete
      const a: number[] = [];
      const b: number[] = [];
      for (let k = 0; k < vectors[i].length; k++) {
        const x = vectors[i][k];
        const y = vectors[j][k];
        if (Number.isFinite(x) && Number.isFinite(y)) {
          a.push(x);
          b.push(y);
        }
      }
      return pearson(a, b);
    }),
  );
  return { samples, matrix };
}

function conditionMap(annotation: ExperimentAnnotation[]) {
  const m = new Map<string, string>();
  for (const a of annotation) m.set(a.sample, a.condition);
  return m;
}

export function preferHumanVsQcContrast(contrasts: string[]): string | null {
  if (contrasts.length === 0) return null;
  const preferred = contrasts.find((c) =>
    /human.*qc|qc.*human/i.test(c.replace(/[_\s-]+/g, " ")),
  );
  return preferred ?? contrasts[0];
}

export function buildVolcano(
  dataset: FragPipeDataset,
  contrast: string,
  opts?: { log2fcThreshold?: number; adjPThreshold?: number },
): VolcanoPoint[] {
  const fcThr = opts?.log2fcThreshold ?? 1;
  const pThr = opts?.adjPThreshold ?? 0.05;
  const points: VolcanoPoint[] = [];
  for (const p of dataset.proteins) {
    const log2fc = p.log2fc[contrast];
    const adjP = p.adjP[contrast];
    if (log2fc === undefined || adjP === undefined) continue;
    if (!Number.isFinite(log2fc) || !Number.isFinite(adjP) || adjP <= 0)
      continue;
    const significant = Math.abs(log2fc) >= fcThr && adjP <= pThr;
    const direction: VolcanoPoint["direction"] = !significant
      ? "ns"
      : log2fc > 0
        ? "up"
        : "down";
    points.push({
      proteinId: p.proteinId,
      gene: p.gene || p.proteinId,
      log2fc,
      adjP,
      negLog10AdjP: -Math.log10(adjP),
      significant,
      direction,
    });
  }
  return points;
}

/** When no adj-p columns exist, approximate Human vs QC from MaxLFQ means. */
export function approximateHumanVsQc(
  dataset: FragPipeDataset,
): { contrast: string; points: VolcanoPoint[] } | null {
  const human = dataset.annotation
    .filter((a) => /human/i.test(a.condition))
    .map((a) => a.sample)
    .filter((s) => dataset.samples.includes(s));
  const qc = dataset.annotation
    .filter((a) => /^qc$/i.test(a.condition) || /\bqc\b/i.test(a.condition))
    .map((a) => a.sample)
    .filter((s) => dataset.samples.includes(s));
  if (human.length === 0 || qc.length === 0) return null;

  const points: VolcanoPoint[] = [];
  for (const p of dataset.proteins) {
    const hVals = human.map((s) => p.maxlfq[s] ?? 0).filter((v) => v > 0);
    const qVals = qc.map((s) => p.maxlfq[s] ?? 0).filter((v) => v > 0);
    if (hVals.length === 0 || qVals.length === 0) continue;
    const hMean = hVals.reduce((a, b) => a + b, 0) / hVals.length;
    const qMean = qVals.reduce((a, b) => a + b, 0) / qVals.length;
    const log2fc = Math.log2((hMean + 1) / (qMean + 1));
    const t = Math.abs(log2fc) / 0.4;
    // Deterministic pseudo-p from effect size (demo only; not a real DE test)
    const adjP = Math.min(
      1,
      Math.max(1e-12, Math.exp(-0.5 * t * t)),
    );
    const significant = Math.abs(log2fc) >= 1 && adjP <= 0.05;
    points.push({
      proteinId: p.proteinId,
      gene: p.gene || p.proteinId,
      log2fc,
      adjP,
      negLog10AdjP: -Math.log10(adjP),
      significant,
      direction: !significant ? "ns" : log2fc > 0 ? "up" : "down",
    });
  }
  return { contrast: "Human_vs_QC (approx from MaxLFQ)", points };
}

export function resultsTableRows(
  points: VolcanoPoint[],
): (VolcanoPoint & { rank: number })[] {
  return points
    .slice()
    .sort((a, b) => a.adjP - b.adjP || Math.abs(b.log2fc) - Math.abs(a.log2fc))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

export function datasetSummary(dataset: FragPipeDataset) {
  const conditions = Array.from(
    new Set(dataset.annotation.map((a) => a.condition)),
  );
  return {
    nProteins: dataset.proteins.length,
    nSamples: dataset.samples.length,
    nContrasts: dataset.contrasts.length,
    conditions,
    source: dataset.source,
  };
}

export function proteinHasMaxlfq(p: ProteinRow): boolean {
  return Object.values(p.maxlfq).some((v) => v > 0);
}

/** Per-sample median log10 MaxLFQ joined with missingness % — custom QC view. */
export function medianVsMissingness(dataset: FragPipeDataset): {
  sample: string;
  condition: string;
  missingPct: number;
  medianLog10: number;
  nDetected: number;
}[] {
  return medianVsMissingnessFrom(
    missingnessBySample(dataset),
    intensityBoxBySample(dataset),
  );
}

/** One-shot QC metrics so summary + plots share the same pass after upload. */
export function computeQcBundle(dataset: FragPipeDataset) {
  const miss = missingnessBySample(dataset);
  const boxes = intensityBoxBySample(dataset);
  const correlation = sampleCorrelationMatrix(dataset);
  const scatter = medianVsMissingnessFrom(miss, boxes);
  const conclusions = buildQcConclusionsFrom({
    miss,
    boxes,
    correlation,
    scatter,
  });
  return { miss, boxes, correlation, scatter, conclusions };
}

function medianVsMissingnessFrom(
  miss: ReturnType<typeof missingnessBySample>,
  boxes: ReturnType<typeof intensityBoxBySample>,
) {
  const bySample = new Map(boxes.map((b) => [b.sample, b]));
  return miss.map((m) => {
    const box = bySample.get(m.sample);
    return {
      sample: m.sample,
      condition: m.condition,
      missingPct: Math.round(m.missingFraction * 1000) / 10,
      medianLog10: box?.median ?? 0,
      nDetected: box?.n ?? 0,
    };
  });
}

export function buildQcConclusions(dataset: FragPipeDataset): QcConclusion[] {
  return computeQcBundle(dataset).conclusions;
}

function buildQcConclusionsFrom(parts: {
  miss: ReturnType<typeof missingnessBySample>;
  boxes: ReturnType<typeof intensityBoxBySample>;
  correlation: ReturnType<typeof sampleCorrelationMatrix>;
  scatter: ReturnType<typeof medianVsMissingnessFrom>;
}): QcConclusion[] {
  const conclusions: QcConclusion[] = [];
  const { miss, boxes, correlation, scatter } = parts;
  const { samples, matrix } = correlation;

  if (miss.length === 0) {
    conclusions.push({
      id: "no-samples",
      severity: "warn",
      title: "No samples available for QC",
      detail: "Load a protein table with MaxLFQ columns to generate QC plots.",
      plotId: "missingness",
      plotLabel: "Missingness",
      group: "conventional",
    });
    return conclusions;
  }

  const sortedMiss = [...miss].sort(
    (a, b) => b.missingFraction - a.missingFraction,
  );
  const worst = sortedMiss[0];
  const meanMiss =
    miss.reduce((s, m) => s + m.missingFraction, 0) / miss.length;
  const highMiss = miss.filter((m) => m.missingFraction >= 0.35);
  const elevatedMiss = miss.filter(
    (m) => m.missingFraction >= Math.max(0.2, meanMiss + 0.1),
  );

  if (highMiss.length > 0) {
    conclusions.push({
      id: "high-missingness",
      severity: worst.missingFraction >= 0.5 ? "critical" : "warn",
      title: `High missingness in ${highMiss.map((m) => m.sample).join(", ")}`,
      detail: `${worst.sample} is ${(worst.missingFraction * 100).toFixed(1)}% missing (MaxLFQ = 0); ${highMiss.length} sample(s) ≥ 35%.`,
      plotId: "missingness",
      plotLabel: "Missingness",
      group: "conventional",
    });
  } else if (elevatedMiss.length > 0) {
    conclusions.push({
      id: "elevated-missingness",
      severity: "info",
      title: `Elevated missingness in ${elevatedMiss.map((m) => m.sample).join(", ")}`,
      detail: `Above cohort mean (${(meanMiss * 100).toFixed(1)}%): ${elevatedMiss
        .map((m) => `${m.sample} ${(m.missingFraction * 100).toFixed(1)}%`)
        .join("; ")}.`,
      plotId: "missingness",
      plotLabel: "Missingness",
      group: "conventional",
    });
  } else {
    conclusions.push({
      id: "missingness-ok",
      severity: "ok",
      title: "Missingness is broadly consistent across samples",
      detail: `Mean missingness ${(meanMiss * 100).toFixed(1)}%; highest is ${worst.sample} at ${(worst.missingFraction * 100).toFixed(1)}%.`,
      plotId: "missingness",
      plotLabel: "Missingness",
      group: "conventional",
    });
  }

  const withIntensity = boxes.filter((b) => b.n > 0);
  if (withIntensity.length >= 2) {
    const medians = withIntensity.map((b) => b.median);
    const globalMed =
      medians.reduce((a, b) => a + b, 0) / medians.length;
    const sortedMed = [...withIntensity].sort((a, b) => a.median - b.median);
    const low = sortedMed[0];
    const high = sortedMed[sortedMed.length - 1];
    const spread = high.median - low.median;
    const skewed = withIntensity.filter(
      (b) => Math.abs(b.median - globalMed) >= 0.35,
    );

    if (spread >= 0.5 || skewed.length > 0) {
      conclusions.push({
        id: "intensity-skew",
        severity: spread >= 0.8 ? "warn" : "info",
        title:
          skewed.length > 0
            ? `Intensity skew: ${skewed.map((s) => s.sample).join(", ")} off cohort median`
            : `Intensity medians span ${spread.toFixed(2)} log₁₀ units`,
        detail: `Cohort median log₁₀ MaxLFQ ≈ ${globalMed.toFixed(2)}; range ${low.sample} ${low.median.toFixed(2)} → ${high.sample} ${high.median.toFixed(2)}. Check normalization / loading.`,
        plotId: "intensity",
        plotLabel: "Intensity",
        group: "conventional",
      });
    } else {
      conclusions.push({
        id: "intensity-ok",
        severity: "ok",
        title: "Intensity distributions align across samples",
        detail: `Median log₁₀ MaxLFQ ≈ ${globalMed.toFixed(2)}; sample medians within ~${spread.toFixed(2)} log₁₀.`,
        plotId: "intensity",
        plotLabel: "Intensity",
        group: "conventional",
      });
    }
  } else {
    conclusions.push({
      id: "intensity-empty",
      severity: "warn",
      title: "Too few positive intensities for distribution QC",
      detail: "Need non-zero MaxLFQ values in at least two samples.",
      plotId: "intensity",
      plotLabel: "Intensity",
      group: "conventional",
    });
  }

  const offDiag: { a: string; b: string; r: number }[] = [];
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const r = matrix[i][j];
      if (Number.isFinite(r)) offDiag.push({ a: samples[i], b: samples[j], r });
    }
  }
  if (offDiag.length > 0) {
    const sortedR = [...offDiag].sort((a, b) => a.r - b.r);
    const lowest = sortedR[0];
    const lowPairs = sortedR.filter((p) => p.r < 0.7);
    if (lowPairs.length > 0) {
      conclusions.push({
        id: "low-correlation",
        severity: lowest.r < 0.5 ? "critical" : "warn",
        title: `Low correlation between ${lowest.a} / ${lowest.b}`,
        detail: `Pearson r = ${lowest.r.toFixed(3)} (lowest pair)${
          lowPairs.length > 1
            ? `; ${lowPairs.length} pairs with r < 0.70`
            : ""
        }.`,
        plotId: "correlation",
        plotLabel: "Sample correlation",
        group: "conventional",
      });
    } else {
      const meanR =
        offDiag.reduce((s, p) => s + p.r, 0) / offDiag.length;
      conclusions.push({
        id: "correlation-ok",
        severity: "ok",
        title: "Sample correlations are strong",
        detail: `Mean pairwise r = ${meanR.toFixed(3)}; lowest ${lowest.a}×${lowest.b} = ${lowest.r.toFixed(3)}.`,
        plotId: "correlation",
        plotLabel: "Sample correlation",
        group: "conventional",
      });
    }
  }

  // Custom: median vs missingness outliers (high missing + low median)
  if (scatter.length >= 2) {
    const meanMed =
      scatter.reduce((s, d) => s + d.medianLog10, 0) / scatter.length;
    const meanPct =
      scatter.reduce((s, d) => s + d.missingPct, 0) / scatter.length;
    const outliers = scatter.filter(
      (d) =>
        d.missingPct >= meanPct + 8 && d.medianLog10 <= meanMed - 0.2,
    );
    const highMissOnly = scatter
      .filter((d) => d.missingPct >= meanPct + 10)
      .sort((a, b) => b.missingPct - a.missingPct);

    if (outliers.length > 0) {
      conclusions.push({
        id: "custom-outlier",
        severity: "warn",
        title: `Custom QC: ${outliers.map((o) => o.sample).join(", ")} — high missingness + low median`,
        detail: `These samples sit in the upper-left of median vs % missing (suspect dropouts or under-loading).`,
        plotId: "median-vs-missing",
        plotLabel: "Median vs missingness",
        group: "custom",
      });
    } else if (highMissOnly.length > 0) {
      const top = highMissOnly[0];
      conclusions.push({
        id: "custom-high-miss",
        severity: "info",
        title: `Custom QC: ${top.sample} stands out on median vs missingness`,
        detail: `${top.sample}: ${top.missingPct}% missing, median log₁₀ = ${top.medianLog10.toFixed(2)} (cohort means ${meanPct.toFixed(1)}% / ${meanMed.toFixed(2)}).`,
        plotId: "median-vs-missing",
        plotLabel: "Median vs missingness",
        group: "custom",
      });
    } else {
      conclusions.push({
        id: "custom-ok",
        severity: "ok",
        title: "Custom QC: no median–missingness outliers",
        detail: `Samples cluster near cohort means (~${meanPct.toFixed(1)}% missing, median log₁₀ ≈ ${meanMed.toFixed(2)}).`,
        plotId: "median-vs-missing",
        plotLabel: "Median vs missingness",
        group: "custom",
      });
    }
  }

  return conclusions;
}
