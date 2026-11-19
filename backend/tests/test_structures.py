"""Structure selection and caching; all network access is replaced by a fake fetcher."""

import json

import pytest

from protein_viz.services.structures import (
    ALPHAFOLD_API_URL,
    RCSB_PDB_URL,
    SIFTS_URL,
    StructureResolver,
    StructureUnavailable,
    chains_for_accession,
    extract_chain,
    uniprot_accession,
)


def atom(
    serial: int,
    chain: str,
    residue: int,
    x: float,
    *,
    name="CA",
    res="ALA",
    b=50.0,
    record="ATOM  ",
):
    return (
        f"{record}{serial:5d} {name:^4} {res} {chain}{residue:4d}    "
        f"{x:8.3f}{0.0:8.3f}{0.0:8.3f}{1.0:6.2f}{b:6.2f}           C"
    )


def pdb(*lines: str) -> str:
    return "\n".join(lines) + "\nEND\n"


COMPLEX = pdb(
    "HEADER    TRANSFERASE                             01-JAN-20   1ABC",
    "EXPDTA    X-RAY DIFFRACTION",
    "REMARK   2 RESOLUTION.    2.10 ANGSTROMS.",
    "REMARK 465 MISSING RESIDUES",
    "DBREF  1ABC A    1   100  UNP    Q99999   OTHER_HUMAN      1    100",
    "DBREF  1ABC B    1   100  UNP    P12345   TARGET_HUMAN     1    100",
    atom(1, "A", 1, 1.0),
    atom(2, "A", 2, 4.8),
    "TER",
    atom(3, "B", 1, 10.0),
    atom(4, "B", 2, 13.8),
    atom(5, "B", 3, 17.6, name="O", res="HOH", record="HETATM"),
    "TER",
)


class FakeWeb:
    """URL → body; a missing URL behaves like HTTP 404; ``down`` raises like a timeout."""

    def __init__(self, pages: dict[str, bytes | str], down: bool = False):
        self.pages = {
            url: body.encode() if isinstance(body, str) else body for url, body in pages.items()
        }
        self.down = down
        self.calls: list[str] = []

    def __call__(self, url: str) -> bytes | None:
        self.calls.append(url)
        if self.down:
            raise OSError(f"Could not reach {url}")
        return self.pages.get(url)


def resolver(tmp_path, web, *, local=None, refs=None, online=True):
    return StructureResolver(tmp_path / "cache", local or {}, refs or {}, online=online, fetch=web)


def sifts(accession: str, *entries: dict) -> tuple[str, str]:
    return SIFTS_URL.format(accession=accession), json.dumps({accession: list(entries)})


def test_accessions_drop_isoforms_and_reject_non_uniprot_ids():
    assert uniprot_accession("o00148-2") == "O00148"
    assert uniprot_accession("A0A024R1R8") == "A0A024R1R8"
    assert uniprot_accession("contam_sp|X") is None
    assert uniprot_accession("REV__P12345") is None


def test_chain_is_chosen_by_dbref_and_only_its_first_model_is_kept():
    assert chains_for_accession(COMPLEX, "P12345") == ["B"]
    kept = extract_chain(COMPLEX, "B")
    atoms = [line for line in kept.splitlines() if line.startswith(("ATOM", "HETATM"))]
    assert {line[21] for line in atoms} == {"B"}
    assert not any("HOH" in line for line in atoms), "waters are dropped"
    assert "REMARK   2 RESOLUTION" in kept and "REMARK 465" not in kept
    assert "EXPDTA" in kept and kept.rstrip().endswith("END")

    nmr = pdb(
        "MODEL        1",
        atom(1, "A", 1, 1.0),
        "ENDMDL",
        "MODEL        2",
        atom(1, "A", 1, 99.0),
        "ENDMDL",
    )
    assert sum(line.startswith("ATOM") for line in extract_chain(nmr, "A").splitlines()) == 1
    with pytest.raises(StructureUnavailable):
        extract_chain(COMPLEX, "Z")


def test_local_file_wins_and_uses_the_mapped_chain_without_network(tmp_path):
    path = tmp_path / "pdb1abc.ent"
    path.write_text(COMPLEX, encoding="utf-8")
    web = FakeWeb({}, down=True)
    service = resolver(tmp_path, web, local={"1ABC": path}, refs={"P12345": ["1ABC"]})
    model = service.model("P12345")
    assert (model.source, model.model_id, model.chain_id) == ("local", "1ABC", "B")
    assert model.resolution == 2.1 and model.method == "X-Ray Diffraction"
    assert {
        line[21] for line in service.coordinates("P12345").splitlines() if line.startswith("ATOM")
    } == {"B"}
    assert web.calls == []


def test_best_pdb_is_used_and_mmcif_only_entries_are_skipped(tmp_path):
    accession = "P12345"
    web = FakeWeb(
        dict(
            [
                sifts(
                    accession,
                    {"pdb_id": "9big", "chain_id": "AA", "coverage": 1.0},  # mmCIF-only chain name
                    {"pdb_id": "8zzz", "chain_id": "B", "coverage": 0.95},  # no legacy .pdb (404)
                    {
                        "pdb_id": "1abc",
                        "chain_id": "B",
                        "coverage": 0.8,
                        "resolution": 2.1,
                        "experimental_method": "X-ray diffraction",
                        "unp_start": 1,
                        "unp_end": 100,
                    },
                ),
                (RCSB_PDB_URL.format(pdb_id="1ABC"), COMPLEX),
            ]
        )
    )
    model = resolver(tmp_path, web).model(accession)
    assert (model.source, model.model_id, model.chain_id, model.coverage) == (
        "pdb",
        "1ABC",
        "B",
        0.8,
    )
    assert (model.unp_start, model.unp_end, model.coloring) == (1, 100, "position")
    assert RCSB_PDB_URL.format(pdb_id="9BIG") not in web.calls


def test_alphafold_fills_in_when_no_experimental_structure_exists(tmp_path):
    accession = "Q8N1N2"
    model_url = "https://alphafold.ebi.ac.uk/files/AF-Q8N1N2-F1-model_v6.pdb"
    web = FakeWeb(
        {
            SIFTS_URL.format(accession=accession): json.dumps({}),
            ALPHAFOLD_API_URL.format(accession=accession): json.dumps(
                [
                    {
                        "uniprotAccession": accession,
                        "entryId": "AF-Q8N1N2-F1",
                        "pdbUrl": model_url,
                        "uniprotStart": 1,
                        "uniprotEnd": 2,
                    },
                ]
            ),
            model_url: pdb(atom(1, "A", 1, 1.0, b=93.2), atom(2, "A", 2, 4.8, b=41.0)),
        }
    )
    model = resolver(tmp_path, web).model(accession)
    assert (model.source, model.model_id, model.coloring) == ("alphafold", "AF-Q8N1N2-F1", "plddt")
    assert model.source_url.endswith("/entry/Q8N1N2")


def test_results_are_cached_so_the_second_request_needs_no_network(tmp_path):
    accession = "P12345"
    web = FakeWeb(
        dict(
            [
                sifts(accession, {"pdb_id": "1abc", "chain_id": "B"}),
                (RCSB_PDB_URL.format(pdb_id="1ABC"), COMPLEX),
            ]
        )
    )
    first = resolver(tmp_path, web).model(accession)
    offline = FakeWeb({}, down=True)
    again = resolver(tmp_path, offline)
    assert again.model(accession) == first
    assert "ATOM" in again.coordinates(accession)
    assert offline.calls == []


def test_unreachable_absent_and_offline_are_distinguished(tmp_path):
    with pytest.raises(StructureUnavailable) as unreachable:
        resolver(tmp_path, FakeWeb({}, down=True)).model("P12345")
    assert unreachable.value.code == "structure_source_unreachable"

    with pytest.raises(StructureUnavailable) as absent:
        resolver(tmp_path, FakeWeb({})).model("P12345")
    assert absent.value.code == "structure_not_found"

    with pytest.raises(StructureUnavailable) as offline:
        resolver(tmp_path, FakeWeb({}), online=False).model("P12345")
    assert offline.value.code == "structure_offline"

    with pytest.raises(StructureUnavailable) as not_uniprot:
        resolver(tmp_path, FakeWeb({})).model("contam_X")
    assert not_uniprot.value.code == "structure_not_uniprot"
    assert not (tmp_path / "cache").exists() or not any((tmp_path / "cache").iterdir())


def test_an_unusable_bundled_file_falls_back_to_online_sources(tmp_path):
    path = tmp_path / "pdb1abc.ent"
    path.write_text("HEADER    PLACEHOLDER\nEND\n", encoding="utf-8")
    web = FakeWeb(
        dict(
            [
                sifts("P12345", {"pdb_id": "1abc", "chain_id": "B"}),
                (RCSB_PDB_URL.format(pdb_id="1ABC"), COMPLEX),
            ]
        )
    )
    model = resolver(tmp_path, web, local={"1ABC": path}, refs={"P12345": ["1ABC"]}).model("P12345")
    assert (model.source, model.chain_id) == ("pdb", "B")
