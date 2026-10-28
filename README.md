# Proteomics Visualization — v0.1

A local, read-only demonstration for exploring a fixed proteomics dataset. Search or select a protein to connect Human − QC differential results, observed abundance, STRING associations, annotations, and available local structures.

## Contents

- `proteomics-viz/`: Next.js frontend; includes the real-data Explore view and the earlier upload/mock QC prototype.
- `backend/`: FastAPI service, tests, and OpenAPI contract.
- `data/raw/`: original protein table and sample annotation.
- `data/processed/`: existing abundance, differential results, sequence, location, network and structure indexes.
- `data/external/pdb_files/`: four local PDB examples. `analysis/` and `reports/` contain earlier research material.

## Requirements

Python 3.11+ and Node.js 20.9+ with npm. Commands below start from the repository root. The demo reads the data already in this repository and uses localhost; no database is required. First-time dependency installation needs internet access.

### Windows PowerShell

Open two terminals. In the first:

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -c requirements.lock -e ".[dev]"
.\.venv\Scripts\python.exe -m uvicorn protein_viz.main:app --host 127.0.0.1 --port 8000
```

In the second, from the repository root:

```powershell
cd proteomics-viz
npm ci
npm run dev
```

Open <http://localhost:43147>. The API documentation is at <http://127.0.0.1:8000/docs>. Stop each server with Ctrl+C. If `py` is unavailable, substitute the Python 3.11+ executable installed on your machine.

### macOS / Linux

First terminal:

```sh
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -c requirements.lock -e '.[dev]'
.venv/bin/python -m uvicorn protein_viz.main:app --host 127.0.0.1 --port 8000
```

Second terminal, from the repository root:

```sh
cd proteomics-viz
npm ci
npm run dev
```

Open <http://localhost:43147>. Windows was used for the validation described below; the macOS/Linux commands have not been independently tested.

## Demo walkthrough

1. Open **Real data explore**. The initial protein is O00148 / DDX39A; its locally packaged structure is 8IJU.
2. Search `P32610` or select a volcano point. The detail and observed sample abundance panels follow the focused Protein ID.
3. Select a STRING network node to focus it; adjust the minimum confidence, zoom, or reveal neighbor-to-neighbor associations. A notice appears if the 29-neighbor display limit truncates results. The neighbor list is also keyboard accessible.
4. Drag the local structure's Cα trace to rotate; use zoom and reset controls. Referenced structures without local coordinates are labelled separately.

## Verification

From `backend/`, use the venv Python to run `python -m protein_viz.cli validate-data`, `python -m pytest -q` and `python -m ruff check src tests` (on Windows, replace `python` with `.\.venv\Scripts\python.exe`; on macOS/Linux use `.venv/bin/python`). From `proteomics-viz/`, run `npm run build`.

The data check should report 9,369 proteins, 45 samples, 4,375 differential results, and four locally available structures. At adjusted p < 0.05 and |log2FC| > 0.7, the imported Human − QC result has 33 significant proteins. These are checks of the included snapshot, not a reanalysis.

The backend defaults to the repository's `data/` directory. To use another dataset set `PROTEIN_DATA_DIR` to a data root with `raw/`, `processed/`, and `external/pdb_files/`, or to a flat directory containing the required files and `pdb_files/`. CORS defaults include localhost ports 43147 and 5173; override with comma-separated `PROTEIN_CORS_ORIGINS` if needed. The frontend API origin defaults to `http://127.0.0.1:8000`; set `NEXT_PUBLIC_PROTEIN_API` before building or starting the frontend if different.

## Scope and limitations

- Human − QC statistics are imported from an existing limma table; the original calculation has not been independently reproduced. Threshold changes filter existing values and do not recalculate BH adjustment.
- Sample group labels are inferred from names and remain unreviewed; replicate types are unknown. Zero/blank intensity is treated as missing, with no imputation in the abundance view.
- STRING data is an incomplete, chunked functional-association export; confidence is not binding strength. Species are retained. The structure view is a simplified Cα trace, not a full molecular viewer.
- The original QC/upload prototype remains separate from Explore. Volcano box selection, raw-p mode and a validated full P0 workflow remain future work.
- This is a local research demo; review security and data permissions before exposing it publicly.
- Confirm the right to redistribute the included input, derived data and third-party structure files before publishing the repository or sharing it beyond the team. No data license is asserted here.
