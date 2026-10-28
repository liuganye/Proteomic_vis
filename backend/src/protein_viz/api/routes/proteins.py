from typing import Annotated

from fastapi import APIRouter, Query

from protein_viz.api.dependencies import Repository
from protein_viz.schemas.common import Page
from protein_viz.schemas.domain import AbundanceResponse, Protein, ProteinDetail
from protein_viz.services.proteins import ProteinService

router = APIRouter(prefix="/proteins", tags=["proteins"])


@router.get("", response_model=Page[Protein])
def proteins(
    repository: Repository,
    q: Annotated[str, Query(max_length=100)] = "",
    organism: str | None = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
):
    return ProteinService(repository).search(q, organism, offset, limit)


@router.get("/{protein_id}", response_model=ProteinDetail)
def protein(protein_id: str, repository: Repository):
    return ProteinService(repository).detail(protein_id)


@router.get("/{protein_id}/abundance", response_model=AbundanceResponse)
def abundance(protein_id: str, repository: Repository):
    return ProteinService(repository).abundance(protein_id)
