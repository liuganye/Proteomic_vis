import { NextResponse } from "next/server";
import {
  buildSessionCookieHeader,
  mintCustomPlotSession,
} from "@/lib/custom-plot-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true";
}

/**
 * GET /api/custom-plot/session
 * Mint a short-lived HttpOnly session cookie + CSRF token for the in-app UI.
 * Does not accept Origin / Sec-Fetch-Site as credentials.
 *
 * Intentional exposure: minting itself is unauthenticated when a secret is
 * configured. Reachable clients can obtain a session. This blocks Origin
 * spoofing + CSRF; it is not a substitute for network isolation. Use
 * CUSTOM_PLOT_REQUIRE_SECRET=1 to disable minting and require the secret
 * header for every caller.
 */
export async function GET(request: Request) {
  const secret = process.env.CUSTOM_PLOT_API_SECRET?.trim() || "";
  const requireSecret = envFlag("CUSTOM_PLOT_REQUIRE_SECRET");
  const allowUnauth = envFlag("CUSTOM_PLOT_ALLOW_UNAUTHENTICATED");
  const isProd = process.env.NODE_ENV === "production";
  // Secure cookies only when the request itself is HTTPS (HTTP localhost must work).
  const secure = new URL(request.url).protocol === "https:";

  if (isProd && !secret && !allowUnauth) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Custom plot API disabled in production. Set CUSTOM_PLOT_API_SECRET.",
      },
      { status: 503 },
    );
  }

  // Open mode (dev, or explicit unauthenticated allow without secret).
  if (!secret && !requireSecret) {
    return NextResponse.json({
      ok: true,
      mode: "open",
      csrf: null,
      expiresAt: null,
    });
  }

  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "Custom plot API requires CUSTOM_PLOT_API_SECRET.",
      },
      { status: 503 },
    );
  }

  // REQUIRE_SECRET means only the API secret header works — no browser session.
  if (requireSecret) {
    return NextResponse.json(
      {
        ok: false,
        mode: "secret-only",
        error:
          "CUSTOM_PLOT_REQUIRE_SECRET=1: browser session minting disabled; send x-custom-plot-secret.",
      },
      { status: 403 },
    );
  }

  const minted = mintCustomPlotSession(secret);
  const res = NextResponse.json({
    ok: true,
    mode: "session",
    csrf: minted.csrfToken,
    expiresAt: minted.expiresAt,
  });
  res.headers.set(
    "Set-Cookie",
    buildSessionCookieHeader(minted.sessionToken, minted.expiresAt, {
      secure,
    }),
  );
  res.headers.set("Cache-Control", "no-store");
  return res;
}
