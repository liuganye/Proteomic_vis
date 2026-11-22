/**
 * Access control for POST /api/custom-plot.
 *
 * Exposure model:
 * - Development (`NODE_ENV !== "production"`): open by default.
 * - Production: disabled unless `CUSTOM_PLOT_API_SECRET` is set, or
 *   `CUSTOM_PLOT_ALLOW_UNAUTHENTICATED=1` is explicitly opted in.
 * - When a secret is configured, callers must present either:
 *     1. `x-custom-plot-secret: <secret>` (AI / automation), or
 *     2. a short-lived HttpOnly session cookie + matching
 *        `x-custom-plot-csrf` header (in-app UI; mint via
 *        GET /api/custom-plot/session).
 * - Browser `Origin` / `Sec-Fetch-Site` are NEVER treated as auth
 *   (those headers are trivially forgeable by remote clients).
 * - `CUSTOM_PLOT_REQUIRE_SECRET=1` disables the session path and
 *   requires the API secret header even in development.
 */

import {
  CUSTOM_PLOT_CSRF_HEADER,
  CUSTOM_PLOT_SESSION_COOKIE,
  readCookie,
  verifyCustomPlotSession,
} from "@/lib/custom-plot-session";
import { timingSafeEqual } from "node:crypto";

export type CustomPlotAccessResult =
  | { ok: true; via: "open" | "secret" | "session" }
  | { ok: false; status: number; error: string };

function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true";
}

function secretsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function checkCustomPlotApiAccess(request: Request): CustomPlotAccessResult {
  const secret = process.env.CUSTOM_PLOT_API_SECRET?.trim() || "";
  const requireSecret = envFlag("CUSTOM_PLOT_REQUIRE_SECRET");
  const allowUnauth = envFlag("CUSTOM_PLOT_ALLOW_UNAUTHENTICATED");
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
    return { ok: true, via: "open" };
  }

  if (!secret && requireSecret) {
    return {
      ok: false,
      status: 503,
      error: "Custom plot API requires CUSTOM_PLOT_API_SECRET.",
    };
  }

  const provided = request.headers.get("x-custom-plot-secret") ?? "";
  if (secret && provided && secretsEqual(provided, secret)) {
    return { ok: true, via: "secret" };
  }

  // Session cookie + CSRF (UI path). Disabled when REQUIRE_SECRET forces
  // the API-secret header for every caller.
  if (secret && !requireSecret) {
    const session = readCookie(
      request.headers.get("cookie"),
      CUSTOM_PLOT_SESSION_COOKIE,
    );
    const csrf = request.headers.get(CUSTOM_PLOT_CSRF_HEADER);
    if (verifyCustomPlotSession(secret, session, csrf)) {
      return { ok: true, via: "session" };
    }
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
