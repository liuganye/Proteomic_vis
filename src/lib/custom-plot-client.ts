/**
 * Browser helper for POST /api/custom-plot.
 * Mints/caches CSRF from GET /api/custom-plot/session and sends credentials.
 * Includes a small concurrency cap so scope changes do not fan out unbounded.
 *
 * Keep this module free of node: imports — it is used from client components.
 */

/** Must match CUSTOM_PLOT_CSRF_HEADER in custom-plot-session.ts (server). */
const CUSTOM_PLOT_CSRF_HEADER = "x-custom-plot-csrf";

type SessionMode = "open" | "session" | "unknown";

let cachedCsrf: string | null = null;
let cachedMode: SessionMode = "unknown";
let cachedExpiresAt: number | null = null;
let mintInFlight: Promise<void> | null = null;

const MAX_CONCURRENT = 2;
let active = 0;
const waitQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    waitQueue.push(resolve);
  });
  active += 1;
}

function releaseSlot(): void {
  active = Math.max(0, active - 1);
  const next = waitQueue.shift();
  if (next) next();
}

async function mintSession(): Promise<void> {
  const res = await fetch("/api/custom-plot/session", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = (await res.json()) as {
    ok?: boolean;
    mode?: string;
    csrf?: string | null;
    expiresAt?: number | null;
    error?: string;
  };
  if (!res.ok || !body.ok) {
    cachedCsrf = null;
    cachedMode = "unknown";
    cachedExpiresAt = null;
    throw new Error(body.error || `Session mint failed (HTTP ${res.status})`);
  }
  if (body.mode === "open") {
    cachedMode = "open";
    cachedCsrf = null;
    cachedExpiresAt = null;
    return;
  }
  if (body.mode === "session" && body.csrf) {
    cachedMode = "session";
    cachedCsrf = body.csrf;
    cachedExpiresAt =
      typeof body.expiresAt === "number" ? body.expiresAt : null;
    return;
  }
  cachedCsrf = null;
  cachedMode = "unknown";
  cachedExpiresAt = null;
  throw new Error(body.error || "Session mint returned unexpected mode");
}

async function ensureSession(): Promise<{
  mode: SessionMode;
  csrf: string | null;
}> {
  const freshEnough =
    cachedMode === "open" ||
    (cachedMode === "session" &&
      cachedCsrf &&
      (!cachedExpiresAt || cachedExpiresAt - Date.now() > 60_000));
  if (!freshEnough) {
    if (!mintInFlight) {
      mintInFlight = mintSession().finally(() => {
        mintInFlight = null;
      });
    }
    await mintInFlight;
  }
  return { mode: cachedMode, csrf: cachedCsrf };
}

function applyCsrfHeader(
  headers: Record<string, string>,
  session: { mode: SessionMode; csrf: string | null },
): void {
  if (session.mode === "session" && session.csrf) {
    headers[CUSTOM_PLOT_CSRF_HEADER] = session.csrf;
  } else {
    delete headers[CUSTOM_PLOT_CSRF_HEADER];
  }
}

/**
 * POST to /api/custom-plot with credentials + CSRF when required.
 * Concurrent calls are capped (fan-out control for multi-plot re-runs).
 */
export async function postCustomPlot(
  body: unknown,
  init?: { signal?: AbortSignal },
): Promise<Response> {
  await acquireSlot();
  try {
    let session = await ensureSession();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    applyCsrfHeader(headers, session);
    const res = await fetch("/api/custom-plot", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(body),
      signal: init?.signal,
    });
    // One retry on auth failure after reminting (expired cookie).
    if (res.status !== 401 || session.mode !== "session") return res;

    cachedMode = "unknown";
    cachedCsrf = null;
    cachedExpiresAt = null;
    session = await ensureSession();
    applyCsrfHeader(headers, session);
    return fetch("/api/custom-plot", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(body),
      signal: init?.signal,
    });
  } finally {
    releaseSlot();
  }
}

/** Test/helper: clear cached session state. */
export function resetCustomPlotClientSession(): void {
  cachedCsrf = null;
  cachedMode = "unknown";
  cachedExpiresAt = null;
  mintInFlight = null;
}
