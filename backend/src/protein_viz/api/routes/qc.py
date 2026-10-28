from fastapi import APIRouter

from protein_viz.api.dependencies import QualityControl
from protein_viz.schemas.domain import QCResponse

router = APIRouter(prefix="/qc", tags=["quality-control"])


@router.get("/samples", response_model=QCResponse)
def samples(service: QualityControl, organism: str | None = None):
    return service.samples(organism)
