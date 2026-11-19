from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import PlainTextResponse

from protein_viz.api.dependencies import Repository, Structures
from protein_viz.schemas.common import Page
from protein_viz.schemas.domain import AbundanceResponse, Protein, ProteinDetail, StructureModel
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


@router.get("/{protein_id}/structure", response_model=StructureModel)
def structure(protein_id: str, repository: Repository, structures: Structures):
    """Pick one model (local, best PDB chain, or AlphaFold) and cache it on first request."""
    ProteinService(repository).get(protein_id)
    model = structures.model(protein_id)
    return StructureModel(
        **model.to_dict(), coordinates_url=f"/api/v1/proteins/{protein_id}/structure/coordinates"
    )


@router.get("/{protein_id}/structure/coordinates", response_class=PlainTextResponse)
def structure_coordinates(protein_id: str, repository: Repository, structures: Structures):
    """PDB-format coordinates of the selected chain only (first model)."""
    ProteinService(repository).get(protein_id)
    return PlainTextResponse(structures.coordinates(protein_id), media_type="chemical/x-pdb")
