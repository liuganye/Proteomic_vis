from fastapi import APIRouter

from protein_viz.api.dependencies import Repository
from protein_viz.schemas.domain import DatasetSummary, Sample
from protein_viz.services.datasets import summarize

router = APIRouter(tags=["dataset"])


@router.get("/dataset", response_model=DatasetSummary)
def dataset(repository: Repository):
    return summarize(repository)


@router.get("/samples", response_model=list[Sample])
def samples(repository: Repository):
    return repository.samples
