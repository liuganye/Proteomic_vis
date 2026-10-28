from typing import Literal

from pydantic import Field

from protein_viz.schemas.common import Model, Page


class Protein(Model):
    protein_id: str
    gene: str | None
    organism: str
    taxon_id: int | None
    length: int
    description: str


class StructureReference(Model):
    pdb_id: str
    source_url: str
    local_available: bool
    download_url: str | None


class ProteinDetail(Protein):
    sequence: str
    locations: list[str]
    structures: list[StructureReference]
    structure_status: Literal["local_available", "reference_only", "no_pdb_reference"]


class Sample(Model):
    sample_id: str
    original_condition: str
    display_group: str
    group_review_status: Literal["unreviewed"] = "unreviewed"
    replicate_label: str
    replicate_type: None = None
    source_file: str


class AbundancePoint(Model):
    sample_id: str
    display_group: str
    intensity: float | None
    log2_intensity: float | None
    observed: bool


class AbundanceResponse(Model):
    protein_id: str
    points: list[AbundancePoint]
    missing_policy: str = "zero or blank -> null; no imputation in this response"


class Contrast(Model):
    contrast_id: str
    label: str
    direction: str
    method: str
    source_file: str
    evaluated_count: int
    sample_ids: list[str]
    provenance: str


class DifferentialResult(Model):
    protein_id: str
    gene: str | None
    organism: str
    log2_fc: float
    p_value: float = Field(ge=0, le=1)
    adj_p: float = Field(ge=0, le=1)
    significant: bool


class DifferentialPage(Page[DifferentialResult]):
    contrast_id: str
    p_value_mode: Literal["adjusted", "raw"]
    p_cutoff: float
    abs_log2_fc_cutoff: float
    evaluated_count: int
    note: str = "Filtering does not refit the model or recompute BH adjusted p-values."


class NetworkEdge(Model):
    source: str
    target: str
    score: float = Field(ge=0, le=1)
    species: int
    evidence: dict[str, float]


class Neighborhood(Model):
    protein_id: str
    nodes: list[Protein]
    edges: list[NetworkEdge]
    total_neighbors: int
    truncated: bool
    source: str = "STRING chunked network export; incomplete functional association graph"
    note: str = "Score is confidence, not binding strength. No model fitting is performed."


class SampleQC(Model):
    sample_id: str
    display_group: str
    detected_count: int
    missing_count: int
    protein_count: int
    missing_fraction: float


class QCResponse(Model):
    organism: str | None
    samples: list[SampleQC]
    note: str = (
        "Descriptive coverage only; pure-species and mixed samples are not graded together. "
        "Group labels and replicate types still require review."
    )


class DatasetSummary(Model):
    schema_version: str = "1.0"
    protein_count: int
    sample_count: int
    differential_result_count: int
    network_edge_count: int
    local_structure_count: int
    organism_counts: dict[str, int]
    source_files: list[str]
    warnings: list[str]
