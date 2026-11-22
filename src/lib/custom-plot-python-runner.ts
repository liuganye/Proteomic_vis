import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type { ChartSpec } from "@/lib/types";
import { SCRIPT_LIMITS, isChartSpec } from "@/lib/custom-plot-script";

function runnerPath(): string {
  // process.cwd() is the Next.js project root in dev and production.
  return path.join(process.cwd(), "scripts", "custom_plot_runner.py");
}

/** Minimal env for the Python child — never spread process.env. */
export function pythonChildEnv(pythonPathHint?: string): Record<string, string> {
  const pathEnv = process.env.PATH ?? "/usr/bin:/bin";
  const env: Record<string, string> = {
    PATH: pathEnv,
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || process.env.LANG || "C.UTF-8",
    HOME: process.env.HOME || "/tmp",
    TMPDIR: process.env.TMPDIR || "/tmp",
    PYTHONPATH: "",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
  };
  // Interpreter path hint only — never copy secrets from process.env.
  if (pythonPathHint) env.CUSTOM_PLOT_PYTHON = pythonPathHint;
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

  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(
      pythonPath,
      [runnerPath()],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: pythonChildEnv(pythonPath) as NodeJS.ProcessEnv,
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
          result.error ||
            `Python script failed (exit ${code ?? "?"})`,
        ),
      );
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}
