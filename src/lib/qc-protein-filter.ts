/**
 * QC ↔ Downstream protein scoping.
 *
 * Filter features are discovered from fields already visible in Downstream
 * (volcano / results / GO) plus the bundled GO demo map — never invents
 * annotations that the UI cannot already show.
 */

import { GO_DEMO_GENE_TERMS, GO_DEMO_TERMS } from "@/data/go-demo-mapping";
import { resolveGoGene } from "@/lib/go-enrichment";
import {
  annotationGroups,
  defaultGroupPair,
  volcanoForGroups,
} from "@/lib/stats";
import type { FragPipeDataset, ProteinRow, VolcanoPoint } from "@/lib/types";

export type QcFilterFeatureId =
  | "go-aspect"
  | "go-term"
  | "gene-symbol"
  | "protein-probability"
  | "de-call";

export type QcFilterFeature = {
  id: QcFilterFeatureId;
  label: string;
  description: string;
  values: { value: string; label: string; count: number }[];
};

export type QcProteinFilter = {
  featureId: QcFilterFeatureId | null;
  value: string | null;
};

export const EMPTY_QC_PROTEIN_FILTER: QcProteinFilter = {
  featureId: null,
  value: null,
};

function proteinHasGeneSymbol(p: ProteinRow): boolean {
  const g = p.gene?.trim() ?? "";
  if (!g) return false;
  // FragPipe sometimes copies Protein ID into Gene when Gene is empty.
  if (g === p.proteinId) return false;
  return !/^[OPQ][0-9][A-Z0-9]{3}[0-9]|^[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/i.test(
    g.split(/[;,\s]/)[0] ?? "",
  );
}

function probabilityBucket(p: ProteinRow): string {
  const v = p.proteinProbability;
  if (v == null || !Number.isFinite(v)) return "missing";
  if (v >= 0.9) return "high";
  if (v >= 0.5) return "mid";
  return "low";
}

function goKeysForProtein(p: ProteinRow): string[] {
  const resolved = resolveGoGene({
    gene: p.gene,
    proteinId: p.proteinId,
  });
  if (!resolved.key) return [];
  return GO_DEMO_GENE_TERMS[resolved.key] ?? [];
}

function countMap(keys: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

function toValues(
  counts: Map<string, number>,
  labels: Record<string, string>,
  order?: string[],
): { value: string; label: string; count: number }[] {
  const keys = order?.filter((k) => counts.has(k)) ?? [...counts.keys()].sort();
  return keys.map((value) => ({
    value,
    label: labels[value] ?? value,
    count: counts.get(value) ?? 0,
  }));
}

/**
 * Discover filter features users can already see in Downstream panels /
 * GO enrichment, limited to values that actually appear in this dataset.
 */
export function discoverQcFilterFeatures(
  dataset: FragPipeDataset,
): QcFilterFeature[] {
  const features: QcFilterFeature[] = [];
  const proteins = dataset.proteins;

  // Gene symbol presence (Results table / volcano labels)
  {
    const counts = countMap(
      proteins.map((p) => (proteinHasGeneSymbol(p) ? "present" : "missing")),
    );
    features.push({
      id: "gene-symbol",
      label: "Gene symbol",
      description: "Whether FragPipe Gene looks like a symbol (Downstream labels).",
      values: toValues(
        counts,
        { present: "Has gene symbol", missing: "Missing / accession-like" },
        ["present", "missing"],
      ),
    });
  }

  // Protein probability (Results table column when present)
  {
    const counts = countMap(proteins.map(probabilityBucket));
    if ((counts.get("missing") ?? 0) < proteins.length) {
      features.push({
        id: "protein-probability",
        label: "Protein probability",
        description: "Buckets of Protein Probability from the protein table.",
        values: toValues(
          counts,
          {
            high: "High (≥ 0.9)",
            mid: "Mid (0.5–0.9)",
            low: "Low (< 0.5)",
            missing: "Missing",
          },
          ["high", "mid", "low", "missing"],
        ),
      });
    }
  }

  // GO aspect / term from the same demo map Downstream GO uses
  {
    const aspectCounts = new Map<string, number>();
    const termCounts = new Map<string, number>();
    const termById = new Map(GO_DEMO_TERMS.map((t) => [t.id, t]));
    for (const p of proteins) {
      const termIds = goKeysForProtein(p);
      const aspects = new Set<string>();
      for (const tid of termIds) {
        termCounts.set(tid, (termCounts.get(tid) ?? 0) + 1);
        const term = termById.get(tid);
        if (term) aspects.add(term.aspect);
      }
      for (const a of aspects) {
        aspectCounts.set(a, (aspectCounts.get(a) ?? 0) + 1);
      }
    }
    if (aspectCounts.size > 0) {
      features.push({
        id: "go-aspect",
        label: "GO aspect",
        description: "Cellular Component / BP / MF from the Downstream GO demo map.",
        values: toValues(
          aspectCounts,
          {
            BP: "Biological process (BP)",
            MF: "Molecular function (MF)",
            CC: "Cellular component (CC)",
          },
          ["BP", "MF", "CC"],
        ),
      });
    }
    if (termCounts.size > 0) {
      const top = [...termCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 40);
      features.push({
        id: "go-term",
        label: "GO term",
        description: "GO terms (demo map) already usable in Downstream enrichment.",
        values: top.map(([value, count]) => {
          const term = termById.get(value);
          return {
            value,
            label: term ? `${term.name} (${term.id})` : value,
            count,
          };
        }),
      });
    }
  }

  // DE call from default Downstream contrast (same defaultGroupPair)
  {
    const groups = annotationGroups(dataset);
    if (groups.length >= 2) {
      const { groupA, groupB } = defaultGroupPair(groups);
      if (groupA && groupB && groupA !== groupB) {
        const { points, ready } = volcanoForGroups(dataset, groupA, groupB, {
          log2fcThreshold: 1,
          adjPThreshold: 0.05,
        });
        if (ready && points.length > 0) {
          const counts = countMap(
            points.map((p) =>
              p.significant ? p.direction : "ns",
            ),
          );
          // Also expose "significant" as a combined bucket
          const sig = points.filter((p) => p.significant).length;
          if (sig > 0) counts.set("significant", sig);
          features.push({
            id: "de-call",
            label: `DE call (${groupA} vs ${groupB})`,
            description:
              "Volcano / results significance using the default Downstream contrast.",
            values: toValues(
              counts,
              {
                up: "Up (significant)",
                down: "Down (significant)",
                ns: "Not significant",
                significant: "Any significant",
              },
              ["significant", "up", "down", "ns"],
            ),
          });
        }
      }
    }
  }

  return features;
}

function proteinMatchesFeature(
  p: ProteinRow,
  featureId: QcFilterFeatureId,
  value: string,
  deById: Map<string, VolcanoPoint> | null,
): boolean {
  switch (featureId) {
    case "gene-symbol":
      return value === "present"
        ? proteinHasGeneSymbol(p)
        : !proteinHasGeneSymbol(p);
    case "protein-probability":
      return probabilityBucket(p) === value;
    case "go-aspect": {
      const termById = new Map(GO_DEMO_TERMS.map((t) => [t.id, t]));
      return goKeysForProtein(p).some(
        (tid) => termById.get(tid)?.aspect === value,
      );
    }
    case "go-term":
      return goKeysForProtein(p).includes(value);
    case "de-call": {
      const point = deById?.get(p.proteinId);
      if (!point) return false;
      if (value === "significant") return point.significant;
      if (value === "ns") return !point.significant;
      return point.significant && point.direction === value;
    }
    default:
      return true;
  }
}

function deIndexForDataset(
  dataset: FragPipeDataset,
): Map<string, VolcanoPoint> | null {
  const groups = annotationGroups(dataset);
  if (groups.length < 2) return null;
  const { groupA, groupB } = defaultGroupPair(groups);
  if (!groupA || !groupB || groupA === groupB) return null;
  const { points, ready } = volcanoForGroups(dataset, groupA, groupB, {
    log2fcThreshold: 1,
    adjPThreshold: 0.05,
  });
  if (!ready) return null;
  return new Map(points.map((p) => [p.proteinId, p]));
}

/** Protein IDs matching a QC feature filter (null filter → all). */
export function proteinIdsMatchingFilter(
  dataset: FragPipeDataset,
  filter: QcProteinFilter,
): string[] | null {
  if (!filter.featureId || !filter.value) return null;
  const deById =
    filter.featureId === "de-call" ? deIndexForDataset(dataset) : null;
  return dataset.proteins
    .filter((p) =>
      proteinMatchesFeature(p, filter.featureId!, filter.value!, deById),
    )
    .map((p) => p.proteinId);
}

/**
 * Resolve the active protein ID set for QC.
 * Downstream selection (when non-empty) intersects with the feature filter.
 */
export function resolveQcProteinIds(
  dataset: FragPipeDataset,
  filter: QcProteinFilter,
  downstreamSelectedIds: string[],
): { ids: string[] | null; empty: boolean; label: string } {
  const filterIds = proteinIdsMatchingFilter(dataset, filter);
  const downstream =
    downstreamSelectedIds.length > 0
      ? new Set(downstreamSelectedIds)
      : null;

  if (!filterIds && !downstream) {
    return { ids: null, empty: false, label: "All proteins" };
  }

  let ids: string[];
  if (filterIds && downstream) {
    ids = filterIds.filter((id) => downstream.has(id));
  } else if (filterIds) {
    ids = filterIds;
  } else {
    ids = dataset.proteins
      .map((p) => p.proteinId)
      .filter((id) => downstream!.has(id));
  }

  const parts: string[] = [];
  if (filter.featureId && filter.value) {
    parts.push(`filter ${filter.featureId}=${filter.value}`);
  }
  if (downstream) {
    parts.push(`Downstream selection (${downstreamSelectedIds.length})`);
  }

  return {
    ids,
    empty: ids.length === 0,
    label: parts.join(" ∩ ") || "Subset",
  };
}

/** Shallow-clone dataset with a protein subset (keeps samples/annotation). */
export function subsetDatasetProteins(
  dataset: FragPipeDataset,
  proteinIds: string[] | null,
): FragPipeDataset {
  if (!proteinIds) return dataset;
  const allow = new Set(proteinIds);
  return {
    ...dataset,
    proteins: dataset.proteins.filter((p) => allow.has(p.proteinId)),
  };
}
