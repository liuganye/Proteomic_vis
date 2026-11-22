import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** HttpOnly cookie carrying the signed browser session. */
export const CUSTOM_PLOT_SESSION_COOKIE = "custom_plot_sess";

/** Browser must echo this header; it is never stored in the cookie alone. */
export const CUSTOM_PLOT_CSRF_HEADER = "x-custom-plot-csrf";

/** Default session lifetime (2 hours). */
export const CUSTOM_PLOT_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export type MintedCustomPlotSession = {
  sessionToken: string;
  csrfToken: string;
  expiresAt: number;
};

function hmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Mint a short-lived session + CSRF pair bound to CUSTOM_PLOT_API_SECRET.
 * Session cookie alone is not enough — CSRF must match (double-submit style).
 */
export function mintCustomPlotSession(
  secret: string,
  nowMs = Date.now(),
  ttlMs = CUSTOM_PLOT_SESSION_TTL_MS,
): MintedCustomPlotSession {
  const expiresAt = nowMs + ttlMs;
  const nonce = randomBytes(16).toString("hex");
  const payload = `v1.${expiresAt}.${nonce}`;
  const sessionSig = hmac(secret, `sess:${payload}`);
  const csrfToken = hmac(secret, `csrf:${payload}`);
  return {
    sessionToken: `${payload}.${sessionSig}`,
    csrfToken,
    expiresAt,
  };
}

/**
 * Verify cookie session + CSRF header. Rejects expired or forged tokens.
 * Origin / Sec-Fetch-Site are intentionally ignored.
 */
export function verifyCustomPlotSession(
  secret: string,
  sessionToken: string | null | undefined,
  csrfToken: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!sessionToken || !csrfToken) return false;
  const parts = sessionToken.split(".");
  if (parts.length !== 4) return false;
  const [ver, expStr, nonce, sig] = parts;
  if (ver !== "v1" || !expStr || !nonce || !sig) return false;
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt < nowMs) return false;
  const payload = `${ver}.${expStr}.${nonce}`;
  const expectedSig = hmac(secret, `sess:${payload}`);
  const expectedCsrf = hmac(secret, `csrf:${payload}`);
  if (!safeEqual(sig, expectedSig)) return false;
  if (!safeEqual(csrfToken, expectedCsrf)) return false;
  return true;
}

/** Parse a Cookie header value for a named cookie. */
export function readCookie(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    return part.slice(idx + 1).trim();
  }
  return null;
}

export function buildSessionCookieHeader(
  sessionToken: string,
  expiresAt: number,
  opts?: { secure?: boolean },
): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  // Caller should pass secure from the request URL protocol (https only).
  const secure = opts?.secure === true;
  const bits = [
    `${CUSTOM_PLOT_SESSION_COOKIE}=${sessionToken}`,
    "Path=/api/custom-plot",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}
