/**
 * UniProt accession → gene symbol aliases for client-side GO enrichment.
 *
 * Built from Homo sapiens FragPipe rows in the shipped sample table whose
 * Gene symbols exist in the bundled GO map (`go-bundle.json`). Regenerated
 * with `scripts/build-go-bundle.py`. Non-human ortholog accessions are
 * omitted. Not a full UniProt dump — accessions outside this list stay
 * unresolved unless the Gene column already matches the GO map.
 */

import goBundle from "./go-bundle.json";

export const GO_UNIPROT_TO_GENE: Record<string, string> =
  goBundle.uniprotToGene as Record<string, string>;
