/**
 * Runtime Gene Ontology mapping for client-side enrichment.
 *
 * Loads the pragmatic bundle in `go-bundle.json` (FragPipe human genes from
 * the shipped sample table ∩ GOA, plus curated mock/pathway seed terms).
 * Regenerated via `scripts/build-go-bundle.py`. Not a full GOA dump — novel
 * organisms / genes outside the bundle remain unmapped.
 */

import goBundle from "./go-bundle.json";

export type GoAspect = "BP" | "MF" | "CC";

export interface GoTermDef {
  id: string;
  name: string;
  aspect: GoAspect;
}

export interface GoBundleMeta {
  source: string;
  goa: string;
  minGenesPerTerm: number;
  maxTermsPerGene: number;
  maxTerms: number;
  fragHumanGenes: number;
  mappedGenes: number;
  fragCoverage: number;
  uniprotAliases: number;
  termCount: number;
}

/** Term catalog used by the client enricher (demo seed + frequent GOA terms). */
export const GO_DEMO_TERMS: GoTermDef[] = goBundle.terms as GoTermDef[];

/**
 * Gene symbol (uppercase) → GO term IDs.
 * Keys match FragPipe `Gene` after trim + uppercasing / multi-gene split.
 */
export const GO_DEMO_GENE_TERMS: Record<string, string[]> =
  goBundle.geneTerms as Record<string, string[]>;

export const GO_BUNDLE_META: GoBundleMeta = goBundle.meta as GoBundleMeta;
