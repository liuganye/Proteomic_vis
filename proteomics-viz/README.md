# Proteomics Viz

Browser app for **QC** and **Downstream** analysis of FragPipe protein outputs. UX mirrors the section/module flow of [FragPipe Analyst](https://github.com/Nesvilab/FragPipe-Analyst) (sidebar + modules + plots/tables), reimplemented in JavaScript — not a fork of the Shiny source.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Papa Parse (TSV) · Recharts (plots)

## Install & run

```bash
cd proteomics-viz
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

Production build:

```bash
npm run build && npm start
```

## Data

| Input | Role |
| --- | --- |
| `combined_protein.tsv` | MaxLFQ intensities (`{sample} MaxLFQ Intensity`), optional `Log2 Fold Change` / `Adjusted P-value` |
| `experiment_annotation.tsv` | `sample`, `condition` (e.g. Human / QC), optional `replicate` / `file` |

**In-app mock data** ships under `public/mock-data/` (120 proteins × 7 samples with Human vs QC stats) so the app runs without a full omics disk.

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

- Client-side only; large HYE tables (~9k × hundreds of columns) may be slow in-browser.
- Approximation mode is not a substitute for FragPipe Analyst / limma DE.
- Structure (PDB), sequence, PPI, and spatial modules from Plan G are out of scope for this slice.
