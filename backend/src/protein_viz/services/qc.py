from protein_viz.core.errors import ResourceNotFound
from protein_viz.repositories.csv_repository import CsvRepository
from protein_viz.schemas.domain import QCResponse, SampleQC


class QCService:
    def __init__(self, repository: CsvRepository):
        self.repository = repository
        self._sample_cache: dict[str | None, QCResponse] = {}

    def samples(self, organism: str | None = None) -> QCResponse:
        if organism in self._sample_cache:
            return self._sample_cache[organism]
        ids = [
            protein.protein_id
            for protein in self.repository.proteins.values()
            if organism is None or protein.organism == organism
        ]
        if not ids:
            raise ResourceNotFound("organism_not_found", f"No proteins for organism: {organism}")
        counts = [0] * len(self.repository.samples)
        for protein_id in ids:
            for index, value in enumerate(self.repository.abundance[protein_id]):
                counts[index] += value is not None
        result = QCResponse(
            organism=organism,
            samples=[
                SampleQC(
                    sample_id=sample.sample_id,
                    display_group=sample.display_group,
                    detected_count=counts[index],
                    missing_count=len(ids) - counts[index],
                    protein_count=len(ids),
                    missing_fraction=(len(ids) - counts[index]) / len(ids),
                )
                for index, sample in enumerate(self.repository.samples)
            ],
        )
        self._sample_cache[organism] = result
        return result
