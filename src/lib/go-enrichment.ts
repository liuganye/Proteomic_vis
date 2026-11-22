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
   * Defaults to the bundled demo mapping.
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

/**
 * Extract a UniProt accession from FragPipe Protein ID / Protein fields.
 * Accepts bare accessions, isoform suffixes, and `sp|ACC|NAME` / `tr|ACC|NAME`.
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
  return null;
}

/** Split FragPipe multi-gene cells (`GENEA;GENEB` / commas / whitespace). */
export function splitGeneCandidates(raw: string): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[;,\s|/]+/)
    .map((g) => normalizeId(g))
    .filter(Boolean);
}

export interface GoGeneResolve {
  /** Uppercase gene symbol key for GO_DEMO_GENE_TERMS (empty if unresolved). */
  key: string;
  source: GoIdSource;
  /** Display / diagnostics label before resolution. */
  label: string;
}

/**
 * Resolve a volcano / protein row to a GO mapping key.
 * Prefers Gene symbols that hit the term map; falls back to UniProt→gene aliases
 * when Gene is missing, sparse, or itself an accession.
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

  const trySymbol = (sym: string): GoGeneResolve | null => {
    if (!sym) return null;
    if (hasTerms(sym)) return { key: sym, source: "gene", label: sym };
    return null;
  };

  const tryUniprot = (raw: string, label: string): GoGeneResolve | null => {
    const acc = extractUniprotAccession(raw);
    if (!acc) return null;
    const gene = uniprotToGene[acc];
    if (gene && hasTerms(gene)) {
      return { key: gene, source: "uniprot", label: label || acc };
    }
    // Direct accession key in geneTerms (rare; supports test overrides)
    if (hasTerms(acc)) return { key: acc, source: "uniprot", label: label || acc };
    return null;
  };

  const geneRaw = p.gene?.trim() ?? "";
  const proteinRaw = p.proteinId?.trim() ?? "";

  // 1) Gene column candidates (symbols first)
  for (const cand of splitGeneCandidates(geneRaw)) {
    const hit = trySymbol(cand);
    if (hit) return hit;
  }

  // 2) Gene column may itself be a UniProt accession (empty-Gene path sets gene=proteinId)
  for (const cand of splitGeneCandidates(geneRaw)) {
    const hit = tryUniprot(cand, cand);
    if (hit) return hit;
  }
  if (geneRaw) {
    const hit = tryUniprot(geneRaw, normalizeId(geneRaw));
    if (hit) return hit;
  }

  // 3) Protein ID / Protein-style field
  if (proteinRaw) {
    const asSymbol = trySymbol(normalizeId(proteinRaw));
    if (asSymbol) return asSymbol;
    const hit = tryUniprot(proteinRaw, normalizeId(stripIsoformSuffix(proteinRaw)));
    if (hit) return hit;
  }

  const label =
    normalizeId(geneRaw) ||
    normalizeId(stripIsoformSuffix(proteinRaw)) ||
    "";
  return { key: "", source: "unresolved", label };
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
  geneHits: number,
  uniprotHits: number,
): GoEnrichmentResult["idColumnUsed"] {
  if (geneHits > 0 && uniprotHits > 0) return "mixed";
  if (geneHits > 0) return "Gene";
  if (uniprotHits > 0) return "Protein ID";
  return "none";
}

/**
 * Client-side GO enrichment against the bundled demo mapping (or overrides).
 * Background = all proteins in `points` that resolve to at least one GO term.
 * Foreground = significant / up / down subset of that background.
 *
 * ID resolution: FragPipe `Gene` (case-insensitive, multi-gene split) first;
 * then compact UniProt accession → gene aliases when Gene is missing/sparse
 * or holds an accession. Not a full UniProt/GOA database.
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
  let fgGeneHits = 0;
  let fgUniprotHits = 0;
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
    if (resolved.source === "gene") fgGeneHits += 1;
    if (resolved.source === "uniprot") {
      fgUniprotHits += 1;
      resolvedViaUniprot += 1;
    }
    if (!seenBg.has(resolved.key)) continue;
    if (seenFg.has(resolved.key)) continue;
    seenFg.add(resolved.key);
    foregroundKeys.push(resolved.key);
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
    idColumnUsed: summarizeIdColumn(fgGeneHits, fgUniprotHits),
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
