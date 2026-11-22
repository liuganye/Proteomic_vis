const CORRELATION_STOPS: [number, [number, number, number]][] = [
  [-1, [74, 114, 160]],    // #4a72a0 muted slate blue
  [-0.5, [143, 174, 206]], // #8faece soft mist blue
  [0, [246, 247, 248]],    // #f6f7f8 soft neutral
  [0.5, [232, 174, 158]],  // #e8ae9e muted peach-rose
  [1, [196, 92, 86]],      // #c45c56 muted terracotta red
];

/** Soft muted diverging ramp (vlag-inspired): slate blue (-1) -> soft neutral (0) -> terracotta red (+1). */
function correlationRgb(value: number): number[] {
  if (!Number.isFinite(value)) return [226, 232, 240];
  const r = Math.max(-1, Math.min(1, value));
  for (let i = 0; i < CORRELATION_STOPS.length - 1; i++) {
    const [a, colA] = CORRELATION_STOPS[i];
    const [b, colB] = CORRELATION_STOPS[i + 1];
    if (r >= a && r <= b) {
      const t = (r - a) / (b - a);
      return [
        Math.round(colA[0] + (colB[0] - colA[0]) * t),
        Math.round(colA[1] + (colB[1] - colA[1]) * t),
        Math.round(colA[2] + (colB[2] - colA[2]) * t),
      ];
    }
  }
  return CORRELATION_STOPS[CORRELATION_STOPS.length - 1][1];
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
export function brushFromPixels(start: { x: number; y: number }, end: { x: number; y: number }, axes: { left: number; right: number; top: number; bottom: number; xMin?: number; xMax: number; yMin?: number; yMax: number }): BrushBounds {
  const xMin = axes.xMin ?? -axes.xMax;
  const yMin = axes.yMin ?? 0;
  const x = (v: number) => xMin + ((Math.max(axes.left, Math.min(axes.right, v)) - axes.left) / (axes.right - axes.left)) * (axes.xMax - xMin);
  const y = (v: number) => yMin + ((axes.bottom - Math.max(axes.top, Math.min(axes.bottom, v))) / (axes.bottom - axes.top)) * (axes.yMax - yMin);
  return { minFc: Math.min(x(start.x), x(end.x)), maxFc: Math.max(x(start.x), x(end.x)), minY: Math.min(y(start.y), y(end.y)), maxY: Math.max(y(start.y), y(end.y)) };
}

export function negativeLogP(p: number): number {
  return -Math.log10(Math.max(p, 1e-300));
}

export function passesVolcanoFilters(p: VolcanoDatum, pCutoff: number, fcCutoff: number): boolean {
  return p.adj_p < pCutoff && Math.abs(p.log2_fc) > fcCutoff;
}

export type VolcanoDirection = "up" | "down" | "ns";

export const LOCAL_STRUCTURE_PROTEINS = [
  { protein_id: "O00148", gene: "DDX39A", pdb_id: "8IJU" },
  { protein_id: "O00154", gene: "ACOT7", pdb_id: "2QQ2" },
  { protein_id: "A4D126", gene: "CRPPA", pdb_id: "4CVH" },
  { protein_id: "A6NHR9", gene: "SMCHD1", pdb_id: "6MW7" },
] as const;

export const LOCAL_STRUCTURE_PDB: Record<string, string> = Object.fromEntries(
  LOCAL_STRUCTURE_PROTEINS.map(item => [item.protein_id, item.pdb_id]),
);

export function volcanoDirection(p: VolcanoDatum, pCutoff: number, fcCutoff: number): VolcanoDirection {
  if (!passesVolcanoFilters(p, pCutoff, fcCutoff)) return "ns";
  return p.log2_fc > 0 ? "up" : "down";
}

export function volcanoSummaryCounts(points: VolcanoDatum[], pCutoff: number, fcCutoff: number): { total: number; passing: number; up: number; down: number } {
  let up = 0;
  let down = 0;
  for (const point of points) {
    const dir = volcanoDirection(point, pCutoff, fcCutoff);
    if (dir === "up") up += 1;
    else if (dir === "down") down += 1;
  }
  return { total: points.length, passing: up + down, up, down };
}

export function orderVolcanoPoints<T extends VolcanoDatum & { protein_id: string }>(
  points: T[],
  pCutoff: number,
  fcCutoff: number,
  matchingIds: Set<string>,
  focusId: string,
  hasFilters = false,
  neighborIds?: Set<string>,
): T[] {
  const priority = (p: T) => {
    if (p.protein_id === focusId) return 4;
    if (hasFilters && matchingIds.has(p.protein_id)) return 3;
    if (neighborIds?.has(p.protein_id)) return 2;
    if (passesVolcanoFilters(p, pCutoff, fcCutoff)) return 1;
    return 0;
  };
  return [...points].sort((a, b) => priority(a) - priority(b));
}

export function selectVolcanoCallouts<T extends VolcanoDatum & { protein_id: string; gene: string | null }>(
  points: T[],
  options: { pCutoff: number; fcCutoff: number; matchingIds: Set<string>; hasFilters: boolean; focusId: string; maxCallouts?: number },
): T[] {
  const limit = options.maxCallouts ?? 6;
  if (limit <= 0) return [];
  const selected: T[] = [];
  const seen = new Set<string>();
  const focused = points.find(p => p.protein_id === options.focusId);
  if (focused) {
    selected.push(focused);
    seen.add(focused.protein_id);
  }
  const pool = options.hasFilters
    ? points.filter(p => options.matchingIds.has(p.protein_id) && !seen.has(p.protein_id))
    : points.filter(p => passesVolcanoFilters(p, options.pCutoff, options.fcCutoff) && !seen.has(p.protein_id));

  pool.sort((a, b) => {
    if (options.hasFilters) {
      const aPass = passesVolcanoFilters(a, options.pCutoff, options.fcCutoff) ? 0 : 1;
      const bPass = passesVolcanoFilters(b, options.pCutoff, options.fcCutoff) ? 0 : 1;
      if (aPass !== bPass) return aPass - bPass;
    }
    return (a.adj_p - b.adj_p) || (Math.abs(b.log2_fc) - Math.abs(a.log2_fc)) || a.protein_id.localeCompare(b.protein_id);
  });

  for (const item of pool) {
    if (selected.length >= limit) break;
    selected.push(item);
    seen.add(item.protein_id);
  }
  return selected;
}

/** A small set of readable ticks, including zero and the domain endpoints. */
function axisStep(extent: number, intervals: number): number {
  const raw = Math.max(extent, 1e-9) / Math.max(intervals, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}

export function rangeTicks(min: number, max: number, intervals = 4): number[] {
  const span = Math.max(max - min, 1e-6);
  const step = axisStep(span, intervals);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) {
    const clean = Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(10));
    ticks.push(clean);
  }
  if (!ticks.length) ticks.push(Number(((min + max) / 2).toPrecision(6)));
  return ticks;
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

export type StringLayoutNode = { x: number; y: number; score: number; radius: number; angle: number };
export type StringGroup = "up" | "down" | "ns" | "untested";

/** Computes a quadratic Bezier chord path and its midpoint (t = 0.5), bowing away from the center focus node. */
export function curvedChordGeometry(
  s: { x: number; y: number },
  t: { x: number; y: number },
  cx: number,
  cy: number,
): { d: string; midX: number; midY: number } {
  const mx = (s.x + t.x) / 2;
  const my = (s.y + t.y) / 2;
  const vx = mx - cx;
  const vy = my - cy;
  const centerDist = Math.hypot(vx, vy);
  const edgeLen = Math.hypot(t.x - s.x, t.y - s.y) || 1;
  let qx = cx + vx * 0.65;
  let qy = cy + vy * 0.65;
  if (centerDist < 62) {
    const nx = -(t.y - s.y) / edgeLen;
    const ny = (t.x - s.x) / edgeLen;
    const sign = nx * vx + ny * vy >= 0 ? 1 : -1;
    const push = Math.max(64, edgeLen * 0.28);
    qx = cx + nx * sign * push;
    qy = cy + ny * sign * push;
  }
  return {
    d: `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${t.x.toFixed(1)} ${t.y.toFixed(1)}`,
    midX: 0.25 * s.x + 0.5 * qx + 0.25 * t.x,
    midY: 0.25 * s.y + 0.5 * qy + 0.25 * t.y,
  };
}

export function curvedChordPath(
  s: { x: number; y: number },
  t: { x: number; y: number },
  cx: number,
  cy: number,
): string {
  return curvedChordGeometry(s, t, cx, cy).d;
}

export function layoutStringNeighborhood<N extends { protein_id: string }>(
  focusId: string,
  nodes: N[],
  edges: { source: string; target: string; score: number }[],
  options?: { groupBy?: (id: string) => StringGroup },
): Map<string, StringLayoutNode> {
  const positions = new Map<string, StringLayoutNode>();
  positions.set(focusId, { x: 500, y: 380, score: 1, radius: 0, angle: 0 });

  const neighbors = nodes.filter(node => node.protein_id !== focusId);
  if (!neighbors.length) return positions;

  const neighborIds = new Set(neighbors.map(n => n.protein_id));
  const focusScore = new Map<string, number>();
  const neighborAdj = new Map<string, Map<string, number>>();
  for (const id of neighborIds) neighborAdj.set(id, new Map());

  for (const edge of edges) {
    if (edge.source === focusId && neighborIds.has(edge.target)) {
      focusScore.set(edge.target, Math.max(focusScore.get(edge.target) ?? 0, edge.score));
    } else if (edge.target === focusId && neighborIds.has(edge.source)) {
      focusScore.set(edge.source, Math.max(focusScore.get(edge.source) ?? 0, edge.score));
    } else if (neighborIds.has(edge.source) && neighborIds.has(edge.target) && edge.source !== edge.target) {
      const aMap = neighborAdj.get(edge.source)!;
      const bMap = neighborAdj.get(edge.target)!;
      aMap.set(edge.target, Math.max(aMap.get(edge.target) ?? 0, edge.score));
      bMap.set(edge.source, Math.max(bMap.get(edge.source) ?? 0, edge.score));
    }
  }

  const scoreFor = (id: string) => focusScore.get(id) ?? 0.4;
  const orderChain = (ids: string[]): string[] => {
    if (ids.length <= 1) return [...ids];
    const remaining = new Set(ids);
    const ordered: string[] = [];
    let current = [...ids].sort((a, b) => (scoreFor(b) - scoreFor(a)) || a.localeCompare(b))[0];
    ordered.push(current);
    remaining.delete(current);
    while (remaining.size > 0) {
      const adj = neighborAdj.get(current)!;
      let nextId: string | null = null;
      let bestNeighborEdge = -1;
      for (const candidate of remaining) {
        const pairScore = adj.get(candidate) ?? 0;
        if (pairScore > bestNeighborEdge) {
          bestNeighborEdge = pairScore;
          nextId = candidate;
        } else if (pairScore === bestNeighborEdge && nextId !== null) {
          const diff = scoreFor(candidate) - scoreFor(nextId);
          if (diff > 0 || (diff === 0 && candidate.localeCompare(nextId) < 0)) {
            nextId = candidate;
          }
        }
      }
      if (bestNeighborEdge <= 0) {
        nextId = [...remaining].sort((a, b) => (scoreFor(b) - scoreFor(a)) || a.localeCompare(b))[0];
      }
      ordered.push(nextId!);
      remaining.delete(nextId!);
      current = nextId!;
    }
    return ordered;
  };

  let slotted: { id: string; slot: number }[] = [];
  let totalSlots = 1;
  if (options?.groupBy) {
    const bucketOrder: StringGroup[] = ["up", "down", "ns", "untested"];
    const buckets = new Map<StringGroup, string[]>(bucketOrder.map(g => [g, []]));
    for (const id of neighborIds) buckets.get(options.groupBy(id))!.push(id);
    const nonEmpty = bucketOrder.map(g => orderChain(buckets.get(g)!)).filter(arr => arr.length > 0);
    const gap = nonEmpty.length > 1 ? 0.5 : 0;
    let cursor = 0;
    for (const sector of nonEmpty) {
      for (const id of sector) {
        slotted.push({ id, slot: cursor });
        cursor += 1;
      }
      cursor += gap;
    }
    totalSlots = Math.max(1, cursor);
  } else {
    const ordered = orderChain([...neighborIds]);
    slotted = ordered.map((id, idx) => ({ id, slot: idx }));
    totalSlots = Math.max(1, ordered.length);
  }

  const count = slotted.length;
  const startAngle = -Math.PI / 2 + Math.PI / Math.max(count, 5);
  slotted.forEach(({ id, slot }, index) => {
    const score = scoreFor(id);
    const clampedScore = Math.max(0.15, Math.min(1, score));
    const baseRadius = 125 + (1 - clampedScore) * 265;
    const stagger = count > 10 ? (index % 2 === 0 ? -12 : 12) : 0;
    const radius = Math.max(112, Math.min(330, baseRadius + stagger));
    const angle = startAngle + (2 * Math.PI * slot) / totalSlots;
    positions.set(id, {
      x: 500 + radius * Math.cos(angle),
      y: 380 + radius * Math.sin(angle),
      score,
      radius,
      angle,
    });
  });

  return positions;
}

export type RingSpec = { r: number; label: string };
export type RingBoxObstacle = { x: number; y: number; halfW: number; halfH: number };

function boxClearance(
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  obstacles: RingBoxObstacle[],
): number {
  let minDist = Infinity;
  for (const box of obstacles) {
    const dx = Math.max(0, Math.abs(x - box.x) - (halfW + box.halfW));
    const dy = Math.max(0, Math.abs(y - box.y) - (halfH + box.halfH));
    const d = dx === 0 && dy === 0
      ? -Math.min(halfW + box.halfW - Math.abs(x - box.x), halfH + box.halfH - Math.abs(y - box.y))
      : Math.hypot(dx, dy);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** Picks collision-free (x, y) coordinates for STRING score ring labels, avoiding nodes, labels, spokes, legend, and viewport edges. */
export function pickRingLabelPositions(
  rings: RingSpec[],
  cx: number,
  cy: number,
  options: {
    obstacles: RingBoxObstacle[];
    spokes: { x: number; y: number }[];
    bounds: { width: number; height: number };
    labelScale?: number;
  },
): { r: number; label: string; x: number; y: number; angle: number }[] {
  if (!rings.length) return [];
  const scale = options.labelScale ?? 1;
  const halfW = 32 * scale;
  const halfH = 9.5 * scale;
  const { width, height } = options.bounds;
  const margin = 10;

  const preferred = [
    Math.PI * 0.25,
    -Math.PI * 0.25,
    Math.PI * 0.75,
    Math.PI * 0.5,
    -Math.PI * 0.5,
    0,
    Math.PI,
    -Math.PI * 0.75,
  ];
  const sweep: number[] = [...preferred];
  for (let i = 0; i < 36; i += 1) {
    const a = -Math.PI + (2 * Math.PI * i) / 36;
    if (!preferred.some(p => Math.abs(Math.atan2(Math.sin(a - p), Math.cos(a - p))) < 0.08)) {
      sweep.push(a);
    }
  }

  const scoreCandidate = (r: number, angle: number, extraBoxes: RingBoxObstacle[]) => {
    const anchorR = r + 10 * scale;
    const x = cx + anchorR * Math.cos(angle);
    const y = cy + anchorR * Math.sin(angle);
    const edgeClear = Math.min(
      x - halfW - margin,
      width - margin - (x + halfW),
      y - halfH - margin,
      height - margin - (y + halfH),
    );
    const obsClear = boxClearance(x, y, halfW, halfH, [...options.obstacles, ...extraBoxes]);
    let spokeClear = Infinity;
    for (const s of options.spokes) {
      const sd = pointToSegmentDist(x, y, cx, cy, s.x, s.y) - halfH;
      if (sd < spokeClear) spokeClear = sd;
    }
    const hardClear = Math.min(edgeClear, obsClear);
    const combined = hardClear < 4 ? hardClear - 100 : Math.min(hardClear, spokeClear);
    return { x, y, angle, combined };
  };

  for (const angle of sweep) {
    const placed: { r: number; label: string; x: number; y: number; angle: number }[] = [];
    const boxes: RingBoxObstacle[] = [];
    let minCombined = Infinity;
    for (const ring of rings) {
      const c = scoreCandidate(ring.r, angle, boxes);
      if (c.combined < minCombined) minCombined = c.combined;
      placed.push({ ...ring, x: c.x, y: c.y, angle: c.angle });
      boxes.push({ x: c.x, y: c.y, halfW, halfH });
    }
    if (minCombined >= 8) return placed;
  }

  const chosen: { r: number; label: string; x: number; y: number; angle: number }[] = [];
  const chosenBoxes: RingBoxObstacle[] = [];
  for (const ring of rings) {
    let best = scoreCandidate(ring.r, Math.PI * 0.25, chosenBoxes);
    for (const angle of sweep) {
      const cand = scoreCandidate(ring.r, angle, chosenBoxes);
      if (cand.combined > best.combined) best = cand;
    }
    chosen.push({ ...ring, x: best.x, y: best.y, angle: best.angle });
    chosenBoxes.push({ x: best.x, y: best.y, halfW, halfH });
  }
  return chosen;
}

const SIGNIFICANCE_LADDER = [1e-10, 1e-8, 1e-6, 1e-5, 1e-4, 0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];

/** Steps adj.p cutoff smoothly along a statistical significance ladder without getting stuck at 1. */
export function stepSignificanceCutoff(current: number, direction: -1 | 1): number {
  const eps = 1e-12;
  if (direction > 0) {
    for (const candidate of SIGNIFICANCE_LADDER) {
      if (candidate > current + Math.max(eps, current * 1e-6)) return candidate;
    }
    return 1;
  }
  for (let i = SIGNIFICANCE_LADDER.length - 1; i >= 0; i -= 1) {
    const candidate = SIGNIFICANCE_LADDER[i];
    if (candidate < current - Math.max(eps, current * 1e-6)) return candidate;
  }
  return Math.max(1e-300, Number((current * 0.1).toExponential(1)));
}

/** Steps |log2FC| cutoff cleanly in 0.1 increments with floating-point rounding. */
export function stepFoldChangeCutoff(current: number, direction: -1 | 1): number {
  return Math.max(0, Math.round((current + direction * 0.1) * 100) / 100);
}
