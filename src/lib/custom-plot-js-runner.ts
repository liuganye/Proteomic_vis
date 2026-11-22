import vm from "node:vm";
import type { ChartSpec } from "@/lib/types";
import { ALLOWED_CHART_TYPES, SCRIPT_LIMITS } from "@/lib/custom-plot-script";

function normalizeChart(raw: unknown): ChartSpec {
  if (!raw || typeof raw !== "object") {
    throw new Error("chart must be an object");
  }
  const v = raw as Record<string, unknown>;
  if (!ALLOWED_CHART_TYPES.includes(v.type as ChartSpec["type"])) {
    throw new Error(`chart.type must be one of ${ALLOWED_CHART_TYPES.join(", ")}`);
  }
  if (!Array.isArray(v.data)) throw new Error("chart.data must be an array");
  if (v.data.length > SCRIPT_LIMITS.maxDataRows) {
    throw new Error(`chart.data exceeds ${SCRIPT_LIMITS.maxDataRows} rows`);
  }
  const xKey = (v.xKey ?? v.x_key) as unknown;
  const yKey = (v.yKey ?? v.y_key) as unknown;
  if (typeof xKey !== "string" || !xKey) throw new Error("chart.xKey is required");
  if (typeof yKey !== "string" || !yKey) throw new Error("chart.yKey is required");
  const out: ChartSpec = {
    type: v.type as ChartSpec["type"],
    data: v.data as ChartSpec["data"],
    xKey,
    yKey,
  };
  if (typeof v.title === "string" && v.title) out.title = v.title;
  const seriesKey = (v.seriesKey ?? v.series_key) as unknown;
  if (typeof seriesKey === "string" && seriesKey) out.seriesKey = seriesKey;
  const xLabel = (v.xLabel ?? v.x_label) as unknown;
  if (typeof xLabel === "string" && xLabel) out.xLabel = xLabel;
  const yLabel = (v.yLabel ?? v.y_label) as unknown;
  if (typeof yLabel === "string" && yLabel) out.yLabel = yLabel;
  return out;
}

/**
 * Run a JS custom-plot snippet in a constrained Node vm context.
 * No require / process / fetch. Source is executed via vm.Script (not
 * string-spliced into a larger template). Assign `chart` or call `emit(...)`.
 */
export function runJsCustomPlot(options: {
  source: string;
  samples: Array<Record<string, string | number>>;
  inputs?: Record<string, string | number | boolean>;
  timeoutMs?: number;
}): ChartSpec {
  const { source, samples, inputs = {}, timeoutMs = SCRIPT_LIMITS.timeoutMs } = options;
  let emitted: unknown;
  const emit = (chart: unknown) => {
    emitted = chart;
  };

  const sandbox: Record<string, unknown> = {
    samples,
    inputs,
    emit,
    chart: undefined,
    Math,
    JSON: {
      parse: JSON.parse,
      stringify: JSON.stringify,
    },
    console: {
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };

  const context = vm.createContext(sandbox, {
    name: "custom-plot-js",
    codeGeneration: { strings: false, wasm: false },
  });

  const script = new vm.Script(source, {
    filename: "custom-plot.js",
  });
  script.runInContext(context, {
    timeout: timeoutMs,
    displayErrors: true,
  });

  const chart = emitted ?? sandbox.chart;
  if (chart == null) {
    throw new Error("script must assign chart = {...} or call emit(...)");
  }
  return normalizeChart(chart);
}
