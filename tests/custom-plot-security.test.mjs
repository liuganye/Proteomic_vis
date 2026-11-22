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
    ["custom-plot-session.ts", "../src/lib/custom-plot-session.ts"],
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
      .replaceAll("@/lib/custom-plot-session", "./custom-plot-session.ts")
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
      .replaceAll("./custom-plot-session.ts", "./custom-plot-session.js")
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
  const session = await import(
    pathToFileURL(join(dir, "custom-plot-session.js")).href
  );
  const py = await import(
    pathToFileURL(join(dir, "custom-plot-python-runner.js")).href
  );
  const jsRunner = await import(
    pathToFileURL(join(dir, "custom-plot-js-runner.js")).href
  );
  setTimeout(() => void rm(dir, { recursive: true, force: true }), 2000);
  return { access, session, py, jsRunner };
}

const mods = await loadModules();

function withEnv(vars, fn) {
  const prev = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

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

test("pythonChildEnv does not inherit host PATH or HOME", () => {
  const hostHome = process.env.HOME;
  const hostPath = process.env.PATH;
  process.env.HOME = "/tmp/should-not-be-child-home";
  process.env.PATH = `/evil/bin:${hostPath || ""}`;
  try {
    const env = mods.py.pythonChildEnv("/usr/bin/python3");
    assert.notEqual(env.HOME, "/tmp/should-not-be-child-home");
    assert.ok(env.HOME.includes("proteomic-custom-plot"));
    assert.equal(env.HOME, env.TMPDIR);
    assert.equal(env.PATH.includes("/evil/bin"), false);
    assert.match(env.PATH, /\/usr\/bin/);
  } finally {
    if (hostHome === undefined) delete process.env.HOME;
    else process.env.HOME = hostHome;
    if (hostPath === undefined) delete process.env.PATH;
    else process.env.PATH = hostPath;
  }
});

test("publicScriptError scrubs absolute paths", () => {
  const msg = mods.access.publicScriptError(
    new Error("boom at /home/ubuntu/secret/project/scripts/custom_plot_runner.py:12"),
  );
  assert.equal(msg.includes("/home/ubuntu"), false);
  assert.match(msg, /\[path\]/);
});

test("checkCustomPlotApiAccess denies production without secret or allow flag", () => {
  withEnv(
    {
      NODE_ENV: "production",
      CUSTOM_PLOT_API_SECRET: undefined,
      CUSTOM_PLOT_ALLOW_UNAUTHENTICATED: undefined,
      CUSTOM_PLOT_REQUIRE_SECRET: undefined,
    },
    () => {
      const req = new Request("http://localhost:43147/api/custom-plot", {
        method: "POST",
      });
      const result = mods.access.checkCustomPlotApiAccess(req);
      assert.equal(result.ok, false);
      assert.equal(result.status, 503);
    },
  );
});

test("checkCustomPlotApiAccess accepts matching secret header", () => {
  withEnv(
    {
      NODE_ENV: "production",
      CUSTOM_PLOT_API_SECRET: "test-secret",
      CUSTOM_PLOT_ALLOW_UNAUTHENTICATED: undefined,
      CUSTOM_PLOT_REQUIRE_SECRET: undefined,
    },
    () => {
      const bad = mods.access.checkCustomPlotApiAccess(
        new Request("http://localhost:43147/api/custom-plot", {
          method: "POST",
        }),
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
      assert.equal(good.via, "secret");
    },
  );
});

test("forged Origin + Sec-Fetch-Site alone are rejected in production posture", () => {
  withEnv(
    {
      NODE_ENV: "production",
      CUSTOM_PLOT_API_SECRET: "prod-secret",
      CUSTOM_PLOT_ALLOW_UNAUTHENTICATED: undefined,
      CUSTOM_PLOT_REQUIRE_SECRET: undefined,
    },
    () => {
      const forged = mods.access.checkCustomPlotApiAccess(
        new Request("http://localhost:43147/api/custom-plot", {
          method: "POST",
          headers: {
            Origin: "http://localhost:43147",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Dest": "empty",
          },
        }),
      );
      assert.equal(forged.ok, false);
      assert.equal(forged.status, 401);

      const forgedEvilOrigin = mods.access.checkCustomPlotApiAccess(
        new Request("http://localhost:43147/api/custom-plot", {
          method: "POST",
          headers: {
            Origin: "https://evil.example",
            "Sec-Fetch-Site": "same-origin",
          },
        }),
      );
      assert.equal(forgedEvilOrigin.ok, false);
      assert.equal(forgedEvilOrigin.status, 401);
    },
  );
});

test("valid session cookie + CSRF authorizes without secret header", () => {
  withEnv(
    {
      NODE_ENV: "production",
      CUSTOM_PLOT_API_SECRET: "prod-secret",
      CUSTOM_PLOT_ALLOW_UNAUTHENTICATED: undefined,
      CUSTOM_PLOT_REQUIRE_SECRET: undefined,
    },
    () => {
      const minted = mods.session.mintCustomPlotSession("prod-secret");
      const cookie = `${mods.session.CUSTOM_PLOT_SESSION_COOKIE}=${minted.sessionToken}`;
      const good = mods.access.checkCustomPlotApiAccess(
        new Request("http://localhost:43147/api/custom-plot", {
          method: "POST",
          headers: {
            Cookie: cookie,
            [mods.session.CUSTOM_PLOT_CSRF_HEADER]: minted.csrfToken,
          },
        }),
      );
      assert.equal(good.ok, true);
      assert.equal(good.via, "session");

      const cookieOnly = mods.access.checkCustomPlotApiAccess(
        new Request("http://localhost:43147/api/custom-plot", {
          method: "POST",
          headers: { Cookie: cookie },
        }),
      );
      assert.equal(cookieOnly.ok, false);
      assert.equal(cookieOnly.status, 401);

      const csrfOnly = mods.access.checkCustomPlotApiAccess(
        new Request("http://localhost:43147/api/custom-plot", {
          method: "POST",
          headers: {
            [mods.session.CUSTOM_PLOT_CSRF_HEADER]: minted.csrfToken,
          },
        }),
      );
      assert.equal(csrfOnly.ok, false);

      const wrongCsrf = mods.access.checkCustomPlotApiAccess(
        new Request("http://localhost:43147/api/custom-plot", {
          method: "POST",
          headers: {
            Cookie: cookie,
            [mods.session.CUSTOM_PLOT_CSRF_HEADER]: "forged-csrf",
          },
        }),
      );
      assert.equal(wrongCsrf.ok, false);
    },
  );
});

test("REQUIRE_SECRET disables session path", () => {
  withEnv(
    {
      NODE_ENV: "production",
      CUSTOM_PLOT_API_SECRET: "prod-secret",
      CUSTOM_PLOT_REQUIRE_SECRET: "1",
      CUSTOM_PLOT_ALLOW_UNAUTHENTICATED: undefined,
    },
    () => {
      const minted = mods.session.mintCustomPlotSession("prod-secret");
      const denied = mods.access.checkCustomPlotApiAccess(
        new Request("http://localhost:43147/api/custom-plot", {
          method: "POST",
          headers: {
            Cookie: `${mods.session.CUSTOM_PLOT_SESSION_COOKIE}=${minted.sessionToken}`,
            [mods.session.CUSTOM_PLOT_CSRF_HEADER]: minted.csrfToken,
          },
        }),
      );
      assert.equal(denied.ok, false);
      assert.equal(denied.status, 401);

      const withSecret = mods.access.checkCustomPlotApiAccess(
        new Request("http://localhost:43147/api/custom-plot", {
          method: "POST",
          headers: { "x-custom-plot-secret": "prod-secret" },
        }),
      );
      assert.equal(withSecret.ok, true);
    },
  );
});

test("minted session rejects expiry and forged signatures", () => {
  const secret = "prod-secret";
  const minted = mods.session.mintCustomPlotSession(secret, Date.now() - 10_000, 1);
  assert.equal(
    mods.session.verifyCustomPlotSession(
      secret,
      minted.sessionToken,
      minted.csrfToken,
      Date.now(),
    ),
    false,
  );

  const fresh = mods.session.mintCustomPlotSession(secret);
  const tampered = fresh.sessionToken.replace(/\.[^.]+$/, ".aaaa");
  assert.equal(
    mods.session.verifyCustomPlotSession(
      secret,
      tampered,
      fresh.csrfToken,
    ),
    false,
  );
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
