#!/usr/bin/env python3
"""
Build a compact client-side GO enrichment bundle for Proteomic_vis.

Inputs (not committed; download once into data/external/cache/):
  - goa_human.gaf.gz  (EBI GOA HUMAN)
  - go-basic.obo      (Gene Ontology)

Also reads:
  - supplementary_files/combined_protein.tsv  (FragPipe human gene / UniProt set)
  - src/data/go-curated-seed.ts              (curated demo terms + mock genes)

Output:
  - src/data/go-bundle.json

Pragmatic filters (not a full GOA dump):
  - Keep curated demo terms plus the most frequent GO terms among FragPipe
    human genes (min genes/term, max catalog size).
  - Cap terms per gene; prefer stronger evidence codes.
  - UniProt→gene aliases only for Homo sapiens rows whose gene is mapped.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

EVID_RANK = {
    "EXP": 0,
    "IDA": 0,
    "IPI": 0,
    "IMP": 0,
    "IGI": 0,
    "IEP": 0,
    "IDI": 0,
    "HTP": 1,
    "HDA": 1,
    "HMP": 1,
    "HGI": 1,
    "HEP": 1,
    "IBA": 2,
    "IBD": 2,
    "IKR": 2,
    "IRD": 2,
    "ISS": 3,
    "ISO": 3,
    "ISA": 3,
    "ISM": 3,
    "IGC": 3,
    "RCA": 3,
    "TAS": 4,
    "NAS": 4,
    "IC": 4,
    "ND": 5,
    "IEA": 6,
}

ASPECT = {"P": "BP", "F": "MF", "C": "CC"}
NS_TO_ASPECT = {
    "biological_process": "BP",
    "molecular_function": "MF",
    "cellular_component": "CC",
}


def parse_demo_mapping(path: Path) -> tuple[list[dict], dict[str, list[str]]]:
    src = path.read_text()
    terms = [
        {"id": m.group(1), "name": m.group(2), "aspect": m.group(3)}
        for m in re.finditer(
            r'\{ id: "(GO:\d+)", name: "([^"]+)", aspect: "(BP|MF|CC)" \}',
            src,
        )
    ]
    gene_terms: dict[str, list[str]] = {}
    # Accept GO_CURATED_GENE_TERMS or legacy GO_DEMO_GENE_TERMS key lines.
    for m in re.finditer(r"^  ([A-Z0-9][A-Z0-9_-]*): \[([^\]]*)\]", src, re.M):
        gene_terms[m.group(1)] = re.findall(r"GO:\d+", m.group(2))
    return terms, gene_terms


def load_fragpipe_human(
    path: Path,
) -> tuple[set[str], dict[str, str]]:
    human_genes: set[str] = set()
    uniprot_to_gene: dict[str, str] = {}
    with path.open() as f:
        for row in csv.DictReader(f, delimiter="\t"):
            if "Homo sapiens" not in (row.get("Organism") or ""):
                continue
            g = (row.get("Gene") or "").strip()
            pid = (
                (row.get("Protein ID") or "")
                .strip()
                .split(";")[0]
                .split("-")[0]
                .upper()
            )
            gene = None
            if g:
                gene = re.split(r"[;\s|/]+", g)[0].strip().upper() or None
                if gene:
                    human_genes.add(gene)
            if pid and gene:
                uniprot_to_gene[pid] = gene
    return human_genes, uniprot_to_gene


def parse_obo_names(path: Path, wanted: set[str]) -> tuple[dict[str, str], dict[str, str]]:
    names: dict[str, str] = {}
    aspects: dict[str, str] = {}
    cur: dict[str, str] | None = None
    with path.open() as f:
        for line in f:
            line = line.rstrip("\n")
            if line == "[Term]":
                cur = {}
            elif line == "":
                if (
                    cur
                    and cur.get("id") in wanted
                    and cur.get("is_obsolete") != "true"
                ):
                    names[cur["id"]] = cur.get("name", "")
                    ns = cur.get("namespace")
                    if ns in NS_TO_ASPECT:
                        aspects[cur["id"]] = NS_TO_ASPECT[ns]
                cur = None
            elif cur is not None:
                if line.startswith("id: "):
                    cur["id"] = line[4:]
                elif line.startswith("name: "):
                    cur["name"] = line[6:]
                elif line.startswith("namespace: "):
                    cur["namespace"] = line[11:]
                elif line.startswith("is_obsolete: true"):
                    cur["is_obsolete"] = "true"
    return names, aspects


def build(
    *,
    frag_path: Path,
    gaf_path: Path,
    obo_path: Path,
    demo_path: Path,
    out_path: Path,
    min_genes: int,
    max_terms: int,
    max_per_gene: int,
) -> dict:
    demo_terms, demo_gene_terms = parse_demo_mapping(demo_path)
    human_genes, uniprot_to_gene = load_fragpipe_human(frag_path)
    target_genes = set(human_genes) | set(demo_gene_terms)

    gene_go_evid: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(lambda: 99))
    term_aspect: dict[str, str] = {}
    term_gene_count: Counter[str] = Counter()

    with gzip.open(gaf_path, "rt") as f:
        for line in f:
            if line.startswith("!"):
                continue
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 9:
                continue
            acc = cols[1].upper()
            symbol = cols[2].upper()
            go = cols[4]
            evid = cols[6]
            aspect = ASPECT.get(cols[8])
            if not aspect:
                continue
            gene = None
            if symbol in target_genes:
                gene = symbol
            elif acc in uniprot_to_gene and uniprot_to_gene[acc] in target_genes:
                gene = uniprot_to_gene[acc]
            else:
                continue
            term_aspect[go] = aspect
            rank = EVID_RANK.get(evid, 5)
            if rank < gene_go_evid[gene][go]:
                gene_go_evid[gene][go] = rank

    for gos in gene_go_evid.values():
        for go in gos:
            term_gene_count[go] += 1

    keep_terms = {t["id"] for t in demo_terms}
    for go, count in term_gene_count.most_common():
        if go in keep_terms:
            continue
        if count < min_genes:
            break
        keep_terms.add(go)
        if len(keep_terms) >= max_terms:
            break

    obo_names, obo_aspects = parse_obo_names(obo_path, keep_terms)

    catalog: list[dict] = []
    seen: set[str] = set()
    for t in demo_terms:
        catalog.append(t)
        seen.add(t["id"])
    for go, _count in term_gene_count.most_common():
        if go not in keep_terms or go in seen:
            continue
        catalog.append(
            {
                "id": go,
                "name": obo_names.get(go) or go,
                "aspect": obo_aspects.get(go) or term_aspect.get(go) or "BP",
            }
        )
        seen.add(go)

    keep_set = {t["id"] for t in catalog}
    gene_terms: dict[str, list[str]] = {}
    for gene in sorted(set(gene_go_evid) | set(demo_gene_terms)):
        cands: list[tuple[int, int, str]] = []
        for go, rank in gene_go_evid.get(gene, {}).items():
            if go in keep_set:
                cands.append((rank, -term_gene_count[go], go))
        for go in demo_gene_terms.get(gene, []):
            if go in keep_set:
                cands.append((-1, -term_gene_count.get(go, 0), go))
        cands.sort()
        picked: list[str] = []
        seen_go: set[str] = set()
        for _rank, _freq, go in cands:
            if go in seen_go:
                continue
            seen_go.add(go)
            picked.append(go)
            if len(picked) >= max_per_gene:
                break
        if picked:
            gene_terms[gene] = picked

    frag_cov = sum(1 for g in human_genes if g in gene_terms)
    uniprot_out = {
        acc: gene
        for acc, gene in sorted(uniprot_to_gene.items())
        if gene in gene_terms
    }

    bundle = {
        "meta": {
            "source": (
                "GOA human GAF + FragPipe supplementary human genes + curated demo terms"
            ),
            "goa": "goa_human.gaf.gz (EBI GOA HUMAN)",
            "minGenesPerTerm": min_genes,
            "maxTermsPerGene": max_per_gene,
            "maxTerms": max_terms,
            "fragHumanGenes": len(human_genes),
            "mappedGenes": len(gene_terms),
            "fragCoverage": frag_cov,
            "uniprotAliases": len(uniprot_out),
            "termCount": len(catalog),
        },
        "terms": catalog,
        "geneTerms": gene_terms,
        "uniprotToGene": uniprot_out,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(bundle, separators=(",", ":")))
    return bundle


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--frag",
        type=Path,
        default=ROOT / "supplementary_files/combined_protein.tsv",
    )
    p.add_argument(
        "--gaf",
        type=Path,
        default=ROOT / "data/external/cache/goa_human.gaf.gz",
    )
    p.add_argument(
        "--obo",
        type=Path,
        default=ROOT / "data/external/cache/go-basic.obo",
    )
    p.add_argument(
        "--demo",
        type=Path,
        default=ROOT / "src/data/go-curated-seed.ts",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=ROOT / "src/data/go-bundle.json",
    )
    p.add_argument("--min-genes", type=int, default=25)
    p.add_argument("--max-terms", type=int, default=350)
    p.add_argument("--max-per-gene", type=int, default=12)
    args = p.parse_args()

    for path, label in (
        (args.frag, "FragPipe TSV"),
        (args.gaf, "GOA GAF"),
        (args.obo, "GO OBO"),
        (args.demo, "demo mapping"),
    ):
        if not path.exists():
            print(f"Missing {label}: {path}", file=sys.stderr)
            return 1

    bundle = build(
        frag_path=args.frag,
        gaf_path=args.gaf,
        obo_path=args.obo,
        demo_path=args.demo,
        out_path=args.out,
        min_genes=args.min_genes,
        max_terms=args.max_terms,
        max_per_gene=args.max_per_gene,
    )
    meta = bundle["meta"]
    print(f"Wrote {args.out} ({args.out.stat().st_size} bytes)")
    print(
        f"terms={meta['termCount']} genes={meta['mappedGenes']} "
        f"fragCoverage={meta['fragCoverage']}/{meta['fragHumanGenes']} "
        f"uniprot={meta['uniprotAliases']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
