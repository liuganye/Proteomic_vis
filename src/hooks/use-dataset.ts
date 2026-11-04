"use client";

import { useCallback, useState } from "react";
import {
  buildDatasetAsync,
  fetchMockDataset,
  readFileAsText,
  type ParseProgress,
} from "@/lib/parse-fragpipe";
import type { LoadState } from "@/lib/types";

export function useDataset() {
  const [state, setState] = useState<LoadState>({ status: "idle" });

  const applyProgress = useCallback((p: ParseProgress) => {
    setState((prev) =>
      prev.status === "loading"
        ? {
            ...prev,
            progress: p.message,
            progressFraction: p.fraction,
          }
        : prev,
    );
  }, []);

  const loadMock = useCallback(() => {
    setState({
      status: "loading",
      progress: "Loading mock data…",
      progressFraction: 0,
    });
    void (async () => {
      try {
        const dataset = await fetchMockDataset(applyProgress);
        // Synchronous ready update — startTransition deferred paint looked like a no-op.
        setState({ status: "ready", dataset });
      } catch (e) {
        console.error("loadMock failed", e);
        setState({
          status: "error",
          error: e instanceof Error ? e.message : "Failed to load mock data",
        });
      }
    })();
  }, [applyProgress]);

  const loadFiles = useCallback(
    async (proteinFile: File, annotationFile?: File | null) => {
      setState({
        status: "loading",
        progress: "Reading uploads…",
        progressFraction: 0,
      });
      try {
        const [proteinText, annotationText] = await Promise.all([
          readFileAsText(proteinFile),
          annotationFile
            ? readFileAsText(annotationFile)
            : Promise.resolve(null),
        ]);

        const dataset = await buildDatasetAsync(
          {
            proteinText,
            annotationText,
            source: "upload",
            proteinFileName: proteinFile.name,
            annotationFileName: annotationFile?.name,
          },
          applyProgress,
        );

        setState({ status: "ready", dataset });
      } catch (e) {
        console.error("loadFiles failed", e);
        setState({
          status: "error",
          error:
            e instanceof Error ? e.message : "Failed to parse uploaded files",
        });
      }
    },
    [applyProgress],
  );

  const loadReal = useCallback(async () => {
    setState({ status: "loading", progress: "Loading real dataset from the backend…" });
    try {
      const api = process.env.NEXT_PUBLIC_PROTEIN_API ?? "http://127.0.0.1:8000";
      const response = await fetch(`${api}/api/v1/qc/matrix`);
      if (!response.ok) throw new Error(`Backend request failed (${response.status})`);
      const data: { samples: { sample_id: string; display_group: string; replicate_label: string }[]; proteins: { protein_id: string; gene: string | null; description: string; values: (number | null)[] }[] } = await response.json();
      const samples = data.samples.map(s => s.sample_id);
      if (!samples.length || data.proteins.some(p => p.values.length !== samples.length)) throw new Error("Invalid sample alignment in backend matrix");
      const dataset: import("@/lib/types").FragPipeDataset = {
        source: "real", samples, maxlfqColumns: samples, contrasts: [], proteinFileName: "Backend HYE dataset",
        annotation: data.samples.map(s => ({ file: s.sample_id, sample: s.sample_id, condition: s.display_group, replicate: s.replicate_label })),
        proteins: data.proteins.map(p => ({ proteinId: p.protein_id, gene: p.gene ?? "", description: p.description, proteinProbability: null, maxlfq: Object.fromEntries(samples.map((sample, i) => [sample, p.values[i] ?? 0])), log2fc: {}, adjP: {} })),
      };
      setState({ status: "ready", dataset });
    } catch (e) {
      setState({ status: "error", error: `Could not load the real dataset. Check that the backend is running. ${e instanceof Error ? e.message : ""}` });
    }
  }, []);

  const clear = useCallback(() => setState({ status: "idle" }), []);

  return { state, loadMock, loadFiles, loadReal, clear };
}
