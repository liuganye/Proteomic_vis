from fastapi import APIRouter

from protein_viz.api.dependencies import QualityControl, Repository
from protein_viz.schemas.domain import QCMatrix, QCMatrixRow, QCResponse

router = APIRouter(prefix="/qc", tags=["quality-control"])


@router.get("/samples", response_model=QCResponse)
def samples(service: QualityControl, organism: str | None = None):
    return service.samples(organism)


@router.get("/matrix", response_model=QCMatrix)
def matrix(repository: Repository):
    return QCMatrix(
        samples=repository.samples,
        proteins=[QCMatrixRow(protein_id=p.protein_id, gene=p.gene,
                              description=p.description, values=repository.abundance[p.protein_id])
                  for p in repository.proteins.values()],
    )
