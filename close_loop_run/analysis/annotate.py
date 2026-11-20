"""Lightweight protein annotation helpers (gene, organism, keyword themes)."""

from __future__ import annotations

import re
from typing import Iterable

import pandas as pd


DEFAULT_THEME_KEYWORDS = {
    "proteasome": [r"proteasome", r"proteasomal"],
    "ribosome_translation": [r"ribosom", r"translation", r"elongation factor"],
    "amino_acid_metabolism": [r"amino.?acid", r"glutamine", r"glutamate", r"urea", r"arginase", r"deaminase"],
    "nitrogen_scavenging": [r"nitrate", r"nitrite", r"urease", r"amidase", r"nitrogen"],
    "fatty_acid_desaturase": [r"desaturase", r"palmitoyl", r"acyl.?acp", r"fatty acid"],
    "collagen_ecm": [r"collagen", r"extracellular matrix", r"fibronectin"],
    "inflammatory": [r"chemokine", r"interleukin", r"cytokine", r"tumor necrosis"],
}


def infer_organism(protein_id: str, fasta: str | None = None, gene: str | None = None) -> str:
    text = " ".join(x for x in [str(protein_id or ""), str(fasta or ""), str(gene or "")] if x and x != "nan")
    low = text.lower()
    if re.search(r"_ecoli\b|os=escherichia coli|ox=83333|taxonomy_id=83333", low):
        return "Escherichia coli"
    if re.search(r"_human\b|os=homo sapiens|ox=9606|taxonomy_id=9606", low):
        return "Homo sapiens"
    if re.search(r"_yeast\b|_yeast|os=saccharomyces", low):
        return "Saccharomyces cerevisiae"
    # UniProt-style heuristic used by Interpreter previously
    pid = str(protein_id or "").split(";")[0]
    if re.match(r"^P0[A-B]", pid):
        return "Escherichia coli"
    if re.match(r"^[AOPQ]\d", pid) or "HUMAN" in text.upper():
        return "Homo sapiens"
    if "Phatr" in text or "phaeodactylum" in low:
        return "Phaeodactylum tricornutum"
    return "unknown"


def keyword_themes(fasta_or_desc: str, themes: dict[str, Iterable[str]] | None = None) -> list[str]:
    text = str(fasta_or_desc or "").lower()
    if not text or text == "nan":
        return []
    themes = themes or DEFAULT_THEME_KEYWORDS
    hits = []
    for name, patterns in themes.items():
        for pat in patterns:
            if re.search(pat, text, flags=re.IGNORECASE):
                hits.append(name)
                break
    return hits


def build_annotation_frame(
    proteins: pd.Series,
    *,
    genes: pd.Series | None = None,
    fasta: pd.Series | None = None,
    theme_map: dict[str, Iterable[str]] | None = None,
) -> pd.DataFrame:
    rows = []
    for i, pid in enumerate(proteins.tolist()):
        g = None if genes is None else genes.iloc[i]
        f = None if fasta is None else fasta.iloc[i]
        themes = keyword_themes(f or "", theme_map)
        rows.append(
            {
                "Protein": pid,
                "Gene": (str(g).split(";")[0] if g is not None and str(g) not in ("", "nan") else ""),
                "Fasta headers": "" if f is None or str(f) == "nan" else str(f),
                "organism_inferred": infer_organism(pid, f, g),
                "theme_keywords": ";".join(themes),
            }
        )
    return pd.DataFrame(rows)
