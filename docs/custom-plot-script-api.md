# Scriptable custom plot API (AI + human)

Stable contract for **QC → Custom → Script / Advanced**. Humans author scripts in the UI; closed-loop AI agents inject the same JSON shapes without hand-editing React.

## Architecture

- Scripts run against **sample-level summary rows** only (missingness %, median log₁₀ MaxLFQ, n detected, Q1/Q3, sample, group) — never the full protein TSV.
- Primary language: **Python** via `POST /api/custom-plot` (Node route → constrained `python3` subprocess with a **minimal env allowlist** — not full `process.env`).
- Optional **JS** snippets run in the same API with Node `vm.Script` (no `require` / `process` / `fetch`; source is not string-spliced into a larger template).
- Scripts must emit a **chartSpec** the UI renders with Recharts.
- Session script plots **re-run** against the current scoped sample rows whenever the QC protein filter or Downstream selection changes.

## Access control (exposure model)

| Environment | Default | How to open / harden |
| --- | --- | --- |
| Development (`NODE_ENV !== production`) | Open | Set `CUSTOM_PLOT_REQUIRE_SECRET=1` + `CUSTOM_PLOT_API_SECRET` to require `x-custom-plot-secret` |
| Production | **Disabled** until configured | Set `CUSTOM_PLOT_API_SECRET` (recommended) **or** explicitly `CUSTOM_PLOT_ALLOW_UNAUTHENTICATED=1` |

When a secret is configured, **`Origin` / `Sec-Fetch-Site` alone never authorize** (those headers are forgeable). Callers must use one of:

1. **API secret** — header `x-custom-plot-secret: <secret>` (AI / automation).
2. **Browser session** — `GET /api/custom-plot/session` sets an HttpOnly `custom_plot_sess` cookie and returns a short-lived CSRF token; the in-app UI then POSTs with `credentials: "same-origin"` and header `x-custom-plot-csrf`. The secret never ships in client JS.

`CUSTOM_PLOT_REQUIRE_SECRET=1` disables session minting and requires the API secret header for every caller (including the UI).

Do not publish the app network-reachable with `CUSTOM_PLOT_ALLOW_UNAUTHENTICATED=1` unless you accept arbitrary script execution on that host.

## Sample row shape (`inputs.samples`)

```json
{
  "sample": "Human_1",
  "group": "Human",
  "missingPct": 12.5,
  "medianLog10": 6.2,
  "nDetected": 4800,
  "q1": 5.1,
  "q3": 7.0
}
```

## Run API — `POST /api/custom-plot`

Request:

```json
{
  "language": "python",
  "source": "# see examples\nchart = {...}",
  "samples": [ { "sample": "...", "group": "...", "missingPct": 0, "medianLog10": 0, "nDetected": 0, "q1": 0, "q3": 0 } ],
  "inputs": { "bins": 12 }
}
```

Success response:

```json
{
  "ok": true,
  "chartSpec": {
    "type": "bar",
    "title": "Missingness by sample",
    "data": [ { "x": "Human_1", "y": 12.5, "group": "Human" } ],
    "xKey": "x",
    "yKey": "y",
    "seriesKey": "group",
    "xLabel": "Sample",
    "yLabel": "Missing %"
  }
}
```

Failure: `{ "ok": false, "error": "..." }` (HTTP 400/401/408/503 as appropriate). Error strings are scrubbed (no absolute paths / raw stderr dumps).

### Python script contract

Globals provided:

| Name | Meaning |
| --- | --- |
| `samples` | `list[dict]` of sample rows |
| `inputs` | `dict` from the request (optional knobs) |
| `math`, `statistics` | stdlib modules |
| `Counter`, `defaultdict` | from `collections` |

Assign a dict to **`chart`** (or call `emit(chart_dict)`):

```python
chart = {
  "type": "bar",           # bar | scatter | histogram | line
  "title": "My plot",
  "data": [ {"x": s["sample"], "y": s["missingPct"], "group": s["group"]} for s in samples ],
  "xKey": "x",
  "yKey": "y",
  "seriesKey": "group",    # optional
  "xLabel": "Sample",
  "yLabel": "Missing %",
}
```

### JS script contract

Same `samples` / `inputs` bindings. Assign `chart = { ... }` or call `emit(...)`.

## Session registration (UI / AI inject)

To add a plot to the live QC session **without editing React**, dispatch:

```js
window.dispatchEvent(new CustomEvent("proteomics:register-custom-plot", {
  detail: {
    id: "user-optional-uuid",   // optional; UI generates if omitted
    title: "AI missingness bars",
    language: "python",
    source: "chart = {...}",
    inputs: {},
    // Prefer pre-computed chartSpec from POST /api/custom-plot:
    chartSpec: { "type": "bar", "data": [...], "xKey": "x", "yKey": "y" }
  }
}));
```

Or pass a full `UserCustomPlotSpec` with `kind: "script"`. `chartSpec.data` must be ≤ 2000 rows (same as the run API).

TypeScript helpers: `src/lib/custom-plot-script.ts` (`parseScriptRegistration`, example sources).

## QC protein scope (related)

QC conventional + custom/script plots honor AppShell protein scope:

1. **Feature filter** — discovered from Downstream-visible annotations (`src/lib/qc-protein-filter.ts`): GO aspect/term (demo map), gene symbol presence, protein probability buckets, default volcano DE call.
2. **Downstream selection** — volcano clicks, results-table toggles, and GO term bars set `selectedProteinIds`; clearing selection refreshes QC to the broader scope.
3. When both are active, QC uses the **intersection**. Empty scope shows an explicit empty state without breaking upload/mock load.
4. **Script plots** re-run via `POST /api/custom-plot` on the scoped sample rows whenever that scope changes, so the chart matches the filter bar.

## Limits (sandbox)

| Limit | Value |
| --- | --- |
| Source length | 12_000 chars |
| Samples rows | 500 |
| chartSpec.data rows | 2_000 |
| Timeout | 3 s |
| Python | No `open` / `import` / `eval` / `exec` / `__` dunders; minimal child env (pinned PATH + dedicated scratch HOME/TMPDIR — not host PATH/HOME) |
| JS (`vm`) | No `require` / `process` / `fetch`; `vm.Script` + timeout; not a full OS sandbox |
| Persistence | Session UI only (same as simple custom plots); cleared with dataset Clear |

## Examples

Bundled in `src/lib/custom-plot-examples.ts`:

1. **Intensity by group** — mean `medianLog10` per annotation group (bar).
2. **Missingness by sample** — `missingPct` bars colored by group.
