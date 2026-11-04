import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import Papa from "papaparse";

// Exercise the actual pure TS calculations with the existing compiler dependency.
async function loadTs(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const stats = await loadTs("../src/lib/stats.ts");
const vis = await loadTs("../src/lib/visualization.ts");
const dataset = values => ({ samples: ["sample"], annotation: [], proteins: values.map(v => ({ maxlfq: { sample: v } })) });

test("histogram counts all observations, excludes unusable values and includes the upper endpoint", () => {
  const result = stats.intensityHistogram(dataset([1, 10, 100, 1000, 0, -10, NaN, Infinity, undefined]), 2);
  assert.equal(result.total, 4);
  assert.deepEqual(result.bins.map(b => b.count), [2, 2]);
  assert.equal(result.bins[0].lower, 0);
  assert.equal(result.bins[1].upper, 3);
});

test("empty and constant intensity data have finite, explicit bins", () => {
  assert.deepEqual(stats.intensityHistogram(dataset([0, NaN])), { bins: [], total: 0 });
  const result = stats.intensityHistogram(dataset([100, 100, 100]));
  assert.equal(result.bins.length, 1);
  assert.equal(result.bins[0].count, 3);
  assert.ok(result.bins[0].lower < 2 && result.bins[0].upper > 2);
  assert.throws(() => stats.intensityHistogram(dataset([1]), 0));
});

test("real HYE histogram accounts for every observed value without the old 20k cap", async () => {
  const csv = await readFile(new URL("../data/processed/maxlfq_wide.csv", import.meta.url), "utf8");
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  assert.equal(parsed.errors.length, 0);
  const samples = parsed.meta.fields.filter(field => field.endsWith(" MaxLFQ Intensity"));
  const proteins = parsed.data.map(row => ({ maxlfq: Object.fromEntries(samples.map(sample => [sample, Number(row[sample])])) }));
  const data = { samples, proteins, annotation: [] };
  const expected = proteins.reduce((total, p) => total + Object.values(p.maxlfq).filter(v => Number.isFinite(v) && v > 0).length, 0);
  const result = stats.intensityHistogram(data);
  assert.equal(expected, 258429, "bundled snapshot changed; review the reference total");
  assert.equal(result.total, expected);
  assert.equal(result.bins.reduce((n, b) => n + b.count, 0), expected);
  assert.equal(stats.intensityBoxBySample(data).reduce((n, b) => n + b.n, 0), expected);
  assert.equal(result.bins.length, 30);
});

test("correlation colors distinguish negative, zero and weak positive values", () => {
  assert.equal(vis.correlationColor(-1), "rgb(179, 88, 6)");
  assert.equal(vis.correlationColor(0), "rgb(247, 247, 247)");
  assert.equal(vis.correlationColor(1), "rgb(33, 102, 172)");
  assert.equal(new Set([-0.35, 0, 0.2, 0.5, 1, NaN].map(vis.correlationColor)).size, 6);
});

test("matrix numbers maintain at least 4.5:1 contrast throughout the scale", () => {
  for (let i = -100; i <= 100; i++) {
    const value = i / 100;
    const rgb = vis.correlationColor(value).match(/\d+/g).map(Number);
    const channels = rgb.map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const l = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    const ratio = vis.correlationTextColor(value) === "#ffffff" ? 1.05 / (l + 0.05) : (l + 0.05) / 0.05;
    assert.ok(ratio >= 4.5, `contrast at r=${value}: ${ratio}`);
  }
});

test("volcano axes contain all points and thresholds, including zero p and distant cutoffs", () => {
  const points = [{ log2_fc: -8.5, adj_p: 0 }, { log2_fc: 4, adj_p: 1 }];
  const axes = vis.volcanoAxes(points, 0.01, 20);
  assert.ok(axes.xMax >= 20);
  assert.ok(axes.yMax >= 300);
  assert.ok(axes.xTicks.includes(0) && axes.yTicks.includes(0));
  assert.equal(axes.xTicks[0], -axes.xMax);
  assert.equal(axes.xTicks.at(-1), axes.xMax);
  assert.ok([...axes.xTicks, ...axes.yTicks].every(Number.isFinite));
  const empty = vis.volcanoAxes([], 1, 0);
  assert.ok(empty.xMax > 0 && empty.yMax > 0);
});

test("volcano filters retain the imported strict cutoff semantics", () => {
  assert.equal(vis.passesVolcanoFilters({ log2_fc: 0.7, adj_p: 0.01 }, 0.05, 0.7), false);
  assert.equal(vis.passesVolcanoFilters({ log2_fc: 1, adj_p: 0.05 }, 0.05, 0.7), false);
  assert.equal(vis.passesVolcanoFilters({ log2_fc: -1, adj_p: 0.01 }, 0.05, 0.7), true);
});

test("brush conversion normalizes reverse drags and clamps to the plot", () => {
  const axes = { left: 20, right: 220, top: 10, bottom: 110, xMax: 5, yMax: 10 };
  const forward = vis.brushFromPixels({ x: 60, y: 20 }, { x: 160, y: 90 }, axes);
  for (const [key, value] of Object.entries({ minFc: -3, maxFc: 2, minY: 2, maxY: 9 })) assert.ok(Math.abs(forward[key] - value) < 1e-12);
  assert.deepEqual(vis.brushFromPixels({ x: 160, y: 90 }, { x: 60, y: 20 }, axes), forward);
  assert.deepEqual(vis.brushFromPixels({ x: -100, y: 999 }, { x: 999, y: -10 }, axes), { minFc: -5, maxFc: 5, minY: 0, maxY: 10 });
});

test("table selection intersects brush, thresholds and search without mutating input", () => {
  const points = [
    { protein_id: "C", gene: null, organism: "human", log2_fc: 0.7, adj_p: 0.01 },
    { protein_id: "B", gene: "beta", organism: "human", log2_fc: -2, adj_p: 0.01 },
    { protein_id: "A", gene: "alpha", organism: "yeast", log2_fc: 3, adj_p: 0.001 },
  ];
  const state = { ...vis.initialExploreState, brush: { minFc: -2, maxFc: 0.7, minY: 2, maxY: 3 } };
  const ids = options => vis.filterRealResults(points, { ...state, ...options }).map(p => p.protein_id);
  assert.deepEqual(ids({}), ["B", "C"], "rectangle edges are inclusive");
  assert.deepEqual(ids({ passingOnly: true }), ["B"]);
  assert.deepEqual(ids({ query: " ALPHA " }), [], "search cannot escape the rectangle");
  assert.deepEqual(ids({ query: " BETa " }), ["B"]);
  assert.deepEqual(ids({ brush: { minFc: 10, maxFc: 20, minY: 0, maxY: 1 } }), [], "empty region is not no selection");
  assert.deepEqual(ids({ brush: null, sort: "effect" }), ["A", "B", "C"]);
  assert.deepEqual(ids({ brush: null, sort: "gene" }), ["A", "B", "C"]);
  assert.deepEqual(points.map(p => p.protein_id), ["C", "B", "A"], "sort must preserve source order");
});

test("real result candidates match the bundled limma values and retain VMA8 evidence", async () => {
  const csv = await readFile(new URL("../data/processed/ga2_human_vs_qc_limma.csv", import.meta.url), "utf8");
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  assert.equal(parsed.errors.length, 0);
  const points = parsed.data.map(p => ({ protein_id: p["Protein ID"], gene: p.Gene, organism: "", log2_fc: Number(p.log2FC), adj_p: Number(p.adj_p) }));
  assert.equal(points.length, 4375);
  const initial = { ...vis.initialExploreState };
  assert.equal(vis.filterRealResults(points, { ...initial, passingOnly: true }).length, 33);
  assert.equal(vis.filterRealResults(points, { ...initial, passingOnly: true, pCutoff: 0.01, fcCutoff: 1 }).length, 23);
  const brush = { minFc: -3, maxFc: -1, minY: 7, maxY: 10 };
  const candidates = vis.filterRealResults(points, { ...initial, brush });
  assert.deepEqual(candidates.map(p => p.protein_id), ["P32610"]);
  assert.equal(candidates[0].gene, "VMA8");
  assert.equal(candidates[0].log2_fc, -2.01167269971667);
  assert.equal(candidates[0].adj_p, 1.19020518653977e-8);
  assert.equal(vis.filterRealResults(points, initial).length, 4375, "clearing selection restores all tested results");
});
