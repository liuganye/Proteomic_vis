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
  const keys = headers.map((k) => k.toLowerCase());
  const find = (names: string[]) => {
    const idx = keys.findIndex((k) => names.includes(k));
    return idx;
  };
  const sampleIdx = find(["sample", "sample name", "samplename"]);
  const conditionIdx = find(["condition", "group", "condition name"]);
  const fileIdx = find(["file", "filename", "raw file"]);
  const repIdx = find(["replicate", "rep", "bio_rep"]);

  if (sampleIdx < 0 || conditionIdx < 0) {
    throw new Error(
      "experiment_annotation.tsv needs at least 'sample' and 'condition' columns",
    );
  }

  return rows.slice(1).map((row) => ({
    file: fileIdx >= 0 ? row[fileIdx] ?? "" : "",
    sample: row[sampleIdx] ?? "",
    condition: row[conditionIdx] ?? "",
    replicate: repIdx >= 0 ? row[repIdx] ?? "" : "",
  }));
}

function inferAnnotation(samples: string[]): ExperimentAnnotation[] {
  return samples.map((sample, i) => ({
    file: `${sample}.raw`,
    sample,
    condition: /qc/i.test(sample)
      ? "QC"
      : /human/i.test(sample)
        ? "Human"
        : "Unknown",
    replicate: String(i + 1),
  }));
}

export function buildDataset(opts: {
  proteinText: string;
  annotationText?: string | null;
  source: "mock" | "upload";
  proteinFileName?: string;
  annotationFileName?: string;
}): FragPipeDataset {
  const core = parseCombinedProtein(opts.proteinText);
  const annotation =
    opts.annotationText && opts.annotationText.trim()
      ? parseExperimentAnnotation(opts.annotationText)
      : inferAnnotation(core.samples);
  return {
    ...core,
    annotation,
    source: opts.source,
    proteinFileName: opts.proteinFileName,
    annotationFileName: opts.annotationFileName,
  };
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
  const annotation =
    opts.annotationText && opts.annotationText.trim()
      ? parseExperimentAnnotation(opts.annotationText)
      : inferAnnotation(core.samples);
  return {
    ...core,
    annotation,
    source: opts.source,
    proteinFileName: opts.proteinFileName,
    annotationFileName: opts.annotationFileName,
  };
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
