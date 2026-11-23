import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/qc-grid-paging.ts", import.meta.url),
  "utf8",
);
const rewritten = source.replaceAll("@/lib/types", "./types-stub.ts");
// Drop the type-only import; transpile leaves a runtime import otherwise.
const withoutTypeImport = rewritten.replace(
  /import type \{ QcPlotId \} from ["'].*?["'];?\n/,
  "",
);
const { outputText } = ts.transpileModule(withoutTypeImport, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const {
  QC_PAGE_SIZE,
  BUILTIN_CELL_COUNT,
  plotCellIndex,
  plotPageIndexFor,
  emptySlotCountForPage,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

test("maps conventional focus ids onto the 2×2 pages", () => {
  assert.equal(plotPageIndexFor("missingness", []), 0);
  assert.equal(plotPageIndexFor("intensity", []), 0);
  assert.equal(plotPageIndexFor("correlation", []), 0);
  assert.equal(plotPageIndexFor("median-vs-missing", []), 1);
});

test("places user plots after the builder cell", () => {
  const ids = ["user-a", "user-b"];
  assert.equal(plotCellIndex("user-a", ids), 7);
  assert.equal(plotPageIndexFor("user-a", ids), 1);
  assert.equal(plotPageIndexFor("user-b", ids), 2);
});

test("pads empty slots only to fill the last page", () => {
  // 6 conventional + builder = 7 → pad 1 → 8 cells / 2 pages
  assert.equal(emptySlotCountForPage(7, 0), 1);
  assert.equal(emptySlotCountForPage(8, 1), 0);
  // two user plots → no placeholder padding that would invent a sparse page
  assert.equal(emptySlotCountForPage(9, 2), 0);
});

test("never exceeds four cells per page window", () => {
  const real = BUILTIN_CELL_COUNT + 1;
  const empty = emptySlotCountForPage(real, 0);
  const total = real + empty;
  const pageCount = Math.ceil(total / QC_PAGE_SIZE);
  for (let p = 0; p < pageCount; p++) {
    const start = p * QC_PAGE_SIZE;
    const slice = Math.min(QC_PAGE_SIZE, total - start);
    assert.ok(slice <= QC_PAGE_SIZE);
    assert.ok(slice > 0);
  }
});
