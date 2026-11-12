export type SectionId = "qc" | "downstream";

export type SampleSelectionProps = {
  selectedSamples: string[];
  onSelectSamples: (samples: string[]) => void;
};

/** Conventional FragPipe Analyst–style QC plots */
export type QcConventionalPlotId =
  | "missingness"
  | "intensity"
  | "correlation";

/** Built-in project-specific QC plots */
export type QcCustomPlotId = "median-vs-missing";

/** User-authored plot id (`user-<uuid>`). */
export type QcUserPlotId = `user-${string}`;

export type QcPlotId = QcConventionalPlotId | QcCustomPlotId | QcUserPlotId;

/** Chart types available in the Custom plots builder. */
export type CustomPlotKind = "scatter" | "bar" | "histogram";

/**
 * Sample-level metrics / columns available for custom QC plots
 * (joined missingness + intensity summaries + annotation group).
 */
export type SampleMetricKey =
  | "sample"
  | "group"
  | "missingPct"
  | "medianLog10"
  | "nDetected"
  | "q1"
  | "q3";

/** Session/UI spec for one user-defined custom plot. */
export interface UserCustomPlotSpec {
  id: QcUserPlotId;
  kind: CustomPlotKind;
  /** Optional display title; auto-generated when empty. */
  title: string;
  /** Scatter/bar X; ignored for histogram. */
  xKey?: SampleMetricKey;
  /** Scatter Y or bar value. */
  yKey?: SampleMetricKey;
  /** Histogram value column. */
  valueKey?: SampleMetricKey;
  /** Optional color / group encoding (typically annotation group). */
  colorBy?: "group" | "none";
}

/** @deprecated Prefer QcPlotId; kept for nav compatibility */
export type QcModuleId = QcPlotId;

export type DownstreamModuleId = "volcano" | "results" | "go";

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
  /** Optional FragPipe `sample_name` column (alias for matching MaxLFQ). */
  sampleName?: string;
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
}

export interface FragPipeDataset {
  proteins: ProteinRow[];
  samples: string[];
  maxlfqColumns: string[];
  contrasts: string[];
  annotation: ExperimentAnnotation[];
  source: "mock" | "upload" | "real";
  proteinFileName?: string;
  annotationFileName?: string;
  /**
   * Set when experiment_annotation sample IDs could not be matched to
   * MaxLFQ column prefixes and groups were inferred from intensity headers.
   */
  annotationWarning?: string;
}

export interface LoadState {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  dataset?: FragPipeDataset;
  /** Human-readable progress while status === "loading" */
  progress?: string;
  /** 0–1 parse progress when known */
  progressFraction?: number;
}

export interface VolcanoPoint {
  proteinId: string;
  gene: string;
  log2fc: number;
  adjP: number;
  negLog10AdjP: number;
  significant: boolean;
  direction: "up" | "down" | "ns";
  /** From combined_protein `Protein Probability` when present. */
  proteinProbability?: number | null;
}
