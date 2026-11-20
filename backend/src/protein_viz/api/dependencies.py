from typing import Annotated

from fastapi import Depends, Request

from protein_viz.repositories.csv_repository import CsvRepository
from protein_viz.services.qc import QCService
from protein_viz.services.structures import StructureResolver


def get_repository(request: Request) -> CsvRepository:
    return request.app.state.repository


def get_qc_service(request: Request) -> QCService:
    return request.app.state.qc_service


def get_structure_resolver(request: Request) -> StructureResolver:
    return request.app.state.structure_resolver


Repository = Annotated[CsvRepository, Depends(get_repository)]
QualityControl = Annotated[QCService, Depends(get_qc_service)]
Structures = Annotated[StructureResolver, Depends(get_structure_resolver)]
