"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { LoadState } from "@/lib/types";

interface Props {
  state: LoadState;
  onLoadReal: () => void;
  onLoadFiles: (protein: File, annotation?: File | null) => void;
  onClear: () => void;
}

export function FileUploadPanel({
  state,
  onLoadReal,
  onLoadFiles,
  onClear,
}: Props) {
  const proteinRef = useRef<HTMLInputElement>(null);
  const annRef = useRef<HTMLInputElement>(null);
  const [proteinFile, setProteinFile] = useState<File | null>(null);
  const [annFile, setAnnFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadDrawerOpen, setUploadDrawerOpen] = useState(false);
  const loading = state.status === "loading";

  const activePortal: "real" | "upload" =
    uploadDrawerOpen || state.dataset?.source === "upload" ? "upload" : "real";

  const groupLabels = useMemo(() => {
    if (!state.dataset) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const a of state.dataset.annotation) {
      if (a.condition && !seen.has(a.condition)) {
        seen.add(a.condition);
        out.push(a.condition);
      }
    }
    return out;
  }, [state.dataset]);

  const assignFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const protein =
      list.find((f) => /combined[_-]?protein/i.test(f.name)) ??
      list.find(
        (f) =>
          /\.(tsv|txt)$/i.test(f.name) &&
          !/annotation|experiment/i.test(f.name),
      ) ??
      list[0];
    const annotation =
      list.find((f) => /annotation|experiment/i.test(f.name)) ??
      list.find((f) => f !== protein && /\.(tsv|txt)$/i.test(f.name));
    if (protein) setProteinFile(protein);
    if (annotation) setAnnFile(annotation);
  }, []);

  const parseNow = useCallback(() => {
    if (!proteinFile || loading) return;
    onLoadFiles(proteinFile, annFile);
  }, [proteinFile, annFile, loading, onLoadFiles]);

  return (
    <section className="min-w-0 break-words rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
            Data portal
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Explore the bundled human Cyclin D1 (CCND1) AP-MS dataset or upload
            your own FragPipe{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-700">
              combined_protein.tsv
            </code>
            .
          </p>
        </div>
        {state.status === "ready" && (
          <button
            type="button"
            onClick={() => {
              setProteinFile(null);
              setAnnFile(null);
              setUploadDrawerOpen(false);
              if (proteinRef.current) proteinRef.current.value = "";
              if (annRef.current) annRef.current.value = "";
              onClear();
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Clear
          </button>
        )}
      </div>

      {/* Two clean portal cards: Real sample data vs Upload TSV */}
      <div
        className="mt-3.5 grid gap-3 sm:grid-cols-2"
        role="radiogroup"
        aria-label="Dataset source"
      >
        <button
          type="button"
          role="radio"
          aria-checked={activePortal === "real"}
          disabled={loading}
          onClick={() => {
            setUploadDrawerOpen(false);
            if (state.dataset?.source !== "real") {
              onLoadReal();
            }
          }}
          className={`flex flex-col rounded-xl border px-4 py-3 text-left transition ${
            activePortal === "real"
              ? "border-teal-800 bg-teal-50/40 ring-1 ring-teal-800/20"
              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70"
          } disabled:opacity-50`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900">
              Real sample data
            </span>
            {state.status === "ready" && state.dataset?.source === "real" && (
              <span className="rounded-full bg-teal-800 px-2 py-0.5 text-[10.5px] font-medium text-white">
                Active
              </span>
            )}
          </div>
          <span className="mt-0.5 text-xs text-slate-600">
            Human CCND1 AP-MS · 3,063 proteins · CCND1 (×3) vs CONTROL (×4)
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={activePortal === "upload"}
          disabled={loading}
          onClick={() => setUploadDrawerOpen(true)}
          className={`flex flex-col rounded-xl border px-4 py-3 text-left transition ${
            activePortal === "upload"
              ? "border-teal-800 bg-teal-50/40 ring-1 ring-teal-800/20"
              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70"
          } disabled:opacity-50`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900">
              Upload TSV
            </span>
            {state.status === "ready" && state.dataset?.source === "upload" && (
              <span className="rounded-full bg-teal-800 px-2 py-0.5 text-[10.5px] font-medium text-white">
                Active
              </span>
            )}
          </div>
          <span className="mt-0.5 text-xs text-slate-600">
            FragPipe combined_protein.tsv + optional experiment_annotation.tsv
          </span>
        </button>
      </div>

      {/* Expandable upload drawer shown only when Upload TSV is selected */}
      {activePortal === "upload" && (
        <div className="mt-3.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
          <div
            className={`rounded-lg border border-dashed px-3 py-3 text-center transition ${
              dragOver
                ? "border-teal-600 bg-teal-50"
                : "border-slate-300 bg-white/80"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files?.length) assignFiles(e.dataTransfer.files);
            }}
          >
            <p className="text-xs text-slate-600">
              Drag &amp; drop TSV files here, or pick files below. Current data
              stays loaded until you click <strong>Parse uploads</strong>.
            </p>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 text-xs">
              <span className="mb-1.5 block font-medium text-slate-700">
                combined_protein.tsv
              </span>
              <input
                ref={proteinRef}
                type="file"
                accept=".tsv,.txt,text/tab-separated-values,text/plain"
                className="sr-only"
                aria-label="Choose combined_protein.tsv"
                onChange={(e) => setProteinFile(e.target.files?.[0] ?? null)}
                disabled={loading}
              />
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => proteinRef.current?.click()}
                  className="shrink-0 rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-900 disabled:opacity-50"
                >
                  Choose file
                </button>
                <span className="truncate text-slate-500">
                  {proteinFile
                    ? `${proteinFile.name} (${(proteinFile.size / (1024 * 1024)).toFixed(2)} MB)`
                    : "No file selected"}
                </span>
              </div>
            </div>

            <div className="min-w-0 text-xs">
              <span className="mb-1.5 block font-medium text-slate-700">
                experiment_annotation.tsv{" "}
                <span className="font-normal text-slate-400">(optional)</span>
              </span>
              <input
                ref={annRef}
                type="file"
                accept=".tsv,.txt,text/tab-separated-values,text/plain"
                className="sr-only"
                aria-label="Choose experiment_annotation.tsv"
                onChange={(e) => setAnnFile(e.target.files?.[0] ?? null)}
                disabled={loading}
              />
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => annRef.current?.click()}
                  className="shrink-0 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Choose file
                </button>
                <span className="truncate text-slate-500">
                  {annFile ? annFile.name : "No file selected"}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loading || !proteinFile}
              onClick={parseNow}
              className="rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {loading ? "Parsing…" : "Parse uploads"}
            </button>
            {state.dataset?.source === "real" && (
              <button
                type="button"
                onClick={() => setUploadDrawerOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {state.status === "loading" && (
        <div className="mt-3" role="status">
          <p className="text-xs text-teal-800">
            {state.progress ?? "Parsing protein table…"}
          </p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-teal-700 transition-[width] duration-200"
              style={{
                width: `${Math.round((state.progressFraction ?? 0.08) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {state.status === "error" && (
        <p
          className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
          role="alert"
        >
          {state.error}
        </p>
      )}

      {state.status === "ready" && state.dataset && (
        <>
          <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-slate-100 bg-slate-50/70 px-3.5 py-2.5 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-slate-500">Proteins</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                {state.dataset.proteins.length.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Samples</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                {state.dataset.samples.length}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Groups</dt>
              <dd className="mt-0.5 truncate font-semibold text-slate-900" title={groupLabels.join(", ")}>
                {groupLabels.length ? groupLabels.join(" vs ") : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Dataset</dt>
              <dd className="mt-0.5 truncate font-semibold text-slate-900" title={state.dataset.proteinFileName}>
                {state.dataset.source === "real"
                  ? "CCND1 AP-MS (JPR 2024)"
                  : state.dataset.proteinFileName ?? "Uploaded TSV"}
              </dd>
            </div>
          </dl>
          {state.dataset.annotationWarning && (
            <p className="mt-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {state.dataset.annotationWarning}
            </p>
          )}
        </>
      )}
    </section>
  );
}
