/**
 * Scriptable custom-plot contract (AI + human).
 * See docs/custom-plot-script-api.md for the full consumer guide.
 */

import type {
  ChartSpec,
  ChartSpecType,
  ScriptPlotLanguage,
  UserCustomPlotSpec,
} from "@/lib/types";
import { newUserPlotId } from "@/lib/custom-plot-metrics";

export const CUSTOM_PLOT_REGISTER_EVENT = "proteomics:register-custom-plot";

export const SCRIPT_LIMITS = {
  maxSourceChars: 12_000,
  maxSamples: 500,
  timeoutMs: 3_000,
  maxDataRows: 2_000,
} as const;

export const ALLOWED_CHART_TYPES: readonly ChartSpecType[] = [
  "bar",
  "scatter",
  "histogram",
  "line",
];

export type CustomPlotRunRequest = {
  language: ScriptPlotLanguage;
  source: string;
  samples: Array<Record<string, string | number>>;
  inputs?: Record<string, string | number | boolean>;
};

export type CustomPlotRunResponse =
  | { ok: true; chartSpec: ChartSpec }
  | { ok: false; error: string };

/** Payload AI / host can dispatch to add a scripted plot to the QC session. */
export type ScriptPlotRegistration = {
  id?: string;
  title: string;
  language: ScriptPlotLanguage;
  source: string;
  inputs?: Record<string, string | number | boolean>;
  chartSpec?: ChartSpec;
};

export function isChartSpec(value: unknown): value is ChartSpec {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!ALLOWED_CHART_TYPES.includes(v.type as ChartSpecType)) return false;
  if (!Array.isArray(v.data)) return false;
  if (v.data.length > SCRIPT_LIMITS.maxDataRows) return false;
  if (typeof v.xKey !== "string" || !v.xKey) return false;
  if (typeof v.yKey !== "string" || !v.yKey) return false;
  return true;
}

export function parseScriptRegistration(
  input: unknown,
): { spec: UserCustomPlotSpec } | { error: string } {
  if (!input || typeof input !== "object") {
    return { error: "Registration must be an object" };
  }
  const raw = input as Record<string, unknown>;

  // Allow full UserCustomPlotSpec with kind script.
  if (raw.kind === "script") {
    const language =
      raw.language === "js" || raw.language === "javascript"
        ? "js"
        : raw.language === "python" || raw.language === undefined
          ? "python"
          : null;
    if (!language) return { error: "language must be python or js" };
    if (typeof raw.source !== "string" || !raw.source.trim()) {
      return { error: "source is required for script plots" };
    }
    if (raw.source.length > SCRIPT_LIMITS.maxSourceChars) {
      return { error: `source exceeds ${SCRIPT_LIMITS.maxSourceChars} characters` };
    }
    const id =
      typeof raw.id === "string" && raw.id.startsWith("user-")
        ? (raw.id as `user-${string}`)
        : newUserPlotId();
    const title =
      typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim()
        : "Script plot";
    const chartSpec = raw.chartSpec;
    if (chartSpec !== undefined && !isChartSpec(chartSpec)) {
      return { error: "chartSpec is invalid" };
    }
    const inputs =
      raw.inputs && typeof raw.inputs === "object" && !Array.isArray(raw.inputs)
        ? (raw.inputs as Record<string, string | number | boolean>)
        : undefined;
    return {
      spec: {
        id,
        kind: "script",
        title,
        language,
        source: raw.source,
        inputs,
        chartSpec: chartSpec as ChartSpec | undefined,
      },
    };
  }

  const language =
    raw.language === "js" || raw.language === "javascript"
      ? "js"
      : raw.language === "python" || raw.language === undefined
        ? "python"
        : null;
  if (!language) return { error: "language must be python or js" };
  if (typeof raw.source !== "string" || !raw.source.trim()) {
    return { error: "source is required" };
  }
  if (raw.source.length > SCRIPT_LIMITS.maxSourceChars) {
    return { error: `source exceeds ${SCRIPT_LIMITS.maxSourceChars} characters` };
  }
  if (typeof raw.title !== "string" || !raw.title.trim()) {
    return { error: "title is required" };
  }
  if (raw.chartSpec !== undefined && !isChartSpec(raw.chartSpec)) {
    return { error: "chartSpec is invalid" };
  }
  const id =
    typeof raw.id === "string" && raw.id.startsWith("user-")
      ? (raw.id as `user-${string}`)
      : newUserPlotId();
  const inputs =
    raw.inputs && typeof raw.inputs === "object" && !Array.isArray(raw.inputs)
      ? (raw.inputs as Record<string, string | number | boolean>)
      : undefined;

  return {
    spec: {
      id,
      kind: "script",
      title: raw.title.trim(),
      language,
      source: raw.source,
      inputs,
      chartSpec: raw.chartSpec as ChartSpec | undefined,
    },
  };
}

/** Dispatch a registration into the live AppShell session (browser only). */
export function registerCustomPlotInSession(detail: ScriptPlotRegistration | UserCustomPlotSpec) {
  if (typeof window === "undefined") {
    throw new Error("registerCustomPlotInSession is browser-only");
  }
  window.dispatchEvent(
    new CustomEvent(CUSTOM_PLOT_REGISTER_EVENT, { detail }),
  );
}

export function validateRunRequest(
  body: unknown,
): { request: CustomPlotRunRequest } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Body must be a JSON object" };
  const raw = body as Record<string, unknown>;
  const language =
    raw.language === "js" || raw.language === "javascript"
      ? "js"
      : raw.language === "python" || raw.language === undefined
        ? "python"
        : null;
  if (!language) return { error: "language must be python or js" };
  if (typeof raw.source !== "string" || !raw.source.trim()) {
    return { error: "source must be a non-empty string" };
  }
  if (raw.source.length > SCRIPT_LIMITS.maxSourceChars) {
    return { error: `source exceeds ${SCRIPT_LIMITS.maxSourceChars} characters` };
  }
  if (!Array.isArray(raw.samples)) return { error: "samples must be an array" };
  if (raw.samples.length > SCRIPT_LIMITS.maxSamples) {
    return { error: `samples exceeds ${SCRIPT_LIMITS.maxSamples} rows` };
  }
  const inputs =
    raw.inputs && typeof raw.inputs === "object" && !Array.isArray(raw.inputs)
      ? (raw.inputs as Record<string, string | number | boolean>)
      : {};
  return {
    request: {
      language,
      source: raw.source,
      samples: raw.samples as Array<Record<string, string | number>>,
      inputs,
    },
  };
}
