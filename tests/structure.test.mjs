import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/structure.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const s = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

function atom(serial, chain, resSeq, x, { name = "CA", alt = " ", res = "ALA", b = 50, ins = " ", record = "ATOM  " } = {}) {
  return `${record}${String(serial).padStart(5)} ${name.padStart(name.length < 4 ? name.length + 1 : 4).padEnd(4)}${alt}${res} ${chain}${String(resSeq).padStart(4)}${ins}   ${x.toFixed(3).padStart(8)}${"0.000".padStart(8)}${"0.000".padStart(8)}${"1.00".padStart(6)}${b.toFixed(2).padStart(6)}           C`;
}

test("parses Cα of the requested chain from the first model only", () => {
  const text = [
    "MODEL        1",
    atom(1, "A", 1, 1), atom(2, "A", 1, 1, { name: "CB" }),
    atom(3, "B", 1, 10), atom(4, "B", 2, 13.8, { b: 91.5 }),
    "ENDMDL", "MODEL        2", atom(5, "B", 3, 99), "ENDMDL",
  ].join("\n");
  const parsed = s.parseCalpha(text, "B");
  assert.equal(parsed.chain, "B");
  assert.deepEqual(parsed.residues.map(r => r.resSeq), [1, 2]);
  assert.equal(parsed.residues[1].bFactor, 91.5);
  assert.equal(parsed.residues[0].x, 10);
});

test("keeps the first alternate location and insertion codes, drops other conformers", () => {
  const parsed = s.parseCalpha([
    atom(1, "A", 5, 1, { alt: "A" }), atom(2, "A", 5, 2, { alt: "B" }),
    atom(3, "A", 5, 4.8, { ins: "A" }), atom(4, "A", 6, 8.6, { alt: "B" }),
  ].join("\n"), "A");
  assert.deepEqual(parsed.residues.map(r => `${r.resSeq}${r.insCode}:${r.x}`), ["5:1", "5A:4.8"]);
  assert.equal(s.residueLabel(parsed.residues[1]), "ALA 5A (chain A)");
});

test("falls back to the first chain and reports empty input explicitly", () => {
  const parsed = s.parseCalpha([atom(1, "C", 1, 0), atom(2, "D", 1, 0)].join("\n"), "A");
  assert.equal(parsed.chain, "C");
  assert.equal(parsed.residues.length, 1);
  assert.deepEqual(s.parseCalpha("HEADER only\nEND\n"), { chain: null, residues: [] });
});

test("breaks the trace where consecutive Cα are farther apart than a peptide bond", () => {
  const { residues } = s.parseCalpha([atom(1, "A", 1, 0), atom(2, "A", 2, 3.8), atom(3, "A", 10, 20)].join("\n"));
  assert.deepEqual([...s.chainBreaks(residues)], [2]);
});

test("projection fits the canvas at any rotation and zoom scales around the centre", () => {
  const { residues } = s.parseCalpha([atom(1, "A", 1, -20), atom(2, "A", 2, 0), atom(3, "A", 3, 30)].join("\n"));
  for (const angles of [[0, 0], [0.7, -1.2], [Math.PI, 2]]) {
    for (const p of s.project(residues, angles, 1, 600, 340)) {
      assert.ok(p.x >= 0 && p.x <= 600 && p.y >= 0 && p.y <= 340, JSON.stringify({ angles, p }));
    }
  }
  const one = s.project(residues, [0, 0], 1, 600, 340);
  const two = s.project(residues, [0, 0], 2, 600, 340);
  assert.ok(Math.abs((two[2].x - 300) - 2 * (one[2].x - 300)) < 1e-9);
  assert.deepEqual(s.project([], [0, 0], 1, 600, 340), []);
});

test("pLDDT colors follow AlphaFold bands and position colors run blue to red", () => {
  assert.equal(s.plddtColor(95), "#0053D6");
  assert.equal(s.plddtColor(90), "#65CBF3", "the band boundary belongs to the lower band");
  assert.equal(s.plddtColor(60), "#FFDB13");
  assert.equal(s.plddtColor(12), "#FF7D45");
  assert.equal(s.plddtColor(NaN), "#FF7D45");
  assert.equal(s.positionColor(0, 10), "hsl(240 70% 45%)");
  assert.equal(s.positionColor(9, 10), "hsl(0 70% 45%)");
  assert.equal(s.positionColor(0, 1), "hsl(240 70% 45%)");
  const residues = [95, 80, 80, 30].map((b, i) => ({ chain: "A", resSeq: i, insCode: "", resName: "ALA", x: 0, y: 0, z: 0, bFactor: b }));
  assert.deepEqual(s.plddtSummary(residues).map(band => band.fraction), [0.25, 0.5, 0, 0.25]);
});

test("hover picks the closest residue within reach, else nothing", () => {
  const points = [{ x: 10, y: 10, depth: 0 }, { x: 14, y: 10, depth: 0 }, { x: 100, y: 100, depth: 0 }];
  assert.equal(s.nearestResidue(points, 13, 10), 1);
  assert.equal(s.nearestResidue(points, 50, 50), null);
});

test("the bundled 8IJU file parses into one continuous-enough chain A", async () => {
  const text = await readFile(new URL("../data/external/pdb_files/pdb8iju.ent", import.meta.url), "utf8");
  const parsed = s.parseCalpha(text, "A");
  assert.equal(parsed.chain, "A");
  assert.equal(parsed.residues.length, 376, "13 residues have A/B conformers; only one is kept");
  assert.ok(s.chainBreaks(parsed.residues).size < 10);
});

// Render the real component (initial, pre-fetch state) and its source description.
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const componentJs = ts.transpileModule(
  await readFile(new URL("../src/components/ProteinStructure.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
const nodeRequire = createRequire(import.meta.url);
const componentModule = { exports: {} };
new Function("require", "module", "exports", "process", componentJs)(
  name => name === "@/lib/structure" ? s : nodeRequire(name),
  componentModule, componentModule.exports, { env: {} },
);
const { ProteinStructure, describeModel } = componentModule.exports;

const model = overrides => ({
  protein_id: "O00148", source: "pdb", model_id: "8IJU", chain_id: "A", method: "X-ray diffraction",
  resolution: 1.82, unp_start: 42, unp_end: 427, coverage: 0.89, source_url: "https://www.rcsb.org/structure/8IJU",
  coloring: "position", coordinates_url: "/api/v1/proteins/O00148/structure/coordinates", ...overrides,
});

test("the source line names entry, chain, method, resolution, range and coverage", () => {
  assert.equal(describeModel(model(), 376),
    "PDB 8IJU · chain A · X-ray diffraction · 1.82 Å · UniProt residues 42–427 · 89% of the sequence · 376 Cα drawn");
  assert.equal(describeModel(model({ source: "alphafold", model_id: "AF-O00148-F1", chain_id: null, method: "AlphaFold prediction", resolution: null, unp_start: 1, unp_end: 427, coverage: null, coloring: "plddt" }), 427),
    "AlphaFold prediction AF-O00148-F1 · UniProt residues 1–427 · 427 Cα drawn");
  assert.match(describeModel(model({ source: "local", unp_start: null, unp_end: null, coverage: null }), 376), /bundled file$/);
});

test("before data arrives the view explains the wait and still lists dataset PDB references", () => {
  const html = renderToStaticMarkup(React.createElement(ProteinStructure, {
    proteinId: "O00148", references: [{ pdb_id: "8IJU" }, { pdb_id: "8IJV" }],
  }));
  assert.match(html, /Finding the best available structure/);
  assert.match(html, /role="status"/);
  assert.match(html, /PDB references in the dataset \(2\)/);
  assert.match(html, /href="https:\/\/www\.rcsb\.org\/structure\/8IJV"/);
  assert.match(html, /<canvas[^>]*tabindex="-1"/, "the empty canvas is not a keyboard stop");
});
