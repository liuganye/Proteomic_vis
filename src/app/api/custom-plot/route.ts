import { NextResponse } from "next/server";
import {
  checkCustomPlotApiAccess,
  publicScriptError,
} from "@/lib/custom-plot-api-access";
import { runJsCustomPlot } from "@/lib/custom-plot-js-runner";
import { runPythonCustomPlot } from "@/lib/custom-plot-python-runner";
import { validateRunRequest } from "@/lib/custom-plot-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/custom-plot
 * Run a constrained Python (or JS) snippet against sample summary rows.
 * Contract: docs/custom-plot-script-api.md
 */
export async function POST(request: Request) {
  const access = checkCustomPlotApiAccess(request);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const validated = validateRunRequest(body);
  if ("error" in validated) {
    return NextResponse.json(
      { ok: false, error: validated.error },
      { status: 400 },
    );
  }

  const { request: req } = validated;

  try {
    const chartSpec =
      req.language === "python"
        ? await runPythonCustomPlot({
            source: req.source,
            samples: req.samples,
            inputs: req.inputs,
          })
        : runJsCustomPlot({
            source: req.source,
            samples: req.samples,
            inputs: req.inputs,
          });

    return NextResponse.json({ ok: true, chartSpec });
  } catch (err) {
    const message = publicScriptError(err);
    const timedOut = /timed out/i.test(message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: timedOut ? 408 : 400 },
    );
  }
}

export async function GET(request: Request) {
  const access = checkCustomPlotApiAccess(request);
  return NextResponse.json({
    service: "custom-plot",
    languages: ["python", "js"],
    docs: "/docs/custom-plot-script-api.md",
    registerEvent: "proteomics:register-custom-plot",
    access: access.ok ? "allowed" : "denied",
  });
}
