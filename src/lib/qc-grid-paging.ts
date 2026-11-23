import type { QcPlotId } from "@/lib/types";

/** Fixed window size for the QC 2×2 panel (never cram more than four cells). */
export const QC_PAGE_SIZE = 4;
/** Conventional cells before the custom-builder (missingness…group-summary). */
export const BUILTIN_CELL_COUNT = 6;

/**
 * Flat index in the paged QC cell list.
 * Order: 6 conventional → custom builder → user plots → empty slots.
 */
export function plotCellIndex(
  plotId: QcPlotId,
  userPlotIds: string[],
): number {
  const conventional: Record<string, number> = {
    missingness: 0,
    intensity: 1,
    correlation: 3,
    "median-vs-missing": 4,
  };
  if (plotId in conventional) return conventional[plotId];
  if (plotId.startsWith("user-")) {
    const userIndex = userPlotIds.indexOf(plotId);
    if (userIndex < 0) return -1;
    return BUILTIN_CELL_COUNT + 1 + userIndex;
  }
  return -1;
}

export function plotPageIndexFor(
  plotId: QcPlotId,
  userPlotIds: string[],
): number {
  const index = plotCellIndex(plotId, userPlotIds);
  if (index < 0) return 0;
  return Math.floor(index / QC_PAGE_SIZE);
}

/**
 * Pad with empty custom-plot slots only when they fill the remainder of the
 * last page — never create a new page that is only placeholders.
 */
export function emptySlotCountForPage(
  realCellCount: number,
  userPlotCount: number,
  pageSize = QC_PAGE_SIZE,
  maxEmptyDesired = Math.max(0, 2 - userPlotCount),
): number {
  if (realCellCount <= 0 || maxEmptyDesired <= 0) return 0;
  const remainder = realCellCount % pageSize;
  if (remainder === 0) return 0;
  return Math.min(maxEmptyDesired, pageSize - remainder);
}
