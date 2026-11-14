import type {
  ExperimentAnnotation,
  FragPipeDataset,
  ProteinRow,
  QcConclusion,
  VolcanoPoint,
} from "./types";

/** Distinct hues for arbitrary annotation groups (Human/QC keep familiar colors). */
const CONDITION_PALETTE = [
  "#0f766e", // teal
  "#b45309", // amber
  "#1d4ed8", // blue
  "#be185d", // pink
  "#7c3aed", // violet
  "#047857", // green
  "#c2410c", // orange
  "#0e7490", // cyan
  "#a16207", // yellow-brown
  "#475569", // slate
];

const PREFERRED_CONDITION_COLORS: Record<string, string> = {
  "group a": "#0f766e",
  "group b": "#b45309",
  human: "#0f766e",
  qc: "#b45309",
};

/** Stable color map for every condition/group label present. */
export function buildConditionColorMap(conditions: string[]): Record<string, string> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const c of conditions) {
    const g = (c ?? "").trim() || "Unknown";
    if (seen.has(g)) continue;
    seen.add(g);
    unique.push(g);
  }
  const map: Record<string, string> = { Unknown: "#64748b" };
  let paletteIdx = 0;
  for (const g of unique) {
    const preferred = PREFERRED_CONDITION_COLORS[g.toLowerCase()];
    if (preferred) {
      map[g] = preferred;
      continue;
    }
    // skip palette slots that match preferred hues already used
    while (
      paletteIdx < CONDITION_PALETTE.length &&
      Object.values(map).includes(CONDITION_PALETTE[paletteIdx])
    ) {
      paletteIdx += 1;
    }
    map[g] =
      CONDITION_PALETTE[paletteIdx % CONDITION_PALETTE.length] ?? "#64748b";
    paletteIdx += 1;
  }
  return map;
}

export function conditionColor(
  condition: string,
  colorMap: Record<string, string>,
): string {
  const g = (condition ?? "").trim() || "Unknown";
  return colorMap[g] ?? colorMap.Unknown ?? "#64748b";
}

/** Order samples by condition (annotation order), then sample name. */
export function samplesOrderedByCondition(dataset: FragPipeDataset): string[] {
  const cond = conditionMap(dataset.annotation);
  const groupOrder = annotationGroups(dataset);
  const rank = new Map(groupOrder.map((g, i) => [g, i]));
  return [...dataset.samples].sort((a, b) => {
    const ca = cond.get(a) ?? "Unknown";
    const cb = cond.get(b) ?? "Unknown";
    const ra = rank.has(ca) ? rank.get(ca)! : 999;
    const rb = rank.has(cb) ? rank.get(cb)! : 999;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

/** Per-group QC aggregates for summary + intensity table. */
export function groupQcStats(
  miss: ReturnType<typeof missingnessBySample>,
  boxes: ReturnType<typeof intensityBoxBySample>,
): {
  condition: string;
  nSamples: number;
  meanMissingPct: number;
  medianOfMedians: number;
  samples: string[];
}[] {
  const boxBy = new Map(boxes.map((b) => [b.sample, b]));
  const byCond = new Map<string, typeof miss>();
  for (const m of miss) {
    const list = byCond.get(m.condition) ?? [];
    list.push(m);
    byCond.set(m.condition, list);
  }
  // Preserve first-seen condition order from miss (already condition-sorted)
  const order: string[] = [];
  const seen = new Set<string>();
  for (const m of miss) {
    if (seen.has(m.condition)) continue;
    seen.add(m.condition);
    order.push(m.condition);
  }
  return order.map((condition) => {
    const rows = byCond.get(condition) ?? [];
    const meanMissingPct =
      rows.length === 0
        ? 0
        : (rows.reduce((s, r) => s + r.missingFraction, 0) / rows.length) * 100;
    const medians = rows
      .map((r) => boxBy.get(r.sample)?.median)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const medianOfMedians =
      medians.length === 0
        ? 0
        : medians.reduce((a, b) => a + b, 0) / medians.length;
    return {
      condition,
      nSamples: rows.length,
      meanMissingPct: Math.round(meanMissingPct * 10) / 10,
      medianOfMedians,
      samples: rows.map((r) => r.sample),
    };
  });
}

export function missingnessBySample(dataset: FragPipeDataset): {
  sample: string;
  condition: string;
  missingFraction: number;
  missingCount: number;
  total: number;
}[] {
  const cond = conditionMap(dataset.annotation);
  const n = dataset.proteins.length;
  const samples = samplesOrderedByCondition(dataset);
  return samples.map((sample) => {
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

/** Count every positive finite observation; only the aggregated bins are plotted. */
export function intensityHistogram(dataset: FragPipeDataset, binCount = 30) {
  if (!Number.isInteger(binCount) || binCount < 1) throw new Error("binCount must be a positive integer");
  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  for (const protein of dataset.proteins) {
    for (const sample of dataset.samples) {
      const raw = protein.maxlfq[sample];
      if (!(raw > 0) || !Number.isFinite(raw)) continue;
      const value = Math.log10(raw);
      min = Math.min(min, value);
      max = Math.max(max, value);
      total += 1;
    }
  }
  if (!total) return { bins: [], total: 0 };
  // Constant data occupies one explicitly bounded bin.
  const count = min === max ? 1 : binCount;
  const start = min === max ? min - 0.5 : min;
  const end = min === max ? max + 0.5 : max;
  const width = (end - start) / count;
  const bins = Array.from({ length: count }, (_, i) => ({
    lower: start + i * width,
    upper: i === count - 1 ? end : start + (i + 1) * width,
    midpoint: start + (i + 0.5) * width,
    count: 0,
  }));
  for (const protein of dataset.proteins) {
    for (const sample of dataset.samples) {
      const raw = protein.maxlfq[sample];
      if (!(raw > 0) || !Number.isFinite(raw)) continue;
      const index = Math.max(0, Math.min(count - 1, Math.floor((Math.log10(raw) - start) / width)));
      bins[index].count += 1;
    }
  }
  return { bins, total };
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
  const samples = samplesOrderedByCondition(dataset);
  const bySample = new Map<string, number[]>();
  for (const sample of samples) bySample.set(sample, []);
  for (const p of dataset.proteins) {
    for (const sample of samples) {
      const raw = p.maxlfq[sample] ?? 0;
      if (raw <= 0 || !Number.isFinite(raw)) continue;
      bySample.get(sample)!.push(Math.log10(raw));
    }
  }
  return samples.map((sample) => {
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
  /** Parallel to samples — condition/group from annotation */
  conditions: string[];
} {
  const samples = samplesOrderedByCondition(dataset);
  const cond = conditionMap(dataset.annotation);
  const conditions = samples.map((s) => cond.get(s) ?? "Unknown");
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
  return { samples, matrix, conditions };
}

function conditionMap(annotation: ExperimentAnnotation[]) {
  const m = new Map<string, string>();
  for (const a of annotation) m.set(a.sample, a.condition);
  return m;
}

/** Unique condition/group labels that have ≥1 MaxLFQ-mapped sample. */
export function annotationGroups(dataset: FragPipeDataset): string[] {
  const sampleSet = new Set(dataset.samples);
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const a of dataset.annotation) {
    const g = (a.condition ?? "").trim();
    if (!g || seen.has(g)) continue;
    if (!sampleSet.has(a.sample)) continue;
    seen.add(g);
    groups.push(g);
  }
  return groups;
}

/** How many MaxLFQ samples resolve to each annotation group. */
export function groupSampleCounts(
  dataset: FragPipeDataset,
): { group: string; n: number; samples: string[] }[] {
  return annotationGroups(dataset).map((group) => {
    const samples = samplesForGroup(dataset, group);
    return { group, n: samples.length, samples };
  });
}

/** Prefer Human vs QC when both exist; otherwise the first two groups. */
export function defaultGroupPair(groups: string[]): {
  groupA: string;
  groupB: string;
} {
  const find = (re: RegExp) => groups.find((g) => re.test(g));
  const human = find(/^human$/i);
  const qc = find(/^qc$/i);
  if (human && qc) return { groupA: human, groupB: qc };
  if (groups.length >= 2) return { groupA: groups[0], groupB: groups[1] };
  return { groupA: groups[0] ?? "", groupB: "" };
}

function normalizeContrastToken(s: string): string {
  return s.trim().toLowerCase().replace(/[_\s-]+/g, "");
}

/**
 * Match a FragPipe limma contrast column to groupA vs groupB.
 * Returns the contrast key and whether log2FC must be flipped (B_vs_A found).
 */
export function matchLimmaContrast(
  contrasts: string[],
  groupA: string,
  groupB: string,
): { contrast: string; flip: boolean } | null {
  if (!groupA || !groupB || groupA === groupB) return null;
  const a = normalizeContrastToken(groupA);
  const b = normalizeContrastToken(groupB);
  if (!a || !b || a === b) return null;

  for (const c of contrasts) {
    const parts = c.split(/\s*_vs_\s*|\s+vs\s+|\s+versus\s+/i);
    if (parts.length === 2) {
      const left = normalizeContrastToken(parts[0]);
      const right = normalizeContrastToken(parts[1]);
      if (left === a && right === b) return { contrast: c, flip: false };
      if (left === b && right === a) return { contrast: c, flip: true };
    }
    // FragPipe sometimes concatenates without a separator after stripping
    // punctuation: "CTRKvsFLU" / "ctrkflu" style tokens.
    const n = normalizeContrastToken(c);
    if (n === `${a}vs${b}` || n === `${a}${b}`) {
      return { contrast: c, flip: false };
    }
    if (n === `${b}vs${a}` || n === `${b}${a}`) {
      return { contrast: c, flip: true };
    }
  }
  // Fallback: loose "human…qc" style substring match for legacy labels
  const loose = contrasts.find((c) => {
    const n = normalizeContrastToken(c);
    return n.includes(a) && n.includes(b) && a !== b;
  });
  if (loose) {
    const n = normalizeContrastToken(loose);
    const ai = n.indexOf(a);
    const bi = n.indexOf(b);
    return { contrast: loose, flip: ai > bi };
  }
  return null;
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
  opts?: {
    log2fcThreshold?: number;
    adjPThreshold?: number;
    /** Multiply log2FC by -1 when the stored contrast is reversed */
    flipLog2fc?: boolean;
  },
): VolcanoPoint[] {
  const fcThr = opts?.log2fcThreshold ?? 1;
  const pThr = opts?.adjPThreshold ?? 0.05;
  const flip = opts?.flipLog2fc ? -1 : 1;
  const points: VolcanoPoint[] = [];
  for (const p of dataset.proteins) {
    const rawFc = p.log2fc[contrast];
    const adjP = p.adjP[contrast];
    if (rawFc === undefined || adjP === undefined) continue;
    const log2fc = rawFc * flip;
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
      proteinProbability: p.proteinProbability,
    });
  }
  return points;
}

function samplesForGroup(dataset: FragPipeDataset, group: string): string[] {
  const want = group.trim().toLowerCase();
  const sampleSet = new Set(dataset.samples);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of dataset.annotation) {
    if (a.condition.trim().toLowerCase() !== want) continue;
    const s = a.sample;
    if (!sampleSet.has(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function meanOrZero(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((x, y) => x + y, 0) / vals.length;
}

/**
 * Approximate DE for any two annotation groups from MaxLFQ group means
 * (demo only when limma adj-p columns are absent for that contrast).
 * Proteins detected in only one group are kept (missing group mean = 0).
 */
export function approximateGroupContrast(
  dataset: FragPipeDataset,
  groupA: string,
  groupB: string,
  opts?: { log2fcThreshold?: number; adjPThreshold?: number },
): { contrast: string; points: VolcanoPoint[] } | null {
  if (!groupA || !groupB || groupA === groupB) return null;
  const aSamples = samplesForGroup(dataset, groupA);
  const bSamples = samplesForGroup(dataset, groupB);
  if (aSamples.length === 0 || bSamples.length === 0) return null;

  const fcThr = opts?.log2fcThreshold ?? 1;
  const pThr = opts?.adjPThreshold ?? 0.05;
  const points: VolcanoPoint[] = [];
  for (const p of dataset.proteins) {
    const aVals = aSamples.map((s) => p.maxlfq[s] ?? 0).filter((v) => v > 0);
    const bVals = bSamples.map((s) => p.maxlfq[s] ?? 0).filter((v) => v > 0);
    // Keep proteins observed in at least one of the two groups.
    if (aVals.length === 0 && bVals.length === 0) continue;
    const aMean = meanOrZero(aVals);
    const bMean = meanOrZero(bVals);
    const log2fc = Math.log2((aMean + 1) / (bMean + 1));
    const t = Math.abs(log2fc) / 0.4;
    // Deterministic pseudo-p from effect size (demo only; not a real DE test)
    const adjP = Math.min(
      1,
      Math.max(1e-12, Math.exp(-0.5 * t * t)),
    );
    const significant = Math.abs(log2fc) >= fcThr && adjP <= pThr;
    points.push({
      proteinId: p.proteinId,
      gene: p.gene || p.proteinId,
      log2fc,
      adjP,
      negLog10AdjP: -Math.log10(adjP),
      significant,
      direction: !significant ? "ns" : log2fc > 0 ? "up" : "down",
      proteinProbability: p.proteinProbability,
    });
  }
  return {
    contrast: `${groupA}_vs_${groupB} (approx from MaxLFQ)`,
    points,
  };
}

/** @deprecated Prefer approximateGroupContrast(dataset, "Human", "QC") */
export function approximateHumanVsQc(
  dataset: FragPipeDataset,
): { contrast: string; points: VolcanoPoint[] } | null {
  const groups = annotationGroups(dataset);
  const human = groups.find((g) => /^human$/i.test(g));
  const qc = groups.find((g) => /^qc$/i.test(g));
  if (!human || !qc) return null;
  return approximateGroupContrast(dataset, human, qc);
}

/**
 * Build volcano points for a selected group pair: reuse limma columns when
 * present, otherwise MaxLFQ group-mean approximation.
 */
export function volcanoForGroups(
  dataset: FragPipeDataset,
  groupA: string,
  groupB: string,
  opts?: { log2fcThreshold?: number; adjPThreshold?: number },
): {
  points: VolcanoPoint[];
  contrastLabel: string;
  approximated: boolean;
  ready: boolean;
  /** Why limma/MaxLFQ mapping failed when points are empty. */
  emptyReason?: string;
} {
  const canCompare = Boolean(groupA && groupB && groupA !== groupB);
  if (!canCompare) {
    return {
      points: [],
      contrastLabel: "—",
      approximated: false,
      ready: false,
    };
  }
  const matched = matchLimmaContrast(dataset.contrasts, groupA, groupB);
  if (matched) {
    const points = buildVolcano(dataset, matched.contrast, {
      ...opts,
      flipLog2fc: matched.flip,
    });
    return {
      points,
      contrastLabel: matched.flip
        ? `${groupA} vs ${groupB} (from ${matched.contrast}, FC flipped)`
        : matched.contrast,
      approximated: false,
      ready: true,
      emptyReason:
        points.length === 0
          ? `Limma contrast "${matched.contrast}" matched, but no proteins had both log2FC and adjusted p-value.`
          : undefined,
    };
  }
  const aSamples = samplesForGroup(dataset, groupA);
  const bSamples = samplesForGroup(dataset, groupB);
  const approx = approximateGroupContrast(dataset, groupA, groupB, opts);
  if (!approx) {
    return {
      points: [],
      contrastLabel: `${groupA} vs ${groupB}`,
      approximated: true,
      ready: true,
      emptyReason:
        `No limma columns for ${groupA} vs ${groupB}, and MaxLFQ mapping found ` +
        `${aSamples.length} sample(s) in ${groupA} and ${bSamples.length} in ${groupB}. ` +
        `Annotation \`sample\` must match MaxLFQ prefixes.`,
    };
  }
  return {
    points: approx.points,
    contrastLabel: approx.contrast,
    approximated: true,
    ready: true,
    emptyReason:
      approx.points.length === 0
        ? `Mapped ${aSamples.length} / ${bSamples.length} MaxLFQ samples for ${groupA} / ${groupB}, but no proteins had intensity in either group.`
        : undefined,
  };
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
  const groups = groupQcStats(miss, boxes);
  const colorMap = buildConditionColorMap(groups.map((g) => g.condition));
  const conclusions = buildQcConclusionsFrom({
    miss,
    boxes,
    correlation,
    scatter,
    groups,
  });
  return { miss, boxes, correlation, scatter, groups, colorMap, conclusions };
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
  groups: ReturnType<typeof groupQcStats>;
}): QcConclusion[] {
  const conclusions: QcConclusion[] = [];
  const { miss, boxes, correlation, scatter, groups } = parts;
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

  if (groups.length > 0) {
    const groupList = groups
      .map(
        (g) =>
          `${g.condition} (n=${g.nSamples}, mean missing ${g.meanMissingPct.toFixed(1)}%)`,
      )
      .join("; ");
    conclusions.push({
      id: "groups-overview",
      severity: "info",
      title:
        groups.length === 1
          ? `One annotation group: ${groups[0].condition}`
          : `${groups.length} annotation groups in experiment_annotation`,
      detail: groupList,
      plotId: "missingness",
      plotLabel: "Missingness",
      group: "conventional",
    });
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
