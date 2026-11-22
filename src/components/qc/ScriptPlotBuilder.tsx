"use client";

import { useState } from "react";
import { SCRIPT_EXAMPLES } from "@/lib/custom-plot-examples";
import type { SampleMetricRow } from "@/lib/custom-plot-metrics";
import { newUserPlotId } from "@/lib/custom-plot-metrics";
import type {
  CustomPlotRunResponse,
} from "@/lib/custom-plot-script";
import type {
  ScriptPlotLanguage,
  UserCustomPlotSpec,
} from "@/lib/types";

export function ScriptPlotBuilder({
  sampleRows,
  onAdd,
}: {
  sampleRows: SampleMetricRow[];
  onAdd: (spec: UserCustomPlotSpec) => void;
}) {
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<ScriptPlotLanguage>("python");
  const [source, setSource] = useState(SCRIPT_EXAMPLES[0]?.source ?? "");
  const [status, setStatus] = useState<
    "idle" | "loading" | "error" | "ready"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const loadExample = (id: string) => {
    const ex = SCRIPT_EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    setLanguage(ex.language);
    setSource(ex.source);
    setTitle(ex.title);
    setError(null);
    setStatus("idle");
  };

  const runAndAdd = async () => {
    if (!source.trim()) {
      setError("Write or load a script first.");
      setStatus("error");
      return;
    }
    if (sampleRows.length === 0) {
      setError("No sample metrics available — load a dataset first.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/custom-plot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language,
          source,
          samples: sampleRows,
          inputs: {},
        }),
      });
      const body = (await res.json()) as CustomPlotRunResponse;
      if (!body.ok) {
        setError(body.error || `Run failed (HTTP ${res.status})`);
        setStatus("error");
        return;
      }
      const plotTitle =
        title.trim() ||
        body.chartSpec.title ||
        `Script · ${language}`;
      const spec: UserCustomPlotSpec = {
        id: newUserPlotId(),
        kind: "script",
        title: plotTitle,
        language,
        source,
        chartSpec: body.chartSpec,
      };
      onAdd(spec);
      setStatus("ready");
      setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  };

  return (
    <div className="rounded-xl border border-dashed border-teal-300/90 bg-teal-50/30 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Script / Advanced
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Author a Python (or JS) snippet over sample-level QC metrics. Scripts
            run via <code className="rounded bg-white px-1">/api/custom-plot</code>{" "}
            and return a chartSpec the UI renders. AI agents use the same
            contract — see{" "}
            <code className="rounded bg-white px-1">
              docs/custom-plot-script-api.md
            </code>
            .
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {SCRIPT_EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            onClick={() => loadExample(ex.id)}
            className="rounded-md border border-teal-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-teal-50"
          >
            Load: {ex.title}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Language</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
            value={language}
            onChange={(e) =>
              setLanguage(e.target.value === "js" ? "js" : "python")
            }
            aria-label="Script language"
          >
            <option value="python">Python (primary)</option>
            <option value="js">JavaScript</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Title (optional)</span>
          <input
            type="text"
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Auto from chartSpec.title…"
            aria-label="Script plot title"
          />
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1 text-sm">
        <span className="text-slate-600">
          Source — assign <code>chart = {"{...}"}</code> using{" "}
          <code>samples</code>
        </span>
        <textarea
          className="min-h-[14rem] w-full rounded-md border border-slate-300 bg-white p-3 font-mono text-xs leading-relaxed"
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setStatus("idle");
          }}
          spellCheck={false}
          aria-label="Custom plot script source"
        />
      </label>

      {status === "loading" ? (
        <p className="mt-2 text-sm text-slate-600" role="status">
          Running script…
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-amber-950" role="alert">
          {error}
        </p>
      ) : null}
      {status === "ready" && !error ? (
        <p className="mt-2 text-sm text-teal-900" role="status">
          Plot added to this session.
        </p>
      ) : null}

      <div className="mt-4">
        <button
          type="button"
          onClick={() => void runAndAdd()}
          disabled={status === "loading"}
          className="rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50"
        >
          {status === "loading" ? "Running…" : "Run & add plot"}
        </button>
      </div>
    </div>
  );
}
