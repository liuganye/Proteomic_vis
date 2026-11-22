import {
  GO_DEMO_GENE_TERMS,
  GO_DEMO_TERMS,
  type GoAspect,
  type GoTermDef,
} from "@/data/go-demo-mapping";
import { GO_UNIPROT_TO_GENE } from "@/data/go-uniprot-to-gene";
import type { VolcanoPoint } from "./types";

export type { GoAspect, GoTermDef };

export type GoDirectionFilter = "significant" | "up" | "down";

/** How a volcano row was matched to the bundled GO gene map. */
export type GoIdSource = "gene" | "uniprot" | "unresolved";

/** FragPipe-style field that supplied the matched ID. */
export type GoIdColumn = "Gene" | "Protein ID";

export interface GoEnrichmentTerm {
  id: string;
  name: string;
  aspect: GoAspect;
  /** Genes in the foreground set annotated to this term */
  hitGenes: string[];
  k: number;
  K: number;
  n: number;
  N: number;
  /** Fold enrichment = (k/n) / (K/N) */
  enrichment: number;
  pValue: number;
  /** Benjamini–Hochberg FDR */
  adjP: number;
  negLog10P: number;
  negLog10AdjP: number;
}

export interface GoEnrichmentResult {
  terms: GoEnrichmentTerm[];
  foregroundSize: number;
  backgroundSize: number;
  annotatedForeground: number;
  annotatedBackground: number;
  unmappedForeground: string[];
  /** Rows resolved via UniProt accession → gene alias (not Gene column). */
  resolvedViaUniprot: number;
  /**
   * Which FragPipe-style field supplied most mapped foreground IDs.
   * `mixed` when both Gene symbols and UniProt aliases contributed.
   */
  idColumnUsed: "Gene" | "Protein ID" | "mixed" | "none";
  aspect: GoAspect | "all";
  direction: GoDirectionFilter;
  ranking: "negLog10AdjP" | "enrichment";
}

export interface GoEnrichmentOptions {
  aspect?: GoAspect | "all";
  direction?: GoDirectionFilter;
  /** Max terms returned after ranking (default 20) */
  topN?: number;
  /** Minimum annotated hits in the foreground (default 2) */
  minHits?: number;
  ranking?: "negLog10AdjP" | "enrichment";
  /**
   * Optional override of gene→term map (uppercase keys).
   * Defaults to the bundled GO map (`go-bundle.json`).
   */
  geneTerms?: Record<string, string[]>;
  termCatalog?: GoTermDef[];
  /** Optional UniProt accession → gene symbol map (uppercase keys). */
  uniprotToGene?: Record<string, string>;
}

function normalizeId(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Strip UniProt isoform suffix (P12345-2 → P12345). */
export function stripIsoformSuffix(accession: string): string {
  return accession.replace(/-\d+$/, "");
}

const UNIPROT_ACC_RE =
  /([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?/i;

/**
 * Extract a UniProt accession from FragPipe Protein ID / Protein fields.
 * Accepts bare accessions, isoform suffixes, `sp|ACC|NAME` / `tr|ACC|NAME`,
 * and first accession in semicolon-grouped IDs (`P00441;Q9Y6K9`).
 */
export function extractUniprotAccession(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const pipe = s.match(/^(?:sp|tr)\|([A-Za-z0-9]+)(?:\||$)/i);
  if (pipe?.[1]) return stripIsoformSuffix(normalizeId(pipe[1]));
  // Bare accession (with optional isoform)
  const bare = s.match(
    /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?$/i,
  );
  if (bare?.[1]) return stripIsoformSuffix(normalizeId(bare[1]));
  // First accession in a multi-ID cell (e.g. P00441;Q9Y6K9)
  const first = s.split(/[;,\s|/]+/).find((part) => UNIPROT_ACC_RE.test(part));
  if (first) {
    const m = first.match(UNIPROT_ACC_RE);
    if (m?.[1]) return stripIsoformSuffix(normalizeId(m[1]));
  }
  return null;
}

/**
 * Split FragPipe multi-gene cells.
 * Prefer `;` / whitespace / `|` separators. Commas only split when both sides
 * look like gene symbols (avoids breaking rare names like `DUR1,2`).
 */
export function splitGeneCandidates(raw: string): string[] {
  if (!raw?.trim()) return [];
  const looksLikeSymbol = (s: string) => /^[A-Za-z][A-Za-z0-9]*$/.test(s);
  // Comma+whitespace is a list separator; bare commas inside tokens (DUR1,2) stay.
  const normalized = raw.replace(/,\s+/g, ";");
  const parts: string[] = [];
  for (const chunk of normalized.split(/[;\s|/]+/)) {
    const t = chunk.trim();
    if (!t) continue;
    if (t.includes(",")) {
      const sides = t.split(",").map((x) => x.trim()).filter(Boolean);
      if (sides.length >= 2 && sides.every(looksLikeSymbol)) {
        parts.push(...sides);
        continue;
      }
    }
    parts.push(t);
  }
  return parts.map((g) => normalizeId(g)).filter(Boolean);
}

export interface GoGeneResolve {
  /** Uppercase gene symbol key for GO_DEMO_GENE_TERMS (empty if unresolved). */
  key: string;
  source: GoIdSource;
  /** Which FragPipe field supplied the matched ID (null when unresolved). */
  column: GoIdColumn | null;
  /** Display / diagnostics label before resolution. */
  label: string;
}

/**
 * Resolve a volcano / protein row to a GO mapping key.
 * Prefers Gene symbols that hit the bundled term map; falls back to UniProt→gene
 * aliases when Gene is missing, sparse, or itself an accession.
 */
export function resolveGoGene(
  p: Pick<VolcanoPoint, "gene" | "proteinId">,
  opts?: {
    geneTerms?: Record<string, string[]>;
    uniprotToGene?: Record<string, string>;
  },
): GoGeneResolve {
  const geneTerms = opts?.geneTerms ?? GO_DEMO_GENE_TERMS;
  const uniprotToGene = opts?.uniprotToGene ?? GO_UNIPROT_TO_GENE;

  const hasTerms = (key: string): boolean => Boolean(geneTerms[key]?.length);

  const trySymbol = (
    sym: string,
    column: GoIdColumn,
  ): GoGeneResolve | null => {
    if (!sym) return null;
    if (hasTerms(sym)) return { key: sym, source: "gene", column, label: sym };
    return null;
  };

  const tryUniprot = (
    raw: string,
    label: string,
    column: GoIdColumn,
  ): GoGeneResolve | null => {
    const acc = extractUniprotAccession(raw);
    if (!acc) return null;
    const gene = uniprotToGene[acc];
    if (gene && hasTerms(gene)) {
      return { key: gene, source: "uniprot", column, label: label || acc };
    }
    // Direct accession key in geneTerms (rare; supports test overrides)
    if (hasTerms(acc)) {
      return { key: acc, source: "uniprot", column, label: label || acc };
    }
    return null;
  };

  const geneRaw = p.gene?.trim() ?? "";
  const proteinRaw = p.proteinId?.trim() ?? "";

  // 1) Gene column candidates (symbols first)
  for (const cand of splitGeneCandidates(geneRaw)) {
    const hit = trySymbol(cand, "Gene");
    if (hit) return hit;
  }

  // 2) Gene column may itself be a UniProt accession (empty-Gene path sets gene=proteinId)
  for (const cand of splitGeneCandidates(geneRaw)) {
    const hit = tryUniprot(cand, cand, "Gene");
    if (hit) return hit;
  }
  if (geneRaw) {
    const hit = tryUniprot(geneRaw, normalizeId(geneRaw), "Gene");
    if (hit) return hit;
  }

  // 3) Protein ID / Protein-style field
  if (proteinRaw) {
    const asSymbol = trySymbol(normalizeId(proteinRaw), "Protein ID");
    if (asSymbol) return asSymbol;
    const hit = tryUniprot(
      proteinRaw,
      normalizeId(stripIsoformSuffix(proteinRaw)),
      "Protein ID",
    );
    if (hit) return hit;
  }

  const label =
    normalizeId(geneRaw) ||
    normalizeId(stripIsoformSuffix(proteinRaw)) ||
    "";
  return { key: "", source: "unresolved", column: null, label };
}

/** @deprecated Prefer resolveGoGene — kept for callers expecting a single string key. */
export function geneKeyFromPoint(
  p: Pick<VolcanoPoint, "gene" | "proteinId">,
): string {
  return resolveGoGene(p).key || normalizeId(p.gene || p.proteinId || "");
}

function selectForeground(
  points: VolcanoPoint[],
  direction: GoDirectionFilter,
): VolcanoPoint[] {
  if (direction === "up") return points.filter((p) => p.direction === "up");
  if (direction === "down") return points.filter((p) => p.direction === "down");
  return points.filter((p) => p.significant);
}

/** log Γ(n+1) for integer n via Lanczos / Stirling-ish sum of logs */
function logFact(n: number): number {
  if (n < 0) return Number.NEGATIVE_INFINITY;
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

/** log(C(n, k)) */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  if (k === 0 || k === n) return 0;
  return logFact(n) - logFact(k) - logFact(n - k);
}

/**
 * One-sided hypergeometric P(X ≥ k) for enrichment
 * (population N, successes K, draws n, observed hits k).
 */
export function hypergeometricTail(
  N: number,
  K: number,
  n: number,
  k: number,
): number {
  if (N < 0 || K < 0 || n < 0 || k < 0) return 1;
  if (k === 0) return 1;
  if (n > N || K > N) return 1;
  const maxX = Math.min(n, K);
  if (k > maxX) return 0;
  let logDenom = logChoose(N, n);
  if (!Number.isFinite(logDenom)) return 1;
  let sum = 0;
  for (let x = k; x <= maxX; x++) {
    const logP =
      logChoose(K, x) + logChoose(N - K, n - x) - logDenom;
    sum += Math.exp(logP);
  }
  if (!Number.isFinite(sum) || sum <= 0) return 1;
  return Math.min(1, sum);
}

/** Benjamini–Hochberg FDR on ascending p-values (returns adjP aligned to input order). */
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  const order = pValues
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p - b.p);
  const adj = new Array<number>(m).fill(1);
  let running = 1;
  for (let rank = m; rank >= 1; rank--) {
    const { p, i } = order[rank - 1]!;
    const val = Math.min(1, (p * m) / rank);
    running = Math.min(running, val);
    adj[i] = running;
  }
  return adj;
}

function summarizeIdColumn(
  geneColumnHits: number,
  proteinColumnHits: number,
): GoEnrichmentResult["idColumnUsed"] {
  if (geneColumnHits > 0 && proteinColumnHits > 0) return "mixed";
  if (geneColumnHits > 0) return "Gene";
  if (proteinColumnHits > 0) return "Protein ID";
  return "none";
}

/**
 * Client-side GO enrichment against the bundled gene→GO map (or overrides).
 * Background = all proteins in `points` that resolve to at least one GO term.
 * Foreground = significant / up / down subset of that background.
 *
 * ID resolution: FragPipe `Gene` (case-insensitive, multi-gene split) first;
 * then UniProt accession → gene aliases (Homo sapiens sample-table coverage)
 * when Gene is missing/sparse or holds an accession. Bundle covers ~99% of
 * human genes in the shipped FragPipe table; not a full UniProt/GOA dump.
 */
export function enrichGoTerms(
  points: VolcanoPoint[],
  opts: GoEnrichmentOptions = {},
): GoEnrichmentResult {
  const aspect = opts.aspect ?? "all";
  const direction = opts.direction ?? "significant";
  const topN = opts.topN ?? 20;
  const minHits = opts.minHits ?? 2;
  const ranking = opts.ranking ?? "negLog10AdjP";
  const geneTerms = opts.geneTerms ?? GO_DEMO_GENE_TERMS;
  const uniprotToGene = opts.uniprotToGene ?? GO_UNIPROT_TO_GENE;
  const catalog = opts.termCatalog ?? GO_DEMO_TERMS;
  const termById = new Map(catalog.map((t) => [t.id, t]));
  const resolveOpts = { geneTerms, uniprotToGene };

  const allowedAspect = (id: string): boolean => {
    if (aspect === "all") return true;
    return termById.get(id)?.aspect === aspect;
  };

  const backgroundKeys: string[] = [];
  const seenBg = new Set<string>();
  for (const p of points) {
    const resolved = resolveGoGene(p, resolveOpts);
    if (!resolved.key || seenBg.has(resolved.key)) continue;
    const terms = geneTerms[resolved.key];
    if (!terms?.length) continue;
    if (!terms.some(allowedAspect)) continue;
    seenBg.add(resolved.key);
    backgroundKeys.push(resolved.key);
  }

  const fgPoints = selectForeground(points, direction);
  const foregroundKeys: string[] = [];
  const seenFg = new Set<string>();
  const unmappedForeground: string[] = [];
  const seenUnmapped = new Set<string>();
  /** Unique FG gene keys resolved from the Gene column (symbol or accession-in-Gene). */
  let fgGeneColumnHits = 0;
  /** Unique FG gene keys resolved from Protein ID. */
  let fgProteinColumnHits = 0;
  /** Unique FG gene keys that used UniProt→gene alias (any column). */
  let resolvedViaUniprot = 0;

  for (const p of fgPoints) {
    const resolved = resolveGoGene(p, resolveOpts);
    if (!resolved.key || !geneTerms[resolved.key]?.some(allowedAspect)) {
      const label = resolved.label || normalizeId(p.gene || p.proteinId || "");
      if (label && !seenUnmapped.has(label)) {
        seenUnmapped.add(label);
        unmappedForeground.push(label);
      }
      continue;
    }
    if (!seenBg.has(resolved.key)) continue;
    if (seenFg.has(resolved.key)) continue;
    seenFg.add(resolved.key);
    foregroundKeys.push(resolved.key);
    // Count after unique-gene dedup so footer stats match annotated FG size.
    if (resolved.column === "Gene") fgGeneColumnHits += 1;
    if (resolved.column === "Protein ID") fgProteinColumnHits += 1;
    if (resolved.source === "uniprot") resolvedViaUniprot += 1;
  }

  const N = backgroundKeys.length;
  const n = foregroundKeys.length;

  // term → background genes / foreground hits
  const bgByTerm = new Map<string, string[]>();
  const fgByTerm = new Map<string, string[]>();

  for (const gene of backgroundKeys) {
    const ids = geneTerms[gene] ?? [];
    for (const id of ids) {
      if (!allowedAspect(id) || !termById.has(id)) continue;
      const list = bgByTerm.get(id) ?? [];
      list.push(gene);
      bgByTerm.set(id, list);
    }
  }
  for (const gene of foregroundKeys) {
    const ids = geneTerms[gene] ?? [];
    for (const id of ids) {
      if (!allowedAspect(id) || !termById.has(id)) continue;
      const list = fgByTerm.get(id) ?? [];
      list.push(gene);
      fgByTerm.set(id, list);
    }
  }

  const raw: Omit<GoEnrichmentTerm, "adjP" | "negLog10AdjP">[] = [];
  for (const [id, bgGenes] of bgByTerm) {
    const hits = fgByTerm.get(id) ?? [];
    const k = hits.length;
    if (k < minHits) continue;
    const K = bgGenes.length;
    if (K === 0 || N === 0 || n === 0) continue;
    const enrichment = (k / n) / (K / N);
    const pValue = hypergeometricTail(N, K, n, k);
    const def = termById.get(id)!;
    raw.push({
      id,
      name: def.name,
      aspect: def.aspect,
      hitGenes: hits.slice().sort(),
      k,
      K,
      n,
      N,
      enrichment,
      pValue,
      negLog10P: -Math.log10(Math.max(pValue, 1e-300)),
    });
  }

  const adjPs = benjaminiHochberg(raw.map((t) => t.pValue));
  let terms: GoEnrichmentTerm[] = raw.map((t, i) => {
    const adjP = adjPs[i] ?? 1;
    return {
      ...t,
      adjP,
      negLog10AdjP: -Math.log10(Math.max(adjP, 1e-300)),
    };
  });

  terms.sort((a, b) => {
    if (ranking === "enrichment") {
      return b.enrichment - a.enrichment || b.negLog10AdjP - a.negLog10AdjP;
    }
    return b.negLog10AdjP - a.negLog10AdjP || b.enrichment - a.enrichment;
  });
  terms = terms.slice(0, topN);

  return {
    terms,
    foregroundSize: fgPoints.length,
    backgroundSize: points.length,
    annotatedForeground: n,
    annotatedBackground: N,
    unmappedForeground,
    resolvedViaUniprot,
    idColumnUsed: summarizeIdColumn(fgGeneColumnHits, fgProteinColumnHits),
    aspect,
    direction,
    ranking,
  };
}

export const GO_ASPECT_LABELS: Record<GoAspect | "all", string> = {
  all: "All aspects",
  BP: "Biological Process",
  MF: "Molecular Function",
  CC: "Cellular Component",
};
