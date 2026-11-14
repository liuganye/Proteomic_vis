# Proteomics Viz

Browser app for **QC** and **Downstream** analysis of FragPipe protein outputs. UX mirrors the section/module flow of [FragPipe Analyst](https://github.com/Nesvilab/FragPipe-Analyst) (sidebar + modules + plots/tables), reimplemented in JavaScript — not a fork of the Shiny source.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Papa Parse (TSV) · Recharts (plots)

## Install & run

```bash
npm install
npm run dev
```

Open [http://localhost:43147](http://localhost:43147).

Production build:

```bash
npm run build && npm start
```

## Data

| Input | Role |
| --- | --- |
| `combined_protein.tsv` | MaxLFQ intensities (`{sample} MaxLFQ Intensity`), optional `Log2 Fold Change` / `Adjusted P-value` |
| `experiment_annotation.tsv` | `sample`, `condition` (e.g. Human / QC), optional `replicate` / `file` |

**In-app mock data** ships under `public/mock-data/` (120 proteins × 7 samples with synthetic Group A vs Group B stats) so the app runs without a full omics disk. Group A contains A_1–A_4 and Group B contains B_1–B_3. This is synthetic demo data, not a subset of the real HYE dataset; protein labels, intensities and statistical values must not be interpreted as experimental evidence. QC means quality control across all seven samples, not a sample group. The bundled JSON and public TSV copies use the same names.

**Optional omics path** (when on the omics host):

```
/data/ganye/Protein_visualization/combined_protein.tsv
/data/ganye/Protein_visualization/experiment_annotation.tsv
```

Upload those files via the Data input panel (the browser cannot read host paths directly).

## First slice — modules

### QC

**Summary first:** a clickable conclusions panel sits above the plots. Each conclusion jumps/scrolls to the graph that illustrates it (highlight ring on focus).

#### Conventional plots (FragPipe Analyst–style)

1. **Missingness** — % proteins with MaxLFQ = 0 per sample (colored by condition)
2. **Intensity** — log₁₀ MaxLFQ histogram + per-sample quartile table
3. **Correlation** — pairwise Pearson matrix on log₁₀ MaxLFQ (sample similarity overview)

#### Custom plots

1. **Median vs missingness** — scatter of median log₁₀ MaxLFQ vs % missing per sample (flags high-missing / low-median outliers)

### Downstream

1. **Volcano** — Human vs QC when contrast columns or annotation conditions are present; adjustable |log2FC| and adj.P thresholds
2. **Results table** — ranked by adjusted p-value, filterable, paginated

If adjusted p-value columns are missing but Human/QC annotation exists, Downstream can show an **approximate** MaxLFQ-mean volcano (demo only — not limma).

## Empty / loading / error

The Data input panel covers idle, loading, parse errors, and a ready summary (protein/sample/contrast counts). Analysis modules show an empty prompt until a dataset is loaded.

## Caveats

- Upload/mock QC is client-side with array-mode TSV parse, chunked progress, and a shared `computeQcBundle` pass; very large tables can still be heavy. Use `npm run dev` (webpack) — Turbopack HMR can leave the UI unhydrated (`npm run dev:turbo` optional). Real-data Explore uses the backend.
- Approximation mode is not a substitute for FragPipe Analyst / limma DE.
- The original prototype does not contain structure, sequence, or network modules; these are available in the separate Real data explore view described below.

## Real-data end-to-end demo

Start the backend using the repository data; see the [project setup guide](../README.md).

In a second terminal, run `npm ci` and `npm run dev` from the repository root and open http://localhost:43147. Select **Real data explore**. It starts with O00148 (DDX39A), whose local structure is PDB 8IJU. Search for another protein or select a volcano point; selecting a node in the STRING network changes the same focus. Adjust the minimum confidence to filter edges and use the zoom controls to inspect the network. Neighbor-to-neighbor edges can be shown using the graph checkbox; it shows up to 29 neighbors and reports truncation. Nodes also support Enter and Space; the expandable neighbor list provides an alternative way to select them. The panel shows the existing Human − QC limma results, observed sample abundances, the local STRING neighborhood, sequence and available structure. Drag the structure to rotate; the canvas is a simplified Cα trace, not a full molecular viewer.

The frontend calls `http://127.0.0.1:8000` by default. Set `NEXT_PUBLIC_PROTEIN_API` before starting Next.js if the API uses another origin. Configure `PROTEIN_CORS_ORIGINS` on the backend if the frontend uses a different origin. Backend startup reads the dataset before becoming ready. This is a focused integration slice: QC remains the separate upload/mock prototype, and the volcano does not yet support box selection or raw-p mode.
