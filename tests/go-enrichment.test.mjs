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
      ["types.ts", "../src/lib/types.ts"],
      ["go-enrichment.ts", "../src/lib/go-enrichment.ts"],
    ];
    for (const [outName, rel] of files) {
      let source = await readFile(new URL(rel, import.meta.url), "utf8");
      source = source
        .replaceAll("@/data/go-demo-mapping", "./go-demo-mapping.ts")
        .replaceAll("@/lib/types", "./types.ts");
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2020,
          moduleResolution: ts.ModuleResolutionKind.NodeJs,
        },
      });
      // Keep .ts extension out of emitted imports for Node ESM
      const js = outputText
        .replaceAll("./go-demo-mapping.ts", "./go-demo-mapping.js")
        .replaceAll("./types.ts", "./types.js");
      await writeFile(join(dir, outName.replace(/\.ts$/, ".js")), js);
    }
    return import(pathToFileURL(join(dir, "go-enrichment.js")).href);
  } finally {
    // Keep temp until import settles — delay cleanup
    setTimeout(() => void rm(dir, { recursive: true, force: true }), 2000);
  }
}

const go = await loadGoEnrichment();

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

// silence unused
void require;
