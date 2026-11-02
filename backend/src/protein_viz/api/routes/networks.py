from typing import Annotated

from fastapi import APIRouter, Query

from protein_viz.api.dependencies import Repository
from protein_viz.schemas.domain import Neighborhood
from protein_viz.services.networks import NetworkService

router = APIRouter(prefix="/networks", tags=["networks"])


@router.get("/{protein_id}/neighbors", response_model=Neighborhood)
def neighbors(
    protein_id: str,
    repository: Repository,
    score_cutoff: Annotated[float, Query(ge=0, le=1, allow_inf_nan=False)] = 0.4,
    max_nodes: Annotated[int, Query(ge=1, le=150)] = 100,
):
    return NetworkService(repository).neighborhood(protein_id, score_cutoff, max_nodes)
