from fastapi import APIRouter

from protein_viz.api.routes import contrasts, datasets, networks, proteins, qc, structures

router = APIRouter(prefix="/api/v1")
for domain in (datasets, proteins, contrasts, networks, qc, structures):
    router.include_router(domain.router)
