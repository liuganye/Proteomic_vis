import shutil

import pytest

from protein_viz.core.config import DEFAULT_DATA_DIR, Settings
from protein_viz.core.errors import DatasetError
from protein_viz.repositories.csv_repository import CsvRepository


def test_incomplete_dataset_fails_with_actionable_error(tmp_path):
    with pytest.raises(DatasetError, match="PROTEIN_DATA_DIR"):
        CsvRepository(tmp_path)


def test_missing_protein_join_cannot_silently_drop_rows(dataset_dir):
    path = dataset_dir / "proteins_with_sequences.csv"
    path.write_text("Protein ID,Sequence\nP1,MAAA\n", encoding="utf-8")
    with pytest.raises(DatasetError, match="Protein IDs do not match"):
        CsvRepository(dataset_dir)


def test_nonfinite_numbers_fail_startup(dataset_dir):
    path = dataset_dir / "ga2_human_vs_qc_limma.csv"
    path.write_text(path.read_text().replace("0.001", "inf"), encoding="utf-8")
    with pytest.raises(DatasetError, match="Non-finite"):
        CsvRepository(dataset_dir)


def test_data_directory_is_configurable_without_changing_cwd(monkeypatch, dataset_dir):
    monkeypatch.setenv("PROTEIN_DATA_DIR", str(dataset_dir))
    monkeypatch.setenv("PROTEIN_CORS_ORIGINS", "http://localhost:3000")
    settings = Settings.from_env()
    assert settings.data_dir == dataset_dir
    assert settings.cors_origins == ("http://localhost:3000",)
    assert DEFAULT_DATA_DIR.name == "data"


def test_structured_dataset_matches_flat_and_loads_local_structures(dataset_dir, tmp_path):
    structured = tmp_path / "structured"
    raw = structured / "raw"
    processed = structured / "processed"
    pdb = structured / "external" / "pdb_files"
    for path in (raw, processed, pdb):
        path.mkdir(parents=True)
    for path in dataset_dir.glob("*.tsv"):
        shutil.copy2(path, raw / path.name)
    for path in dataset_dir.glob("*.csv"):
        shutil.copy2(path, processed / path.name)
    shutil.copy2(dataset_dir / "pdb_files" / "pdb1abc.ent", pdb / "pdb1abc.ent")
    flat = CsvRepository(dataset_dir)
    organized = CsvRepository(structured)
    assert organized.proteins == flat.proteins
    assert organized.abundance == flat.abundance
    assert organized.differential == flat.differential
    assert set(organized.local_structures) == {"1ABC"}
