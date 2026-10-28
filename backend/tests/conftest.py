"""Small synthetic fixtures only; production APIs always load the actual source files."""

import csv
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from protein_viz.core.config import Settings
from protein_viz.main import create_app


def write_csv(path: Path, headers: list[str], rows: list[list]) -> None:
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, delimiter="\t" if path.suffix == ".tsv" else ",")
        writer.writerow(headers)
        writer.writerows(rows)


@pytest.fixture
def dataset_dir(tmp_path):
    write_csv(
        tmp_path / "combined_protein.tsv",
        ["Protein ID", "Gene", "Organism", "Protein Length", "Description"],
        [
            ["P1", "SAME", "Homo sapiens", 4, "Protein one"],
            ["P2", "GENE2", "Homo sapiens", 4, "Protein two"],
            ["P3", "GENE3", "Homo sapiens", 4, "Protein three"],
            ["Y1", "SAME", "Saccharomyces cerevisiae (strain ATCC 204508 / S288c)", 4, "Yeast"],
        ],
    )
    write_csv(
        tmp_path / "experiment_annotation.tsv",
        ["sample", "condition", "replicate", "file"],
        [
            ["Condition_A_34", "Condition", "34", "/original/A.mzML"],
            ["Human_4", "Human", "4", "/original/H.mzML"],
            ["QC_7", "QC", "7", "/original/Q.mzML"],
        ],
    )
    # Deliberately shuffle columns and rows to catch positional rather than keyed joins.
    write_csv(
        tmp_path / "maxlfq_wide.csv",
        [
            "Protein ID",
            "QC_7 MaxLFQ Intensity",
            "Condition_A_34 MaxLFQ Intensity",
            "Human_4 MaxLFQ Intensity",
        ],
        [["Y1", 32, 16, 0], ["P2", 0, 4, 8], ["P1", 0, 8, 16], ["P3", "", 2, 4]],
    )
    for name, column, values in (
        ("proteins_with_sequences.csv", "Sequence", ["MAAA"] * 4),
        ("spatial_mapping.csv", "locations", ["Nucleus; Cytoplasm", "", "Membrane", ""]),
    ):
        write_csv(
            tmp_path / name,
            ["Protein ID", column],
            list(zip(["P1", "P2", "P3", "Y1"], values, strict=True)),
        )
    write_csv(
        tmp_path / "structure_pdb_index.csv",
        ["Protein ID", "pdb_id", "pdb_ids"],
        [
            ["P1", "1ABC", "1ABC;2DEF"],
            ["P2", "2DEF", "2DEF"],
            ["P3", "no pdb avaliable", "no pdb avaliable"],
            ["Y1", "no pdb avaliable", "no pdb avaliable"],
        ],
    )
    structures = tmp_path / "pdb_files"
    structures.mkdir()
    (structures / "pdb1abc.ent").write_text("HEADER    TEST STRUCTURE\nEND\n", encoding="utf-8")
    write_csv(
        tmp_path / "ga2_human_vs_qc_limma.csv",
        ["Protein ID", "log2FC", "p_value", "adj_p", "contrast", "method"],
        [
            ["P1", 1.0, 0.001, 0.02, "Human_vs_QC", "limma_eBayes_BH"],
            ["P2", 0.7, 0.001, 0.02, "Human_vs_QC", "limma_eBayes_BH"],
            ["P3", -4.0, 0.01, 0.06, "Human_vs_QC", "limma_eBayes_BH"],
        ],
    )
    write_csv(
        tmp_path / "ppi_string_edges.csv",
        ["Protein_A", "Protein_B", "score", "species"],
        [
            ["P1", "P2", 0.9, 9606],
            ["P1", "P3", 0.5, 9606],
            ["P2", "P3", 0.8, 9606],
            ["P1", "Y1", 0.99, 9606],
        ],
    )
    return tmp_path


@pytest.fixture
def client(dataset_dir):
    with TestClient(create_app(Settings(data_dir=dataset_dir))) as test_client:
        yield test_client
