import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Load the same pure TypeScript functions the chart uses, without a browser.
const source = await readFile(new URL("../src/lib/abundance.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { abundanceDomain, abundanceGroups } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

test("abundance domain focuses on observed values and exposes readable ordered ticks", () => {
  const axis = abundanceDomain([22, 23, 24, null, NaN, Infinity]);
  assert.ok(axis);
  assert.ok(axis.min < 22 && axis.max > 24, "all observed points have breathing room");
  assert.ok(axis.min > 0, "a positive domain need not include zero");
  assert.ok(axis.ticks.length >= 2);
  assert.ok(axis.ticks.every(Number.isFinite));
  assert.ok(axis.ticks.every((tick, i) => tick >= axis.min && tick <= axis.max && (!i || tick > axis.ticks[i - 1])));
});

test("abundance domain handles missing, negative and constant values", () => {
  assert.equal(abundanceDomain([null, NaN, Infinity, -Infinity]), null);
  assert.equal(abundanceDomain([]), null);
  for (const values of [[17, 17], [0, 0], [-3, -3], [-4, -2]]) {
    const axis = abundanceDomain(values);
    assert.ok(axis && Number.isFinite(axis.min) && Number.isFinite(axis.max));
    assert.ok(axis.min < Math.min(...values) && axis.max > Math.max(...values));
    assert.ok(axis.ticks.length >= 2 && axis.ticks.every(Number.isFinite));
  }
});

test("groups retain missing samples, group order and deterministic non-overlapping sample positions", () => {
  const points = [
    ...Array.from({ length: 12 }, (_, i) => ({
      sample_id: `A_${i + 1}`,
      display_group: "A",
      log2_intensity: i === 3 ? null : 22,
    })),
    { sample_id: "B_1", display_group: "B", log2_intensity: null },
  ];
  const before = structuredClone(points);
  const groups = abundanceGroups(points);
  assert.deepEqual(groups.map(g => g.name), ["A", "B"]);
  assert.equal(groups[0].points.length, 12);
  assert.equal(groups[0].points[3].log2_intensity, null);
  assert.equal(groups[1].points[0].sample_id, "B_1");
  assert.ok(groups.every(g => Number.isFinite(g.width) && g.width >= 120));
  const positions = groups[0].points.map(point => point.x);
  assert.equal(new Set(positions).size, 12, "same-valued samples must have distinct x positions");
  assert.deepEqual(abundanceGroups(points), groups, "layout remains stable between renders");
  assert.deepEqual(points, before, "grouping does not mutate the data");
});

test("positions stay fixed when a sample's value becomes missing", () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({
    sample_id: `sample_${i}`,
    display_group: i < 16 ? "large" : "small",
    log2_intensity: 20 + i,
  }));
  const missing = samples.map((point, i) => ({ ...point, log2_intensity: i % 2 ? null : point.log2_intensity }));
  const layout = values => abundanceGroups(values).map(group => group.points.map(point => point.x));
  assert.deepEqual(layout(missing), layout(samples));
  for (const positions of layout(missing)) {
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] - positions[i - 1] >= 12 - 1e-10);
    }
  }
});

// Render the real component using its actual React runtime and calculations. This
// checks the visible initial state; it is not a replacement for browser interaction tests.
const componentSource = await readFile(new URL("../src/components/ProteinAbundance.tsx", import.meta.url), "utf8");
const componentJs = ts.transpileModule(componentSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodeRequire = createRequire(import.meta.url);
const componentModule = { exports: {} };
new Function("require", "module", "exports", componentJs)(
  name => name === "@/lib/abundance" ? { abundanceDomain, abundanceGroups } : nodeRequire(name),
  componentModule,
  componentModule.exports,
);
const { ProteinAbundance } = componentModule.exports;

function renderAbundance(points, selectedSamples = []) {
  return renderToStaticMarkup(React.createElement(ProteinAbundance, {
    abundance: { points }, selectedSamples, onSelectSamples: () => {},
  }));
}

test("sample details preserve observed and missing values and the current selection", () => {
  const html = renderAbundance([
    { sample_id: "Human_4", display_group: "Human", log2_intensity: 23.41 },
    { sample_id: "Human_5", display_group: "Human", log2_intensity: null },
  ], ["Human_4"]);
  assert.match(html, /QC selected samples:/);
  assert.match(html, /Human_4[^<]*.*23\.41/s);
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(match => match[0]);
  const observed = rows.find(row => row.includes("Human_4"));
  const missing = rows.find(row => row.includes("Human_5"));
  assert.ok(observed && missing);
  assert.match(observed, /aria-pressed="true"/);
  assert.match(observed, /23\.41/);
  assert.match(observed, /Observed/);
  assert.match(missing, /Missing/);
  assert.match(missing, /aria-pressed="false"/);
});

test("all-missing protein displays an explicit empty state and keeps sample details", () => {
  const html = renderAbundance([{ sample_id: "Missing_1", display_group: "A", log2_intensity: null }], ["Missing_1"]);
  assert.match(html, /No observed abundance values are available/);
  assert.match(html, /Missing_1/);
  assert.match(html, /Missing/);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /<svg\b/);
});

test("displayed intensities are rounded to two decimals without moving points", () => {
  const html = renderAbundance([
    { sample_id: "S_1", display_group: "A", log2_intensity: 25.411853617233 },
    { sample_id: "S_2", display_group: "A", log2_intensity: 24.1 },
  ], ["S_1"]);
  assert.match(html, /25\.41/);
  assert.doesNotMatch(html, /25\.4118/, "no unrounded value in text, tooltip, aria-label or table");
});
