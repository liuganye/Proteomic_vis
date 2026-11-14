"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { addPanel, DEFAULT_LAYOUT, GRID_COLUMNS, GRID_GAP, GRID_ROW, panelDefinition, placePanel, readLayout, WORKSPACE_MODULES, type PanelLayout, type WorkspaceModuleId } from "@/lib/workspace-layout";

const STORAGE_KEY = "proteomics.workspace.real.layout.v1";
type Gesture = { id: WorkspaceModuleId; mode: "move" | "resize"; x: number; y: number; scrollY: number; start: PanelLayout; base: PanelLayout[]; draft: PanelLayout[] };

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
  const [history, setHistory] = useState<PanelLayout[][]>([]);
  const [locked, setLocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState("");
  const [width, setWidth] = useState(0);
  const [dragged, setDragged] = useState<WorkspaceModuleId | null>(null);
  const [dropAt, setDropAt] = useState<{x:number;y:number} | null>(null);
  const [controls, setControls] = useState<WorkspaceModuleId | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const libraryGesture = useRef<{id:WorkspaceModuleId;x:number;y:number;moved:boolean;at:{x:number;y:number}|null} | null>(null);
  const suppressAddClick = useRef(false);
  const current = useRef(layout); current.current = layout;
  const narrow = width > 0 && width < 720;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const restored = raw ? readLayout(raw) : null;
      if (restored) setLayout(restored);
      else if (raw) setNotice("Saved layout could not be restored. The default layout is shown.");
    } catch { setNotice("Browser storage is unavailable. Layout changes will last for this visit."); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, panels: layout })); setSaved(true); }
    catch { setSaved(false); }
  }, [layout, ready]);
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    let measuredWidth = 0;
    const observer = new ResizeObserver(entries => {
      const nextWidth = entries[0].contentRect.width;
      if (nextWidth !== measuredWidth) {
        measuredWidth = nextWidth;
        setWidth(nextWidth);
        gesture.current = null; setPreview(null);
        libraryGesture.current = null; setDragged(null); setDropAt(null);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const commit = useCallback((next: PanelLayout[], message: string) => {
    const before = current.current;
    if (JSON.stringify(next) !== JSON.stringify(before)) {
      setHistory(h => [...h.slice(-19), before]);
      current.current = next; setLayout(next);
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
  const cancelGesture = () => { gesture.current = null; setPreview(null); };
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { gesture.current = null; libraryGesture.current = null; setPreview(null); setDragged(null); setDropAt(null); setControls(null); } };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  const begin = (e: PointerEvent<HTMLButtonElement>, panel: PanelLayout, mode: Gesture["mode"]) => {
    if (locked || narrow || e.button !== 0 || !width) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { id: panel.id, mode, x: e.clientX, y: e.clientY, scrollY: window.scrollY, start: panel, base: layout, draft: layout };
    setControls(null);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g) return;
    if (e.clientY > window.innerHeight - 50) window.scrollBy(0, 14);
    else if (e.clientY < 70) window.scrollBy(0, -14);
    const dx = Math.round((e.clientX - g.x) / ((width + GRID_GAP) / GRID_COLUMNS));
    const dy = Math.round((e.clientY - g.y + window.scrollY - g.scrollY) / (GRID_ROW + GRID_GAP));
    const requested = g.mode === "move" ? { ...g.start, x: g.start.x + dx, y: g.start.y + dy } : { ...g.start, w: g.start.w + dx, h: g.start.h + dy };
    g.draft = placePanel(g.base, requested);
    setPreview(g.draft);
  };
  const finish = () => {
    const g = gesture.current;
    if (g) commit(g.draft, `${panelDefinition(g.id).title} ${g.mode === "move" ? "moved" : "resized"}.`);
    cancelGesture();
  };
  const change = (panel: PanelLayout, patch: Partial<PanelLayout>) => commit(placePanel(layout, { ...panel, ...patch }), `${panelDefinition(panel.id).title} layout updated.`);
  const activeLayout = preview ?? layout;
  const visualOrder = [...activeLayout].sort((a,b) => a.y - b.y || a.x - b.x);
  const rendered = narrow ? visualOrder : activeLayout;
  const bottom = Math.max(7, ...activeLayout.map(p => p.y + p.h));
  const dropPreview = dragged && dropAt ? placePanel(layout, { ...panelDefinition(dragged), ...dropAt }).find(p => p.id === dragged) : null;
  const styleFor = (p: PanelLayout): CSSProperties => ({
    left: `calc(${p.x / GRID_COLUMNS * 100}% + ${GRID_GAP * p.x / GRID_COLUMNS}px)`,
    width: `calc(${p.w / GRID_COLUMNS * 100}% - ${GRID_GAP * (1-p.w / GRID_COLUMNS)}px)`,
    top: p.y * (GRID_ROW + GRID_GAP), height: p.h * (GRID_ROW + GRID_GAP) - GRID_GAP,
  });

  return <div className="analysis-workspace">
    <aside className="workspace-library" aria-label="Analysis module library">
      <details open>
        <summary>Analysis modules <span>7</span></summary>
        <p className="workspace-help">Drag a module onto the workspace, or select Add.</p>
        {["Candidates", "Protein evidence", "Functional analysis"].map(group => <div key={group} className="workspace-module-group">
          <h3>{group}</h3>
          {WORKSPACE_MODULES.filter(m => m.group === group).map(m => {
            const added = layout.some(p => p.id === m.id);
            return <button key={m.id} type="button" className="workspace-module" data-draggable={!added && !locked && !narrow}
              disabled={added || locked || !ready} aria-label={`Add ${m.title}`} data-testid={`add-${m.id}`}
              onPointerDown={e => {
                suppressAddClick.current = false;
                if (narrow || e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                libraryGesture.current = {id:m.id,x:e.clientX,y:e.clientY,moved:false,at:null};
              }}
              onPointerMove={e => {
                const g = libraryGesture.current, r = grid.current?.getBoundingClientRect();
                if (!g || !r || Math.hypot(e.clientX-g.x,e.clientY-g.y)<6 && !g.moved) return;
                g.moved = true; suppressAddClick.current = true; setDragged(g.id);
                if (e.clientY > window.innerHeight-50) window.scrollBy(0,14);
                else if (e.clientY < 70) window.scrollBy(0,-14);
                g.at = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
                  ? {x:Math.floor((e.clientX-r.left)/((width+GRID_GAP)/GRID_COLUMNS)),y:Math.floor((e.clientY-r.top)/(GRID_ROW+GRID_GAP))} : null;
                setDropAt(g.at);
              }}
              onPointerUp={() => {
                const g = libraryGesture.current;
                if (g?.moved && g.at) commit(addPanel(layout,g.id,g.at),`${m.title} added.`);
                libraryGesture.current = null; setDragged(null); setDropAt(null);
              }}
              onPointerCancel={() => { libraryGesture.current = null; setDragged(null); setDropAt(null); }}
              onClick={() => { if (suppressAddClick.current) { suppressAddClick.current = false; return; } commit(addPanel(layout, m.id), `${m.title} added.`); }}>
              <span className="workspace-module-title">{m.title}<span className="workspace-module-action">{added ? "Added" : "Add"}</span></span>
              <span className="workspace-module-description">{m.description}</span>
            </button>;
          })}
        </div>)}
      </details>
      <p className="workspace-library-note">Every panel shares your candidate filters, protein focus and QC sample selection.</p>
    </aside>
    <div className="workspace-main">
      {context}
      <div className="workspace-controls">
        <div><strong>Your workspace</strong><p>{narrow ? "Stacked view. Desktop positions are preserved." : "Drag a title to move. Drag the corner to resize. Cards snap to the grid."}</p></div>
        <div className="workspace-actions">
          <button type="button" aria-pressed={locked} onClick={() => { setLocked(!locked); cancelGesture(); setControls(null); }}>{locked ? "Unlock layout" : "Lock layout"}</button>
          <button type="button" disabled={locked || !history.length} onClick={() => { const previous = history[history.length-1]; if (previous) { current.current = previous; setLayout(previous); setHistory(h => h.slice(0,-1)); setNotice("Last layout change undone."); } }}>Undo layout</button>
          <button type="button" disabled={locked || !ready} onClick={() => commit(DEFAULT_LAYOUT.map(p => ({...p})), "Default layout restored. Analysis filters are unchanged.")}>Reset layout</button>
          <button type="button" disabled={locked || !layout.length || !ready} onClick={() => commit([], "Workspace cleared. Use Undo layout to restore it.")}>Clear canvas</button>
        </div>
      </div>
      <div className="workspace-status"><span>{saved ? "Layout saved on this browser" : "Layout kept for this visit"}</span><span role="status" aria-live="polite">{notice}</span></div>
      <div ref={grid} className={`workspace-grid ${narrow ? "is-stacked" : ""} ${dragged ? "is-dropping" : ""}`} data-testid="workspace-grid"
        style={narrow ? undefined : { minHeight: (Math.max(bottom, (dropPreview?.y ?? 0) + (dropPreview?.h ?? 0)) + 2) * (GRID_ROW + GRID_GAP) }}>
        {!layout.length && <div className="workspace-empty"><h3>Build your analysis workspace</h3><p>Add a volcano plot to explore candidates, then place evidence panels alongside it.</p><button type="button" disabled={locked || !ready} onClick={() => commit(DEFAULT_LAYOUT.map(p => ({...p})), "Candidate exploration layout added.")}>Use candidate exploration layout</button></div>}
        {dropPreview && !narrow && <div className="workspace-drop-preview" style={styleFor(dropPreview)} aria-hidden="true">Place {panelDefinition(dropPreview.id).title} here</div>}
        {rendered.map(panel => {
          const def = panelDefinition(panel.id);
          return <section key={panel.id} id={`workspace-${panel.id}`} tabIndex={-1} aria-label={`${def.title} panel`} data-testid={`panel-${panel.id}`}
            data-grid-x={panel.x} data-grid-y={panel.y} data-grid-w={panel.w} data-grid-h={panel.h}
            className={`workspace-panel ${gesture.current?.id === panel.id ? "is-moving" : ""}`} style={narrow ? undefined : styleFor(panel)}>
            <header className="workspace-panel-header">
              <button type="button" className="workspace-drag-handle" aria-label={`Move ${def.title}`} title="Drag to move; arrow keys move one grid step; Shift + arrow keys resize; Escape cancels"
                disabled={locked || narrow} onPointerDown={e => begin(e, panel, "move")} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture} onLostPointerCapture={cancelGesture}
                onKeyDown={e => {
                  const keys: Record<string,[number,number]> = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
                  const delta = keys[e.key]; if (!delta) return; e.preventDefault();
                  change(panel, e.shiftKey ? {w:panel.w+delta[0],h:panel.h+delta[1]} : {x:panel.x+delta[0],y:panel.y+delta[1]});
                }}><Grip/><span>{def.title}</span></button>
              <button type="button" className="workspace-layout-button" aria-expanded={controls === panel.id} disabled={locked || narrow} onClick={() => setControls(controls === panel.id ? null : panel.id)}>Layout</button>
              <button type="button" className="workspace-remove" aria-label={`Remove ${def.title}`} disabled={locked} onClick={() => { commit(layout.filter(p => p.id !== panel.id), `${def.title} removed. Analysis selections are unchanged.`); setControls(null); }}>
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
            {!locked && !narrow && <button type="button" className="workspace-resize" aria-label={`Resize ${def.title}`} title="Drag to resize, or use the Layout menu"
              onPointerDown={e=>begin(e,panel,"resize")} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture} onLostPointerCapture={cancelGesture}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setControls(panel.id); } }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 14 14 5M10 14l4-4"/></svg>
            </button>}
          </section>;
        })}
      </div>
    </div>
  </div>;
}
