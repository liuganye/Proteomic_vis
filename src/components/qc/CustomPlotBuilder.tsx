"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  SAMPLE_METRIC_OPTIONS,
  autoTitle,
  defaultKeysForKind,
  isCategoricalMetric,
  isNumericMetric,
  newUserPlotId,
} from "@/lib/custom-plot-metrics";
import type {
  CustomPlotKind,
  SampleMetricKey,
  UserCustomPlotSpec,
} from "@/lib/types";

const KINDS: { id: CustomPlotKind; label: string; hint: string }[] = [
  { id: "scatter", label: "Scatter", hint: "X × Y sample metrics" },
  { id: "bar", label: "Bar", hint: "Category × numeric value" },
  { id: "histogram", label: "Histogram", hint: "Distribution of one metric" },
];

export function CustomPlotBuilder({
  onAdd,
}: {
  onAdd: (spec: UserCustomPlotSpec) => void;
}) {
  const [kind, setKind] = useState<CustomPlotKind>("scatter");
  const defaults = defaultKeysForKind(kind);
  const [xKey, setXKey] = useState<SampleMetricKey>(defaults.xKey ?? "sample");
  const [yKey, setYKey] = useState<SampleMetricKey>(
    defaults.yKey ?? "missingPct",
  );
  const [valueKey, setValueKey] = useState<SampleMetricKey>(
    defaults.valueKey ?? "medianLog10",
  );
  const [colorBy, setColorBy] = useState<"group" | "none">(defaults.colorBy);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const numericOptions = useMemo(
    () => SAMPLE_METRIC_OPTIONS.filter((o) => o.kind === "numeric"),
    [],
  );
  const categoricalOptions = useMemo(
    () => SAMPLE_METRIC_OPTIONS.filter((o) => o.kind === "categorical"),
    [],
  );

  const applyKind = (next: CustomPlotKind) => {
    setKind(next);
    const d = defaultKeysForKind(next);
    if (d.xKey) setXKey(d.xKey);
    if (d.yKey) setYKey(d.yKey);
    if (d.valueKey) setValueKey(d.valueKey);
    setColorBy(d.colorBy);
    setError(null);
  };

  const handleAdd = () => {
    if (kind === "scatter") {
      if (!isNumericMetric(xKey) || !isNumericMetric(yKey)) {
        setError("Scatter needs numeric X and Y.");
        return;
      }
    } else if (kind === "bar") {
      if (!isCategoricalMetric(xKey) || !isNumericMetric(yKey)) {
        setError("Bar needs a categorical X and a numeric value.");
        return;
      }
    } else if (!isNumericMetric(valueKey)) {
      setError("Histogram needs a numeric value column.");
      return;
    }

    const draft: UserCustomPlotSpec = {
      id: newUserPlotId(),
      kind,
      title: title.trim(),
      xKey: kind === "histogram" ? undefined : xKey,
      yKey: kind === "histogram" ? undefined : yKey,
      valueKey: kind === "histogram" ? valueKey : undefined,
      colorBy,
    };
    if (!draft.title) draft.title = autoTitle(draft);
    onAdd(draft);
    setTitle("");
    setError(null);
  };

  return (
    <div className="rounded-xl border border-dashed border-amber-300/90 bg-amber-50/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Add a custom plot
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Choose chart type and sample-level columns (missingness, MaxLFQ
            summaries, group). Specs stay in this session until you remove them
            or clear data.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Plot type">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => applyKind(k.id)}
            className={
              kind === k.id
                ? "rounded-md bg-amber-800 px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-md border border-amber-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-amber-50"
            }
          >
            {k.label}
            <span className="ml-1.5 text-xs opacity-80">{k.hint}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kind !== "histogram" ? (
          <Field label={kind === "bar" ? "X (category)" : "X"}>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={xKey}
              onChange={(e) => setXKey(e.target.value as SampleMetricKey)}
              aria-label="X axis metric"
            >
              {(kind === "bar" ? categoricalOptions : numericOptions).map(
                (o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ),
              )}
            </select>
          </Field>
        ) : null}

        {kind !== "histogram" ? (
          <Field label={kind === "bar" ? "Value (Y)" : "Y"}>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={yKey}
              onChange={(e) => setYKey(e.target.value as SampleMetricKey)}
              aria-label="Y axis metric"
            >
              {numericOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Value">
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={valueKey}
              onChange={(e) => setValueKey(e.target.value as SampleMetricKey)}
              aria-label="Histogram value metric"
            >
              {numericOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Color / group">
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            value={colorBy}
            onChange={(e) =>
              setColorBy(e.target.value === "group" ? "group" : "none")
            }
            aria-label="Color by group"
          >
            <option value="group">Annotation group</option>
            <option value="none">None</option>
          </select>
        </Field>

        <Field label="Title (optional)">
          <input
            type="text"
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            placeholder="Auto from axes…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Custom plot title"
          />
        </Field>
      </div>

      {error ? (
        <p className="mt-2 text-sm text-amber-900" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4">
        <button
          type="button"
          onClick={handleAdd}
          className="rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900"
        >
          Add plot
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-600">{label}</span>
      {children}
    </label>
  );
}
