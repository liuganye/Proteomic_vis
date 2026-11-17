---
name: Proteomics Viz
description: QC and linked proteomics evidence in an adjustable analysis workspace.
colors:
  background: "#f8fafc"
  foreground: "#0f172a"
  accent: "#0f766e"
  accent-muted: "#ecfdf5"
  app-background: "#f5f7f8"
  surface: "#ffffff"
  surface-border: "#dbe3e7"
  control-border: "#cbd5df"
  muted-text: "#52616b"
  action: "#115e59"
  selected: "#e5f2ee"
  grid-background: "#eef2f3"
  panel-header: "#f7faf9"
  pending-background: "#fffbeb"
  pending-text: "#854d0e"
typography:
  headline:
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontSize: "16px"
    fontWeight: 650
  body:
    fontSize: "14px"
    lineHeight: 1.6
  panel-label:
    fontSize: "13px"
    fontWeight: 650
  helper:
    fontSize: "12px"
    lineHeight: 1.65
rounded:
  compact: "4px"
  control: "5px"
  module: "6px"
  panel: "12px"
spacing:
  compact: "6px"
  small: "12px"
  medium: "16px"
  large: "24px"
  page: "28px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    rounded: "{rounded.module}"
    padding: "10px 12px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  button-secondary-hover:
    backgroundColor: "{colors.selected}"
  module-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.module}"
    padding: "12px 10px"
  workspace-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  pending-status:
    backgroundColor: "{colors.pending-background}"
    textColor: "{colors.pending-text}"
    rounded: "{rounded.compact}"
    padding: "4px 8px"
---

# Design System: Proteomics Viz

## Overview

This records the implemented slate and teal application, not a newly approved aesthetic direction. The interface supports operating on data: begin with sample QC, then arrange candidate and protein evidence views around a research question. White surfaces, restrained borders and compact controls keep the analytical content central.

**Key Characteristics:**
- Shared sample selection, candidate filters and focused protein across views.
- Adjustable, non-overlapping analysis panels with visible alternatives to dragging.
- Explicit data identity, unavailable evidence and pending analysis states.

Source of truth: `src/app/globals.css`, `src/components/AppShell.tsx`, `src/components/AnalysisWorkspace.tsx`, `src/components/RealExplore.tsx`, and `src/lib/workspace-layout.ts`. This document captures the shell and workspace extension; individual plot encodings retain their existing behavior.

## Colors

Teal marks actions, current navigation, focus and layout feedback; slate neutrals carry the page, text and boundaries. The frontmatter preserves the existing CSS primitives and recurring shell colors.

### Primary
- **Accent teal:** focus outlines, caret and drag feedback.
- **Action teal:** primary navigation actions and current-page text.
- **Selected tint:** active navigation and secondary-control hover.

### Neutral
- **App background / surface:** quiet page canvas and white analytical surfaces.
- **Surface border / control border:** navigation boundaries, panels and compact controls.
- **Foreground / muted text:** primary information and supporting explanations.
- **Grid background / panel header:** distinguish placement space from each panel's controls.

Pending GO status uses amber text and a pale amber surface with an explicit label. Color alone must not imply computed results or evidence availability. Existing plot colors retain their analytical meanings.

## Typography

The interface uses the incumbent sans-serif treatment. Global CSS declares `var(--font-sans), "IBM Plex Sans", system-ui, sans-serif`, but the inspected root layout does not provision that variable or load a font; do not claim a guaranteed IBM Plex rendering. Tailwind's base sans-serif stack supplies the fallback when the declaration is unresolved. The legacy serif utility names Libre Bodoni/Georgia, while workspace panel content explicitly inherits the surrounding sans-serif family. Sequence text uses a monospace treatment.

Page headings use the headline role and reduce to 22px on the mobile shell. Section titles are 16px; panel handles are 13px; controls and supporting text are typically 11–14px. Page introductions have a 75-character maximum measure. Dataset counts use tabular numerals.

## Layout

QC is the initial page. Its desktop navigation occupies 224px beside the main content, inside an 1800px maximum shell. The downstream page has a 2000px maximum width, with a 218px sticky module library and a flexible main column separated by 24px. Shared sample and protein context precedes workspace controls and the panel grid.

The library contains seven modules, grouped into Candidates, Protein evidence and Functional analysis: volcano, results, sample abundance, protein details, STRING network, protein structure and GO enrichment. The default layout places volcano and results side by side at six columns each, with full-width abundance underneath.

The workspace uses 12 columns, 64px rows and 12px gaps. Movement and resizing snap to this geometry; collisions push other panels downward. Module-specific minimum dimensions preserve usable content. Panels scroll internally on the desktop grid.

At a viewport width of 1000px or less, the library narrows to 180px and page padding becomes 20px. At 760px or less, the shell stacks, navigation wraps, page padding becomes 16px and the module library becomes an inline collapsible section with two-column module groups. Separately, a measured grid width below 720px switches panels to a vertical stack in visual grid order, disables geometry editing and preserves desktop positions. Narrow panels expand with their content.

## Elevation & Depth

Resting surfaces rely on borders and tonal differences. A moving or resizing panel receives a teal boundary and a single elevated shadow (`0 8px 28px rgb(15 23 42 / 15%)`). The dotted grid and dashed drop preview communicate placement. There is no decorative elevation system or animated layout transition in this implementation.

## Shapes

Panels and shared context use rounded 12px corners. Library cards and primary navigation actions use 6px corners, compact workspace buttons use 5px, and small badges/selects use 4px. Thin borders define controls. Panel header and body corners follow the outer panel, with a dedicated resize control in the bottom-right corner.

## Components

- **Page navigation:** QC and Downstream workspace remain visible together. Current-page styling uses a selected tint and teal text; dataset identity and counts remain in the top bar.
- **Module library:** each item shows a title, short purpose and Add/Added state. Add is keyboard-operable; pointer dragging can place an unadded module at a grid location. Added items are disabled, preventing duplicate panels.
- **Shared context:** one sample selection summary and protein picker above the workspace coordinate the panels. Return to QC and Clear sample selection act on analysis context, separately from layout controls.
- **Panel frame:** drag the title to move and the corner to resize. Arrow keys on the title move one step; Shift + arrow keys resize. The Layout menu offers directional buttons and width/height selects. Escape cancels a live gesture or closes the menu. Focus uses a 2px teal outline with a 3px offset.
- **Layout controls:** Lock, Undo, Reset and Clear affect panel arrangement only. Undo retains up to 20 prior layouts during the visit. Browser storage saves module IDs and geometry under `proteomics.workspace.real.layout.v1`; it does not save analytical state. Invalid saved geometry falls back to the default, and unavailable storage is communicated. Reset or removal does not change filters or selections.
- **Pending GO panel:** the amber “Analysis not connected” badge, shared candidate count and explanation remain visible. GO annotations, ID mapping and enrichment computation are not connected; the panel contains no enrichment statistics. It follows the candidate set, not only the focused protein.
- **Evidence states:** loading, request failure, absent local coordinates and proteins outside imported contrast results remain distinct. Synthetic and uploaded results are presented separately from the real evidence workspace.

## Do's and Don'ts

- **Do** preserve the incumbent slate/teal shell and the analytical meaning of existing plots.
- **Do** provide Add, keyboard and Layout-menu paths alongside pointer gestures.
- **Do** keep layout persistence separate from sample selection, candidate filtering and protein focus.
- **Do** show data source, pending analysis and missing evidence in text.
- **Don't** present imported statistics as newly recomputed after a filter or layout change.
- **Don't** present the GO placeholder as completed enrichment or mix synthetic/uploaded evidence into the real snapshot.
- **Don't** introduce overlapping panels or discard desktop geometry when the narrow layout stacks.
