import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function loadFilterLib() {
  const dir = await mkdtemp(join(tmpdir(), "qc-filter-"));
  const files = [
    ["go-demo-mapping.ts", "../src/data/go-demo-mapping.ts"],
    ["go-uniprot-to-gene.ts", "../src/data/go-uniprot-to-gene.ts"],
    ["types.ts", "../src/lib/types.ts"],
    ["go-enrichment.ts", "../src/lib/go-enrichment.ts"],
    ["qc-protein-filter.ts", "../src/lib/qc-protein-filter.ts"],
  ];
  for (const [outName, rel] of files) {
    let source = await readFile(new URL(rel, import.meta.url), "utf8");
    source = source
      .replaceAll("@/data/go-demo-mapping", "./go-demo-mapping.ts")
      .replaceAll("@/data/go-uniprot-to-gene", "./go-uniprot-to-gene.ts")
      .replaceAll("@/lib/types", "./types.ts")
      .replaceAll("@/lib/go-enrichment", "./go-enrichment.ts")
      .replaceAll("@/lib/stats", "./stats-stub.ts")
      .replaceAll("@/data/go-demo-mapping", "./go-demo-mapping.ts");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
    });
    const js = outputText
      .replaceAll("./go-demo-mapping.ts", "./go-demo-mapping.js")
      .replaceAll("./go-uniprot-to-gene.ts", "./go-uniprot-to-gene.js")
      .replaceAll("./types.ts", "./types.js")
      .replaceAll("./go-enrichment.ts", "./go-enrichment.js")
      .replaceAll("./stats-stub.ts", "./stats-stub.js")
      .replaceAll("./qc-protein-filter.ts", "./qc-protein-filter.js");
    await writeFile(join(dir, outName.replace(/\.ts$/, ".js")), js);
  }
  await writeFile(
    join(dir, "stats-stub.js"),
    `
export function annotationGroups(){ return ["Human","QC"]; }
export function defaultGroupPair(){ return { groupA:"Human", groupB:"QC" }; }
export function volcanoForGroups(dataset){
  const points = dataset.proteins.map(p => ({
    proteinId: p.proteinId,
    gene: p.gene,
    log2fc: p.proteinId === "P-UP" ? 2 : p.proteinId === "P-DOWN" ? -2 : 0.1,
    adjP: p.proteinId.startsWith("P-") && p.proteinId !== "P-NS" ? 1e-4 : 0.5,
    negLog10AdjP: 4,
    significant: p.proteinId === "P-UP" || p.proteinId === "P-DOWN",
    direction: p.proteinId === "P-UP" ? "up" : p.proteinId === "P-DOWN" ? "down" : "ns",
  }));
  return { points, ready: true, contrastLabel: "Human / QC", approximated: false };
}
`,
  );
  const mod = await import(pathToFileURL(join(dir, "qc-protein-filter.js")).href);
  setTimeout(() => void rm(dir, { recursive: true, force: true }), 2000);
  return mod;
}

const filterLib = await loadFilterLib();

function dataset(proteins) {
  return {
    proteins,
    samples: ["S1"],
    maxlfqColumns: ["S1 MaxLFQ Intensity"],
    contrasts: [],
    annotation: [{ file: "S1", sample: "S1", condition: "Human", replicate: "1" }],
    source: "mock",
  };
}

test("discoverQcFilterFeatures exposes Downstream-visible GO and gene features", () => {
  const ds = dataset([
    {
      proteinId: "P1",
      gene: "BRCA1",
      description: "",
      proteinProbability: 0.99,
      maxlfq: { S1: 1e6 },
      log2fc: {},
      adjP: {},
    },
    {
      proteinId: "P2",
      gene: "",
      description: "",
      proteinProbability: null,
      maxlfq: { S1: 0 },
      log2fc: {},
      adjP: {},
    },
  ]);
  const features = filterLib.discoverQcFilterFeatures(ds);
  const ids = features.map((f) => f.id);
  assert.ok(ids.includes("gene-symbol"));
  assert.ok(ids.includes("protein-probability"));
  // BRCA1 is in the demo GO map → aspect/term features appear
  assert.ok(ids.includes("go-aspect") || ids.includes("go-term"));
});

test("resolveQcProteinIds intersects feature filter with Downstream selection", () => {
  const ds = dataset([
    {
      proteinId: "P-UP",
      gene: "BRCA1",
      description: "",
      proteinProbability: 0.95,
      maxlfq: { S1: 10 },
      log2fc: {},
      adjP: {},
    },
    {
      proteinId: "P-DOWN",
      gene: "TP53",
      description: "",
      proteinProbability: 0.2,
      maxlfq: { S1: 10 },
      log2fc: {},
      adjP: {},
    },
    {
      proteinId: "P-NS",
      gene: "ACTB",
      description: "",
      proteinProbability: 0.7,
      maxlfq: { S1: 10 },
      log2fc: {},
      adjP: {},
    },
  ]);

  const high = filterLib.resolveQcProteinIds(
    ds,
    { featureId: "protein-probability", value: "high" },
    [],
  );
  assert.deepEqual(high.ids, ["P-UP"]);
  assert.equal(high.empty, false);

  const intersect = filterLib.resolveQcProteinIds(
    ds,
    { featureId: "protein-probability", value: "high" },
    ["P-DOWN", "P-UP"],
  );
  assert.deepEqual(intersect.ids, ["P-UP"]);

  const empty = filterLib.resolveQcProteinIds(
    ds,
    { featureId: "protein-probability", value: "high" },
    ["P-DOWN"],
  );
  assert.equal(empty.empty, true);
  assert.deepEqual(empty.ids, []);
});

test("subsetDatasetProteins keeps samples and empties proteins safely", () => {
  const ds = dataset([
    {
      proteinId: "A",
      gene: "G",
      description: "",
      proteinProbability: null,
      maxlfq: { S1: 1 },
      log2fc: {},
      adjP: {},
    },
  ]);
  const empty = filterLib.subsetDatasetProteins(ds, []);
  assert.equal(empty.proteins.length, 0);
  assert.equal(empty.samples.length, 1);
  const same = filterLib.subsetDatasetProteins(ds, null);
  assert.equal(same, ds);
});
