import Papa from "papaparse";
import mockFragpipe from "@/data/mock-fragpipe.json";
import type {
  ExperimentAnnotation,
  FragPipeDataset,
  ProteinRow,
} from "./types";

export type ParseProgress = {
  phase: "reading" | "parsing" | "building";
  message: string;
  /** 0–1 when known */
  fraction?: number;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function yieldToUi(): Promise<void> {
  // Prefer setTimeout over rAF — rAF can stall when the tab/dev overlay
  // is backgrounded and made mock load look like a no-op.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Sync TSV → string[][] (array mode is much cheaper than header objects on wide FragPipe tables). */
export function parseTsvRows(text: string): string[][] {
  const result = Papa.parse<string[]>(text, {
    header: false,
    delimiter: "\t",
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  // Papa often reports TooFewFields/TooManyFields as non-fatal "errors".
  if (result.data.length === 0 && result.errors.length > 0) {
    const first = result.errors[0];
    throw new Error(`TSV parse error: ${first.message} (row ${first.row})`);
  }
  return result.data.filter((row) => row.length > 0 && row.some((c) => c !== ""));
}

/** @deprecated Prefer parseTsvRows; kept for callers that want objects. */
export function parseTsv(text: string): Record<string, string>[] {
  const rows = parseTsvRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = cells[i] ?? "";
    }
    return obj;
  });
}

export function detectMaxlfqColumns(headers: string[]): string[] {
  return headers.filter(
    (h) =>
      h.endsWith(" MaxLFQ Intensity") ||
      h.endsWith(" MaxLFQ intensity") ||
      / MaxLFQ Intensity$/i.test(h),
  );
}

export function sampleFromMaxlfqCol(col: string): string {
  return col.replace(/ MaxLFQ Intensity$/i, "");
}

export function detectLog2FcColumns(headers: string[]): string[] {
  return headers.filter((h) => /Log2 Fold Change/i.test(h));
}

export function detectAdjPColumns(headers: string[]): string[] {
  return headers.filter(
    (h) => /Adjusted P-value/i.test(h) || /Adj\.?\s*P-value/i.test(h),
  );
}

export function contrastFromStatCol(col: string): string {
  return col
    .replace(/\s*Log2 Fold Change$/i, "")
    .replace(/\s*Adjusted P-value$/i, "")
    .replace(/\s*Adj\.?\s*P-value$/i, "")
    .trim();
}

function findHeaderIndex(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.toLowerCase());
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

const CHUNK = 400;

export function parseCombinedProtein(
  text: string,
): Omit<
  FragPipeDataset,
  "annotation" | "source" | "proteinFileName" | "annotationFileName"
> {
  // Sync path used by tests / small mocks — same logic as async without yields.
  const rows = parseTsvRows(text);
  if (rows.length < 2) {
    throw new Error("combined_protein.tsv has no data rows");
  }
  return materializeProteins(rows[0], rows.slice(1));
}

export async function parseCombinedProteinAsync(
  text: string,
  onProgress?: (p: ParseProgress) => void,
): Promise<
  Omit<
    FragPipeDataset,
    "annotation" | "source" | "proteinFileName" | "annotationFileName"
  >
> {
  onProgress?.({
    phase: "parsing",
    message: "Tokenizing protein table…",
    fraction: 0.05,
  });
  await yieldToUi();

  const rows = parseTsvRows(text);
  if (rows.length < 2) {
    throw new Error("combined_protein.tsv has no data rows");
  }
  const headers = rows[0];
  const data = rows.slice(1);

  onProgress?.({
    phase: "building",
    message: `Building ${data.length.toLocaleString()} protein rows…`,
    fraction: 0.15,
  });
  await yieldToUi();

  return materializeProteinsAsync(headers, data, onProgress);
}

function materializeProteins(
  headers: string[],
  data: string[][],
): Omit<
  FragPipeDataset,
  "annotation" | "source" | "proteinFileName" | "annotationFileName"
> {
  const plan = columnPlan(headers);
  const proteins: ProteinRow[] = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    proteins[i] = rowFromCells(data[i], plan);
  }
  return {
    proteins,
    samples: plan.samples,
    maxlfqColumns: plan.maxlfqColumns,
    contrasts: plan.contrasts,
  };
}

async function materializeProteinsAsync(
  headers: string[],
  data: string[][],
  onProgress?: (p: ParseProgress) => void,
): Promise<
  Omit<
    FragPipeDataset,
    "annotation" | "source" | "proteinFileName" | "annotationFileName"
  >
> {
  const plan = columnPlan(headers);
  const proteins: ProteinRow[] = new Array(data.length);
  const total = data.length;

  for (let i = 0; i < total; i++) {
    proteins[i] = rowFromCells(data[i], plan);
    if (i > 0 && i % CHUNK === 0) {
      onProgress?.({
        phase: "building",
        message: `Parsed ${i.toLocaleString()} / ${total.toLocaleString()} proteins…`,
        fraction: 0.15 + 0.75 * (i / total),
      });
      await yieldToUi();
    }
  }

  onProgress?.({
    phase: "building",
    message: `Parsed ${total.toLocaleString()} proteins`,
    fraction: 0.95,
  });

  return {
    proteins,
    samples: plan.samples,
    maxlfqColumns: plan.maxlfqColumns,
    contrasts: plan.contrasts,
  };
}

type ColumnPlan = {
  maxlfqColumns: string[];
  samples: string[];
  maxlfqIdx: number[];
  log2Idx: { col: number; contrast: string }[];
  adjPIdx: { col: number; contrast: string }[];
  contrasts: string[];
  proteinIdIdx: number;
  geneIdx: number;
  descIdx: number;
  probIdx: number;
};

function columnPlan(headers: string[]): ColumnPlan {
  const maxlfqColumns = detectMaxlfqColumns(headers);
  if (maxlfqColumns.length === 0) {
    throw new Error(
      "No MaxLFQ Intensity columns found. Expected columns like '{sample} MaxLFQ Intensity'.",
    );
  }
  const samples = maxlfqColumns.map(sampleFromMaxlfqCol);
  const maxlfqIdx = maxlfqColumns.map((c) => headers.indexOf(c));

  const log2Cols = detectLog2FcColumns(headers);
  const adjPCols = detectAdjPColumns(headers);
  const log2Idx = log2Cols.map((c) => ({
    col: headers.indexOf(c),
    contrast: contrastFromStatCol(c),
  }));
  const adjPIdx = adjPCols.map((c) => ({
    col: headers.indexOf(c),
    contrast: contrastFromStatCol(c),
  }));
  const contrasts = Array.from(
    new Set([...log2Idx.map((x) => x.contrast), ...adjPIdx.map((x) => x.contrast)]),
  ).filter(Boolean);

  return {
    maxlfqColumns,
    samples,
    maxlfqIdx,
    log2Idx,
    adjPIdx,
    contrasts,
    proteinIdIdx: findHeaderIndex(headers, [
      "Protein ID",
      "Protein.ID",
      "ProteinID",
    ]),
    geneIdx: findHeaderIndex(headers, ["Gene", "Gene Name", "Gene Names"]),
    descIdx: findHeaderIndex(headers, ["Description", "Protein Description"]),
    probIdx: findHeaderIndex(headers, [
      "Protein Probability",
      "Protein.Probability",
    ]),
  };
}

function rowFromCells(cells: string[], plan: ColumnPlan): ProteinRow {
  const maxlfq: Record<string, number> = {};
  for (let i = 0; i < plan.samples.length; i++) {
    const idx = plan.maxlfqIdx[i];
    maxlfq[plan.samples[i]] = num(cells[idx]) ?? 0;
  }
  const log2fc: Record<string, number> = {};
  for (const { col, contrast } of plan.log2Idx) {
    const v = num(cells[col]);
    if (v !== null) log2fc[contrast] = v;
  }
  const adjP: Record<string, number> = {};
  for (const { col, contrast } of plan.adjPIdx) {
    const v = num(cells[col]);
    if (v !== null) adjP[contrast] = v;
  }
  return {
    proteinId: plan.proteinIdIdx >= 0 ? (cells[plan.proteinIdIdx] ?? "") : "",
    gene: plan.geneIdx >= 0 ? (cells[plan.geneIdx] ?? "") : "",
    description: plan.descIdx >= 0 ? (cells[plan.descIdx] ?? "") : "",
    proteinProbability:
      plan.probIdx >= 0 ? num(cells[plan.probIdx]) : null,
    maxlfq,
    log2fc,
    adjP,
  };
}

export function parseExperimentAnnotation(text: string): ExperimentAnnotation[] {
  const rows = parseTsvRows(text);
  if (rows.length < 2) {
    throw new Error("experiment_annotation.tsv has no data rows");
  }
  const headers = rows[0];
  const keys = headers.map((k) => k.toLowerCase().replace(/[\s_]+/g, ""));
  const find = (names: string[]) => {
    const normalized = names.map((n) => n.toLowerCase().replace(/[\s_]+/g, ""));
    return keys.findIndex((k) => normalized.includes(k));
  };
  // Prefer dedicated `sample` over `sample_name` when both exist.
  const sampleIdx = find(["sample"]);
  const sampleNameIdx = find(["samplename", "sample name"]);
  const resolvedSampleIdx = sampleIdx >= 0 ? sampleIdx : sampleNameIdx;
  const conditionIdx = find(["condition", "group", "conditionname"]);
  const fileIdx = find(["file", "filename", "rawfile"]);
  const repIdx = find(["replicate", "rep", "biorep"]);

  if (resolvedSampleIdx < 0 || conditionIdx < 0) {
    throw new Error(
      "experiment_annotation.tsv needs at least 'sample' and 'condition' columns",
    );
  }

  return rows.slice(1).map((row) => ({
    file: fileIdx >= 0 ? row[fileIdx] ?? "" : "",
    sample: (row[resolvedSampleIdx] ?? "").trim(),
    sampleName:
      sampleNameIdx >= 0 ? (row[sampleNameIdx] ?? "").trim() : undefined,
    condition: (row[conditionIdx] ?? "").trim(),
    replicate: repIdx >= 0 ? (row[repIdx] ?? "").trim() : "",
  }));
}

/** Strip path + extension from a FragPipe `file` / raw path. */
export function fileStem(file: string): string {
  const base = file.split(/[/\\]/).pop() ?? file;
  return base.replace(/\.(raw|mzml|mzXML|d)$/i, "");
}

/** Normalize sample tokens for fuzzy MaxLFQ ↔ annotation matching. */
export function normalizeSampleKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Infer a condition/group label from a MaxLFQ / annotation sample id.
 * `CTRK_1` → CTRK, `Control_3` → Control, `Condition_A_34` → Condition_A,
 * `QC_10` → QC, `CTRL-1` → CTRL.
 */
export function inferConditionFromSample(sample: string): string {
  const s = sample.trim();
  if (!s) return "Unknown";
  if (/^qc([_-]?\d+)?$/i.test(s)) return "QC";
  if (/^human([_-]?\d+)?$/i.test(s)) return "Human";
  // Prefer longest prefix before a trailing _<digits> / -<digits>
  const m = s.match(/^(.*?)[_-](\d+)$/);
  if (m && m[1] && m[1].length > 0) return m[1];
  return s;
}

/** Trailing replicate index when present (`Control_1` → 1, `CTRL-3` → 3). */
export function replicateFromSample(sample: string): number | null {
  const m = sample.trim().match(/[_-](\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Synonym clusters so renamed annotation labels still attach to MaxLFQ
 * prefixes (Control ↔ CTRK/CTRL, Treatment/PTX ↔ residual FLU/DUL by size).
 * Tokens are compared after `normalizeSampleKey`.
 */
const GROUP_SYNONYM_CLUSTERS: string[][] = [
  ["control", "ctrl", "ctrk", "ctl", "vehicle", "veh", "untreated", "wt"],
  ["treatment", "treat", "treated", "tx", "trt", "ptx", "paclitaxel", "drug"],
  ["flu", "influenza", "flu10", "flutreatment"],
  ["dul", "dul10", "duloxetine"],
  ["ubi", "ub", "ubiquitin", "ubiq"],
  ["human", "hela", "hsapiens", "hs"],
  ["qc", "qualitycontrol", "pool", "pooled"],
  ["yeast", "scerevisiae", "sc", "saccharomyces"],
  ["ecoli", "ec", "escherichiacoli"],
];

const SYNONYM_CANON = (() => {
  const map = new Map<string, string>();
  for (const cluster of GROUP_SYNONYM_CLUSTERS) {
    const canon = cluster[0];
    for (const tok of cluster) map.set(normalizeSampleKey(tok), canon);
  }
  return map;
})();

/** Canonical synonym key for a group/prefix token, or the normalized token. */
export function synonymKey(label: string): string {
  const n = normalizeSampleKey(label);
  if (!n) return "";
  if (SYNONYM_CANON.has(n)) return SYNONYM_CANON.get(n)!;
  // Strip trailing digits from tokens like flu10 / dul10 already normalized
  const stripped = n.replace(/\d+$/, "");
  if (stripped && SYNONYM_CANON.has(stripped)) return SYNONYM_CANON.get(stripped)!;
  return n;
}

export function sameSynonymGroup(a: string, b: string): boolean {
  const ka = synonymKey(a);
  const kb = synonymKey(b);
  return Boolean(ka && kb && ka === kb);
}

function previewIds(ids: string[], n = 6): string {
  if (ids.length <= n) return ids.join(", ");
  return `${ids.slice(0, n).join(", ")}… (+${ids.length - n} more)`;
}

type AlignMode = "exact" | "synonym" | "residual" | "positional" | "inferred";

/**
 * Autodetect MaxLFQ sample columns and attach each to an annotation group.
 *
 * Matching rules (in order):
 * 1. **Exact / normalized ID** — annotation `sample`, `sample_name`, or file
 *    stem equals a MaxLFQ prefix (`Control_1 MaxLFQ Intensity` → `Control_1`).
 * 2. **Synonym + replicate** — group/prefix synonyms (Control↔CTRK/CTRL, …)
 *    with matching trailing replicate when available.
 * 3. **Residual cardinality** — leftover annotation conditions paired to
 *    leftover MaxLFQ prefixes with the same sample count (sorted by replicate).
 * 4. **Positional** — only if still unmatched and lengths are equal.
 * 5. **Infer** — derive groups from MaxLFQ prefixes alone.
 */
export function alignAnnotationToSamples(
  annotation: ExperimentAnnotation[],
  samples: string[],
): { annotation: ExperimentAnnotation[]; warning?: string; mode: AlignMode } {
  if (samples.length === 0) {
    return { annotation: [], mode: "inferred" };
  }
  if (!annotation.length) {
    return { annotation: inferAnnotation(samples), mode: "inferred" };
  }

  const byNorm = new Map<string, string>();
  for (const s of samples) {
    const key = normalizeSampleKey(s);
    if (key && !byNorm.has(key)) byNorm.set(key, s);
  }

  const usedMaxlfq = new Set<string>();
  const usedAnn = new Set<number>();
  const matched: ExperimentAnnotation[] = [];
  const pairNotes: string[] = [];

  const pushMatch = (
    row: ExperimentAnnotation,
    maxlfqSample: string,
    annIdx: number,
  ) => {
    if (usedMaxlfq.has(maxlfqSample) || usedAnn.has(annIdx)) return false;
    usedMaxlfq.add(maxlfqSample);
    usedAnn.add(annIdx);
    matched.push({
      ...row,
      sample: maxlfqSample,
      condition: (row.condition || inferConditionFromSample(row.sample)).trim(),
    });
    return true;
  };

  // --- Pass 1: exact / normalized ID ---
  annotation.forEach((row, annIdx) => {
    const candidates = [row.sample, row.sampleName, fileStem(row.file)].filter(
      (c): c is string => Boolean(c && c.trim()),
    );
    for (const c of candidates) {
      let hit: string | undefined;
      if (samples.includes(c) && !usedMaxlfq.has(c)) hit = c;
      else {
        const fuzzy = byNorm.get(normalizeSampleKey(c));
        if (fuzzy && !usedMaxlfq.has(fuzzy)) hit = fuzzy;
      }
      if (hit && pushMatch(row, hit, annIdx)) break;
    }
  });
  const nExact = matched.length;

  // --- Pass 2: synonym + replicate ---
  annotation.forEach((row, annIdx) => {
    if (usedAnn.has(annIdx)) return;
    const annLabels = [
      inferConditionFromSample(row.sample),
      row.condition,
      inferConditionFromSample(row.sampleName ?? ""),
      inferConditionFromSample(fileStem(row.file)),
    ].filter(Boolean);
    const wantRep =
      replicateFromSample(row.sample) ??
      replicateFromSample(row.sampleName ?? "") ??
      replicateFromSample(fileStem(row.file)) ??
      (row.replicate && Number.isFinite(Number(row.replicate))
        ? Number(row.replicate)
        : null);

    const candidates = samples.filter((s) => {
      if (usedMaxlfq.has(s)) return false;
      const pref = inferConditionFromSample(s);
      return annLabels.some((lab) => sameSynonymGroup(lab, pref));
    });
    if (candidates.length === 0) return;

    let hit: string | undefined;
    if (wantRep != null) {
      hit = candidates.find((s) => replicateFromSample(s) === wantRep);
    }
    if (!hit && candidates.length === 1) hit = candidates[0];
    if (hit && pushMatch(row, hit, annIdx)) {
      pairNotes.push(
        `${row.sample || row.condition}↔${hit} (synonym)`,
      );
    }
  });
  const nSynonym = matched.length - nExact;

  // --- Pass 3: residual groups by cardinality ---
  const remainingAnn = annotation
    .map((row, i) => ({ row, i }))
    .filter(({ i }) => !usedAnn.has(i));
  const remainingMax = samples.filter((s) => !usedMaxlfq.has(s));

  if (remainingAnn.length > 0 && remainingMax.length > 0) {
    const annByCond = new Map<string, { row: ExperimentAnnotation; i: number }[]>();
    for (const item of remainingAnn) {
      const cond =
        (item.row.condition || inferConditionFromSample(item.row.sample)).trim() ||
        "Unknown";
      const list = annByCond.get(cond) ?? [];
      list.push(item);
      annByCond.set(cond, list);
    }
    const maxByPref = new Map<string, string[]>();
    for (const s of remainingMax) {
      const pref = inferConditionFromSample(s);
      const list = maxByPref.get(pref) ?? [];
      list.push(s);
      maxByPref.set(pref, list);
    }

    const sortAnn = (
      a: { row: ExperimentAnnotation; i: number },
      b: { row: ExperimentAnnotation; i: number },
    ) => {
      const ra =
        replicateFromSample(a.row.sample) ??
        (Number.isFinite(Number(a.row.replicate))
          ? Number(a.row.replicate)
          : 0);
      const rb =
        replicateFromSample(b.row.sample) ??
        (Number.isFinite(Number(b.row.replicate))
          ? Number(b.row.replicate)
          : 0);
      return ra - rb;
    };
    const sortMax = (a: string, b: string) => {
      const ra = replicateFromSample(a) ?? 0;
      const rb = replicateFromSample(b) ?? 0;
      return ra - rb || a.localeCompare(b);
    };

    const usedCond = new Set<string>();
    const usedPref = new Set<string>();
    const sizes = new Map<number, { ann: string[]; max: string[] }>();
    for (const [cond, rows] of annByCond) {
      const slot = sizes.get(rows.length) ?? { ann: [], max: [] };
      slot.ann.push(cond);
      sizes.set(rows.length, slot);
    }
    for (const [pref, ss] of maxByPref) {
      const slot = sizes.get(ss.length) ?? { ann: [], max: [] };
      slot.max.push(pref);
      sizes.set(ss.length, slot);
    }

    for (const [size, slot] of sizes) {
      if (slot.ann.length !== 1 || slot.max.length !== 1) continue;
      const cond = slot.ann[0];
      const pref = slot.max[0];
      if (usedCond.has(cond) || usedPref.has(pref)) continue;
      const orderedAnn = (annByCond.get(cond) ?? []).slice().sort(sortAnn);
      const orderedMax = (maxByPref.get(pref) ?? []).slice().sort(sortMax);
      for (let k = 0; k < size; k++) {
        pushMatch(orderedAnn[k].row, orderedMax[k], orderedAnn[k].i);
      }
      usedCond.add(cond);
      usedPref.add(pref);
      pairNotes.push(`${cond}↔${pref} (residual n=${size})`);
    }
  }
  const nAfterResidual = matched.length;
  const nResidual = nAfterResidual - nExact - nSynonym;

  // --- Pass 4: positional if still nothing and equal length ---
  let usedPositional = false;
  if (matched.length === 0 && annotation.length === samples.length) {
    usedPositional = true;
    annotation.forEach((row, i) => {
      pushMatch(row, samples[i], i);
    });
    pairNotes.push("positional order (equal sample counts)");
  }

  if (matched.length > 0) {
    const extras = samples
      .filter((s) => !usedMaxlfq.has(s))
      .map((sample, i) => ({
        file: `${sample}.raw`,
        sample,
        sampleName: sample,
        condition: inferConditionFromSample(sample),
        replicate: String(replicateFromSample(sample) ?? i + 1),
      }));

    let mode: AlignMode = "exact";
    if (usedPositional) mode = "positional";
    else if (nExact === annotation.length && nSynonym === 0 && nResidual === 0) {
      mode = "exact";
    } else if (nSynonym > 0) mode = "synonym";
    else if (nResidual > 0) mode = "residual";
    else if (nExact > 0) mode = "exact";

    const needsWarn = mode !== "exact" || matched.length < annotation.length;
    const warning = needsWarn
      ? `Autodetected MaxLFQ→group mapping (${mode}): ${previewIds(
          pairNotes.length
            ? pairNotes
            : matched.map((m) => `${m.condition}:${m.sample}`),
          8,
        )}. Annotation group labels are kept; intensity columns use MaxLFQ sample prefixes.`
      : undefined;
    return {
      annotation: [...matched, ...extras],
      warning,
      mode,
    };
  }

  // --- Pass 5: infer from MaxLFQ only ---
  const inferred = inferAnnotation(samples);
  const annIds = annotation.map((a) => a.sample).filter(Boolean);
  const groups = Array.from(
    new Set(inferred.map((a) => a.condition).filter(Boolean)),
  );
  const warning =
    `Could not map annotation samples (${previewIds(annIds)}) onto MaxLFQ columns (${previewIds(samples)}). ` +
    `Using groups inferred from MaxLFQ prefixes (${groups.join(", ") || "—"}).`;
  return { annotation: inferred, warning, mode: "inferred" };
}

export function inferAnnotation(samples: string[]): ExperimentAnnotation[] {
  return samples.map((sample, i) => {
    const condition = inferConditionFromSample(sample);
    const repMatch = sample.trim().match(/[_-](\d+)$/);
    return {
      file: `${sample}.raw`,
      sample,
      sampleName: sample,
      condition,
      replicate: repMatch?.[1] ?? String(i + 1),
    };
  });
}

function attachAnnotation(
  core: Omit<
    FragPipeDataset,
    "annotation" | "source" | "proteinFileName" | "annotationFileName" | "annotationWarning"
  >,
  annotationText: string | null | undefined,
  meta: {
    source: "mock" | "upload";
    proteinFileName?: string;
    annotationFileName?: string;
  },
): FragPipeDataset {
  const raw =
    annotationText && annotationText.trim()
      ? parseExperimentAnnotation(annotationText)
      : [];
  const { annotation, warning } = alignAnnotationToSamples(raw, core.samples);
  return {
    ...core,
    annotation,
    annotationWarning: warning,
    source: meta.source,
    proteinFileName: meta.proteinFileName,
    annotationFileName: meta.annotationFileName,
  };
}

export function buildDataset(opts: {
  proteinText: string;
  annotationText?: string | null;
  source: "mock" | "upload";
  proteinFileName?: string;
  annotationFileName?: string;
}): FragPipeDataset {
  const core = parseCombinedProtein(opts.proteinText);
  return attachAnnotation(core, opts.annotationText, opts);
}

export async function buildDatasetAsync(
  opts: {
    proteinText: string;
    annotationText?: string | null;
    source: "mock" | "upload";
    proteinFileName?: string;
    annotationFileName?: string;
  },
  onProgress?: (p: ParseProgress) => void,
): Promise<FragPipeDataset> {
  const core = await parseCombinedProteinAsync(opts.proteinText, onProgress);
  onProgress?.({
    phase: "building",
    message: "Applying sample annotation…",
    fraction: 0.97,
  });
  return attachAnnotation(core, opts.annotationText, opts);
}

export async function fetchMockDataset(
  onProgress?: (p: ParseProgress) => void,
): Promise<FragPipeDataset> {
  onProgress?.({
    phase: "reading",
    message: "Loading mock data…",
    fraction: 0.02,
  });

  // 1) Static JSON import — reliable even when /public fetch or dynamic import fails.
  const bundledProtein =
    (mockFragpipe as { proteinText?: string }).proteinText ??
    (mockFragpipe as { default?: { proteinText?: string } }).default?.proteinText;
  const bundledAnn =
    (mockFragpipe as { annotationText?: string }).annotationText ??
    (mockFragpipe as { default?: { annotationText?: string } }).default
      ?.annotationText;
  if (bundledProtein && bundledAnn) {
    return buildDatasetAsync(
      {
        proteinText: bundledProtein,
        annotationText: bundledAnn,
        source: "mock",
        proteinFileName: "combined_protein.tsv (mock)",
        annotationFileName: "experiment_annotation.tsv (mock)",
      },
      onProgress,
    );
  }

  // 2) Fallback: public/ mock TSVs
  const [proteinRes, annRes] = await Promise.all([
    fetch("/mock-data/combined_protein.tsv"),
    fetch("/mock-data/experiment_annotation.tsv"),
  ]);
  if (!proteinRes.ok) {
    throw new Error(
      `Failed to load mock combined_protein.tsv (${proteinRes.status})`,
    );
  }
  if (!annRes.ok) {
    throw new Error(
      `Failed to load mock experiment_annotation.tsv (${annRes.status})`,
    );
  }
  const [proteinText, annotationText] = await Promise.all([
    proteinRes.text(),
    annRes.text(),
  ]);
  return buildDatasetAsync(
    {
      proteinText,
      annotationText,
      source: "mock",
      proteinFileName: "combined_protein.tsv (mock)",
      annotationFileName: "experiment_annotation.tsv (mock)",
    },
    onProgress,
  );
}

export async function readFileAsText(file: File): Promise<string> {
  // file.text() is typically faster than FileReader for modern browsers
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}
