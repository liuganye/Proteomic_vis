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
    setState({
      status: "loading",
      progress: "Loading real human CCND1 AP-MS sample dataset…",
      progressFraction: 0.05,
    });
    try {
      const [proteinRes, annotationRes] = await Promise.all([
        fetch("/data/ccnd1-apms/combined_protein.tsv"),
        fetch("/data/ccnd1-apms/experiment_annotation.tsv"),
      ]);
      if (!proteinRes.ok) {
        throw new Error(`Failed to fetch combined_protein.tsv (${proteinRes.status})`);
      }
      const [proteinText, annotationText] = await Promise.all([
        proteinRes.text(),
        annotationRes.ok ? annotationRes.text() : Promise.resolve(null),
      ]);
      const dataset = await buildDatasetAsync(
        {
          proteinText,
          annotationText,
          source: "real",
          proteinFileName: "CCND1 AP-MS (combined_protein.tsv)",
          annotationFileName: annotationRes.ok ? "experiment_annotation.tsv" : undefined,
        },
        applyProgress,
      );
      setState({ status: "ready", dataset });
    } catch (e) {
      setState({
        status: "error",
        error: `Could not load the real sample dataset. ${e instanceof Error ? e.message : ""}`,
      });
    }
  }, [applyProgress]);

  const clear = useCallback(() => setState({ status: "idle" }), []);

  return { state, loadMock, loadFiles, loadReal, clear };
}
