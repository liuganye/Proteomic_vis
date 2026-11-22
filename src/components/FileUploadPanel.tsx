"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LoadState } from "@/lib/types";

type PortalSource = "mock" | "real" | "upload";

function sourceFromDataset(
  dataset: NonNullable<LoadState["dataset"]> | undefined,
): PortalSource | null {
  if (!dataset) return null;
  if (dataset.source === "mock") return "mock";
  if (dataset.source === "real") return "real";
  return "upload";
}

interface Props {
  state: LoadState;
  onLoadMock: () => void;
  onLoadReal: () => void;
  onLoadFiles: (protein: File, annotation?: File | null) => void;
  onClear: () => void;
  /** Compact strip for embedding above Downstream when no dataset is ready. */
  compact?: boolean;
}

export function FileUploadPanel({
  state,
  onLoadMock,
  onLoadReal,
  onLoadFiles,
  onClear,
  compact = false,
}: Props) {
  const proteinRef = useRef<HTMLInputElement>(null);
  const annRef = useRef<HTMLInputElement>(null);
  const [proteinFile, setProteinFile] = useState<File | null>(null);
  const [annFile, setAnnFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** User intent while idle/loading; overridden by loaded dataset when ready. */
  const [intent, setIntent] = useState<PortalSource>("upload");
  const loading = state.status === "loading";
  const loaded = sourceFromDataset(state.dataset);
  const source: PortalSource =
    state.status === "ready" && loaded ? loaded : intent;

  // Keep selection aligned with whatever is actually loaded (auto-loadReal, Clear, etc.).
  useEffect(() => {
    if (state.status === "ready" && state.dataset) {
      const next = sourceFromDataset(state.dataset);
      if (next) setIntent(next);
      return;
    }
    if (state.status === "idle") setIntent("upload");
  }, [state.status, state.dataset]);

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
    setIntent("upload");
  }, []);

  const parseNow = useCallback(() => {
    if (!proteinFile || loading) return;
    onLoadFiles(proteinFile, annFile);
  }, [proteinFile, annFile, loading, onLoadFiles]);

  const activateSource = (next: PortalSource) => {
    setIntent(next);
    if (next === "mock" && !loading) onLoadMock();
    if (next === "real" && !loading) onLoadReal();
  };

  return (
    <section
      className={`data-portal min-w-0 break-words ${compact ? "data-portal--compact" : ""}`}
      aria-labelledby="data-portal-heading"
      data-testid="data-portal"
    >
      <div className="data-portal__header">
        <div>
          <h2 id="data-portal-heading" className="data-portal__title">
            Data portal
          </h2>
          {!compact && (
            <p className="data-portal__lede">
              One place to load mock demo data, the packaged real FragPipe HYE
              snapshot, or your own{" "}
              <code>combined_protein.tsv</code>
              {" "}(+ optional{" "}
              <code>experiment_annotation.tsv</code>
              ).
            </p>
          )}
        </div>
        {state.status === "ready" && state.dataset && (
          <button
            type="button"
            onClick={() => {
              setProteinFile(null);
              setAnnFile(null);
              if (proteinRef.current) proteinRef.current.value = "";
              if (annRef.current) annRef.current.value = "";
              setIntent("upload");
              onClear();
            }}
            className="data-portal__clear"
          >
            Clear
          </button>
        )}
      </div>

      <div
        className="data-portal__sources"
        role="radiogroup"
        aria-label="Dataset source"
      >
        {(
          [
            { id: "mock", label: "Mock demo", hint: "Synthetic Group A / B" },
            { id: "real", label: "Real HYE", hint: "Packaged FragPipe snapshot" },
            { id: "upload", label: "Upload TSV", hint: "Protein + annotation" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={source === opt.id}
            data-testid={`portal-source-${opt.id}`}
            disabled={loading}
            className={`data-portal__source ${source === opt.id ? "is-active" : ""}`}
            onClick={() => activateSource(opt.id)}
          >
            <strong>{opt.label}</strong>
            <span>{opt.hint}</span>
          </button>
        ))}
      </div>

      {source === "upload" && (
        <div className="data-portal__upload" id="data-portal-upload">
          <div
            className={`data-portal__drop ${dragOver ? "is-over" : ""}`}
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
            <p>
              Drop FragPipe TSV files here, or choose below. Protein + annotation
              can arrive together.
            </p>
          </div>

          <div className="data-portal__files">
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block font-medium text-[color:var(--portal-ink)]">
                combined_protein.tsv
              </span>
              <input
                ref={proteinRef}
                type="file"
                accept=".tsv,.txt,text/tab-separated-values,text/plain"
                className="data-portal__file-input"
                onChange={(e) => {
                  setProteinFile(e.target.files?.[0] ?? null);
                  setIntent("upload");
                }}
                disabled={loading}
              />
              {proteinFile && (
                <p className="mt-1 truncate text-xs text-[color:var(--portal-muted)]">
                  {proteinFile.name} ·{" "}
                  {(proteinFile.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              )}
            </label>
            <label className="block min-w-0 text-sm">
              <span className="mb-1 block font-medium text-[color:var(--portal-ink)]">
                experiment_annotation.tsv{" "}
                <span className="font-normal text-[color:var(--portal-muted)]">
                  (optional)
                </span>
              </span>
              <input
                ref={annRef}
                type="file"
                accept=".tsv,.txt,text/tab-separated-values,text/plain"
                className="data-portal__file-input data-portal__file-input--secondary"
                onChange={(e) => {
                  setAnnFile(e.target.files?.[0] ?? null);
                  setIntent("upload");
                }}
                disabled={loading}
              />
              {annFile && (
                <p className="mt-1 truncate text-xs text-[color:var(--portal-muted)]">
                  {annFile.name}
                </p>
              )}
            </label>
          </div>

          <button
            type="button"
            disabled={loading || !proteinFile}
            onClick={parseNow}
            className="data-portal__parse"
            data-testid="portal-parse-uploads"
          >
            {loading ? "Working…" : "Parse uploads"}
          </button>
        </div>
      )}

      {source === "mock" && state.status === "ready" && state.dataset?.source === "mock" && (
        <p className="data-portal__banner data-portal__banner--mock">
          Synthetic demo · 120 proteins · Group A: 4 samples (A_1–A_4) · Group B:
          3 samples (B_1–B_3). Illustrative values only — QC checks all seven
          samples; Group A vs Group B statistics are for demonstration.
        </p>
      )}

      {source === "real" && state.status === "ready" && state.dataset?.source === "real" && (
        <p className="data-portal__banner">
          Real HYE FragPipe snapshot loaded. Switch to Mock or Upload TSV above
          to change source; Clear resets the portal.
        </p>
      )}

      {state.status === "idle" && (
        <p className="mt-3 text-sm text-[color:var(--portal-muted)]">
          No data loaded yet. Pick Mock, Real HYE, or Upload TSV above.
        </p>
      )}
      {state.status === "loading" && (
        <div className="mt-3" role="status">
          <p className="text-sm text-[color:var(--chart-accent-deep,#0a5c5f)]">
            {state.progress ?? "Parsing protein table…"}
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--portal-track,#e8eef1)]">
            <div
              className="h-full rounded-full bg-[color:var(--chart-accent,#0d7377)] transition-[width] duration-200"
              style={{
                width: `${Math.round((state.progressFraction ?? 0.08) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
      {state.status === "error" && (
        <p
          className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {state.error}
        </p>
      )}
      {state.status === "ready" && state.dataset && (
        <>
          <dl className="data-portal__stats">
            <div>
              <dt>Proteins</dt>
              <dd>{state.dataset.proteins.length.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Samples</dt>
              <dd>{state.dataset.samples.length}</dd>
            </div>
            <div>
              <dt>Contrasts</dt>
              <dd>{state.dataset.contrasts.length || "—"}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{state.dataset.source}</dd>
            </div>
            <div className="data-portal__stats-files">
              <dt>Files</dt>
              <dd className="truncate">
                {state.dataset.proteinFileName}
                {state.dataset.annotationFileName
                  ? ` · ${state.dataset.annotationFileName}`
                  : ""}
              </dd>
            </div>
          </dl>
          {state.dataset.annotationWarning && (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {state.dataset.annotationWarning}
            </p>
          )}
        </>
      )}
      {/* Test hook only — not in the a11y tree */}
      <button
        type="button"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="load-mock-data"
        disabled={loading}
        onClick={() => activateSource("mock")}
      >
        Load mock data
      </button>
    </section>
  );
}
