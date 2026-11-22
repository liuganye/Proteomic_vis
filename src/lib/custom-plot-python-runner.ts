import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChartSpec } from "@/lib/types";
import { SCRIPT_LIMITS, isChartSpec } from "@/lib/custom-plot-script";

function runnerPath(): string {
  // process.cwd() is the Next.js project root in dev and production.
  return path.join(process.cwd(), "scripts", "custom_plot_runner.py");
}

/** Dedicated scratch dir — never reuse the host HOME. */
export function pythonScratchDir(): string {
  const dir = path.join(os.tmpdir(), "proteomic-custom-plot");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve interpreter to an absolute path when possible so PATH can stay minimal.
 */
export function resolvePythonBinary(pythonPathHint?: string): string {
  const hint =
    pythonPathHint?.trim() ||
    process.env.CUSTOM_PLOT_PYTHON?.trim() ||
    "python3";
  if (path.isAbsolute(hint)) return hint;
  // Prefer well-known absolute locations over inheriting a wide host PATH.
  const candidates = [
    `/usr/bin/${hint}`,
    `/bin/${hint}`,
    hint === "python3" ? "/usr/local/bin/python3" : "",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return hint;
}

/**
 * Minimal env for the Python child — never spread process.env.
 * PATH is pinned to the interpreter dir + /usr/bin:/bin (not the host PATH).
 * HOME/TMPDIR point at a dedicated scratch directory.
 */
export function pythonChildEnv(pythonPathHint?: string): Record<string, string> {
  const pythonBin = resolvePythonBinary(pythonPathHint);
  const binDir = path.isAbsolute(pythonBin)
    ? path.dirname(pythonBin)
    : "/usr/bin";
  const scratch = pythonScratchDir();
  const pathParts = Array.from(
    new Set([binDir, "/usr/bin", "/bin"].filter(Boolean)),
  );
  const env: Record<string, string> = {
    PATH: pathParts.join(":"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    HOME: scratch,
    TMPDIR: scratch,
    TMP: scratch,
    TEMP: scratch,
    PYTHONPATH: "",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
  };
  return env;
}

/**
 * Run a Python custom-plot snippet via the constrained subprocess runner.
 */
export function runPythonCustomPlot(options: {
  source: string;
  samples: Array<Record<string, string | number>>;
  inputs?: Record<string, string | number | boolean>;
  timeoutMs?: number;
  pythonPath?: string;
}): Promise<ChartSpec> {
  const {
    source,
    samples,
    inputs = {},
    timeoutMs = SCRIPT_LIMITS.timeoutMs,
    pythonPath = process.env.CUSTOM_PLOT_PYTHON || "python3",
  } = options;

  const payload = JSON.stringify({ source, samples, inputs });
  const resolvedPython = resolvePythonBinary(pythonPath);

  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(
      resolvedPython,
      [runnerPath()],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: pythonChildEnv(resolvedPython) as NodeJS.ProcessEnv,
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Python script timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 2_000_000) {
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to start Python: ${err.message}`));
    });

    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout.trim() || "{}");
      } catch {
        reject(
          new Error(
            // Prefer runner JSON errors; avoid dumping raw stderr paths to callers.
            `Python runner returned non-JSON (exit ${code ?? "?"})`,
          ),
        );
        return;
      }
      const result = parsed as {
        ok?: boolean;
        chartSpec?: unknown;
        error?: string;
      };
      if (result.ok && isChartSpec(result.chartSpec)) {
        resolve(result.chartSpec);
        return;
      }
      reject(
        new Error(
          result.error || `Python script failed (exit ${code ?? "?"})`,
        ),
      );
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}
