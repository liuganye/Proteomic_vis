/**
 * Smoke checks for Downstream volcano sample↔group mapping.
 * Run: npx tsx --tsconfig tsconfig.json scripts/verify-volcano-mapping.mts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  alignAnnotationToSamples,
  buildDataset,
  sameSynonymGroup,
  synonymKey,
} from "../src/lib/parse-fragpipe.ts";
import {
  annotationGroups,
  approximateGroupContrast,
  matchLimmaContrast,
  volcanoForGroups,
} from "../src/lib/stats.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

assert(sameSynonymGroup("Control", "CTRK"), "Control↔CTRK synonym");
assert(sameSynonymGroup("CTRL", "CTRK"), "CTRL↔CTRK synonym");
assert(synonymKey("FLU10") === synonymKey("flu"), "FLU10↔flu synonym key");
assert(!sameSynonymGroup("PTX", "FLU"), "PTX is not a FLU synonym (residual handles it)");

const mockP = fs.readFileSync(
  path.join(root, "public/mock-data/combined_protein.tsv"),
  "utf8",
);
const mockA = fs.readFileSync(
  path.join(root, "public/mock-data/experiment_annotation.tsv"),
  "utf8",
);
const mock = buildDataset({
  proteinText: mockP,
  annotationText: mockA,
  source: "mock",
});
assert(!mock.annotationWarning, "mock annotation aligns without warning");
assert(
  matchLimmaContrast(mock.contrasts, "Human", "QC")?.contrast === "Human_vs_QC",
  "limma Human_vs_QC matched",
);
const mockVolcano = volcanoForGroups(mock, "Human", "QC");
assert(
  mockVolcano.points.length === 120,
  `mock limma points=${mockVolcano.points.length}`,
);
assert(mockVolcano.approximated === false, "mock uses limma not approx");
assert(
  mockVolcano.points.every((p) => p.proteinProbability != null),
  "mock volcano carries Protein Probability",
);

// Henry: CTRK/FLU annotation + Control/PTX MaxLFQ → keep CTRK/FLU groups
const ctrkAnnPath = "/Users/liuganye/Downloads/experiment_annotation (1).tsv";
const ptxPath = "/Users/liuganye/Downloads/combined_protein (1).tsv";
if (fs.existsSync(ctrkAnnPath) && fs.existsSync(ptxPath)) {
  const auto = buildDataset({
    proteinText: fs.readFileSync(ptxPath, "utf8"),
    annotationText: fs.readFileSync(ctrkAnnPath, "utf8"),
    source: "upload",
  });
  assert(Boolean(auto.annotationWarning), "autodetect sets mapping warning");
  const groups = annotationGroups(auto);
  assert(
    groups.includes("CTRK") && groups.includes("FLU"),
    `autodetect keeps annotation groups: ${groups.join(",")}`,
  );
  assert(
    auto.annotation.some((a) => a.sample === "Control_1" && a.condition === "CTRK"),
    "Control_1 MaxLFQ → CTRK",
  );
  assert(
    auto.annotation.some((a) => a.sample.startsWith("PTX_") && a.condition === "FLU"),
    "PTX_* MaxLFQ → FLU via residual cardinality",
  );
  const v = volcanoForGroups(auto, "CTRK", "FLU");
  assert(v.points.length > 0, `CTRK vs FLU autodetect points=${v.points.length}`);
  assert(v.approximated, "CTRK vs FLU uses MaxLFQ approx");
} else {
  console.log("skip: Henry CTRK/PTX local files not present");
}

// Matching CTRK/FLU rename of MaxLFQ headers (exact)
if (fs.existsSync(ctrkAnnPath) && fs.existsSync(ptxPath)) {
  let text = fs.readFileSync(ptxPath, "utf8");
  const map: Record<string, string> = {
    Control_1: "CTRK_1",
    Control_2: "CTRK_2",
    Control_3: "CTRK_3",
    PTX_4: "FLU_4",
    PTX_5: "FLU_5",
    PTX_6: "FLU_6",
  };
  for (const [a, b] of Object.entries(map)) text = text.split(a).join(b);
  const matched = buildDataset({
    proteinText: text,
    annotationText: fs.readFileSync(ctrkAnnPath, "utf8"),
    source: "upload",
  });
  assert(!matched.annotationWarning, "exact MaxLFQ IDs align without warning");
  assert(
    annotationGroups(matched).join(",") === "CTRK,FLU",
    `matched groups=${annotationGroups(matched)}`,
  );
  const v = volcanoForGroups(matched, "CTRK", "FLU");
  assert(v.points.length > 5000, `CTRK vs FLU exact points=${v.points.length}`);
  const approx = approximateGroupContrast(matched, "CTRK", "FLU");
  assert(
    approx && approx.points.length > 5227,
    "one-sided detections kept in approx",
  );
}

// Unit: alignAnnotationToSamples synonym mode
{
  const aligned = alignAnnotationToSamples(
    [
      { file: "CTRL-1.raw", sample: "CTRK_1", condition: "CTRK", replicate: "1" },
      { file: "CTRL-2.raw", sample: "CTRK_2", condition: "CTRK", replicate: "2" },
      { file: "FLU-1.raw", sample: "FLU_3", condition: "FLU", replicate: "3" },
      { file: "FLU-2.raw", sample: "FLU_4", condition: "FLU", replicate: "4" },
    ],
    ["Control_1", "Control_2", "Treatment_3", "Treatment_4"],
  );
  assert(aligned.mode === "synonym" || aligned.mode === "residual", `mode=${aligned.mode}`);
  assert(
    aligned.annotation.filter((a) => a.condition === "CTRK").map((a) => a.sample).join(",") ===
      "Control_1,Control_2",
    "synonym maps Control→CTRK",
  );
  assert(
    aligned.annotation.filter((a) => a.condition === "FLU").every((a) =>
      a.sample.startsWith("Treatment_"),
    ),
    "residual maps Treatment→FLU",
  );
}

// Protein-only upload: infer groups from sample prefixes
const proteinOnly = buildDataset({
  proteinText: mockP.replace(/Human_/g, "CTRK_").replace(/QC_/g, "FLU_"),
  annotationText: null,
  source: "upload",
});
assert(
  annotationGroups(proteinOnly).includes("CTRK") &&
    annotationGroups(proteinOnly).includes("FLU"),
  `protein-only inferred groups=${annotationGroups(proteinOnly)}`,
);
const po = volcanoForGroups(proteinOnly, "CTRK", "FLU");
assert(po.points.length > 0, "protein-only CTRK vs FLU volcano works");

// Real supplementary Human vs QC (no limma in combined_protein)
const realP = path.join(root, "supplementary_files/combined_protein.tsv");
const realA = path.join(root, "supplementary_files/experiment_annotation.tsv");
if (fs.existsSync(realP) && fs.existsSync(realA)) {
  const real = buildDataset({
    proteinText: fs.readFileSync(realP, "utf8"),
    annotationText: fs.readFileSync(realA, "utf8"),
    source: "upload",
  });
  const v = volcanoForGroups(real, "Human", "QC");
  assert(
    v.points.length > 1000,
    `real Human vs QC approx points=${v.points.length}`,
  );
  assert(
    real.proteins[0].proteinProbability != null,
    "real Protein Probability parsed",
  );
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll volcano mapping checks passed.");
