import math

from protein_viz.core.errors import ResourceNotFound
from protein_viz.repositories.csv_repository import CsvRepository
from protein_viz.schemas.common import Page
from protein_viz.schemas.domain import (
    AbundancePoint,
    AbundanceResponse,
    Protein,
    ProteinDetail,
    StructureReference,
)


class ProteinService:
    def __init__(self, repository: CsvRepository):
        self.repository = repository

    def get(self, protein_id: str) -> Protein:
        protein = self.repository.proteins.get(protein_id)
        if protein is None:
            raise ResourceNotFound("protein_not_found", f"Unknown Protein ID: {protein_id}")
        return protein

    def search(self, query: str, organism: str | None, offset: int, limit: int) -> Page[Protein]:
        query = query.strip().casefold()
        proteins = [
            protein
            for protein in self.repository.proteins.values()
            if (organism is None or protein.organism == organism)
            and (
                not query
                or query in protein.protein_id.casefold()
                or query in (protein.gene or "").casefold()
            )
        ]
        return Page[Protein](
            items=proteins[offset : offset + limit], total=len(proteins), offset=offset, limit=limit
        )

    def detail(self, protein_id: str) -> ProteinDetail:
        protein = self.get(protein_id)
        structures = [
            StructureReference(
                pdb_id=pdb_id,
                source_url=f"https://www.rcsb.org/structure/{pdb_id}",
                local_available=pdb_id in self.repository.local_structures,
                download_url=f"/api/v1/structures/{pdb_id}"
                if pdb_id in self.repository.local_structures
                else None,
            )
            for pdb_id in self.repository.structure_ids[protein_id]
        ]
        status = (
            "local_available"
            if any(item.local_available for item in structures)
            else ("reference_only" if structures else "no_pdb_reference")
        )
        return ProteinDetail(
            **protein.model_dump(),
            sequence=self.repository.sequences[protein_id]["Sequence"],
            locations=[
                location.strip()
                for location in self.repository.locations[protein_id]["locations"].split(";")
                if location.strip()
            ],
            structures=structures,
            structure_status=status,
        )

    def abundance(self, protein_id: str) -> AbundanceResponse:
        self.get(protein_id)
        points = [
            AbundancePoint(
                sample_id=sample.sample_id,
                display_group=sample.display_group,
                intensity=value,
                log2_intensity=math.log2(value) if value is not None else None,
                observed=value is not None,
            )
            for sample, value in zip(
                self.repository.samples, self.repository.abundance[protein_id], strict=True
            )
        ]
        return AbundanceResponse(protein_id=protein_id, points=points)
