# Backend

The FastAPI service reads `../data/` by default. From the repository root, follow the installation and startup steps in [the project README](../README.md). API docs are available at `http://127.0.0.1:8000/docs` once the server is running.

The application loads and validates the data at startup. It exposes read-only protein, abundance, contrast, network, QC and structure endpoints. To point to a different dataset, set `PROTEIN_DATA_DIR`; both the repository's structured data layout and the earlier flat layout are supported. `.env.example` documents optional environment variables; it is not loaded automatically.

Use the venv Python to run `-m protein_viz.cli validate-data`, `-m pytest -q` and `-m ruff check src tests`. The imported limma table is not recomputed by the API. QC endpoints currently provide descriptive coverage, not validated quality scores or PCA.
