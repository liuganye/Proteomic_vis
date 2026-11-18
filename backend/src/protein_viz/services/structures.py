"""Choose, download and cache one structure model per protein.

Order of preference:
1. A bundled local PDB file for the protein (works offline).
2. The best experimental structure according to PDBe SIFTS ``best_structures``
   (sorted by UniProt coverage, then resolution), downloaded from RCSB.
   Entries that RCSB does not provide in legacy PDB format (very large complexes)
   are skipped and the next candidate is tried.
3. The AlphaFold DB prediction for the UniProt accession.

Only the selected chain of the first model is kept, so the browser downloads a
small file and never draws a different protein from the same complex.
Everything uses the standard library so it can be tested without a web stack.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

SIFTS_URL = "https://www.ebi.ac.uk/pdbe/api/mappings/best_structures/{accession}"
RCSB_PDB_URL = "https://files.rcsb.org/download/{pdb_id}.pdb"
ALPHAFOLD_API_URL = "https://alphafold.ebi.ac.uk/api/prediction/{accession}"
MAX_EXPERIMENTAL_CANDIDATES = 3
USER_AGENT = "protein-viz/0.1 (+https://github.com/liuganye/Proteomic_vis)"

# Letters and digits only: rejects contaminant/decoy IDs such as "contam_sp|..." or "REV__".
ACCESSION = re.compile(r"^[A-Z0-9]{1,10}$")
PDB_ID = re.compile(r"^[0-9][A-Z0-9]{3}$")

Fetcher = Callable[[str], bytes | None]
"""Return the response body, ``None`` for HTTP 404, or raise ``OSError`` for other failures."""


class StructureUnavailable(Exception):
    """No model could be obtained; ``code`` says whether it is absent or unreachable."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class StructureModel:
    protein_id: str
    source: Literal["local", "pdb", "alphafold"]
    model_id: str
    chain_id: str | None
    method: str | None
    resolution: float | None
    unp_start: int | None
    unp_end: int | None
    coverage: float | None
    source_url: str
    coloring: Literal["plddt", "position"]

    def to_dict(self) -> dict:
        return asdict(self)


def default_fetch(url: str, timeout: float = 15.0) -> bytes | None:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            return response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise OSError(f"HTTP {error.code} from {url}") from error
    except urllib.error.URLError as error:
        raise OSError(f"Could not reach {url}: {error.reason}") from error


def uniprot_accession(protein_id: str) -> str | None:
    """Canonical accession: drop isoform suffixes such as ``-2``; reject non-UniProt IDs."""
    accession = protein_id.strip().upper().split("-")[0]
    return accession if ACCESSION.match(accession) else None


def chains_for_accession(pdb_text: str, accession: str) -> list[str]:
    """Chains whose DBREF record maps to the UniProt accession, in file order."""
    chains: list[str] = []
    for line in pdb_text.splitlines():
        if line.startswith("DBREF ") and line[26:32].strip() == "UNP":
            if line[33:41].strip().upper() == accession and line[12] not in chains:
                chains.append(line[12])
    return chains


def atom_chains(pdb_text: str) -> list[str]:
    """Chains that have protein atoms, in file order (fallback when DBREF is missing)."""
    chains: list[str] = []
    for line in pdb_text.splitlines():
        if line.startswith("ATOM  ") and len(line) > 21 and line[21] not in chains:
            chains.append(line[21])
    return chains


def extract_chain(pdb_text: str, chain_id: str | None) -> str:
    """Keep header records plus ATOM/HETATM/TER lines of one chain from the first model."""
    header: list[str] = []
    atoms: list[str] = []
    seen_model = False
    for line in pdb_text.splitlines():
        record = line[:6]
        if record == "MODEL ":
            if seen_model:
                break
            seen_model = True
            continue
        if record == "ENDMDL":
            break
        if record in ("ATOM  ", "HETATM", "TER   "):
            if line[17:20] == "HOH":
                continue  # waters add size but nothing to a backbone view
            if chain_id is None or (len(line) > 21 and line[21] == chain_id):
                atoms.append(line)
        elif not atoms and (
            record in ("HEADER", "TITLE ", "EXPDTA", "DBREF ") or line.startswith("REMARK   2 ")
        ):
            header.append(line)
    kept = header + atoms
    if not any(line.startswith("ATOM  ") for line in kept):
        raise StructureUnavailable(
            "structure_chain_empty", f"No atoms for chain {chain_id or '(any)'} in the model"
        )
    kept.append("END")
    return "\n".join(kept) + "\n"


class StructureResolver:
    def __init__(
        self,
        cache_dir: Path,
        local_structures: dict[str, Path],
        reference_ids: dict[str, list[str]],
        *,
        online: bool = True,
        fetch: Fetcher = default_fetch,
    ):
        self.cache_dir = cache_dir
        self.local_structures = local_structures
        self.reference_ids = reference_ids
        self.online = online
        self.fetch = fetch

    # -- public API ------------------------------------------------------------------------

    def model(self, protein_id: str) -> StructureModel:
        cached = self._read_meta(protein_id)
        if cached is not None:
            return cached
        model, coordinates = self._resolve(protein_id)
        self._write_cache(protein_id, model, coordinates)
        return model

    def coordinates(self, protein_id: str) -> str:
        self.model(protein_id)
        return self._coordinates_path(protein_id).read_text(encoding="utf-8")

    # -- resolution ------------------------------------------------------------------------

    def _resolve(self, protein_id: str) -> tuple[StructureModel, str]:
        accession = uniprot_accession(protein_id)
        local = self._from_local(protein_id, accession)
        if local is not None:
            return local
        if not self.online:
            raise StructureUnavailable(
                "structure_offline", "Online structure download is disabled on this server"
            )
        if accession is None:
            raise StructureUnavailable(
                "structure_not_uniprot", f"{protein_id} is not a UniProt accession"
            )
        failures: list[str] = []
        for source in (self._from_pdb, self._from_alphafold):
            try:
                found = source(protein_id, accession)
            except OSError as error:
                failures.append(str(error))
                continue
            if found is not None:
                return found
        if failures:
            raise StructureUnavailable(
                "structure_source_unreachable",
                "Structure services could not be reached: " + "; ".join(failures),
            )
        raise StructureUnavailable(
            "structure_not_found", f"No experimental or predicted structure for {accession}"
        )

    def _from_local(
        self, protein_id: str, accession: str | None
    ) -> tuple[StructureModel, str] | None:
        for pdb_id in self.reference_ids.get(protein_id, []):
            path = self.local_structures.get(pdb_id)
            if path is None:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            chains = (chains_for_accession(text, accession) if accession else []) or atom_chains(
                text
            )
            chain = chains[0] if chains else None
            try:
                coordinates = extract_chain(text, chain)
            except StructureUnavailable:
                continue  # unusable bundled file: fall back to the next source
            return (
                StructureModel(
                    protein_id=protein_id,
                    source="local",
                    model_id=pdb_id,
                    chain_id=chain,
                    method=_expdta(text),
                    resolution=_resolution(text),
                    unp_start=None,
                    unp_end=None,
                    coverage=None,
                    source_url=f"https://www.rcsb.org/structure/{pdb_id}",
                    coloring="position",
                ),
                coordinates,
            )
        return None

    def _from_pdb(self, protein_id: str, accession: str) -> tuple[StructureModel, str] | None:
        body = self.fetch(SIFTS_URL.format(accession=accession))
        if body is None:
            return None
        entries = json.loads(body).get(accession, [])
        for entry in entries[:MAX_EXPERIMENTAL_CANDIDATES]:
            pdb_id = str(entry.get("pdb_id", "")).upper()
            chain = entry.get("chain_id")
            if not PDB_ID.match(pdb_id) or not isinstance(chain, str) or len(chain) != 1:
                continue  # multi-character chain IDs only exist in mmCIF-only entries
            text = self.fetch(RCSB_PDB_URL.format(pdb_id=pdb_id))
            if text is None:
                continue  # no legacy PDB file (large complex); try the next candidate
            try:
                coordinates = extract_chain(text.decode("utf-8", errors="replace"), chain)
            except StructureUnavailable:
                continue
            return (
                StructureModel(
                    protein_id=protein_id,
                    source="pdb",
                    model_id=pdb_id,
                    chain_id=chain,
                    method=entry.get("experimental_method"),
                    resolution=_float_or_none(entry.get("resolution")),
                    unp_start=_int_or_none(entry.get("unp_start")),
                    unp_end=_int_or_none(entry.get("unp_end")),
                    coverage=_float_or_none(entry.get("coverage")),
                    source_url=f"https://www.rcsb.org/structure/{pdb_id}",
                    coloring="position",
                ),
                coordinates,
            )
        return None

    def _from_alphafold(self, protein_id: str, accession: str) -> tuple[StructureModel, str] | None:
        body = self.fetch(ALPHAFOLD_API_URL.format(accession=accession))
        if body is None:
            return None
        predictions = [
            item
            for item in json.loads(body)
            if str(item.get("uniprotAccession", "")).upper() == accession and item.get("pdbUrl")
        ]
        if not predictions:
            return None
        prediction = predictions[0]
        text = self.fetch(prediction["pdbUrl"])
        if text is None:
            return None
        return (
            StructureModel(
                protein_id=protein_id,
                source="alphafold",
                model_id=str(prediction.get("entryId") or f"AF-{accession}-F1"),
                chain_id=None,
                method="AlphaFold prediction",
                resolution=None,
                unp_start=_int_or_none(prediction.get("uniprotStart")),
                unp_end=_int_or_none(prediction.get("uniprotEnd")),
                coverage=None,
                source_url=f"https://alphafold.ebi.ac.uk/entry/{accession}",
                coloring="plddt",
            ),
            extract_chain(text.decode("utf-8", errors="replace"), None),
        )

    # -- cache -----------------------------------------------------------------------------

    def _key(self, protein_id: str) -> str:
        return re.sub(r"[^A-Za-z0-9_-]", "_", protein_id)

    def _meta_path(self, protein_id: str) -> Path:
        return self.cache_dir / f"{self._key(protein_id)}.json"

    def _coordinates_path(self, protein_id: str) -> Path:
        return self.cache_dir / f"{self._key(protein_id)}.pdb"

    def _read_meta(self, protein_id: str) -> StructureModel | None:
        meta, coordinates = self._meta_path(protein_id), self._coordinates_path(protein_id)
        if not (meta.is_file() and coordinates.is_file()):
            return None
        try:
            return StructureModel(**json.loads(meta.read_text(encoding="utf-8")))
        except (TypeError, ValueError):
            return None  # stale or corrupt cache entry: resolve again

    def _write_cache(self, protein_id: str, model: StructureModel, coordinates: str) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        # Coordinates first, metadata last: metadata marks a complete entry.
        _atomic_write(self._coordinates_path(protein_id), coordinates)
        _atomic_write(self._meta_path(protein_id), json.dumps(model.to_dict(), indent=2))


def _atomic_write(path: Path, text: str) -> None:
    handle, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(text)
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def _expdta(text: str) -> str | None:
    for line in text.splitlines():
        if line.startswith("EXPDTA"):
            return line[10:].strip().title() or None
    return None


def _resolution(text: str) -> float | None:
    for line in text.splitlines():
        if line.startswith("REMARK   2 RESOLUTION."):
            match = re.search(r"(\d+(?:\.\d+)?)\s*ANGSTROM", line)
            return float(match.group(1)) if match else None
    return None


def _float_or_none(value) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _int_or_none(value) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
