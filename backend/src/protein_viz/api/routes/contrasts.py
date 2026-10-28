from typing import Annotated, Literal

from fastapi import APIRouter, Query

from protein_viz.api.dependencies import Repository
from protein_viz.schemas.domain import Contrast, DifferentialPage
from protein_viz.services.contrasts import CONTRAST_ID, ContrastService

router = APIRouter(prefix="/contrasts", tags=["contrasts"])


@router.get("", response_model=list[Contrast])
def contrasts(repository: Repository):
    return [ContrastService(repository).get(CONTRAST_ID)]


@router.get("/{contrast_id}/results", response_model=DifferentialPage)
def results(
    contrast_id: str,
    repository: Repository,
    organism: str | None = None,
    p_value_mode: Literal["adjusted", "raw"] = "adjusted",
    p_cutoff: Annotated[float, Query(gt=0, le=1, allow_inf_nan=False)] = 0.05,
    abs_log2_fc_cutoff: Annotated[float, Query(ge=0, allow_inf_nan=False)] = 0.7,
    significant_only: bool = False,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=10000)] = 100,
):
    return ContrastService(repository).results(
        contrast_id,
        organism,
        p_value_mode,
        p_cutoff,
        abs_log2_fc_cutoff,
        significant_only,
        offset,
        limit,
    )
