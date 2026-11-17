# Proteomics Viz

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Support a traceable workflow from sample QC to candidate protein selection and evidence inspection. The project is a COMP6411 visualization prototype; it displays imported quantitative results rather than running a new statistical analysis.

## Users

The intended research audience examines proteomics results and candidate evidence. This audience is a project hypothesis, not a claim of completed user research. The student team also uses the app for design discussions and demonstrations.

## Operating Context

The existing application runs locally with a Next.js/React/TypeScript frontend and Python/FastAPI backend. The repository packages a real dataset snapshot and an independent synthetic demonstration dataset.

## Capabilities and Constraints

- Real dataset: 9,369 protein records, 45 samples, 4,375 imported Human − QC differential results. Sample group interpretation and upstream statistical provenance remain under review.
- QC, candidate results, and protein evidence share sample selection and protein focus; filtering and selection do not recompute statistics.
- Mock has 120 proteins and 7 samples, labelled Group A/B in the current local changes. Mock/upload evidence must not be presented as the real snapshot's evidence.
- The user requests two primary pages: QC first, followed by a downstream workspace with a left-hand module toolbox.
- On 2026-11-12 the user selected a snapping grid with movable, resizable modules and no overlaps, rather than an overlapping infinite canvas.
- The confirmed first layout iteration includes volcano, results, sample abundance, protein details, STRING, structure and GO enrichment. Individual plot redesign remains deferred. GO currently provides a pending-analysis panel and shared candidate count, not computed enrichment results.
- Existing local branches/worktrees differ; implementation must preserve uncommitted mock naming and documentation changes and reconcile the intended baseline explicitly.

## Evidence on Hand

README.md, WEB_GUIDE.zh-CN.md, MEETING_QA.zh-CN.md, the data/ snapshot, frontend calculation tests, existing interactive view components, and reports/figures/plot_manifest.csv. Archived figures are not automatically interactive modules.

## Product Principles

- Preserve data identity and shared analytical context across views.
- Distinguish layout operations from filters, sample selection, and statistical computation.
- Make missing, untested, filtered-out, unavailable, and request-error states explicit.
- Establish the workspace and selected task modules before revising their visual encodings.
- Support adding and moving modules without requiring pointer dragging alone.
