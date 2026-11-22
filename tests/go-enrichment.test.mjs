import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);

async function loadGoEnrichment() {
  const dir = await mkdtemp(join(tmpdir(), "go-enrich-"));
  try {
    const files = [
      ["go-demo-mapping.ts", "../src/data/go-demo-mapping.ts"],
      ["go-uniprot-to-gene.ts", "../src/data/go-uniprot-to-gene.ts"],
      ["types.ts", "../src/lib/types.ts"],
      ["go-enrichment.ts", "../src/lib/go-enrichment.ts"],
    ];
    for (const [outName, rel] of files) {
      let source = await readFile(new URL(rel, import.meta.url), "utf8");
      source = source
        .replaceAll("@/data/go-demo-mapping", "./go-demo-mapping.ts")
        .replaceAll("@/data/go-uniprot-to-gene", "./go-uniprot-to-gene.ts")
        .replaceAll("@/lib/types", "./types.ts");
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2020,
          moduleResolution: ts.ModuleResolutionKind.NodeJs,
        },
      });
      const js = outputText
        .replaceAll("./go-demo-mapping.ts", "./go-demo-mapping.js")
        .replaceAll("./go-uniprot-to-gene.ts", "./go-uniprot-to-gene.js")
        .replaceAll("./types.ts", "./types.js");
      await writeFile(join(dir, outName.replace(/\.ts$/, ".js")), js);
    }
    return import(pathToFileURL(join(dir, "go-enrichment.js")).href);
  } finally {
    setTimeout(() => void rm(dir, { recursive: true, force: true }), 2000);
  }
}

const go = await loadGoEnrichment();

function point(partial) {
  return {
    proteinId: partial.proteinId ?? partial.gene ?? "X",
    gene: partial.gene ?? "",
    log2fc: partial.log2fc ?? 2,
    adjP: partial.adjP ?? 1e-6,
    negLog10AdjP: partial.negLog10AdjP ?? 6,
    significant: partial.significant ?? true,
    direction: partial.direction ?? "up",
  };
}

test("hypergeometricTail is 1 when k=0 and decreases for stronger enrichment", () => {
  assert.equal(go.hypergeometricTail(100, 10, 20, 0), 1);
  const weak = go.hypergeometricTail(100, 10, 20, 2);
  const strong = go.hypergeometricTail(100, 10, 20, 8);
  assert.ok(strong < weak);
  assert.ok(strong < 0.01);
});

test("benjaminiHochberg returns same length and bounds adj.P to [0,1]", () => {
  const p = [0.001, 0.02, 0.03, 0.5];
  const adj = go.benjaminiHochberg(p);
  assert.equal(adj.length, 4);
  assert.ok(adj.every((a) => a >= 0 && a <= 1));
  assert.ok(adj[0] <= adj[adj.length - 1] + 1e-12);
});

test("enrichGoTerms ranks DNA repair among DNA-damage significant genes", () => {
  const genes = [
    "BRCA1",
    "BRCA2",
    "ATM",
    "ATR",
    "CHEK1",
    "PARP1",
    "PCNA",
    "ACTB",
    "GAPDH",
    "ALB",
    "TUBB",
    "VIM",
  ];
  const damage = new Set([
    "BRCA1",
    "BRCA2",
    "ATM",
    "ATR",
    "CHEK1",
    "PARP1",
    "PCNA",
  ]);
  const points = genes.map((gene) => ({
    proteinId: gene,
    gene,
    log2fc: damage.has(gene) ? 2 : 0.1,
    adjP: damage.has(gene) ? 1e-6 : 0.8,
    negLog10AdjP: damage.has(gene) ? 6 : 0.1,
    significant: damage.has(gene),
    direction: damage.has(gene) ? "up" : "ns",
  }));

  const result = go.enrichGoTerms(points, {
    aspect: "BP",
    direction: "significant",
    ranking: "negLog10AdjP",
    topN: 10,
    minHits: 2,
  });

  assert.ok(result.annotatedForeground >= 5);
  assert.ok(result.terms.length > 0);
  const topIds = result.terms.map((t) => t.id);
  assert.ok(
    topIds.includes("GO:0006281") || topIds.includes("GO:0006974"),
    `expected DNA repair / damage among top terms, got ${topIds.join(",")}`,
  );
  assert.equal(result.ranking, "negLog10AdjP");
  assert.ok(result.terms[0].negLog10AdjP >= result.terms.at(-1).negLog10AdjP);
  assert.equal(result.idColumnUsed, "Gene");
});

test("enrichGoTerms reports empty when no significant proteins", () => {
  const points = [
    {
      proteinId: "ACTB",
      gene: "ACTB",
      log2fc: 0.1,
      adjP: 0.9,
      negLog10AdjP: 0.05,
      significant: false,
      direction: "ns",
    },
  ];
  const result = go.enrichGoTerms(points, { aspect: "all" });
  assert.equal(result.annotatedForeground, 0);
  assert.equal(result.terms.length, 0);
});

test("extractUniprotAccession handles bare, isoform, and sp|ACC|NAME", () => {
  assert.equal(go.extractUniprotAccession("P00441"), "P00441");
  assert.equal(go.extractUniprotAccession("P00441-2"), "P00441");
  assert.equal(go.extractUniprotAccession("sp|P00441|SODC_HUMAN"), "P00441");
  assert.equal(go.extractUniprotAccession("tr|O14757|CHK1_HUMAN"), "O14757");
  assert.equal(go.extractUniprotAccession("not-an-accession"), null);
});

test("resolveGoGene prefers Gene symbol then UniProt alias", () => {
  const byGene = go.resolveGoGene({ gene: "sod1", proteinId: "P00441" });
  assert.equal(byGene.key, "SOD1");
  assert.equal(byGene.source, "gene");
  assert.equal(byGene.column, "Gene");

  const byAcc = go.resolveGoGene({ gene: "", proteinId: "P00441-1" });
  assert.equal(byAcc.key, "SOD1");
  assert.equal(byAcc.source, "uniprot");
  assert.equal(byAcc.column, "Protein ID");

  const geneIsAcc = go.resolveGoGene({ gene: "P00441", proteinId: "P00441" });
  assert.equal(geneIsAcc.key, "SOD1");
  assert.equal(geneIsAcc.source, "uniprot");
  assert.equal(geneIsAcc.column, "Gene");

  const multi = go.resolveGoGene({
    gene: "UNKNOWN;SOD1",
    proteinId: "X",
  });
  assert.equal(multi.key, "SOD1");
  assert.equal(multi.source, "gene");
  assert.equal(multi.column, "Gene");
});

test("splitGeneCandidates keeps comma-in-name symbols like DUR1,2", () => {
  assert.deepEqual(go.splitGeneCandidates("DUR1,2"), ["DUR1,2"]);
  assert.deepEqual(go.splitGeneCandidates("SOD1;GAPDH"), ["SOD1", "GAPDH"]);
  assert.deepEqual(go.splitGeneCandidates("SOD1, GAPDH"), ["SOD1", "GAPDH"]);
});

test("real-upload-shaped UniProt-only list still enriches", () => {
  // Mimics FragPipe rows where Gene is empty and stats copies proteinId into gene
  const background = [
    point({ proteinId: "P00441", gene: "", significant: true, direction: "up" }), // SOD1
    point({ proteinId: "P00338", gene: "", significant: true, direction: "up" }), // LDHA
    point({ proteinId: "P06733", gene: "", significant: true, direction: "up" }), // ENO1
    point({ proteinId: "P04406", gene: "", significant: false, direction: "ns" }), // GAPDH
    point({ proteinId: "P07437", gene: "", significant: false, direction: "ns" }), // TUBB
    point({ proteinId: "P99999", gene: "", significant: true, direction: "up" }), // CYCS
    point({ proteinId: "A0A0B4J2F0", gene: "", significant: true, direction: "up" }), // unmapped
    point({
      proteinId: "sp|P06733|ENOA_HUMAN",
      gene: "",
      significant: true,
      direction: "up",
    }), // human ENO1 via pipe (same gene as bare P06733 — dedup)
  ];

  const result = go.enrichGoTerms(background, {
    aspect: "all",
    direction: "significant",
    topN: 10,
    minHits: 2,
  });

  assert.ok(
    result.annotatedForeground >= 3,
    `expected mapped FG via UniProt, got ${result.annotatedForeground}`,
  );
  assert.ok(result.terms.length > 0, "expected enriched terms for UniProt-only upload");
  assert.equal(result.idColumnUsed, "Protein ID");
  assert.ok(result.resolvedViaUniprot >= 3);
  assert.ok(result.unmappedForeground.includes("A0A0B4J2F0"));
});

test("accession held in Gene column reports idColumnUsed Gene", () => {
  // stats.ts empty-Gene path copies Protein ID into gene — still a Gene-field lookup
  const points = [
    point({ proteinId: "P00441", gene: "P00441", significant: true }),
    point({ proteinId: "P00338", gene: "P00338", significant: true }),
    point({ proteinId: "P06733", gene: "P06733", significant: true }),
    point({ proteinId: "P04406", gene: "P04406", significant: false, direction: "ns", log2fc: 0.1, adjP: 0.9 }),
    point({ proteinId: "P07437", gene: "P07437", significant: false, direction: "ns", log2fc: 0.1, adjP: 0.9 }),
  ];
  const result = go.enrichGoTerms(points, {
    aspect: "all",
    direction: "significant",
    topN: 10,
    minHits: 2,
  });
  assert.ok(result.annotatedForeground >= 3);
  assert.equal(result.idColumnUsed, "Gene");
  assert.equal(result.resolvedViaUniprot, result.annotatedForeground);
});

test("via-UniProt counter is unique FG genes after dedup", () => {
  const points = [
    point({ proteinId: "P00441", gene: "", significant: true }),
    point({ proteinId: "P00441-2", gene: "", significant: true }), // same SOD1
    point({ proteinId: "sp|P00441|SODC_HUMAN", gene: "", significant: true }),
    point({ proteinId: "P00338", gene: "", significant: true }),
    point({ proteinId: "P06733", gene: "", significant: true }),
    point({ proteinId: "P04406", gene: "GAPDH", significant: false, direction: "ns", log2fc: 0.1, adjP: 0.9 }),
    point({ proteinId: "P07437", gene: "TUBB", significant: false, direction: "ns", log2fc: 0.1, adjP: 0.9 }),
  ];
  const result = go.enrichGoTerms(points, {
    aspect: "all",
    direction: "significant",
    topN: 10,
    minHits: 2,
  });
  assert.equal(result.annotatedForeground, 3); // SOD1, LDHA, ENO1
  assert.equal(result.resolvedViaUniprot, 3); // not 5 row-level hits
  assert.equal(result.idColumnUsed, "Protein ID");
});

test("non-human UniProt accessions do not alias into human GO symbols", () => {
  const yeast = go.resolveGoGene({ gene: "", proteinId: "P00924" });
  assert.equal(yeast.key, "");
  assert.equal(yeast.source, "unresolved");
  const ecoli = go.resolveGoGene({ gene: "", proteinId: "P52643" });
  assert.equal(ecoli.key, "");
  const horse = go.resolveGoGene({ gene: "", proteinId: "P00004" });
  assert.equal(horse.key, "");
  const bovin = go.resolveGoGene({ gene: "", proteinId: "P02769" });
  assert.equal(bovin.key, "");
  // Human counterparts still resolve
  assert.equal(go.resolveGoGene({ gene: "", proteinId: "P06733" }).key, "ENO1");
  assert.equal(go.resolveGoGene({ gene: "", proteinId: "P99999" }).key, "CYCS");
});

test("real-upload-shaped mixed Gene + UniProt produces chart metadata", () => {
  const points = [
    point({ proteinId: "O14757", gene: "CHEK1", significant: true }),
    point({ proteinId: "P06493", gene: "CDK1", significant: true }),
    point({ proteinId: "P24941", gene: "", significant: true }), // CDK2 via UniProt
    point({ proteinId: "P04637", gene: "TP53", significant: true }),
    point({ proteinId: "P00519", gene: "ABL1", significant: false, direction: "ns", log2fc: 0.1, adjP: 0.9 }),
    point({ proteinId: "ZZZZZZ", gene: "NOTAGOGENE", significant: true }),
  ];

  const result = go.enrichGoTerms(points, {
    aspect: "BP",
    direction: "significant",
    topN: 10,
    minHits: 2,
  });

  assert.ok(result.annotatedForeground >= 3);
  assert.ok(result.terms.length > 0);
  assert.ok(
    result.idColumnUsed === "Gene" || result.idColumnUsed === "mixed",
    `idColumnUsed=${result.idColumnUsed}`,
  );
  assert.ok(result.unmappedForeground.includes("NOTAGOGENE"));
});

test("empty mapping UX fields when nothing overlaps demo map", () => {
  const points = [
    point({ proteinId: "A0A0B4J2F0", gene: "PIGBOS1", significant: true }),
    point({ proteinId: "A0A0J9YX57", gene: "MAGEB6B", significant: true }),
  ];
  const result = go.enrichGoTerms(points, { aspect: "all" });
  assert.equal(result.annotatedForeground, 0);
  assert.equal(result.terms.length, 0);
  assert.equal(result.idColumnUsed, "none");
  assert.ok(result.unmappedForeground.length >= 2);
});

void require;
