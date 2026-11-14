# Proteomics Visualization — v0.1

A local, read-only demonstration for exploring a fixed proteomics dataset. Search or select a protein to connect Human − QC differential results, observed abundance, STRING associations, annotations, and available local structures.

[中文说明：数据来源、网页功能与使用边界](./WEB_GUIDE.zh-CN.md)

[教师讨论与项目答疑手册：开场稿、设计依据、演示与常见问题](./MEETING_QA.zh-CN.md)

[下游网格工作区：操作、模块清单与验证记录](./WORKSPACE_DESIGN.zh-CN.md)

The real-data interface has two pages: **QC** and **Downstream workspace**. Drag modules from the left library, move their title bars, and resize their bottom-right corners. Cards snap to a 12-column grid without overlapping. Click **Add** or use each card's **Layout** menu as alternatives. Layouts are saved in this browser; **Undo layout**, **Reset layout**, and **Lock layout** are available. Narrow screens stack cards while preserving desktop positions. Layout saving does not save the analysis session.

Seven modules are available: volcano, results, sample abundance, protein details, STRING network, structure, and GO enrichment. **GO is currently a movable placeholder with a linked candidate count; annotations and enrichment computation are not connected and no GO result is claimed.** Mock/upload results remain separate from the real-data workspace.

## Contents

- Next.js frontend at repo root (`package.json`, `src/`, `public/`); includes real-data QC and RealExplore, plus separate upload/mock QC.
- `supplementary_files/`: Plan G notebook, CSVs/TSVs, and plots.
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
npm ci
npm run dev
```

Open <http://localhost:43147>. Windows was used for the validation described below; the macOS/Linux commands have not been independently tested.

## Demo walkthrough

The top **Focused protein** selector opens a searchable dropdown with **Current candidates** and **All proteins** scopes. Candidates follow the results table filters and sort; the full dataset is fetched 20 choices at a time. Each choice shows its gene, protein ID and organism, and the current focus is marked **Selected**. Searching this dropdown does not change the result filters.

1. QC automatically loads the backend HYE dataset. Select a bar, scatter point, or intensity-summary sample; a correlation cell selects both samples. Open **Real data explore** to see their abundance values or missing status. Selecting an abundance point updates the QC selection too. The initial protein is O00148 / DDX39A; its locally packaged structure is 8IJU.
2. Use **Box select** to drag a candidate region in the volcano. The real results table shows the intersection of that region, its search, and optional threshold filter. It supports sorting and pagination. For a reproducible single candidate, enter log₂FC bounds −3 to −1 and −log₁₀ adjusted p bounds 7 to 10 under **Set selection bounds with keyboard**: this selects `P32610 / VMA8`. Inspect its table row to update all protein evidence panels. **Inspect points** enables individual point selection.
   Inside **Focused protein**, use **Switch focused protein** to search all real proteins without changing candidate filters. **Previous candidate / Next candidate** follow the current table order across pages and show **Candidate X / N**. A protein outside the filters is labelled **Outside candidate set**; **Start with first candidate** resumes the filtered list. Gene names can match multiple species, so check the protein ID and organism before selecting.
3. Select a STRING network node to focus it; adjust the minimum confidence, zoom, or reveal neighbor-to-neighbor associations. A notice appears if the 29-neighbor display limit truncates results. The neighbor list is also keyboard accessible.
4. Drag the local structure's Cα trace to rotate; use zoom and reset controls. Referenced structures without local coordinates are labelled separately.
5. QC, Explore and real-data Downstream retain samples, the focused protein and candidate filters while switching views. **Clear box selection** keeps search and threshold filtering; **Clear table filters** restores all tested results. **Clear sample selection** removes sample highlights. Refreshing or replacing the dataset resets selections. QC still summarizes all proteins; sample selection never recomputes the contrast. Mock or uploaded data remains separate.

## Verification

From `backend/`, use the venv Python to run `python -m protein_viz.cli validate-data`, `python -m pytest -q` and `python -m ruff check src tests` (on Windows, replace `python` with `.\.venv\Scripts\python.exe`; on macOS/Linux use `.venv/bin/python`). From the repository root, run `npm test` for visualization calculations and real snapshot regression checks, then `npm run build` for production compilation and TypeScript. The [Chinese guide](./WEB_GUIDE.zh-CN.md#8-回归检查与完整演示路线) records the browser walkthrough and expected evidence values.

The data check should report 9,369 proteins, 45 samples, 4,375 differential results, and four locally available structures. At adjusted p < 0.05 and |log2FC| > 0.7, the imported Human − QC result has 33 significant proteins. These are checks of the included snapshot, not a reanalysis.

The backend defaults to the repository's `data/` directory. To use another dataset set `PROTEIN_DATA_DIR` to a data root with `raw/`, `processed/`, and `external/pdb_files/`, or to a flat directory containing the required files and `pdb_files/`. CORS defaults include localhost ports 43147 and 5173; override with comma-separated `PROTEIN_CORS_ORIGINS` if needed. The frontend API origin defaults to `http://127.0.0.1:8000`; set `NEXT_PUBLIC_PROTEIN_API` before building or starting the frontend if different.

## Scope and limitations

- Human − QC statistics are imported from an existing limma table; the original calculation has not been independently reproduced. Threshold changes filter existing values and do not recalculate BH adjustment.
- Sample group labels are inferred from names and remain unreviewed; replicate types are unknown. Zero/blank intensity is treated as missing, with no imputation in the abundance view.
- STRING data is an incomplete, chunked functional-association export; confidence is not binding strength. Species are retained. The structure view is a simplified Cα trace, not a full molecular viewer.
- QC uses descriptive plots for the real dataset; inferred groups need review, and differences across groups are not automatic quality verdicts. The separate upload/mock prototype is not connected to Explore. Raw-p mode, candidate export, persistent analysis sessions and independently validated statistical reanalysis remain future work.
- This is a local research demo; review security and data permissions before exposing it publicly.
- Confirm the right to redistribute the included input, derived data and third-party structure files before publishing the repository or sharing it beyond the team. No data license is asserted here.
