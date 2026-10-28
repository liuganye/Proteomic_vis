"""Load a validated, read-only snapshot once at application startup.

No pandas dependency is needed to serve the fixed dataset. Do not write corrected
annotations back to the supplied files. A future prepared-data adapter can replace
this class without changing the routes or public response models.
"""

import csv
import math
import re
from pathlib import Path

from protein_viz.core.errors import DatasetError
from protein_viz.schemas.domain import NetworkEdge, Protein, Sample

REQUIRED_FILES = (
    "combined_protein.tsv",
    "experiment_annotation.tsv",
    "maxlfq_wide.csv",
    "ga2_human_vs_qc_limma.csv",
    "proteins_with_sequences.csv",
    "spatial_mapping.csv",
    "structure_pdb_index.csv",
    "ppi_string_edges.csv",
)
TAXON_BY_ORGANISM = {
    "Homo sapiens": 9606,
    "Saccharomyces cerevisiae (strain ATCC 204508 / S288c)": 4932,
    "Escherichia coli (strain K12)": 83333,
}
PDB_ID_PATTERN = re.compile(r"[A-Za-z0-9]{4}\Z")


def read_rows(path: Path, required_columns: set[str]):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter="\t" if path.suffix == ".tsv" else ",")
        missing = required_columns - set(reader.fieldnames or [])
        if missing:
            raise DatasetError(f"{path.name}: missing columns {sorted(missing)}")
        yield from reader


def number(value: str | None) -> float | None:
    if value is None or value.strip().lower() in {"", "na", "nan"}:
        return None
    result = float(value)
    if not math.isfinite(result):
        raise DatasetError("Non-finite number in input dataset")
    return result


def indexed_rows(path: Path, required_columns: set[str]) -> dict[str, dict]:
    rows = {}
    for row in read_rows(path, required_columns | {"Protein ID"}):
        protein_id = row["Protein ID"]
        if not protein_id or protein_id in rows:
            raise DatasetError(f"{path.name}: empty or duplicate Protein ID {protein_id!r}")
        rows[protein_id] = row
    return rows


class CsvRepository:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir.resolve()
        # The versioned dataset is organized by provenance. A flat directory remains
        # supported for external datasets and small test fixtures.
        structured = (self.data_dir / "raw").is_dir() or (self.data_dir / "processed").is_dir()
        self.paths = {
            name: self.data_dir / ("raw" if name.endswith(".tsv") else "processed") / name
            if structured else self.data_dir / name
            for name in REQUIRED_FILES
        }
        structures_dir = (
            self.data_dir / "external" / "pdb_files" if structured else self.data_dir / "pdb_files"
        )
        missing = [name for name, path in self.paths.items() if not path.is_file()]
        if missing:
            raise DatasetError(
                f"Dataset incomplete at {self.data_dir}: {', '.join(missing)}. "
                "Set PROTEIN_DATA_DIR to a data folder with raw/ and processed/ subfolders, "
                "or a flat CSV/TSV folder."
            )
        self.proteins: dict[str, Protein] = {}
        columns = {"Protein ID", "Gene", "Organism", "Protein Length", "Description"}
        for row in read_rows(self.paths["combined_protein.tsv"], columns):
            protein_id = row["Protein ID"]
            if not protein_id or protein_id in self.proteins:
                raise DatasetError(f"Duplicate or empty primary Protein ID: {protein_id!r}")
            self.proteins[protein_id] = Protein(
                protein_id=protein_id,
                gene=row["Gene"] or None,
                organism=row["Organism"],
                taxon_id=TAXON_BY_ORGANISM.get(row["Organism"]),
                length=int(row["Protein Length"]),
                description=row["Description"],
            )
        if not self.proteins:
            raise DatasetError("Primary protein table is empty")

        self.samples: list[Sample] = []
        for row in read_rows(
            self.paths["experiment_annotation.tsv"],
            {"sample", "condition", "replicate", "file"},
        ):
            sample_id = row["sample"]
            self.samples.append(
                Sample(
                    sample_id=sample_id,
                    original_condition=row["condition"],
                    display_group=re.sub(r"_\d+$", "", sample_id),
                    replicate_label=row["replicate"],
                    source_file=row["file"].replace("\\", "/").rsplit("/", 1)[-1],
                )
            )
        self.sample_ids = [sample.sample_id for sample in self.samples]
        if not self.sample_ids or len(set(self.sample_ids)) != len(self.sample_ids):
            raise DatasetError("Sample identifiers must be nonempty and unique")
        if any(not sample_id for sample_id in self.sample_ids):
            raise DatasetError("Sample identifiers must be nonempty")
        wide_path = self.paths["maxlfq_wide.csv"]
        with wide_path.open(encoding="utf-8-sig", newline="") as stream:
            headers = next(csv.reader(stream))
        quant_samples = {
            name.removesuffix(" MaxLFQ Intensity")
            for name in headers
            if name.endswith(" MaxLFQ Intensity")
        }
        if quant_samples != set(self.sample_ids):
            raise DatasetError("Annotation samples do not match MaxLFQ sample columns")
        self.abundance: dict[str, list[float | None]] = {}
        wide = indexed_rows(wide_path, {f"{sample} MaxLFQ Intensity" for sample in self.sample_ids})
        self._same_protein_ids("maxlfq_wide.csv", wide)
        for protein_id, row in wide.items():
            values = [number(row[f"{sample} MaxLFQ Intensity"]) for sample in self.sample_ids]
            if any(value is not None and value < 0 for value in values):
                raise DatasetError(f"Negative intensity for {protein_id}")
            self.abundance[protein_id] = [value if value else None for value in values]

        self.sequences = indexed_rows(self.paths["proteins_with_sequences.csv"], {"Sequence"})
        self.locations = indexed_rows(self.paths["spatial_mapping.csv"], {"locations"})
        structure_rows = indexed_rows(
            self.paths["structure_pdb_index.csv"], {"pdb_id", "pdb_ids"}
        )
        for name, rows in (
            ("sequences", self.sequences),
            ("locations", self.locations),
            ("structures", structure_rows),
        ):
            self._same_protein_ids(name, rows)
        self.structure_ids: dict[str, list[str]] = {}
        self.local_structures: dict[str, Path] = {}
        available_files = {
            path.stem.removeprefix("pdb").upper(): path
            for path in structures_dir.glob("pdb*.ent")
            if path.is_file()
        }
        for protein_id, row in structure_rows.items():
            ids = [
                value.strip().upper()
                for value in row["pdb_ids"].split(";")
                if PDB_ID_PATTERN.fullmatch(value.strip())
            ]
            if row["pdb_id"].lower() != "no pdb avaliable" and not ids:
                raise DatasetError(f"Invalid PDB reference for {protein_id}")
            self.structure_ids[protein_id] = list(dict.fromkeys(ids))
            for pdb_id in ids:
                if pdb_id in available_files:
                    self.local_structures[pdb_id] = available_files[pdb_id]

        self.differential = indexed_rows(
            self.paths["ga2_human_vs_qc_limma.csv"],
            {"log2FC", "p_value", "adj_p", "contrast", "method"},
        )
        if not self.differential:
            raise DatasetError("Human vs QC result table is empty")
        for protein_id, row in self.differential.items():
            self._known_protein(protein_id, "differential results")
            if row["contrast"] != "Human_vs_QC" or row["method"] != "limma_eBayes_BH":
                raise DatasetError("Unexpected contrast or method in Human vs QC result table")
            for column in ("log2FC", "p_value", "adj_p"):
                value = number(row[column])
                if value is None:
                    raise DatasetError(f"Missing {column} for {protein_id}")
                if column != "log2FC" and not 0 <= value <= 1:
                    raise DatasetError(f"Invalid {column} for {protein_id}")

        self.edges: list[NetworkEdge] = []
        self.adjacency: dict[str, list[NetworkEdge]] = {}
        self.excluded_cross_species_edges = 0
        for row in read_rows(
            self.paths["ppi_string_edges.csv"], {"Protein_A", "Protein_B", "score", "species"}
        ):
            source, target = row["Protein_A"], row["Protein_B"]
            self._known_protein(source, "STRING edge")
            self._known_protein(target, "STRING edge")
            species = int(row["species"])
            first, second = self.proteins[source], self.proteins[target]
            if first.organism != second.organism or any(
                protein.taxon_id is not None and protein.taxon_id != species
                for protein in (first, second)
            ):
                self.excluded_cross_species_edges += 1
                continue
            score = number(row["score"])
            if score is None:
                raise DatasetError("STRING edge has no score")
            edge = NetworkEdge(
                source=source,
                target=target,
                score=score,
                species=species,
                evidence={
                    key: number(row[key])
                    for key in (
                        "ascore",
                        "dscore",
                        "escore",
                        "fscore",
                        "nscore",
                        "pscore",
                        "tscore",
                    )
                    if key in row and number(row[key]) is not None
                },
            )
            self.edges.append(edge)
            self.adjacency.setdefault(source, []).append(edge)
            if target != source:
                self.adjacency.setdefault(target, []).append(edge)

    def _same_protein_ids(self, table: str, rows: dict) -> None:
        if set(rows) != set(self.proteins):
            raise DatasetError(f"{table}: Protein IDs do not match the primary table")

    def _known_protein(self, protein_id: str, table: str) -> None:
        if protein_id not in self.proteins:
            raise DatasetError(f"{table}: unknown Protein ID {protein_id!r}")
