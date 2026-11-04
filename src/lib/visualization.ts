/** Orange / neutral / blue, with the full Pearson range preserved. */
function correlationRgb(value: number): number[] {
  if (!Number.isFinite(value)) return [226, 232, 240];
  const r = Math.max(-1, Math.min(1, value));
  const end = r < 0 ? [179, 88, 6] : [33, 102, 172];
  return end.map((channel) => Math.round(247 + (channel - 247) * Math.abs(r)));
}

export function correlationColor(value: number): string {
  return `rgb(${correlationRgb(value).join(", ")})`;
}

export function correlationTextColor(value: number): string {
  const linear = correlationRgb(value).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

export type VolcanoDatum = { log2_fc: number; adj_p: number };
export type RealResult = VolcanoDatum & { protein_id: string; gene: string | null; organism: string };
export type BrushBounds = { minFc: number; maxFc: number; minY: number; maxY: number };
export type ExploreState = {
  pCutoff: number;
  fcCutoff: number;
  brush: BrushBounds | null;
  query: string;
  passingOnly: boolean;
  sort: "adj_p" | "effect" | "gene";
  page: number;
};
export const initialExploreState: ExploreState = { pCutoff: 0.05, fcCutoff: 0.7, brush: null, query: "", passingOnly: false, sort: "adj_p", page: 0 };
export const RESULT_PAGE_SIZE = 10;

export function inVolcanoBrush(point: VolcanoDatum, bounds: BrushBounds | null): boolean {
  if (!bounds) return true;
  const y = negativeLogP(point.adj_p);
  return point.log2_fc >= bounds.minFc && point.log2_fc <= bounds.maxFc && y >= bounds.minY && y <= bounds.maxY;
}

export function filterRealResults<T extends RealResult>(points: T[], state: ExploreState): T[] {
  const query = state.query.trim().toLowerCase();
  return points.filter(p => inVolcanoBrush(p, state.brush)
    && (!state.passingOnly || passesVolcanoFilters(p, state.pCutoff, state.fcCutoff))
    && (!query || `${p.protein_id} ${p.gene ?? ""}`.toLowerCase().includes(query)))
    .sort((a, b) => (state.sort === "effect" ? Math.abs(b.log2_fc) - Math.abs(a.log2_fc)
      : state.sort === "gene" ? (a.gene || a.protein_id).localeCompare(b.gene || b.protein_id)
      : a.adj_p - b.adj_p) || a.protein_id.localeCompare(b.protein_id));
}

/** Convert a drag in SVG coordinates to data bounds, independent of screen size. */
export function brushFromPixels(start: { x: number; y: number }, end: { x: number; y: number }, axes: { left: number; right: number; top: number; bottom: number; xMax: number; yMax: number }): BrushBounds {
  const x = (v: number) => ((Math.max(axes.left, Math.min(axes.right, v)) - axes.left) / (axes.right - axes.left) * 2 - 1) * axes.xMax;
  const y = (v: number) => (axes.bottom - Math.max(axes.top, Math.min(axes.bottom, v))) / (axes.bottom - axes.top) * axes.yMax;
  return { minFc: Math.min(x(start.x), x(end.x)), maxFc: Math.max(x(start.x), x(end.x)), minY: Math.min(y(start.y), y(end.y)), maxY: Math.max(y(start.y), y(end.y)) };
}

export function negativeLogP(p: number): number {
  return -Math.log10(Math.max(p, 1e-300));
}

export function passesVolcanoFilters(p: VolcanoDatum, pCutoff: number, fcCutoff: number): boolean {
  return p.adj_p < pCutoff && Math.abs(p.log2_fc) > fcCutoff;
}

/** A small set of readable ticks, including zero and the domain endpoints. */
function axisStep(extent: number, intervals: number): number {
  const raw = extent / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}

export function volcanoAxes(points: VolcanoDatum[], pCutoff: number, fcCutoff: number) {
  let xExtent = Math.max(1, fcCutoff);
  let yExtent = Math.max(1, negativeLogP(pCutoff));
  for (const point of points) {
    xExtent = Math.max(xExtent, Math.abs(point.log2_fc));
    yExtent = Math.max(yExtent, negativeLogP(point.adj_p));
  }
  const xStep = axisStep(xExtent * 1.05, 4);
  const yStep = axisStep(yExtent * 1.05, 5);
  const xSteps = Math.ceil((xExtent * 1.05) / xStep);
  const ySteps = Math.ceil((yExtent * 1.05) / yStep);
  return {
    xMax: xSteps * xStep,
    yMax: ySteps * yStep,
    xTicks: Array.from({ length: xSteps * 2 + 1 }, (_, i) => (i - xSteps) * xStep),
    yTicks: Array.from({ length: ySteps + 1 }, (_, i) => i * yStep),
  };
}
