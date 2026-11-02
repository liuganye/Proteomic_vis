from typing import Annotated

from fastapi import APIRouter, Path
from fastapi.responses import FileResponse

from protein_viz.api.dependencies import Repository
from protein_viz.core.errors import ResourceNotFound

router = APIRouter(prefix="/structures", tags=["structures"])


@router.get("/{pdb_id}", response_class=FileResponse)
def structure(pdb_id: Annotated[str, Path(pattern=r"^[A-Za-z0-9]{4}$")], repository: Repository):
    pdb_id = pdb_id.upper()
    path = repository.local_structures.get(pdb_id)
    if path is None:
        raise ResourceNotFound("structure_not_local", f"No bundled coordinates for PDB {pdb_id}")
    return FileResponse(path, media_type="chemical/x-pdb", filename=f"{pdb_id}.pdb")
