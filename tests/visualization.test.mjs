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
const qcPlot = await loadTs("../src/lib/qc-plot.ts");
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

test("group histograms share bin boundaries and sum to the full histogram", () => {
  const full = stats.intensityHistogram(dataset([1, 10, 100, 1000, 10000]), 4);
  const domain = [full.bins[0].lower, full.bins.at(-1).upper];
  const a = stats.intensityHistogram(dataset([1, 100, 10000]), 4, domain);
  const b = stats.intensityHistogram(dataset([10, 1000]), 4, domain);
  assert.deepEqual(a.bins.map(bin => [bin.lower, bin.upper]), full.bins.map(bin => [bin.lower, bin.upper]));
  assert.deepEqual(a.bins.map((bin, i) => bin.count + b.bins[i].count), full.bins.map(bin => bin.count));
  assert.equal(stats.intensityHistogram(dataset([100, 100]), 4, domain).bins.length, 4);
  assert.throws(() => stats.intensityHistogram(dataset([1, 100]), 4, [1, 2]), /contain/);
  assert.throws(() => stats.intensityHistogram(dataset([1]), 4, [2, 2]), /increasing/);
});

test("empty and constant sample correlations are undefined, including the diagonal", () => {
  const data = { samples: ["empty", "one", "constant", "variable"], annotation: [], proteins: [
    { maxlfq: { empty: 0, one: 10, constant: 100, variable: 10 } },
    { maxlfq: { empty: 0, one: 0, constant: 100, variable: 100 } },
    { maxlfq: { empty: 0, one: 0, constant: 100, variable: 1000 } },
  ] };
  const result = stats.sampleCorrelationMatrix(data);
  for (const sample of ["empty", "one", "constant"]) {
    const i = result.samples.indexOf(sample);
    assert.ok(Number.isNaN(result.matrix[i][i]), sample);
  }
  const i = result.samples.indexOf("variable");
  assert.equal(result.matrix[i][i], 1);
});

test("constant log intensities stay undefined despite floating-point rounding", () => {
  for (const count of [3, 45, 9369]) {
    const data = { samples: ["constant", "variable"], annotation: [], proteins:
      Array.from({ length: count }, (_, i) => ({ maxlfq: {
        constant: 1234567,
        variable: 10 ** (1 + i % 7),
      } })),
    };
    const result = stats.sampleCorrelationMatrix(data);
    const c = result.samples.indexOf("constant");
    const v = result.samples.indexOf("variable");
    assert.ok(Number.isNaN(result.matrix[c][c]), `constant diagonal, n=${count}`);
    assert.ok(Number.isNaN(result.matrix[c][v]), `constant vs variable, n=${count}`);
    assert.ok(Number.isNaN(result.matrix[v][c]), `variable vs constant, n=${count}`);
    assert.equal(result.matrix[v][v], 1);
  }
});

test("Pearson preserves known correlations using only paired finite values", () => {
  const a = [1e9 + 1, NaN, 1e9 + 2, Infinity, 1e9 + 3, 1e9 + 4];
  const b = [2, 999, 4, 999, 6, 8];
  assert.ok(Math.abs(stats.pearson(a, b) - 1) < 1e-12);
  assert.ok(Math.abs(stats.pearson(b, a) - 1) < 1e-12);
  assert.ok(Math.abs(stats.pearson(a, b.map(value => -value)) + 1) < 1e-12);
  assert.ok(Math.abs(stats.pearson([1, 2, 3], [2, 0, 2])) < 1e-12);
});

test("pair inspector counts only proteins observed in both samples", () => {
  const data = { proteins: [
    { maxlfq: { a: 10, b: 100 } }, { maxlfq: { a: 0, b: 10 } },
    { maxlfq: { a: Infinity, b: 10 } }, { maxlfq: { a: 10, b: -1 } },
    { maxlfq: { a: 100, b: 1000 } }, { maxlfq: { a: NaN } },
  ] };
  assert.equal(qcPlot.sharedProteinCount(data, "a", "b"), 2);
  assert.equal(qcPlot.sharedProteinCount(data, "b", "a"), 2);
  assert.equal(qcPlot.sharedProteinCount(data, "a", "a"), 3);
  assert.equal(qcPlot.sharedProteinCount(data, "a", "unknown"), 0);
});

test("Q2 intensity summary axes contain every finite value, including constant and empty data", () => {
  for (const values of [[], [7.2], [7.2, 7.2], [6.1, 7.9, NaN, Infinity]]) {
    const [min, max] = qcPlot.paddedDomain(values);
    assert.ok(Number.isFinite(min) && Number.isFinite(max) && min < max);
    for (const value of values.filter(Number.isFinite)) assert.ok(value > min && value < max);
  }
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
  assert.equal(vis.correlationColor(-1), "rgb(74, 114, 160)");
  assert.equal(vis.correlationColor(0), "rgb(246, 247, 248)");
  assert.equal(vis.correlationColor(1), "rgb(196, 92, 86)");
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
  const summary = vis.volcanoSummaryCounts(points, 0.05, 0.7);
  assert.equal(summary.total, 4375);
  assert.equal(summary.passing, 33);
  assert.equal(summary.up + summary.down, 33);
  assert.ok(summary.up > 0 && summary.down > 0);
});

test("volcano direction, z-order layering and callout selection prioritize focus and filtered candidates", () => {
  assert.equal(vis.volcanoDirection({ log2_fc: 1.5, adj_p: 0.01 }, 0.05, 0.7), "up");
  assert.equal(vis.volcanoDirection({ log2_fc: -1.5, adj_p: 0.01 }, 0.05, 0.7), "down");
  assert.equal(vis.volcanoDirection({ log2_fc: 0.7, adj_p: 0.01 }, 0.05, 0.7), "ns");
  assert.equal(vis.volcanoDirection({ log2_fc: 2.0, adj_p: 0.05 }, 0.05, 0.7), "ns");

  const points = [
    { protein_id: "FOCUS", gene: "G_FOCUS", log2_fc: 0.1, adj_p: 0.8 },
    { protein_id: "NS", gene: "G_NS", log2_fc: 0.2, adj_p: 0.7 },
    { protein_id: "NEIGHBOR", gene: "G_NB", log2_fc: 0.3, adj_p: 0.6 },
    { protein_id: "UP", gene: "G_UP", log2_fc: 2.0, adj_p: 0.001 },
    { protein_id: "MATCH", gene: "G_MATCH", log2_fc: -1.8, adj_p: 0.002 },
  ];
  const ordered = vis.orderVolcanoPoints(points, 0.05, 0.7, new Set(["MATCH"]), "FOCUS", true, new Set(["NEIGHBOR"]));
  assert.deepEqual(ordered.map(p => p.protein_id), ["NS", "UP", "NEIGHBOR", "MATCH", "FOCUS"]);
  assert.deepEqual(points.map(p => p.protein_id), ["FOCUS", "NS", "NEIGHBOR", "UP", "MATCH"], "ordering must not mutate input");
  assert.equal(vis.LOCAL_STRUCTURE_PDB.O00148, "8IJU");
  assert.equal(Object.keys(vis.LOCAL_STRUCTURE_PDB).length, 4);

  const calloutsNoFilter = vis.selectVolcanoCallouts(points, {
    pCutoff: 0.05,
    fcCutoff: 0.7,
    matchingIds: new Set(),
    hasFilters: false,
    focusId: "FOCUS",
    maxCallouts: 6,
  });
  assert.deepEqual(calloutsNoFilter.map(p => p.protein_id), ["FOCUS", "UP", "MATCH"]);

  const calloutsWithFilter = vis.selectVolcanoCallouts(points, {
    pCutoff: 0.05,
    fcCutoff: 0.7,
    matchingIds: new Set(["MATCH"]),
    hasFilters: true,
    focusId: "FOCUS",
    maxCallouts: 2,
  });
  assert.deepEqual(calloutsWithFilter.map(p => p.protein_id), ["FOCUS", "MATCH"]);
});

test("STRING layout maps higher confidence closer to center and places center at (500, 380)", () => {
  const nodes = [
    { protein_id: "CENTER" },
    { protein_id: "LOW" },
    { protein_id: "HIGH" },
    { protein_id: "MID" },
  ];
  const edges = [
    { source: "CENTER", target: "LOW", score: 0.4 },
    { source: "CENTER", target: "HIGH", score: 0.95 },
    { source: "CENTER", target: "MID", score: 0.7 },
    { source: "HIGH", target: "MID", score: 0.8 },
  ];
  const layout = vis.layoutStringNeighborhood("CENTER", nodes, edges);
  assert.deepEqual(
    { x: layout.get("CENTER").x, y: layout.get("CENTER").y, radius: layout.get("CENTER").radius },
    { x: 500, y: 380, radius: 0 },
  );
  assert.ok(layout.get("HIGH").radius < layout.get("MID").radius);
  assert.ok(layout.get("MID").radius < layout.get("LOW").radius);
  for (const id of ["HIGH", "MID", "LOW"]) {
    const pos = layout.get(id);
    assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y));
  }
});

test("STRING sector grouping clusters co-regulated neighbors and curvedChordGeometry avoids center", () => {
  const nodes = [
    { protein_id: "CENTER" },
    { protein_id: "U1" },
    { protein_id: "D1" },
    { protein_id: "U2" },
    { protein_id: "X1" },
  ];
  const edges = [
    { source: "CENTER", target: "U1", score: 0.9 },
    { source: "CENTER", target: "D1", score: 0.9 },
    { source: "CENTER", target: "U2", score: 0.8 },
    { source: "CENTER", target: "X1", score: 0.7 },
  ];
  const groups = { U1: "up", U2: "up", D1: "down", X1: "untested" };
  const grouped = vis.layoutStringNeighborhood("CENTER", nodes, edges, { groupBy: id => groups[id] });
  assert.ok(grouped.get("U1").angle < grouped.get("D1").angle);
  assert.ok(grouped.get("U2").angle < grouped.get("D1").angle);
  assert.ok(grouped.get("D1").angle < grouped.get("X1").angle);

  const chord = vis.curvedChordGeometry({ x: 300, y: 300 }, { x: 700, y: 300 }, 500, 300);
  assert.ok(chord.d.startsWith("M 300.0 300.0 Q "));
  assert.ok(Math.hypot(chord.midX - 500, chord.midY - 300) >= 30);

  const rings = [{ r: 100, label: "1.0" }, { r: 150, label: "0.7" }];
  const obstacleAtBottomRight = [{ x: 300 + 110 * Math.SQRT1_2, y: 300 + 110 * Math.SQRT1_2, halfW: 36, halfH: 26 }];
  const placed = vis.pickRingLabelPositions(rings, 300, 300, {
    obstacles: obstacleAtBottomRight,
    spokes: [],
    bounds: { width: 640, height: 600 },
  });
  assert.equal(placed.length, 2);
  for (const item of placed) {
    const dx = Math.abs(item.x - obstacleAtBottomRight[0].x);
    const dy = Math.abs(item.y - obstacleAtBottomRight[0].y);
    assert.ok(dx > 28 + 36 || dy > 8.5 + 26, "ring label must dodge obstacle box");
  }

  assert.equal(vis.stepSignificanceCutoff(1, -1), 0.5);
  assert.equal(vis.stepSignificanceCutoff(0.05, 1), 0.1);
  assert.equal(vis.stepSignificanceCutoff(0.05, -1), 0.02);
  assert.equal(vis.stepFoldChangeCutoff(0.7, 1), 0.8);
  assert.equal(vis.stepFoldChangeCutoff(0.05, -1), 0);
});
