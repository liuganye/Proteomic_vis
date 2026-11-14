/** Layout is independent of analytical state: changing a panel never changes a filter. */
export const GRID_COLUMNS = 12;
export const GRID_ROW = 64;
export const GRID_GAP = 12;
export const WORKSPACE_MODULES = [
  { id: "volcano", title: "Volcano plot", description: "Select candidate proteins", group: "Candidates", w: 6, h: 9, minW: 4, minH: 6 },
  { id: "results", title: "Results table", description: "Search and inspect candidates", group: "Candidates", w: 6, h: 9, minW: 4, minH: 6 },
  { id: "abundance", title: "Sample abundance", description: "Check the focused protein", group: "Protein evidence", w: 12, h: 6, minW: 4, minH: 5 },
  { id: "details", title: "Protein details", description: "Identity, annotation and sequence", group: "Protein evidence", w: 6, h: 7, minW: 4, minH: 4 },
  { id: "network", title: "STRING network", description: "Explore functional associations", group: "Protein evidence", w: 6, h: 10, minW: 4, minH: 6 },
  { id: "structure", title: "Protein structure", description: "Inspect available local coordinates", group: "Protein evidence", w: 6, h: 8, minW: 4, minH: 5 },
  { id: "go", title: "GO enrichment", description: "Functional themes · not connected", group: "Functional analysis", w: 6, h: 6, minW: 4, minH: 4 },
] as const;
export type WorkspaceModuleId = typeof WORKSPACE_MODULES[number]["id"];
export type PanelLayout = { id: WorkspaceModuleId; x: number; y: number; w: number; h: number };
export const DEFAULT_LAYOUT: PanelLayout[] = [
  { id: "volcano", x: 0, y: 0, w: 6, h: 9 },
  { id: "results", x: 6, y: 0, w: 6, h: 9 },
  { id: "abundance", x: 0, y: 9, w: 12, h: 6 },
];
export const isModuleId = (id: unknown): id is WorkspaceModuleId => WORKSPACE_MODULES.some(m => m.id === id);
export const panelDefinition = (id: WorkspaceModuleId) => WORKSPACE_MODULES.find(m => m.id === id)!;
export function overlaps(a: PanelLayout, b: PanelLayout) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
export function clampPanel(panel: PanelLayout): PanelLayout {
  const def = panelDefinition(panel.id);
  const w = Math.max(def.minW, Math.min(GRID_COLUMNS, Math.round(panel.w)));
  const h = Math.max(def.minH, Math.min(20, Math.round(panel.h)));
  return { id: panel.id, w, h, x: Math.max(0, Math.min(GRID_COLUMNS - w, Math.round(panel.x))), y: Math.max(0, Math.round(panel.y)) };
}
/** The edited panel keeps its requested position; collisions flow down, never overlap. */
export function placePanel(layout: PanelLayout[], requested: PanelLayout): PanelLayout[] {
  const active = clampPanel(requested);
  const placed: PanelLayout[] = [active];
  for (const item of layout.filter(p => p.id !== active.id).sort((a,b) => a.y - b.y || a.x - b.x)) {
    const next = { ...item };
    let collisions = placed.filter(p => overlaps(next, p));
    while (collisions.length) {
      next.y = Math.max(...collisions.map(p => p.y + p.h));
      collisions = placed.filter(p => overlaps(next, p));
    }
    placed.push(next);
  }
  // Stable render order preserves focus and chart interaction state during dragging.
  const order = layout.some(p => p.id === active.id) ? layout.map(p => p.id) : [...layout.map(p => p.id), active.id];
  return order.map(id => placed.find(p => p.id === id)!);
}
export function addPanel(layout: PanelLayout[], id: WorkspaceModuleId, at?: {x: number; y: number}): PanelLayout[] {
  if (layout.some(p => p.id === id)) return layout;
  const def = panelDefinition(id);
  const next: PanelLayout = { id, w: def.w, h: def.h, x: 0, y: 0 };
  if (at) return placePanel(layout, { ...next, ...at });
  const bottom = Math.max(0, ...layout.map(p => p.y + p.h));
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x <= GRID_COLUMNS - next.w; x++) {
      const candidate = { ...next, x, y };
      if (!layout.some(p => overlaps(candidate, p))) return [...layout, candidate];
    }
  }
  return [...layout, { ...next, y: bottom }];
}
/** Reject corrupt/obsolete storage rather than silently misrepresenting its layout. */
export function readLayout(raw: string): PanelLayout[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || !Array.isArray(parsed.panels) || parsed.panels.length > WORKSPACE_MODULES.length) return null;
    const seen = new Set<string>();
    const result: PanelLayout[] = [];
    for (const p of parsed.panels) {
      if (!p || !isModuleId(p.id) || seen.has(p.id) || ![p.x,p.y,p.w,p.h].every(v => typeof v === "number" && Number.isFinite(v)) || p.y > 10000) return null;
      const clamped = clampPanel(p);
      if (["x","y","w","h"].some(k => p[k] !== clamped[k as keyof PanelLayout]) || result.some(r => overlaps(r, clamped))) return null;
      seen.add(p.id); result.push(clamped);
    }
    return result;
  } catch { return null; }
}
