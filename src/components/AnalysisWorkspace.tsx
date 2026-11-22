"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { addPanel, DEFAULT_LAYOUT, GRID_COLUMNS, GRID_GAP, GRID_ROW, panelDefinition, placePanel, readLayout, WORKSPACE_MODULES, type PanelLayout, type WorkspaceModuleId } from "@/lib/workspace-layout";

const STORAGE_KEY = "proteomics.workspace.real.layout.v3";
const FREE_STORAGE_KEY = "proteomics.workspace.real.free.v3";
type SnapMode = "grid" | "free";
type FreeRect = { xFrac: number; top: number; wFrac: number; height: number };
type FreeMap = Partial<Record<WorkspaceModuleId, FreeRect>>;
type PixelBox = { left: number; top: number; width: number; height: number };
type Gesture = {
  id: WorkspaceModuleId;
  mode: "move" | "resize" | "resize-w" | "resize-h";
  x: number;
  y: number;
  scrollY: number;
  start: PanelLayout;
  startBox: PixelBox;
  base: PanelLayout[];
  draft: PanelLayout[];
};
type LibraryGesture = {
  id: WorkspaceModuleId;
  title: string;
  w: number;
  h: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  at: { x: number; y: number } | null;
};

function gridBoxPx(p: PanelLayout, gridWidth: number): PixelBox {
  const step = (gridWidth + GRID_GAP) / GRID_COLUMNS;
  return {
    left: p.x * step,
    width: Math.max(200, p.w * step - GRID_GAP),
    top: p.y * (GRID_ROW + GRID_GAP),
    height: Math.max(160, p.h * (GRID_ROW + GRID_GAP) - GRID_GAP),
  };
}

function toFreeRect(box: PixelBox, gridWidth: number): FreeRect {
  const safeW = Math.max(gridWidth, 320);
  const wFrac = Math.min(1, Math.max(180 / safeW, box.width / safeW));
  const xFrac = Math.min(1 - wFrac, Math.max(0, box.left / safeW));
  return { xFrac, top: Math.max(0, Math.round(box.top)), wFrac, height: Math.max(200, Math.round(box.height)) };
}

function fromFreeRect(r: FreeRect, gridWidth: number): PixelBox {
  const safeW = Math.max(gridWidth, 320);
  const width = Math.min(safeW, Math.max(200, r.wFrac * safeW));
  const left = Math.min(safeW - width, Math.max(0, r.xFrac * safeW));
  return { left, top: Math.max(0, r.top), width, height: Math.max(200, r.height) };
}

function ensureFreeMap(panels: PanelLayout[], free: FreeMap, gw: number): FreeMap {
  const next: FreeMap = { ...free };
  for (const p of panels) {
    if (!next[p.id]) next[p.id] = toFreeRect(gridBoxPx(p, gw), gw);
  }
  return next;
}

function overlapArea(a: PixelBox, b: PixelBox): number {
  const ox = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const oy = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return ox * oy;
}

type PanelStackMeta = {
  zMap: Partial<Record<WorkspaceModuleId, number>>;
  overlaps: Partial<Record<WorkspaceModuleId, WorkspaceModuleId[]>>;
  frontOfStack: Partial<Record<WorkspaceModuleId, boolean>>;
  behindActive: Partial<Record<WorkspaceModuleId, boolean>>;
};

function computePanelStack(
  panels: PanelLayout[],
  boxFor: (p: PanelLayout) => PixelBox,
  zOrder: WorkspaceModuleId[],
  activeFocusId: WorkspaceModuleId | null,
): PanelStackMeta {
  const boxes = new Map<WorkspaceModuleId, PixelBox>();
  for (const p of panels) boxes.set(p.id, boxFor(p));

  const rank = (id: WorkspaceModuleId) => {
    const idx = zOrder.indexOf(id);
    return idx >= 0 ? idx : -1;
  };
  const ordered = panels.map(p => p.id).sort((a, b) => rank(a) - rank(b));
  const zMap: Partial<Record<WorkspaceModuleId, number>> = {};
  ordered.forEach((id, idx) => { zMap[id] = 10 + idx * 2; });

  const overlaps: Partial<Record<WorkspaceModuleId, WorkspaceModuleId[]>> = {};
  const frontOfStack: Partial<Record<WorkspaceModuleId, boolean>> = {};
  const behindActive: Partial<Record<WorkspaceModuleId, boolean>> = {};

  for (const a of ordered) {
    const boxA = boxes.get(a)!;
    const peers: WorkspaceModuleId[] = [];
    let hasHigherOverlap = false;
    for (let i = ordered.length - 1; i >= 0; i--) {
      const b = ordered[i];
      if (b === a) continue;
      if (overlapArea(boxA, boxes.get(b)!) > 400) {
        peers.push(b);
        if ((zMap[b] ?? 0) > (zMap[a] ?? 0)) hasHigherOverlap = true;
      }
    }
    overlaps[a] = peers;
    if (peers.length > 0 && !hasHigherOverlap) frontOfStack[a] = true;
    if (hasHigherOverlap && (activeFocusId === null || peers.includes(activeFocusId) || hasHigherOverlap)) {
      behindActive[a] = true;
    }
  }

  return { zMap, overlaps, frontOfStack, behindActive };
}

function Grip() {
  return <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">{[5,11].flatMap(x => [5,10,15].map(y => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3"/>))}</svg>;
}

export function AnalysisWorkspace({ context, renderPanel, reveal }: {
  context: ReactNode;
  renderPanel: (id: WorkspaceModuleId) => ReactNode;
  reveal?: { id: WorkspaceModuleId; token: number } | null;
}) {
  const [layout, setLayout] = useState<PanelLayout[]>(DEFAULT_LAYOUT);
  const [preview, setPreview] = useState<PanelLayout[] | null>(null);
  const [history, setHistory] = useState<{ layout: PanelLayout[]; free: FreeMap }[]>([]);
  const [locked, setLocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState("");
  const [width, setWidth] = useState(0);
  const [snapMode, setSnapMode] = useState<SnapMode>("grid");
  const [freeRects, setFreeRects] = useState<FreeMap>({});
  const [zOrder, setZOrder] = useState<WorkspaceModuleId[]>([]);
  const [soloPanel, setSoloPanel] = useState<WorkspaceModuleId | null>(null);
  const [stackMenu, setStackMenu] = useState<WorkspaceModuleId | null>(null);
  const [activeBox, setActiveBox] = useState<{ id: WorkspaceModuleId; box: PixelBox } | null>(null);
  const [dragged, setDragged] = useState<WorkspaceModuleId | null>(null);
  const [dragGhost, setDragGhost] = useState<{ id: WorkspaceModuleId; title: string; x: number; y: number } | null>(null);
  const [dropAt, setDropAt] = useState<{ x: number; y: number } | null>(null);
  const [controls, setControls] = useState<WorkspaceModuleId | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const libraryGesture = useRef<LibraryGesture | null>(null);
  const activeBoxRef = useRef<{ id: WorkspaceModuleId; box: PixelBox } | null>(null);
  const suppressAddClick = useRef(false);
  const current = useRef(layout); current.current = layout;
  const freeRef = useRef(freeRects); freeRef.current = freeRects;
  const snapRef = useRef(snapMode); snapRef.current = snapMode;
  const widthRef = useRef(width); widthRef.current = width;
  const narrow = width > 0 && width < 480;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const restored = raw ? readLayout(raw) : null;
      if (restored) setLayout(restored);
      else if (raw) setNotice("Saved layout could not be restored. The default layout is shown.");
      const rawFree = localStorage.getItem(FREE_STORAGE_KEY);
      if (rawFree) {
        const parsed = JSON.parse(rawFree) as { snap?: SnapMode; rects?: FreeMap };
        if (parsed.snap === "free" || parsed.snap === "grid") setSnapMode(parsed.snap);
        if (parsed.rects && typeof parsed.rects === "object") setFreeRects(parsed.rects);
      }
    } catch { setNotice("Browser storage is unavailable. Layout changes will last for this visit."); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, panels: layout }));
      localStorage.setItem(FREE_STORAGE_KEY, JSON.stringify({ snap: snapMode, rects: freeRects }));
      setSaved(true);
    }
    catch { setSaved(false); }
  }, [layout, snapMode, freeRects, ready]);
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    let measuredWidth = 0;
    const observer = new ResizeObserver(entries => {
      const nextWidth = entries[0].contentRect.width;
      if (Math.abs(nextWidth - measuredWidth) >= 1) {
        measuredWidth = nextWidth;
        setWidth(nextWidth);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const commit = useCallback((next: PanelLayout[], message: string, nextFree?: FreeMap) => {
    const beforeLayout = current.current;
    const beforeFree = freeRef.current;
    const resolvedFree = nextFree ?? beforeFree;
    if (JSON.stringify(next) !== JSON.stringify(beforeLayout) || JSON.stringify(resolvedFree) !== JSON.stringify(beforeFree)) {
      setHistory(h => [...h.slice(-19), { layout: beforeLayout, free: beforeFree }]);
      current.current = next; setLayout(next);
      freeRef.current = resolvedFree; setFreeRects(resolvedFree);
    }
    setNotice(message);
  }, []);
  useEffect(() => {
    if (!reveal || !ready) return;
    const next = addPanel(current.current, reveal.id);
    commit(next, `${panelDefinition(reveal.id).title} opened.`);
    const frame = requestAnimationFrame(() => {
      const panel = document.getElementById(`workspace-${reveal.id}`);
      panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      panel?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal, ready, commit]);

  const cancelAll = useCallback(() => {
    gesture.current = null;
    libraryGesture.current = null;
    activeBoxRef.current = null;
    setActiveBox(null);
    setPreview(null);
    setDragged(null);
    setDragGhost(null);
    setDropAt(null);
  }, []);

  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { cancelAll(); setControls(null); setSoloPanel(null); setStackMenu(null); } };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [cancelAll]);

  useEffect(() => {
    if (!stackMenu) return;
    const onDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest(".workspace-overlap-tabs")) setStackMenu(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [stackMenu]);

  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      const g = gesture.current;
      const gw = grid.current?.getBoundingClientRect().width || widthRef.current;
      if (g && gw > 0) {
        if (e.clientY > window.innerHeight - 50) window.scrollBy(0, 14);
        else if (e.clientY < 70) window.scrollBy(0, -14);
        const rawDxPx = e.clientX - g.x;
        const rawDyPx = e.clientY - g.y + window.scrollY - g.scrollY;
        const nextBox: PixelBox = { ...g.startBox };
        if (g.mode === "move") {
          nextBox.left = Math.max(0, Math.min(gw - g.startBox.width, g.startBox.left + rawDxPx));
          nextBox.top = Math.max(0, g.startBox.top + rawDyPx);
        } else {
          if (g.mode === "resize-w" || g.mode === "resize") {
            nextBox.width = Math.max(240, Math.min(gw - g.startBox.left, g.startBox.width + rawDxPx));
          }
          if (g.mode === "resize-h" || g.mode === "resize") {
            nextBox.height = Math.max(200, g.startBox.height + rawDyPx);
          }
        }
        activeBoxRef.current = { id: g.id, box: nextBox };
        setActiveBox({ id: g.id, box: nextBox });

        if (snapRef.current === "grid") {
          const dx = Math.round(rawDxPx / ((gw + GRID_GAP) / GRID_COLUMNS));
          const dy = Math.round(rawDyPx / (GRID_ROW + GRID_GAP));
          const requested = g.mode === "move"
            ? { ...g.start, x: g.start.x + dx, y: g.start.y + dy }
            : g.mode === "resize-w"
              ? { ...g.start, w: g.start.w + dx }
              : g.mode === "resize-h"
                ? { ...g.start, h: g.start.h + dy }
                : { ...g.start, w: g.start.w + dx, h: g.start.h + dy };
          g.draft = placePanel(g.base, requested);
          setPreview(g.draft);
        }
        return;
      }

      const lg = libraryGesture.current;
      const r = grid.current?.getBoundingClientRect();
      if (!lg || !r) return;
      if (!lg.moved && Math.hypot(e.clientX - lg.startX, e.clientY - lg.startY) < 6) return;
      lg.moved = true;
      lg.x = e.clientX;
      lg.y = e.clientY;
      suppressAddClick.current = true;
      setDragged(lg.id);
      setDragGhost({ id: lg.id, title: lg.title, x: e.clientX, y: e.clientY });
      if (e.clientY > window.innerHeight - 50) window.scrollBy(0, 14);
      else if (e.clientY < 70) window.scrollBy(0, -14);

      const inDropZone = e.clientX >= r.left - 32 && e.clientX <= r.right + 32 && e.clientY >= r.top - 32;
      if (inDropZone && r.width > 0) {
        const colStep = (r.width + GRID_GAP) / GRID_COLUMNS;
        const rowStep = GRID_ROW + GRID_GAP;
        const x = Math.max(0, Math.min(GRID_COLUMNS - lg.w, Math.round((e.clientX - r.left) / colStep - lg.w / 2)));
        const y = Math.max(0, Math.round((e.clientY - r.top) / rowStep - 0.5));
        lg.at = { x, y };
      } else {
        lg.at = null;
      }
      setDropAt(lg.at);
    };

    const onUp = () => {
      const g = gesture.current;
      if (g) {
        const gw = grid.current?.getBoundingClientRect().width || widthRef.current;
        if (snapRef.current === "free" && activeBoxRef.current?.id === g.id && gw > 0) {
          const updatedFree: FreeMap = {
            ...ensureFreeMap(current.current, freeRef.current, gw),
            [g.id]: toFreeRect(activeBoxRef.current.box, gw),
          };
          commit(current.current, `${panelDefinition(g.id).title} ${g.mode === "move" ? "moved" : "resized"}.`, updatedFree);
        } else {
          const nextFree = { ...freeRef.current };
          delete nextFree[g.id];
          commit(g.draft, `${panelDefinition(g.id).title} ${g.mode === "move" ? "moved" : "resized"}.`, nextFree);
        }
        cancelAll();
        return;
      }

      const lg = libraryGesture.current;
      if (lg) {
        if (lg.moved && lg.at) {
          const def = panelDefinition(lg.id);
          const gw = grid.current?.getBoundingClientRect().width || widthRef.current;
          const r = grid.current?.getBoundingClientRect();
          const exists = current.current.some(p => p.id === lg.id);
          if (snapRef.current === "free" && gw > 0 && r) {
            const box = gridBoxPx({ ...def, x: lg.at.x, y: lg.at.y }, gw);
            box.left = Math.max(0, Math.min(gw - box.width, lg.x - r.left - box.width / 2));
            box.top = Math.max(0, Math.round(lg.y - r.top - 24));
            const nextLayout = exists ? current.current : [...current.current, { id: def.id, x: lg.at.x, y: lg.at.y, w: def.w, h: def.h }];
            const nextFree = {
              ...ensureFreeMap(current.current, freeRef.current, gw),
              [lg.id]: toFreeRect(box, gw),
            };
            commit(nextLayout, `${def.title} ${exists ? "moved" : "added"}.`, nextFree);
          } else {
            const nextLayout = exists
              ? placePanel(current.current, { ...(current.current.find(p => p.id === lg.id) ?? def), x: lg.at.x, y: lg.at.y })
              : addPanel(current.current, lg.id, lg.at);
            commit(nextLayout, `${def.title} ${exists ? "moved" : "added"}.`);
          }
        }
        cancelAll();
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [commit, cancelAll]);

  const bringToFront = (id: WorkspaceModuleId) => {
    setZOrder(curr => (curr[curr.length - 1] === id ? curr : [...curr.filter(item => item !== id), id]));
    setSoloPanel(curr => (curr && curr !== id ? id : curr));
    setStackMenu(null);
  };

  const begin = (e: PointerEvent<HTMLElement>, panel: PanelLayout, mode: Gesture["mode"]) => {
    if (locked || narrow || e.button !== 0 || !width) return;
    e.preventDefault();
    bringToFront(panel.id);
    const startBox = snapMode === "free" && freeRects[panel.id]
      ? fromFreeRect(freeRects[panel.id]!, width)
      : gridBoxPx(panel, width);
    gesture.current = { id: panel.id, mode, x: e.clientX, y: e.clientY, scrollY: window.scrollY, start: panel, startBox, base: layout, draft: layout };
    activeBoxRef.current = { id: panel.id, box: startBox };
    setActiveBox({ id: panel.id, box: startBox });
    setControls(null);
  };
  const change = (panel: PanelLayout, patch: Partial<PanelLayout>) => {
    const nextFree = { ...freeRects };
    delete nextFree[panel.id];
    commit(placePanel(layout, { ...panel, ...patch }), `${panelDefinition(panel.id).title} layout updated.`, nextFree);
  };
  const toggleSnapMode = () => {
    if (locked || narrow) return;
    if (snapMode === "grid") {
      const nextFree: FreeMap = { ...freeRects };
      if (width > 0) {
        for (const p of layout) {
          if (!nextFree[p.id]) nextFree[p.id] = toFreeRect(gridBoxPx(p, width), width);
        }
      }
      setSnapMode("free");
      setFreeRects(nextFree);
      setNotice("Free placement enabled (drag or resize smoothly without grid snap).");
    } else {
      if (width > 0 && Object.keys(freeRects).length > 0) {
        const colStep = (width + GRID_GAP) / GRID_COLUMNS;
        const rowStep = GRID_ROW + GRID_GAP;
        let next = [...layout];
        for (const p of layout) {
          const fr = freeRects[p.id];
          if (!fr) continue;
          const def = panelDefinition(p.id);
          const box = fromFreeRect(fr, width);
          const x = Math.round(box.left / colStep);
          const y = Math.round(box.top / rowStep);
          const w = Math.max(def.minW, Math.round((box.width + GRID_GAP) / colStep));
          const h = Math.max(def.minH, Math.round((box.height + GRID_GAP) / rowStep));
          next = placePanel(next, { id: p.id, x, y, w, h });
        }
        commit(next, "Snapped panels back to grid.", {});
      }
      setSnapMode("grid");
    }
  };
  const activeLayout = preview ?? layout;
  const visualOrder = [...activeLayout].sort((a,b) => a.y - b.y || a.x - b.x);
  const rendered = narrow ? visualOrder : activeLayout;
  const gridBottom = Math.max(7, ...activeLayout.map(p => p.y + p.h));
  const freeBottomPx = snapMode === "free"
    ? Math.max(0, ...layout.map(p => { const fr = freeRects[p.id]; return fr ? fr.top + fr.height : 0; }))
    : 0;
  const activeBottomPx = activeBox ? activeBox.box.top + activeBox.box.height : 0;
  const dropPreview = dragged && dropAt
    ? (layout.some(p => p.id === dragged)
        ? placePanel(layout, { ...(layout.find(p => p.id === dragged) ?? panelDefinition(dragged)), ...dropAt }).find(p => p.id === dragged)
        : addPanel(layout, dragged, dropAt).find(p => p.id === dragged))
    : null;
  const snapTargetPanel = activeBox && snapMode === "grid"
    ? activeLayout.find(p => p.id === activeBox.id) ?? null
    : null;
  const gridStyleFor = (p: PanelLayout): CSSProperties => ({
    left: `calc(${p.x / GRID_COLUMNS * 100}% + ${GRID_GAP * p.x / GRID_COLUMNS}px)`,
    width: `calc(${p.w / GRID_COLUMNS * 100}% - ${GRID_GAP * (1-p.w / GRID_COLUMNS)}px)`,
    top: p.y * (GRID_ROW + GRID_GAP), height: p.h * (GRID_ROW + GRID_GAP) - GRID_GAP,
  });
  const boxForPanel = (p: PanelLayout): PixelBox => {
    if (activeBox?.id === p.id) return activeBox.box;
    if (snapMode === "free" && width > 0) {
      return freeRects[p.id] ? fromFreeRect(freeRects[p.id]!, width) : gridBoxPx(p, width);
    }
    return gridBoxPx(p, Math.max(width, 640));
  };
  const topPanelId = zOrder[zOrder.length - 1] ?? rendered[rendered.length - 1]?.id ?? null;
  const stackMeta = computePanelStack(rendered, boxForPanel, zOrder, topPanelId);
  const styleFor = (p: PanelLayout): CSSProperties => {
    const zIndex = activeBox?.id === p.id ? 55 : soloPanel === p.id ? 52 : (stackMeta.zMap[p.id] ?? 10);
    if (activeBox?.id === p.id) {
      return { left: activeBox.box.left, top: activeBox.box.top, width: activeBox.box.width, height: activeBox.box.height, zIndex };
    }
    if (snapMode === "free" && width > 0) {
      const box = freeRects[p.id] ? fromFreeRect(freeRects[p.id]!, width) : gridBoxPx(p, width);
      return { left: box.left, top: box.top, width: box.width, height: box.height, zIndex };
    }
    return { ...gridStyleFor(p), zIndex };
  };

  const freeDropStyle: CSSProperties | null = dragged && snapMode === "free" && dragGhost && grid.current && width > 0
    ? (() => {
        const r = grid.current!.getBoundingClientRect();
        if (dragGhost.x < r.left - 32 || dragGhost.x > r.right + 32 || dragGhost.y < r.top - 32) return null;
        const box = gridBoxPx({ ...panelDefinition(dragged), x: 0, y: 0 }, width);
        return {
          left: Math.max(0, Math.min(width - box.width, dragGhost.x - r.left - box.width / 2)),
          top: Math.max(0, Math.round(dragGhost.y - r.top - 24)),
          width: box.width,
          height: box.height,
        };
      })()
    : null;

  return <div className="analysis-workspace">
    {dragGhost && <div className="workspace-drag-ghost" style={{ left: dragGhost.x + 14, top: dragGhost.y - 16 }} aria-hidden="true">{dragGhost.title}</div>}
    <div className="workspace-main">
      <div className="workspace-toolbar">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">{context}</div>
          <div className="workspace-actions" title={saved ? "Layout saved on this browser" : "Layout kept for this visit"}>
            {notice && <span role="status" aria-live="polite" className="rounded bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-900">{notice}</span>}
            {soloPanel && (
              <button type="button" aria-pressed="true" onClick={() => setSoloPanel(null)} title="Show all views stacked on canvas">
                Show all
              </button>
            )}
            <button type="button" aria-pressed={snapMode === "free"} disabled={locked || narrow || !ready} onClick={toggleSnapMode}
              title="Switch between free-form smooth canvas positioning and 12-column grid alignment">
              {snapMode === "free" ? "Snap: Free" : "Snap: Grid"}
            </button>
            <button type="button" aria-pressed={locked} onClick={() => { setLocked(!locked); cancelAll(); setControls(null); }}>{locked ? "Unlock" : "Lock"}</button>
            <button type="button" disabled={locked || !history.length} onClick={() => { const previous = history[history.length-1]; if (previous) { current.current = previous.layout; setLayout(previous.layout); freeRef.current = previous.free; setFreeRects(previous.free); setHistory(h => h.slice(0,-1)); setNotice("Undone."); } }}>Undo</button>
            <button type="button" disabled={locked || !ready} onClick={() => { setSoloPanel(null); commit(DEFAULT_LAYOUT.map(p => ({...p})), "Layout reset.", {}); }}>Reset</button>
            <button type="button" disabled={locked || !layout.length || !ready} onClick={() => { setSoloPanel(null); commit([], "Cleared.", {}); }}>Clear</button>
          </div>
        </div>
        <div className="workspace-library-strip" role="region" aria-label="Analysis module library">
          <span className="workspace-library-label">Views</span>
          {WORKSPACE_MODULES.map(m => {
            const added = layout.some(p => p.id === m.id);
            const isFront = added && (soloPanel === m.id || (!soloPanel && (stackMeta.frontOfStack[m.id] || topPanelId === m.id)));
            const canDrag = !locked && !narrow && ready;
            return <button key={m.id} type="button" className={`workspace-module ${added ? "is-added" : ""} ${isFront ? "is-front" : ""}`} data-draggable={canDrag}
              disabled={locked || !ready} aria-label={added ? `Focus or drag ${m.title}` : `Add ${m.title}`} data-testid={`add-${m.id}`}
              title={added ? `${m.title} — click to bring to front, or drag onto canvas` : `${m.description} — click or drag onto canvas`}
              onPointerDown={e => {
                suppressAddClick.current = false;
                if (!canDrag || e.button !== 0) return;
                e.preventDefault();
                libraryGesture.current = { id: m.id, title: m.title, w: m.w, h: m.h, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moved: false, at: null };
              }}
              onClick={() => {
                if (suppressAddClick.current) { suppressAddClick.current = false; return; }
                if (added) {
                  bringToFront(m.id);
                  document.getElementById(`workspace-${m.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  setNotice(`${m.title} focused.`);
                  return;
                }
                bringToFront(m.id);
                commit(addPanel(current.current, m.id), `${m.title} added.`);
              }}>
              <span className="workspace-module-title">{m.title}<span className="workspace-module-action">{added ? "•" : "+"}</span></span>
            </button>;
          })}
        </div>
      </div>
      <div ref={grid} className={`workspace-grid ${narrow ? "is-stacked" : ""} ${dragged ? "is-dropping" : ""} ${snapMode === "free" ? "is-free" : ""}`} data-testid="workspace-grid"
        style={narrow ? undefined : { minHeight: Math.max((Math.max(gridBottom, (dropPreview?.y ?? 0) + (dropPreview?.h ?? 0)) + 2) * (GRID_ROW + GRID_GAP), freeBottomPx + 80, activeBottomPx + 80) }}>
        {!layout.length && <div className="workspace-empty"><h3>Build your analysis workspace</h3><p>Add or drag a volcano plot to explore candidates, then arrange views freely on the canvas.</p><button type="button" disabled={locked || !ready} onClick={() => commit(DEFAULT_LAYOUT.map(p => ({...p})), "Candidate exploration layout added.", {})}>Use candidate exploration layout</button></div>}
        {snapTargetPanel && !narrow && <div className="workspace-drop-preview is-snap-guide" style={gridStyleFor(snapTargetPanel)} aria-hidden="true" />}
        {(freeDropStyle || dropPreview) && !narrow && <div className="workspace-drop-preview" style={freeDropStyle ?? gridStyleFor(dropPreview!)} aria-hidden="true">Place {panelDefinition(dragged ?? dropPreview!.id).title} here</div>}
        {rendered.map(panel => {
          const def = panelDefinition(panel.id);
          const overlappingIds = stackMeta.overlaps[panel.id] ?? [];
          const isSolo = soloPanel === panel.id;
          const isSoloHidden = Boolean(soloPanel && soloPanel !== panel.id);
          const isFront = !isSoloHidden && (isSolo || Boolean(stackMeta.frontOfStack[panel.id]));
          const isBehind = !soloPanel && Boolean(stackMeta.behindActive[panel.id]);
          return <section key={panel.id} id={`workspace-${panel.id}`} tabIndex={-1} aria-label={`${def.title} panel`} data-testid={`panel-${panel.id}`}
            data-panel-kind={panel.id} data-panel-solo={isSolo ? "true" : undefined} data-grid-x={panel.x} data-grid-y={panel.y} data-grid-w={panel.w} data-grid-h={panel.h}
            onPointerDownCapture={e => {
              const target = e.target as Element | null;
              if (target?.closest(".workspace-overlap-tabs, .workspace-remove")) return;
              bringToFront(panel.id);
            }}
            onPointerDown={e => {
              if (locked || narrow || e.button !== 0) return;
              const target = e.target as Element | null;
              if (target?.closest("button, input, select, textarea, a, label, summary, details, canvas, table, .workspace-resize, .workspace-resize-e, .workspace-resize-s, .workspace-panel-controls, [role='button'], [data-protein-id], [data-sample], [data-network-node], [data-no-panel-drag='true']")) return;
              begin(e, panel, "move");
            }}
            className={`workspace-panel group/panel ${activeBox?.id === panel.id ? "is-moving" : ""} ${isFront ? "is-focused-front" : ""} ${isBehind ? "is-overlapped-behind" : ""} ${isSoloHidden ? "is-solo-hidden" : ""}`}
            style={narrow ? undefined : styleFor(panel)}>
            <header className="workspace-panel-header">
              <button type="button" className="workspace-drag-handle" aria-label={`Move ${def.title}`} title="Drag to move (or drag chart background); arrow keys move; Shift + arrow keys resize"
                disabled={locked || narrow} onPointerDown={e => { e.stopPropagation(); begin(e, panel, "move"); }}
                onKeyDown={e => {
                  const keys: Record<string,[number,number]> = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
                  const delta = keys[e.key]; if (!delta) return; e.preventDefault();
                  change(panel, e.shiftKey ? {w:panel.w+delta[0],h:panel.h+delta[1]} : {x:panel.x+delta[0],y:panel.y+delta[1]});
                }}><Grip/><span>{def.title}</span></button>
              {!soloPanel && overlappingIds.length > 0 && (
                <div className="workspace-overlap-tabs">
                  {overlappingIds.length === 1 ? (
                    <button
                      type="button"
                      className="workspace-overlap-pill"
                      onPointerDown={e => e.stopPropagation()}
                      onClick={() => bringToFront(overlappingIds[0])}
                      title={`Bring ${panelDefinition(overlappingIds[0]).title} to front`}
                    >
                      ⇄ {panelDefinition(overlappingIds[0]).title}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="workspace-overlap-pill"
                        aria-expanded={stackMenu === panel.id}
                        onPointerDown={e => e.stopPropagation()}
                        onClick={() => setStackMenu(curr => curr === panel.id ? null : panel.id)}
                        title="Switch between overlapping charts at this position"
                      >
                        Layers ({overlappingIds.length + 1}) ▾
                      </button>
                      {stackMenu === panel.id && (
                        <div className="workspace-overlap-menu" role="menu" aria-label="Overlapping charts">
                          <button
                            type="button"
                            role="menuitem"
                            onPointerDown={e => e.stopPropagation()}
                            onClick={() => setStackMenu(null)}
                          >
                            ✓ {def.title}
                          </button>
                          {overlappingIds.map(oid => (
                            <button
                              key={oid}
                              type="button"
                              role="menuitem"
                              onPointerDown={e => e.stopPropagation()}
                              onClick={() => bringToFront(oid)}
                            >
                              ⇄ {panelDefinition(oid).title}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              <button type="button" className="workspace-solo-button" aria-pressed={isSolo}
                onPointerDown={e => e.stopPropagation()}
                onClick={() => {
                  if (isSolo) setSoloPanel(null);
                  else { bringToFront(panel.id); setSoloPanel(panel.id); }
                }}
                title={isSolo ? "Show all views again (or press Escape)" : `View only ${def.title}`}>
                {isSolo ? "Show all" : "Solo"}
              </button>
              <button type="button" className="workspace-layout-button" aria-expanded={controls === panel.id} disabled={locked || narrow} onClick={() => setControls(controls === panel.id ? null : panel.id)}>Layout</button>
              <button type="button" className="workspace-remove" aria-label={`Remove ${def.title}`} disabled={locked} onClick={() => { const nextFree = { ...freeRects }; delete nextFree[panel.id]; if (soloPanel === panel.id) setSoloPanel(null); commit(layout.filter(p => p.id !== panel.id), `${def.title} removed. Analysis selections are unchanged.`, nextFree); setControls(null); }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>
              </button>
            </header>
            {controls === panel.id && <div className="workspace-panel-controls">
              <div className="workspace-actions">{([['Left',-1,0],['Right',1,0],['Up',0,-1],['Down',0,1]] as const).map(([label,dx,dy]) => <button key={label} type="button" aria-label={`Move ${def.title} ${label.toLowerCase()}`} onClick={() => change(panel,{x:panel.x+dx,y:panel.y+dy})}>{label}</button>)}</div>
              <label>Width<select aria-label={`${def.title} width`} value={panel.w} onChange={e => change(panel,{w:Number(e.target.value)})}>{Array.from({length:13-def.minW},(_,i)=>def.minW+i).map(w=><option key={w} value={w}>{w} / 12 columns</option>)}</select></label>
              <label>Height<select aria-label={`${def.title} height`} value={panel.h} onChange={e => change(panel,{h:Number(e.target.value)})}>{Array.from({length:21-def.minH},(_,i)=>def.minH+i).map(h=><option key={h} value={h}>{h} rows</option>)}</select></label>
              <button type="button" onClick={() => setControls(null)}>Done</button>
            </div>}
            <div className="workspace-panel-content">{renderPanel(panel.id)}</div>
            {!locked && !narrow && <>
              <div role="presentation" className="workspace-resize-e" title="Drag right edge to resize width"
                onPointerDown={e => { e.stopPropagation(); begin(e, panel, "resize-w"); }} />
              <div role="presentation" className="workspace-resize-s" title="Drag bottom edge to resize height"
                onPointerDown={e => { e.stopPropagation(); begin(e, panel, "resize-h"); }} />
              <button type="button" className="workspace-resize" aria-label={`Resize ${def.title}`} title="Drag to resize, or use the Layout menu"
                onPointerDown={e => { e.stopPropagation(); begin(e, panel, "resize"); }}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setControls(panel.id); } }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 14 14 5M10 14l4-4"/></svg>
              </button>
            </>}
          </section>;
        })}
      </div>
    </div>
  </div>;
}
