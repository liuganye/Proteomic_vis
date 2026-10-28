from collections import Counter

from protein_viz.repositories.csv_repository import REQUIRED_FILES, CsvRepository
from protein_viz.schemas.domain import DatasetSummary


def summarize(repository: CsvRepository) -> DatasetSummary:
    warnings = [
        "Display groups derive from sample name prefixes; original conditions are preserved. "
        "A/B labels and replicate types require Bio review before new statistics.",
        "Zero/blank MaxLFQ is returned as null; observed abundance is not imputed.",
        "Human vs QC results are precomputed imports, not recomputed on request.",
        "STRING is a chunked functional association network, not a complete physical PPI graph.",
        "Only locally available PDB files are served; a reference is not a downloaded structure.",
    ]
    if repository.excluded_cross_species_edges:
        warnings.append(
            f"Excluded {repository.excluded_cross_species_edges} STRING edges with "
            "organism or known-taxon conflicts; source files are unchanged."
        )
    return DatasetSummary(
        protein_count=len(repository.proteins),
        sample_count=len(repository.samples),
        differential_result_count=len(repository.differential),
        network_edge_count=len(repository.edges),
        local_structure_count=len(repository.local_structures),
        organism_counts=dict(Counter(protein.organism for protein in repository.proteins.values())),
        source_files=list(REQUIRED_FILES),
        warnings=warnings,
    )
