import {
  intensityBoxBySample,
  missingnessBySample,
} from "@/lib/stats";
import type {
  CustomPlotKind,
  FragPipeDataset,
  SampleMetricKey,
  UserCustomPlotSpec,
} from "@/lib/types";

export interface SampleMetricRow {
  sample: string;
  group: string;
  missingPct: number;
  medianLog10: number;
  nDetected: number;
  q1: number;
  q3: number;
}

export const SAMPLE_METRIC_OPTIONS: {
  key: SampleMetricKey;
  label: string;
  kind: "categorical" | "numeric";
}[] = [
  { key: "sample", label: "Sample", kind: "categorical" },
  { key: "group", label: "Group (condition)", kind: "categorical" },
  { key: "missingPct", label: "Missingness %", kind: "numeric" },
  { key: "medianLog10", label: "Median log₁₀ MaxLFQ", kind: "numeric" },
  { key: "nDetected", label: "Proteins detected (n)", kind: "numeric" },
  { key: "q1", label: "Q1 log₁₀ MaxLFQ", kind: "numeric" },
  { key: "q3", label: "Q3 log₁₀ MaxLFQ", kind: "numeric" },
];

export function metricLabel(key: SampleMetricKey): string {
  return SAMPLE_METRIC_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

export function isNumericMetric(key: SampleMetricKey): boolean {
  return SAMPLE_METRIC_OPTIONS.find((o) => o.key === key)?.kind === "numeric";
}

export function isCategoricalMetric(key: SampleMetricKey): boolean {
  return SAMPLE_METRIC_OPTIONS.find((o) => o.key === key)?.kind === "categorical";
}

/** Per-sample table for custom plot axes (reuses QC missingness + box metrics). */
export function buildSampleMetricRows(
  dataset: FragPipeDataset,
  miss = missingnessBySample(dataset),
  boxes = intensityBoxBySample(dataset),
): SampleMetricRow[] {
  const boxBy = new Map(boxes.map((b) => [b.sample, b]));
  return miss.map((m) => {
    const box = boxBy.get(m.sample);
    const nDetected = Math.max(0, m.total - m.missingCount);
    return {
      sample: m.sample,
      group: m.condition,
      missingPct: Math.round(m.missingFraction * 1000) / 10,
      medianLog10: box?.median ?? 0,
      nDetected,
      q1: box?.q1 ?? 0,
      q3: box?.q3 ?? 0,
    };
  });
}

export function defaultKeysForKind(kind: CustomPlotKind): {
  xKey?: SampleMetricKey;
  yKey?: SampleMetricKey;
  valueKey?: SampleMetricKey;
  colorBy: "group" | "none";
} {
  if (kind === "scatter") {
    return {
      xKey: "missingPct",
      yKey: "medianLog10",
      colorBy: "group",
    };
  }
  if (kind === "bar") {
    return {
      xKey: "sample",
      yKey: "missingPct",
      colorBy: "group",
    };
  }
  return {
    valueKey: "medianLog10",
    colorBy: "none",
  };
}

export function autoTitle(
  spec: Pick<UserCustomPlotSpec, "kind" | "xKey" | "yKey" | "valueKey">,
): string {
  if (spec.kind === "histogram" && spec.valueKey) {
    return `Histogram · ${metricLabel(spec.valueKey)}`;
  }
  if (spec.kind === "scatter" && spec.xKey && spec.yKey) {
    return `Scatter · ${metricLabel(spec.xKey)} vs ${metricLabel(spec.yKey)}`;
  }
  if (spec.kind === "bar" && spec.xKey && spec.yKey) {
    return `Bar · ${metricLabel(spec.yKey)} by ${metricLabel(spec.xKey)}`;
  }
  return `Custom ${spec.kind}`;
}

export function newUserPlotId(): `user-${string}` {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `user-${rand}`;
}

export function userPlotAnchorId(id: string): string {
  return `qc-plot-${id}`;
}
