from typing import Literal

from protein_viz.core.errors import ResourceNotFound
from protein_viz.repositories.csv_repository import CsvRepository
from protein_viz.schemas.domain import Contrast, DifferentialPage, DifferentialResult

CONTRAST_ID = "human-vs-qc"


class ContrastService:
    def __init__(self, repository: CsvRepository):
        self.repository = repository

    def get(self, contrast_id: str) -> Contrast:
        if contrast_id != CONTRAST_ID:
            raise ResourceNotFound("contrast_not_found", f"Unknown contrast: {contrast_id}")
        return Contrast(
            contrast_id=CONTRAST_ID,
            label="Human vs QC",
            direction="Human - QC",
            method="limma_eBayes_BH",
            source_file="ga2_human_vs_qc_limma.csv",
            evaluated_count=len(self.repository.differential),
            sample_ids=[
                sample.sample_id
                for sample in self.repository.samples
                if sample.original_condition in {"Human", "QC"}
            ],
            provenance=(
                "Imported precomputed results. Method is recorded in the supplied CSV/notebook; "
                "the original R execution has not been independently reproduced by this API."
            ),
        )

    def results(
        self,
        contrast_id: str,
        organism: str | None,
        p_value_mode: Literal["adjusted", "raw"],
        p_cutoff: float,
        abs_log2_fc_cutoff: float,
        significant_only: bool,
        offset: int,
        limit: int,
    ) -> DifferentialPage:
        contrast = self.get(contrast_id)
        results = []
        for protein_id, row in self.repository.differential.items():
            protein = self.repository.proteins[protein_id]
            if organism is not None and protein.organism != organism:
                continue
            log2_fc, p_value, adj_p = (float(row[key]) for key in ("log2FC", "p_value", "adj_p"))
            selected_p = adj_p if p_value_mode == "adjusted" else p_value
            significant = selected_p < p_cutoff and abs(log2_fc) > abs_log2_fc_cutoff
            if significant_only and not significant:
                continue
            results.append(
                DifferentialResult(
                    protein_id=protein_id,
                    gene=protein.gene,
                    organism=protein.organism,
                    log2_fc=log2_fc,
                    p_value=p_value,
                    adj_p=adj_p,
                    significant=significant,
                )
            )
        return DifferentialPage(
            items=results[offset : offset + limit],
            total=len(results),
            offset=offset,
            limit=limit,
            contrast_id=contrast_id,
            evaluated_count=contrast.evaluated_count,
            p_value_mode=p_value_mode,
            p_cutoff=p_cutoff,
            abs_log2_fc_cutoff=abs_log2_fc_cutoff,
        )
