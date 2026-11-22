import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

async function loadTs(rel) {
  const source = await readFile(new URL(rel, import.meta.url), "utf8");
  // Strip path aliases used by the app; tests import relative TS modules.
  const rewritten = source
    .replaceAll("@/lib/", "./")
    .replaceAll("@/data/", "../src/data/");
  // Resolve chained imports by compiling dependent files into a temp ESM bundle.
  const { outputText } = ts.transpileModule(rewritten, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  return outputText;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadScriptLib() {
  const dir = await mkdtemp(path.join(tmpdir(), "cps-"));
  const metricsSrc = await readFile(
    path.join(root, "src/lib/custom-plot-metrics.ts"),
    "utf8",
  );
  const scriptSrc = await readFile(
    path.join(root, "src/lib/custom-plot-script.ts"),
    "utf8",
  );
  // metrics only needs types at compile time for our helpers; strip type-only imports.
  const metricsJs = ts.transpileModule(
    metricsSrc
      .replace(/from\s+"@\/lib\/stats"/g, 'from "./stats-stub.js"')
      .replace(/from\s+"@\/lib\/types"/g, 'from "./types-stub.js"'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;

  await writeFile(
    path.join(dir, "types-stub.js"),
    "export {};\n",
  );
  await writeFile(
    path.join(dir, "stats-stub.js"),
    `
export function missingnessBySample(){return [];}
export function intensityBoxBySample(){return [];}
`,
  );
  await writeFile(path.join(dir, "custom-plot-metrics.js"), metricsJs);

  const scriptJs = ts.transpileModule(
    scriptSrc
      .replace(/from\s+"@\/lib\/types"/g, 'from "./types-stub.js"')
      .replace(
        /from\s+"@\/lib\/custom-plot-metrics"/g,
        'from "./custom-plot-metrics.js"',
      ),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  await writeFile(path.join(dir, "custom-plot-script.js"), scriptJs);
  return import(path.join(dir, "custom-plot-script.js"));
}

const samples = [
  {
    sample: "A1",
    group: "A",
    missingPct: 10,
    medianLog10: 6,
    nDetected: 100,
    q1: 5,
    q3: 7,
  },
  {
    sample: "B1",
    group: "B",
    missingPct: 40,
    medianLog10: 5,
    nDetected: 50,
    q1: 4,
    q3: 6,
  },
];

test("validateRunRequest accepts python payloads and rejects oversize source", async () => {
  const lib = await loadScriptLib();
  const ok = lib.validateRunRequest({
    language: "python",
    source: "chart = {'type':'bar','data':[],'xKey':'x','yKey':'y'}",
    samples,
  });
  assert.equal("request" in ok, true);

  const bad = lib.validateRunRequest({
    language: "python",
    source: "x".repeat(lib.SCRIPT_LIMITS.maxSourceChars + 1),
    samples,
  });
  assert.equal("error" in bad, true);
});

test("parseScriptRegistration builds kind=script specs for AI inject", async () => {
  const lib = await loadScriptLib();
  const parsed = lib.parseScriptRegistration({
    title: "AI bars",
    language: "python",
    source: "chart = {'type':'bar','data':[{'x':1,'y':2}],'xKey':'x','yKey':'y'}",
    chartSpec: {
      type: "bar",
      data: [{ x: 1, y: 2 }],
      xKey: "x",
      yKey: "y",
    },
  });
  assert.equal("spec" in parsed, true);
  assert.equal(parsed.spec.kind, "script");
  assert.equal(parsed.spec.title, "AI bars");
  assert.match(parsed.spec.id, /^user-/);
});

function runPython(source) {
  const runner = path.join(root, "scripts/custom_plot_runner.py");
  return spawnSync("python3", [runner], {
    input: JSON.stringify({ samples, inputs: {}, source }),
    encoding: "utf8",
  });
}

test("Python runner emits chartSpec and blocks imports", () => {
  const good = runPython(`
data = [{"x": s["sample"], "y": s["missingPct"], "group": s["group"]} for s in samples]
chart = {"type": "bar", "data": data, "xKey": "x", "yKey": "y", "seriesKey": "group"}
`);
  assert.equal(good.status, 0, good.stderr || good.stdout);
  const parsed = JSON.parse(good.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.chartSpec.type, "bar");
  assert.equal(parsed.chartSpec.data.length, 2);

  const blocked = runPython(
    "import os\nchart = {'type':'bar','data':[],'xKey':'x','yKey':'y'}",
  );
  const blockedBody = JSON.parse(blocked.stdout);
  assert.equal(blockedBody.ok, false);
  assert.match(blockedBody.error, /import/i);
});

test("Python sandbox rejects open, eval, and dunder access", () => {
  for (const source of [
    "open('/etc/passwd')\nchart={'type':'bar','data':[],'xKey':'x','yKey':'y'}",
    "eval('1+1')\nchart={'type':'bar','data':[],'xKey':'x','yKey':'y'}",
    "chart=__builtins__",
    "x=().__class__\nchart={'type':'bar','data':[],'xKey':'x','yKey':'y'}",
  ]) {
    const result = runPython(source);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, false, source);
    assert.match(body.error, /not allowed|import|dunder|open|eval/i, source);
  }
});

test("isChartSpec and registration reject oversized chartSpec.data", async () => {
  const lib = await loadScriptLib();
  const huge = {
    type: "bar",
    data: Array.from({ length: lib.SCRIPT_LIMITS.maxDataRows + 1 }, (_, i) => ({
      x: i,
      y: i,
    })),
    xKey: "x",
    yKey: "y",
  };
  assert.equal(lib.isChartSpec(huge), false);
  const parsed = lib.parseScriptRegistration({
    title: "too big",
    language: "python",
    source: "chart = {}",
    chartSpec: huge,
  });
  assert.equal("error" in parsed, true);
});

test("Python example scripts from repo produce charts", async () => {
  // Inline the two examples (avoid TS path alias load for examples module).
  const sources = [
    `
by = defaultdict(list)
for s in samples:
    by[s["group"]].append(float(s["medianLog10"]))
data = []
for group, vals in sorted(by.items()):
    mean = sum(vals) / len(vals) if vals else 0
    data.append({"x": group, "y": round(mean, 3), "group": group})
chart = {"type": "bar", "data": data, "xKey": "x", "yKey": "y", "seriesKey": "group"}
`,
    `
data = [{"x": s["sample"], "y": float(s["missingPct"]), "group": s["group"]} for s in samples]
chart = {"type": "bar", "data": data, "xKey": "x", "yKey": "y", "seriesKey": "group"}
`,
  ];
  const runner = path.join(root, "scripts/custom_plot_runner.py");
  for (const source of sources) {
    const result = spawnSync("python3", [runner], {
      input: JSON.stringify({ samples, source, inputs: {} }),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, true);
    assert.ok(body.chartSpec.data.length >= 1);
  }
});

// silence unused helper warning in some runners
void loadTs;
