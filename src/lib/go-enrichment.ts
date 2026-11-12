import {
  GO_DEMO_GENE_TERMS,
  GO_DEMO_TERMS,
  type GoAspect,
  type GoTermDef,
} from "@/data/go-demo-mapping";
import type { VolcanoPoint } from "./types";

export type { GoAspect, GoTermDef };

export type GoDirectionFilter = "significant" | "up" | "down";

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
}

function normalizeGene(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Resolve a volcano / protein row to a mapping key (gene preferred). */
export function geneKeyFromPoint(p: Pick<VolcanoPoint, "gene" | "proteinId">): string {
  if (p.gene?.trim()) return normalizeGene(p.gene);
  // UniProt-style IDs or FragPipe Protein ID — try as-is (demo map is gene-keyed)
  return normalizeGene(p.proteinId);
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

/**
 * Client-side GO enrichment against the bundled demo mapping (or overrides).
 * Background = all proteins in `points` that resolve to at least one GO term.
 * Foreground = significant / up / down subset of that background.
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
  const catalog = opts.termCatalog ?? GO_DEMO_TERMS;
  const termById = new Map(catalog.map((t) => [t.id, t]));

  const allowedAspect = (id: string): boolean => {
    if (aspect === "all") return true;
    return termById.get(id)?.aspect === aspect;
  };

  const backgroundKeys: string[] = [];
  const seenBg = new Set<string>();
  for (const p of points) {
    const key = geneKeyFromPoint(p);
    if (!key || seenBg.has(key)) continue;
    const terms = geneTerms[key];
    if (!terms?.length) continue;
    if (!terms.some(allowedAspect)) continue;
    seenBg.add(key);
    backgroundKeys.push(key);
  }

  const fgPoints = selectForeground(points, direction);
  const foregroundKeys: string[] = [];
  const seenFg = new Set<string>();
  const unmappedForeground: string[] = [];
  const seenUnmapped = new Set<string>();
  for (const p of fgPoints) {
    const key = geneKeyFromPoint(p);
    if (!key) continue;
    if (!geneTerms[key]?.some(allowedAspect)) {
      if (!seenUnmapped.has(key)) {
        seenUnmapped.add(key);
        unmappedForeground.push(key);
      }
      continue;
    }
    if (!seenBg.has(key)) continue;
    if (seenFg.has(key)) continue;
    seenFg.add(key);
    foregroundKeys.push(key);
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
