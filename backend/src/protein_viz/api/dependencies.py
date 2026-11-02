from typing import Annotated

from fastapi import Depends, Request

from protein_viz.repositories.csv_repository import CsvRepository
from protein_viz.services.qc import QCService


def get_repository(request: Request) -> CsvRepository:
    return request.app.state.repository


def get_qc_service(request: Request) -> QCService:
    return request.app.state.qc_service


Repository = Annotated[CsvRepository, Depends(get_repository)]
QualityControl = Annotated[QCService, Depends(get_qc_service)]
