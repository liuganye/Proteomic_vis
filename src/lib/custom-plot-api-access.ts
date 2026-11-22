/**
 * Access control for POST /api/custom-plot.
 *
 * Exposure model:
 * - Development (`NODE_ENV !== "production"`): open by default.
 * - Production: disabled unless `CUSTOM_PLOT_API_SECRET` is set, or
 *   `CUSTOM_PLOT_ALLOW_UNAUTHENTICATED=1` is explicitly opted in.
 * - When a secret is configured, non-same-origin callers must send
 *   header `x-custom-plot-secret: <secret>`. Same-origin browser UI
 *   (Sec-Fetch-Site: same-origin) may call without the header so the
 *   secret never ships to the client.
 * - Set `CUSTOM_PLOT_REQUIRE_SECRET=1` to require the header even in
 *   development (same-origin still allowed).
 */

export type CustomPlotAccessResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function isSameOriginBrowser(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function checkCustomPlotApiAccess(request: Request): CustomPlotAccessResult {
  const secret = process.env.CUSTOM_PLOT_API_SECRET?.trim() || "";
  const requireSecret =
    process.env.CUSTOM_PLOT_REQUIRE_SECRET === "1" ||
    process.env.CUSTOM_PLOT_REQUIRE_SECRET === "true";
  const allowUnauth =
    process.env.CUSTOM_PLOT_ALLOW_UNAUTHENTICATED === "1" ||
    process.env.CUSTOM_PLOT_ALLOW_UNAUTHENTICATED === "true";
  const isProd = process.env.NODE_ENV === "production";

  if (isProd && !secret && !allowUnauth) {
    return {
      ok: false,
      status: 503,
      error:
        "Custom plot API disabled in production. Set CUSTOM_PLOT_API_SECRET (recommended) or CUSTOM_PLOT_ALLOW_UNAUTHENTICATED=1.",
    };
  }

  if (!secret && !requireSecret) {
    return { ok: true };
  }

  if (!secret && requireSecret) {
    return {
      ok: false,
      status: 503,
      error: "Custom plot API requires CUSTOM_PLOT_API_SECRET.",
    };
  }

  const provided = request.headers.get("x-custom-plot-secret") ?? "";
  if (secret && provided === secret) {
    return { ok: true };
  }

  // Same-origin UI may call without embedding the secret in the browser.
  if (secret && isSameOriginBrowser(request) && !requireSecret) {
    return { ok: true };
  }

  // Dev + requireSecret without matching header (and not same-origin bypass when requireSecret)
  if (secret && isSameOriginBrowser(request) && requireSecret && provided === secret) {
    return { ok: true };
  }

  return { ok: false, status: 401, error: "Unauthorized" };
}

/** Scrub absolute paths / long stderr from errors returned to clients. */
export function publicScriptError(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  const scrubbed = raw
    .replace(/(?:[A-Za-z]:)?(?:\/[\w.@+-]+)+/g, "[path]")
    .replace(/\n+/g, " ")
    .trim();
  if (!scrubbed) return "Script failed";
  if (
    /timed out|not allowed|exceeds|must be|required|Unauthorized|disabled|invalid|chart\./i.test(
      scrubbed,
    )
  ) {
    return scrubbed.slice(0, 300);
  }
  return scrubbed.slice(0, 200);
}
