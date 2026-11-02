import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from protein_viz import __version__
from protein_viz.api.router import router
from protein_viz.core.config import Settings
from protein_viz.core.errors import ResourceNotFound
from protein_viz.repositories.csv_repository import CsvRepository
from protein_viz.schemas.common import ErrorResponse
from protein_viz.services.qc import QCService

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        repository = CsvRepository(settings.data_dir)
        app.state.repository = repository
        app.state.qc_service = QCService(repository)
        logger.info(
            "Loaded %d proteins and %d samples", len(repository.proteins), len(repository.samples)
        )
        try:
            yield
        finally:
            app.state.qc_service = None
            app.state.repository = None

    app = FastAPI(
        title="Protein Visualization API",
        version=__version__,
        lifespan=lifespan,
        description="Read-only API over the supplied project dataset. No online statistical jobs.",
        responses={404: {"model": ErrorResponse}},
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET"],
        allow_headers=["*"],
        allow_credentials=False,
    )

    @app.exception_handler(ResourceNotFound)
    async def resource_not_found(_request: Request, error: ResourceNotFound):
        return JSONResponse(status_code=404, content={"code": error.code, "message": error.message})

    @app.get("/health", tags=["health"])
    def health(request: Request):
        return {
            "status": "ok" if request.app.state.repository is not None else "not_ready",
            "version": __version__,
        }

    app.include_router(router)
    return app


app = create_app()
