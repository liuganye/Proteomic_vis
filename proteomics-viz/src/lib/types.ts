export type SectionId = "qc" | "downstream";

/** Conventional FragPipe Analyst–style QC plots */
export type QcConventionalPlotId =
  | "missingness"
  | "intensity"
  | "correlation";

/** Project-specific / extra QC plots */
export type QcCustomPlotId = "median-vs-missing";

export type QcPlotId = QcConventionalPlotId | QcCustomPlotId;

/** @deprecated Prefer QcPlotId; kept for nav compatibility */
export type QcModuleId = QcPlotId;

export type DownstreamModuleId = "volcano" | "results";

export type ModuleId = QcModuleId | DownstreamModuleId;

export type QcConclusionSeverity = "ok" | "info" | "warn" | "critical";

export interface QcConclusion {
  id: string;
  severity: QcConclusionSeverity;
  /** Short headline shown in the summary list */
  title: string;
  /** One-sentence clear conclusion */
  detail: string;
  /** Plot section to scroll/focus when clicked */
  plotId: QcPlotId;
  plotLabel: string;
  group: "conventional" | "custom";
}

export interface ExperimentAnnotation {
  file: string;
  sample: string;
  condition: string;
  replicate: string;
}

export interface ProteinRow {
  proteinId: string;
  gene: string;
  description: string;
  proteinProbability: number | null;
  /** sample name → MaxLFQ intensity (0 = missing) */
  maxlfq: Record<string, number>;
  /** contrast key → log2 fold change */
  log2fc: Record<string, number>;
  /** contrast key → adjusted p-value */
  adjP: Record<string, number>;
  raw: Record<string, string>;
}

export interface FragPipeDataset {
  proteins: ProteinRow[];
  samples: string[];
  maxlfqColumns: string[];
  contrasts: string[];
  annotation: ExperimentAnnotation[];
  source: "mock" | "upload";
  proteinFileName?: string;
  annotationFileName?: string;
}

export interface LoadState {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  dataset?: FragPipeDataset;
}

export interface VolcanoPoint {
  proteinId: string;
  gene: string;
  log2fc: number;
  adjP: number;
  negLog10AdjP: number;
  significant: boolean;
  direction: "up" | "down" | "ns";
}
