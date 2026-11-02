"use client";

import type { QcConclusion, QcPlotId } from "@/lib/types";

const SEVERITY_STYLES: Record<
  QcConclusion["severity"],
  { badge: string; border: string; label: string }
> = {
  ok: {
    badge: "bg-teal-100 text-teal-900",
    border: "border-teal-200 hover:border-teal-400",
    label: "OK",
  },
  info: {
    badge: "bg-sky-100 text-sky-900",
    border: "border-sky-200 hover:border-sky-400",
    label: "Note",
  },
  warn: {
    badge: "bg-amber-100 text-amber-950",
    border: "border-amber-200 hover:border-amber-400",
    label: "Warn",
  },
  critical: {
    badge: "bg-rose-100 text-rose-950",
    border: "border-rose-300 hover:border-rose-500",
    label: "Critical",
  },
};

export function QcSummary({
  conclusions,
  onJump,
}: {
  conclusions: QcConclusion[];
  onJump: (plotId: QcPlotId) => void;
}) {
  const conventional = conclusions.filter((c) => c.group === "conventional");
  const custom = conclusions.filter((c) => c.group === "custom");

  return (
    <div
      id="qc-summary"
      className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm sm:p-5"
    >
      <header className="mb-3">
        <p className="text-xs font-semibold tracking-[0.18em] text-teal-800 uppercase">
          QC summary
        </p>
        <h2 className="mt-1 font-serif text-2xl text-slate-900">
          Conclusions before the plots
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Click any conclusion to jump to the graph that illustrates it.
        </p>
      </header>

      <ConclusionGroup
        title="Conventional"
        items={conventional}
        onJump={onJump}
      />
      <ConclusionGroup
        title="Custom"
        items={custom}
        onJump={onJump}
        className="mt-4"
      />
    </div>
  );
}

function ConclusionGroup({
  title,
  items,
  onJump,
  className = "",
}: {
  title: string;
  items: QcConclusion[];
  onJump: (plotId: QcPlotId) => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={className}>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {title}
      </h3>
      <ul className="space-y-2">
        {items.map((c) => {
          const style = SEVERITY_STYLES[c.severity];
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onJump(c.plotId)}
                className={`group flex w-full flex-col gap-1 rounded-lg border bg-white px-3 py-2.5 text-left transition ${style.border} focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${style.badge}`}
                  >
                    {style.label}
                  </span>
                  <span className="text-sm font-semibold text-slate-900 group-hover:text-teal-900">
                    {c.title}
                  </span>
                  <span className="ml-auto text-[11px] font-medium text-teal-800 underline-offset-2 group-hover:underline">
                    → {c.plotLabel}
                  </span>
                </div>
                <p className="text-sm leading-snug text-slate-600">{c.detail}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
