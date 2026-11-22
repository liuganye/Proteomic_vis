import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function loadModules() {
  const dir = await mkdtemp(join(tmpdir(), "cps-sec-"));
  const files = [
    ["types.ts", "../src/lib/types.ts"],
    ["custom-plot-metrics.ts", "../src/lib/custom-plot-metrics.ts"],
    ["custom-plot-script.ts", "../src/lib/custom-plot-script.ts"],
    ["custom-plot-api-access.ts", "../src/lib/custom-plot-api-access.ts"],
    ["custom-plot-python-runner.ts", "../src/lib/custom-plot-python-runner.ts"],
    ["custom-plot-js-runner.ts", "../src/lib/custom-plot-js-runner.ts"],
  ];
  for (const [outName, rel] of files) {
    let source = await readFile(new URL(rel, import.meta.url), "utf8");
    source = source
      .replaceAll("@/lib/types", "./types.ts")
      .replaceAll("@/lib/custom-plot-metrics", "./custom-plot-metrics.ts")
      .replaceAll("@/lib/custom-plot-script", "./custom-plot-script.ts")
      .replaceAll("@/lib/stats", "./stats-stub.ts");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
    });
    const js = outputText
      .replaceAll("./types.ts", "./types.js")
      .replaceAll("./custom-plot-metrics.ts", "./custom-plot-metrics.js")
      .replaceAll("./custom-plot-script.ts", "./custom-plot-script.js")
      .replaceAll("./stats-stub.ts", "./stats-stub.js");
    await writeFile(join(dir, outName.replace(/\.ts$/, ".js")), js);
  }
  await writeFile(
    join(dir, "stats-stub.js"),
    `export function missingnessBySample(){return [];}
export function intensityBoxBySample(){return [];}
`,
  );
  const access = await import(
    pathToFileURL(join(dir, "custom-plot-api-access.js")).href
  );
  const py = await import(
    pathToFileURL(join(dir, "custom-plot-python-runner.js")).href
  );
  const jsRunner = await import(
    pathToFileURL(join(dir, "custom-plot-js-runner.js")).href
  );
  setTimeout(() => void rm(dir, { recursive: true, force: true }), 2000);
  return { access, py, jsRunner };
}

const mods = await loadModules();

test("pythonChildEnv does not inherit secrets from process.env", () => {
  process.env.AWS_SECRET_ACCESS_KEY = "should-not-leak";
  process.env.CUSTOM_FAKE_TOKEN = "nope";
  const env = mods.py.pythonChildEnv("python3");
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.CUSTOM_FAKE_TOKEN, undefined);
  assert.ok(env.PATH);
  assert.equal(env.PYTHONPATH, "");
  assert.equal(env.PYTHONDONTWRITEBYTECODE, "1");
});

test("publicScriptError scrubs absolute paths", () => {
  const msg = mods.access.publicScriptError(
    new Error("boom at /home/ubuntu/secret/project/scripts/custom_plot_runner.py:12"),
  );
  assert.equal(msg.includes("/home/ubuntu"), false);
  assert.match(msg, /\[path\]/);
});

test("checkCustomPlotApiAccess denies production without secret or allow flag", () => {
  const prev = process.env.NODE_ENV;
  const prevSecret = process.env.CUSTOM_PLOT_API_SECRET;
  const prevAllow = process.env.CUSTOM_PLOT_ALLOW_UNAUTHENTICATED;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.CUSTOM_PLOT_API_SECRET;
    delete process.env.CUSTOM_PLOT_ALLOW_UNAUTHENTICATED;
    const req = new Request("http://localhost:43147/api/custom-plot", {
      method: "POST",
    });
    const result = mods.access.checkCustomPlotApiAccess(req);
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
  } finally {
    process.env.NODE_ENV = prev;
    if (prevSecret === undefined) delete process.env.CUSTOM_PLOT_API_SECRET;
    else process.env.CUSTOM_PLOT_API_SECRET = prevSecret;
    if (prevAllow === undefined) delete process.env.CUSTOM_PLOT_ALLOW_UNAUTHENTICATED;
    else process.env.CUSTOM_PLOT_ALLOW_UNAUTHENTICATED = prevAllow;
  }
});

test("checkCustomPlotApiAccess accepts matching secret header", () => {
  const prev = process.env.NODE_ENV;
  const prevSecret = process.env.CUSTOM_PLOT_API_SECRET;
  try {
    process.env.NODE_ENV = "production";
    process.env.CUSTOM_PLOT_API_SECRET = "test-secret";
    const bad = mods.access.checkCustomPlotApiAccess(
      new Request("http://localhost:43147/api/custom-plot", { method: "POST" }),
    );
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 401);

    const good = mods.access.checkCustomPlotApiAccess(
      new Request("http://localhost:43147/api/custom-plot", {
        method: "POST",
        headers: { "x-custom-plot-secret": "test-secret" },
      }),
    );
    assert.equal(good.ok, true);
  } finally {
    process.env.NODE_ENV = prev;
    if (prevSecret === undefined) delete process.env.CUSTOM_PLOT_API_SECRET;
    else process.env.CUSTOM_PLOT_API_SECRET = prevSecret;
  }
});

test("JS runner blocks require and process and accepts chart assignment", () => {
  const samples = [
    {
      sample: "A",
      group: "G",
      missingPct: 1,
      medianLog10: 2,
      nDetected: 3,
      q1: 1,
      q3: 3,
    },
  ];
  const ok = mods.jsRunner.runJsCustomPlot({
    source: `chart = { type: "bar", data: samples.map(s => ({x:s.sample,y:s.missingPct})), xKey:"x", yKey:"y" };`,
    samples,
  });
  assert.equal(ok.type, "bar");
  assert.equal(ok.data.length, 1);

  assert.throws(
    () =>
      mods.jsRunner.runJsCustomPlot({
        source: `require("fs"); chart = {type:"bar",data:[],xKey:"x",yKey:"y"};`,
        samples,
      }),
    /require|not defined|ReferenceError/i,
  );
  assert.throws(
    () =>
      mods.jsRunner.runJsCustomPlot({
        source: `process.env; chart = {type:"bar",data:[],xKey:"x",yKey:"y"};`,
        samples,
      }),
    /process|not defined|ReferenceError/i,
  );
});
