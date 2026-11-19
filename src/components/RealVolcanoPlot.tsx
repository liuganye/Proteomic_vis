"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  brushFromPixels,
  LOCAL_STRUCTURE_PDB,
  LOCAL_STRUCTURE_PROTEINS,
  negativeLogP,
  orderVolcanoPoints,
  rangeTicks,
  selectVolcanoCallouts,
  stepFoldChangeCutoff,
  stepSignificanceCutoff,
  volcanoAxes,
  volcanoDirection,
  volcanoSummaryCounts,
  type BrushBounds,
} from "@/lib/visualization";
import type { WorkspaceModuleId } from "@/lib/workspace-layout";
import { VolcanoBrushInputs } from "./VolcanoBrushInputs";

type Point = { protein_id: string; gene: string | null; organism?: string; log2_fc: number; p_value?: number; adj_p: number };
type AbundancePoint = { sample_id: string; display_group: string; log2_intensity: number | null };

const DIRECTION_COLORS = {
  up: "#0f766e",
  down: "#b45309",
  ns: "#94a3b8",
} as const;

export function RealVolcanoPlot({
  points,
  focus,
  onChoose,
  pCutoff,
  fcCutoff,
  setPCutoff,
  setFcCutoff,
  brush,
  onBrush,
  matchingIds,
  hasFilters,
  onViewResults,
  hoveredProteinId,
  onHoverProtein,
  networkNeighborIds,
  selectedSamples,
  focusedAbundance,
  onOpenPanel,
}: {
  points: Point[];
  focus: string;
  onChoose: (id: string) => void;
  pCutoff: number;
  fcCutoff: number;
  setPCutoff: (value: number) => void;
  setFcCutoff: (value: number) => void;
  brush: BrushBounds | null;
  onBrush: (bounds: BrushBounds | null) => void;
  matchingIds: Set<string>;
  hasFilters: boolean;
  onViewResults?: () => void;
  hoveredProteinId?: string | null;
  onHoverProtein?: (id: string | null) => void;
  networkNeighborIds?: Set<string>;
  selectedSamples?: string[];
  focusedAbundance?: AbundancePoint[] | null;
  onOpenPanel?: (id: WorkspaceModuleId) => void;
}) {
  const { xMax: fullXMax, yMax: fullYMax, xTicks: fullXTicks, yTicks: fullYTicks } = useMemo(
    () => volcanoAxes(points, pCutoff, fcCutoff),
    [points, pCutoff, fcCutoff],
  );
  const plotContainerRef = useRef<HTMLDivElement>(null);
  const [svgSize, setSvgSize] = useState({ w: 760, h: 400 });
  useEffect(() => {
    const el = plotContainerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const nw = Math.max(300, Math.round(rect.width));
      const nh = Math.max(210, Math.round(rect.height));
      setSvgSize(curr => (Math.abs(curr.w - nw) >= 1 || Math.abs(curr.h - nh) >= 1) ? { w: nw, h: nh } : curr);
    };
    update();
    const observer = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const nw = Math.max(300, Math.round(cr.width));
      const nh = Math.max(210, Math.round(cr.height));
      setSvgSize(curr => (Math.abs(curr.w - nw) >= 1 || Math.abs(curr.h - nh) >= 1) ? { w: nw, h: nh } : curr);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const svgW = svgSize.w;
  const svgH = svgSize.h;
  const uiScale = Math.max(0.9, Math.min(1.8, Math.sqrt((svgW * svgH) / (680 * 380))));
  const hudScale = Math.min(1.35, Math.max(0.9, uiScale));
  const left = Math.round(56 * uiScale);
  const right = Math.max(left + 140, svgW - Math.round(16 * uiScale));
  const top = Math.round(36 * uiScale);
  const bottom = Math.max(top + 110, svgH - Math.round(40 * uiScale));
  const plotW = right - left;
  const tickFontSize = Math.round(12 * uiScale);
  const axisTitleSize = Math.round(13 * uiScale);
  const calloutFontSize = Math.round(12 * uiScale);
  const hudFontSize = Math.round(12 * hudScale);
  const [boxSelect, setBoxSelect] = useState(false);
  const [pinnedControls, setPinnedControls] = useState(false);
  const [editingInput, setEditingInput] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [showNeighbors, setShowNeighbors] = useState(true);
  const [zoomedToBrush, setZoomedToBrush] = useState(false);
  const [wheelView, setWheelView] = useState<{ xMin: number; xMax: number; yMin: number; yMax: number } | null>(null);
  const [wheelActive, setWheelActive] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredThreshold, setHoveredThreshold] = useState<"p" | "fc-left" | "fc-right" | null>(null);
  const [thresholdDrag, setThresholdDrag] = useState<"p" | "fc-left" | "fc-right" | null>(null);
  const [nearbyCount, setNearbyCount] = useState(0);
  const [clusterMenu, setClusterMenu] = useState<{ x: number; y: number; items: { point: Point; dist: number }[] } | null>(null);
  const [preview, setPreview] = useState<BrushBounds | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const thresholdDragRef = useRef<{
    kind: "p" | "fc-left" | "fc-right";
    axes: { left: number; right: number; top: number; bottom: number; xMin: number; xMax: number; yMin: number; yMax: number };
  } | null>(null);
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);
  const clipId = useId();
  const isZoomed = Boolean((zoomedToBrush && brush) || wheelView);
  const activeHoverId = hoveredProteinId ?? hoveredId;

  const view = useMemo(() => {
    if (zoomedToBrush && brush) {
      const fcSpan = Math.max(brush.maxFc - brush.minFc, 0.2);
      const ySpan = Math.max(brush.maxY - brush.minY, 0.2);
      const xMin = brush.minFc - fcSpan * 0.05;
      const xMax = brush.maxFc + fcSpan * 0.05;
      const yMin = Math.max(0, brush.minY - ySpan * 0.05);
      const yMax = brush.maxY + ySpan * 0.05;
      return {
        xMin,
        xMax,
        yMin,
        yMax,
        xTicks: rangeTicks(xMin, xMax, 4),
        yTicks: rangeTicks(yMin, yMax, 5),
      };
    }
    if (wheelView) {
      return {
        ...wheelView,
        xTicks: rangeTicks(wheelView.xMin, wheelView.xMax, 5),
        yTicks: rangeTicks(wheelView.yMin, wheelView.yMax, 5),
      };
    }
    return {
      xMin: -fullXMax,
      xMax: fullXMax,
      yMin: 0,
      yMax: fullYMax,
      xTicks: fullXTicks,
      yTicks: fullYTicks,
    };
  }, [zoomedToBrush, brush, wheelView, fullXMax, fullYMax, fullXTicks, fullYTicks]);

  const wheelMetaRef = useRef({
    wheelActive: false,
    left,
    right,
    top,
    bottom,
    svgW,
    svgH,
    fullXMax,
    fullYMax,
    viewXMin: view.xMin,
    viewXMax: view.xMax,
    viewYMin: view.yMin,
    viewYMax: view.yMax,
  });
  useEffect(() => {
    wheelMetaRef.current = {
      wheelActive,
      left,
      right,
      top,
      bottom,
      svgW,
      svgH,
      fullXMax,
      fullYMax,
      viewXMin: view.xMin,
      viewXMax: view.xMax,
      viewYMin: view.yMin,
      viewYMax: view.yMax,
    };
  }, [wheelActive, left, right, top, bottom, svgW, svgH, fullXMax, fullYMax, view]);

  useEffect(() => {
    if (!wheelActive) return;
    const onOutsideDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest("[data-panel-kind='volcano']")) setWheelActive(false);
    };
    window.addEventListener("pointerdown", onOutsideDown);
    return () => window.removeEventListener("pointerdown", onOutsideDown);
  }, [wheelActive]);

  useEffect(() => {
    const el = plotContainerRef.current;
    if (!el) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      const meta = wheelMetaRef.current;
      const isSolo = Boolean(el.closest("[data-panel-solo='true']"));
      if (!meta.wheelActive && !isSolo && !e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const mx = ((e.clientX - rect.left) / rect.width) * meta.svgW;
      const my = ((e.clientY - rect.top) / rect.height) * meta.svgH;
      const u = Math.max(0, Math.min(1, (mx - meta.left) / Math.max(1, meta.right - meta.left)));
      const v = Math.max(0, Math.min(1, (meta.bottom - my) / Math.max(1, meta.bottom - meta.top)));
      const factor = Math.exp(e.deltaY * 0.0015);
      setZoomedToBrush(false);
      setWheelView(curr => {
        const curXMin = curr?.xMin ?? meta.viewXMin;
        const curXMax = curr?.xMax ?? meta.viewXMax;
        const curYMin = curr?.yMin ?? meta.viewYMin;
        const curYMax = curr?.yMax ?? meta.viewYMax;
        const fullSpanX = Math.max(0.2, meta.fullXMax * 2);
        const fullSpanY = Math.max(0.2, meta.fullYMax);
        const nextSpanX = Math.max(fullSpanX / 20, Math.min(fullSpanX, (curXMax - curXMin) * factor));
        const nextSpanY = Math.max(fullSpanY / 20, Math.min(fullSpanY, (curYMax - curYMin) * factor));
        if (nextSpanX >= fullSpanX * 0.985 && nextSpanY >= fullSpanY * 0.985) return null;
        const anchorX = curXMin + u * (curXMax - curXMin);
        const anchorY = curYMin + v * (curYMax - curYMin);
        let xMin = anchorX - u * nextSpanX;
        let xMax = xMin + nextSpanX;
        if (xMin < -meta.fullXMax) { xMin = -meta.fullXMax; xMax = xMin + nextSpanX; }
        if (xMax > meta.fullXMax) { xMax = meta.fullXMax; xMin = xMax - nextSpanX; }
        let yMin = anchorY - v * nextSpanY;
        let yMax = yMin + nextSpanY;
        if (yMin < 0) { yMin = 0; yMax = nextSpanY; }
        if (yMax > meta.fullYMax) { yMax = meta.fullYMax; yMin = Math.max(0, yMax - nextSpanY); }
        return { xMin, xMax, yMin, yMax };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const pointerPosition = (event: PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    return matrix ? point.matrixTransform(matrix.inverse()) : null;
  };

  const axes = { left, right, top, bottom, xMin: view.xMin, xMax: view.xMax, yMin: view.yMin, yMax: view.yMax };
  const x = (value: number) => left + ((value - view.xMin) / (view.xMax - view.xMin)) * (right - left);
  const y = (value: number) => bottom - ((value - view.yMin) / (view.yMax - view.yMin)) * (bottom - top);
  const counts = useMemo(() => volcanoSummaryCounts(points, pCutoff, fcCutoff), [points, pCutoff, fcCutoff]);
  const testedNeighbors = useMemo(
    () => (networkNeighborIds?.size ? points.filter(p => networkNeighborIds.has(p.protein_id)) : []),
    [points, networkNeighborIds],
  );
  const orderedPoints = useMemo(
    () => orderVolcanoPoints(points, pCutoff, fcCutoff, matchingIds, focus, hasFilters, showNeighbors ? networkNeighborIds : undefined),
    [points, pCutoff, fcCutoff, matchingIds, focus, hasFilters, showNeighbors, networkNeighborIds],
  );
  const screenPoints = useMemo(
    () => {
      const px = (value: number) => left + ((value - view.xMin) / (view.xMax - view.xMin)) * (right - left);
      const py = (value: number) => bottom - ((value - view.yMin) / (view.yMax - view.yMin)) * (bottom - top);
      return orderedPoints.flatMap(p => {
        const yData = negativeLogP(p.adj_p);
        if (p.log2_fc < view.xMin || p.log2_fc > view.xMax || yData < view.yMin || yData > view.yMax) return [];
        return [{ point: p, sx: px(p.log2_fc), sy: py(yData) }];
      });
    },
    [orderedPoints, view, left, right, top, bottom],
  );
  const findNearestPoints = (pt: { x: number; y: number }, maxDistPx: number, clusterDistPx: number) => {
    let best: { point: Point; sx: number; sy: number; dist: number; orderIdx: number } | null = null;
    const cluster: { point: Point; dist: number; orderIdx: number }[] = [];
    for (let i = screenPoints.length - 1; i >= 0; i--) {
      const item = screenPoints[i];
      const dx = item.sx - pt.x;
      const dy = item.sy - pt.y;
      if (Math.abs(dx) > maxDistPx || Math.abs(dy) > maxDistPx) continue;
      const d = Math.hypot(dx, dy);
      if (d <= maxDistPx) {
        if (!best || d < best.dist - 0.5 || (Math.abs(d - best.dist) <= 0.5 && i > best.orderIdx)) {
          best = { ...item, dist: d, orderIdx: i };
        }
        if (d <= clusterDistPx) cluster.push({ point: item.point, dist: d, orderIdx: i });
      }
    }
    cluster.sort((a, b) => (Math.abs(a.dist - b.dist) < 1.5 ? b.orderIdx - a.orderIdx : a.dist - b.dist));
    return { best, cluster };
  };
  const callouts = useMemo(
    () => (showLabels
      ? selectVolcanoCallouts(points, { pCutoff, fcCutoff, matchingIds, hasFilters, focusId: focus, maxCallouts: 6 })
      : []),
    [showLabels, points, pCutoff, fcCutoff, matchingIds, hasFilters, focus],
  );

  const selected = points.find(p => p.protein_id === focus);
  const hovered = activeHoverId ? points.find(p => p.protein_id === activeHoverId) : undefined;
  const inspected = hovered ?? selected;
  const inspectedLocalPdb = inspected ? LOCAL_STRUCTURE_PDB[inspected.protein_id] : undefined;
  const focusLocalPdb = LOCAL_STRUCTURE_PDB[focus];

  const tick = (value: number) => Math.abs(value) >= 10000 ? value.toExponential(0) : Number(value.toPrecision(4)).toString();
  const pointTitle = (p: Point) => {
    const dir = volcanoDirection(p, pCutoff, fcCutoff);
    const dirLabel = dir === "up" ? "Higher in Human" : dir === "down" ? "Higher in QC" : "Does not pass";
    return `${p.gene || p.protein_id} (${p.protein_id})${p.organism ? ` · ${p.organism}` : ""} · log₂FC ${p.log2_fc.toFixed(2)} · adj p ${p.adj_p.toExponential(2)} · ${dirLabel}`;
  };
  const bounds = preview ?? brush;
  const manualBounds = brush ?? { minFc: -fullXMax, maxFc: fullXMax, minY: 0, maxY: fullYMax };

  const inView = (p: Point) => {
    const py = negativeLogP(p.adj_p);
    return p.log2_fc >= view.xMin && p.log2_fc <= view.xMax && py >= view.yMin && py <= view.yMax;
  };

  const placedCallouts = useMemo(() => {
    const projectX = (value: number) => left + ((value - view.xMin) / (view.xMax - view.xMin)) * (right - left);
    const projectY = (value: number) => bottom - ((value - view.yMin) / (view.yMax - view.yMin)) * (bottom - top);
    const placed: { point: Point; px: number; py: number; lx: number; ly: number; anchor: "start" | "middle" | "end" }[] = [];
    for (const point of callouts) {
      const pyData = negativeLogP(point.adj_p);
      if (point.log2_fc < view.xMin || point.log2_fc > view.xMax || pyData < view.yMin || pyData > view.yMax) continue;
      const px = projectX(point.log2_fc);
      const py = projectY(pyData);
      let anchor: "start" | "middle" | "end" = "start";
      let lx = px + 8 * uiScale;
      if (px > right - 90 * uiScale) {
        anchor = "end";
        lx = px - 8 * uiScale;
      }
      const minLy = top + 28 * uiScale;
      const sepX = 76 * uiScale;
      const sepY = 16 * uiScale;
      let ly = Math.max(minLy, py - 8 * uiScale);
      for (const prev of placed) {
        if (Math.abs(lx - prev.lx) < sepX && Math.abs(ly - prev.ly) < sepY) {
          ly = prev.ly + sepY <= bottom - 10 * uiScale ? prev.ly + sepY : Math.max(minLy, prev.ly - sepY);
        }
      }
      ly = Math.max(minLy, Math.min(bottom - 8 * uiScale, ly));
      lx = Math.max(left + 6 * uiScale, Math.min(right - 6 * uiScale, lx));
      placed.push({ point, px, py, lx, ly, anchor });
    }
    return placed;
  }, [callouts, view, left, right, top, bottom, uiScale]);

  const startThresholdDrag = (kind: "p" | "fc-left" | "fc-right", e: PointerEvent<SVGElement>) => {
    if (boxSelect || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const svgEl = e.currentTarget.ownerSVGElement;
    svgEl?.setPointerCapture(e.pointerId);
    thresholdDragRef.current = {
      kind,
      axes: { left, right, top, bottom, xMin: view.xMin, xMax: view.xMax, yMin: view.yMin, yMax: view.yMax },
    };
    setThresholdDrag(kind);
    setHoveredThreshold(kind);
    setHoveredId(null);
    setClusterMenu(null);
  };

  const formatPCutoff = (value: number) => (value >= 0.001 ? Number(value.toPrecision(2)).toString() : value.toExponential(1));

  const compactHud = plotW < 470 * hudScale;
  const sidePillW = Math.round((compactHud ? 96 : 146) * hudScale);
  const centerPillW = Math.round((compactHud ? 124 : 184) * hudScale);
  const pillH = Math.round(22 * hudScale);
  const pillY = Math.max(3, Math.round((top - pillH) / 2));

  return <section id="real-volcano" className="group relative flex flex-1 min-h-0 min-w-0 flex-col scroll-mt-6">
    <div
      className={`absolute bottom-[calc(100%+36px)] left-0 right-0 z-40 flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-slate-200/90 bg-white/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-sm transition-opacity duration-150 after:content-[''] after:absolute after:inset-x-0 after:top-full after:h-2 ${boxSelect || pinnedControls || editingInput ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none group-hover/panel:opacity-100 group-hover/panel:pointer-events-auto group-hover:opacity-100 group-hover:pointer-events-auto"}`}
      onFocusCapture={e => { if ((e.target as Element).tagName === "INPUT") setEditingInput(true); }}
      onBlurCapture={() => setEditingInput(false)}
      aria-label="Volcano parameters toolbar"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="inline-flex overflow-hidden rounded border border-slate-300" role="group" aria-label="Volcano interaction mode">
          <button type="button" aria-pressed={!boxSelect} onClick={() => setBoxSelect(false)} className={`px-2 py-0.5 ${!boxSelect ? "bg-teal-800 text-white font-medium" : "bg-white text-slate-700 hover:bg-slate-50"}`}>Inspect</button>
          <button type="button" aria-pressed={boxSelect} onClick={() => { setBoxSelect(true); setClusterMenu(null); }} className={`border-l border-slate-300 px-2 py-0.5 ${boxSelect ? "bg-teal-800 text-white font-medium" : "bg-white text-slate-700 hover:bg-slate-50"}`}>Box select</button>
        </div>
        <button type="button" disabled={!brush} onClick={() => { setZoomedToBrush(false); onBrush(null); setPreview(null); }} className="rounded border border-slate-300 bg-white px-2 py-0.5 disabled:opacity-40 hover:bg-slate-50">Clear</button>
        {brush && <button type="button" aria-pressed={isZoomed} onClick={() => setZoomedToBrush(z => !z)} className={`rounded border px-2 py-0.5 ${isZoomed ? "border-teal-700 bg-teal-50 text-teal-900 font-medium" : "border-slate-300 bg-white hover:bg-slate-50"}`}>{isZoomed ? "Full view" : "Zoom"}</button>}
        <VolcanoBrushInputs key={JSON.stringify(manualBounds)} bounds={manualBounds} onApply={next => { onBrush(next); }} />
        <label className="flex cursor-pointer select-none items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-700">
          <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} />
          Labels
        </label>
        <label className="flex cursor-pointer select-none items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-700">
          <input type="checkbox" checked={showNeighbors} onChange={e => setShowNeighbors(e.target.checked)} />
          Neighbors ({testedNeighbors.length})
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ThresholdInput
          label="adj.p <"
          value={pCutoff}
          min={1e-300}
          max={1}
          onStep={dir => setPCutoff(stepSignificanceCutoff(pCutoff, dir))}
          formatValue={v => (v >= 0.001 ? Number(v.toPrecision(2)).toString() : v.toExponential(1))}
          onChange={setPCutoff}
        />
        <ThresholdInput
          label="|log₂FC| >"
          value={fcCutoff}
          min={0}
          max={1000000}
          onStep={dir => setFcCutoff(stepFoldChangeCutoff(fcCutoff, dir))}
          formatValue={v => Number(v.toFixed(2)).toString()}
          onChange={setFcCutoff}
        />
        <div className="inline-flex items-center gap-1" title="Jump to local 3D structure">
          <span className="text-[11px] text-slate-500">3D:</span>
          {LOCAL_STRUCTURE_PROTEINS.map(item => (
            <button
              key={item.protein_id}
              type="button"
              onClick={() => { onChoose(item.protein_id); onOpenPanel?.("structure"); }}
              className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors ${focus === item.protein_id ? "border-teal-700 bg-teal-50 font-semibold text-teal-900" : "border-slate-200 bg-white text-slate-700 hover:bg-teal-50"}`}
              title={`${item.gene} (${item.protein_id}) · PDB ${item.pdb_id}`}
            >
              {item.pdb_id}
            </button>
          ))}
        </div>
        <a href="#real-results" onClick={e => { if (onViewResults) { e.preventDefault(); onViewResults(); } }} className="rounded border border-teal-700/40 bg-teal-50/60 px-2 py-0.5 font-medium text-teal-900 hover:bg-teal-50">Table ({matchingIds.size.toLocaleString()})</a>
        <button
          type="button"
          aria-pressed={pinnedControls}
          onClick={() => setPinnedControls(p => !p)}
          className={`rounded border px-2 py-0.5 ${pinnedControls ? "border-teal-700 bg-teal-50 font-semibold text-teal-900" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
          title="Keep parameter bar open"
        >
          {pinnedControls ? "Pinned" : "Pin"}
        </button>
      </div>
    </div>
    <div
      ref={plotContainerRef}
      onPointerDownCapture={() => setWheelActive(true)}
      className="relative flex-1 min-h-[210px] w-full overflow-visible"
      tabIndex={0}
      role="region"
      aria-label="Human minus QC volcano chart."
    >
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        data-no-panel-drag={boxSelect || hoveredId || hoveredThreshold || thresholdDrag ? "true" : undefined}
        className="block h-full w-full"
        preserveAspectRatio="none"
        style={{
          touchAction: boxSelect || thresholdDrag ? "none" : "auto",
          cursor:
            thresholdDrag === "p" || hoveredThreshold === "p"
              ? "ns-resize"
              : thresholdDrag || hoveredThreshold
                ? "ew-resize"
                : boxSelect
                  ? "crosshair"
                  : hoveredId
                    ? "pointer"
                    : "grab",
        }}
        role="group"
        tabIndex={0}
        aria-label="Volcano plot of Human minus QC with numeric axes and current threshold lines. Select a point or draw a selection in Box select mode."
        onPointerDown={e => {
          if (e.button !== 0) return;
          const point = pointerPosition(e);
          if (boxSelect) {
            if (!point || point.x < left || point.x > right || point.y < top || point.y > bottom) return;
            e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = point; setPreview(brushFromPixels(point, point, axes));
            return;
          }
          pointerDownAt.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={e => {
          const point = pointerPosition(e);
          if (thresholdDragRef.current && point) {
            const { kind, axes: snapAxes } = thresholdDragRef.current;
            if (kind === "p") {
              const clampedY = Math.max(snapAxes.top + 4, Math.min(snapAxes.bottom, point.y));
              const negLogP = snapAxes.yMin + ((snapAxes.bottom - clampedY) / Math.max(1, snapAxes.bottom - snapAxes.top)) * (snapAxes.yMax - snapAxes.yMin);
              const rawP = negLogP <= 0 ? 1 : Math.pow(10, -Math.min(300, negLogP));
              const nextP = rawP >= 0.98 ? 1 : Math.max(1e-300, Number(rawP.toPrecision(2)));
              setPCutoff(nextP);
            } else {
              const clampedX = Math.max(snapAxes.left, Math.min(snapAxes.right, point.x));
              const rawFc = snapAxes.xMin + ((clampedX - snapAxes.left) / Math.max(1, snapAxes.right - snapAxes.left)) * (snapAxes.xMax - snapAxes.xMin);
              const nextFc = Math.max(0, Math.round(Math.abs(rawFc) * 20) / 20);
              setFcCutoff(nextFc);
            }
            return;
          }
          if (drag.current && point) {
            setPreview(brushFromPixels(drag.current, point, axes));
            return;
          }
          if (boxSelect || hoveredThreshold || !point || point.x < left || point.x > right || point.y < top || point.y > bottom) {
            if (hoveredId !== null) { setHoveredId(null); setNearbyCount(0); onHoverProtein?.(null); }
            return;
          }
          const snapR = 18 * uiScale;
          const clusterR = 12 * uiScale;
          const { best, cluster } = findNearestPoints(point, snapR, clusterR);
          const nextId = best?.point.protein_id ?? null;
          if (nextId !== hoveredId) {
            setHoveredId(nextId);
            onHoverProtein?.(nextId);
          }
          if (cluster.length !== nearbyCount) setNearbyCount(cluster.length);
        }}
        onPointerUp={e => {
          if (thresholdDragRef.current) {
            thresholdDragRef.current = null;
            setThresholdDrag(null);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            return;
          }
          const point = pointerPosition(e), start = drag.current;
          drag.current = null; setPreview(null);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          if (boxSelect) {
            pointerDownAt.current = null;
            if (start && point && Math.hypot(point.x - start.x, point.y - start.y) >= 5) onBrush(brushFromPixels(start, point, axes));
            return;
          }
          const down = pointerDownAt.current;
          pointerDownAt.current = null;
          if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 5) return;
          if (!point || point.x < left || point.x > right || point.y < top || point.y > bottom) {
            setClusterMenu(null);
            return;
          }
          const { best, cluster } = findNearestPoints(point, 18 * uiScale, 12 * uiScale);
          if (!best) {
            setClusterMenu(null);
            return;
          }
          onChoose(best.point.protein_id);
          if (cluster.length > 1) {
            const clampedX = Math.max(left + 8, Math.min(right - 224, point.x + 12));
            const clampedY = Math.max(top + 8, Math.min(bottom - Math.min(220, cluster.slice(0, 8).length * 26 + 38), point.y + 12));
            setClusterMenu({ x: clampedX, y: clampedY, items: cluster.slice(0, 8) });
          } else {
            setClusterMenu(null);
          }
        }}
        onPointerCancel={() => {
          thresholdDragRef.current = null;
          setThresholdDrag(null);
          setHoveredThreshold(null);
          drag.current = null;
          pointerDownAt.current = null;
          setPreview(null);
        }}
        onPointerLeave={() => {
          if (!thresholdDragRef.current) setHoveredThreshold(null);
          if (hoveredId !== null) { setHoveredId(null); setNearbyCount(0); onHoverProtein?.(null); }
        }}
        onKeyDown={e => {
          if (e.key === "Escape") {
            thresholdDragRef.current = null;
            setThresholdDrag(null);
            setHoveredThreshold(null);
            drag.current = null;
            pointerDownAt.current = null;
            setPreview(null);
            setBoxSelect(false);
            setClusterMenu(null);
          }
        }}>
        <defs><clipPath id={clipId}><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath></defs>
        <g aria-label="Volcano HUD counts">
          <rect x={left} y={pillY} width={sidePillW} height={pillH} rx={pillH / 2} fill="#fffbeb" stroke="#fcd34d" />
          <circle cx={left + 12 * hudScale} cy={pillY + pillH / 2} r={4 * hudScale} fill="#b45309" />
          <text x={left + 21 * hudScale} y={pillY + pillH / 2 + hudFontSize * 0.36} fontSize={hudFontSize} fontWeight="600" fill="#92400e">{compactHud ? `← QC: ${counts.down}` : `← QC higher: ${counts.down}`}</text>
          <rect x={(left + right) / 2 - centerPillW / 2} y={pillY} width={centerPillW} height={pillH} rx={pillH / 2} fill="#f8fafc" stroke="#cbd5e1" />
          <text x={(left + right) / 2} y={pillY + pillH / 2 + hudFontSize * 0.36} textAnchor="middle" fontSize={hudFontSize} fontWeight="600" fill="#334155" data-testid="volcano-counts">{compactHud ? `${counts.total.toLocaleString()} · ${counts.passing} pass` : `${counts.total.toLocaleString()} tested · ${counts.passing} pass`}</text>
          <rect x={right - sidePillW} y={pillY} width={sidePillW} height={pillH} rx={pillH / 2} fill="#f0fdfa" stroke="#99f6e4" />
          <circle cx={right - sidePillW + 12 * hudScale} cy={pillY + pillH / 2} r={4 * hudScale} fill="#0f766e" />
          <text x={right - 10 * hudScale} y={pillY + pillH / 2 + hudFontSize * 0.36} textAnchor="end" fontSize={hudFontSize} fontWeight="600" fill="#0f766e">{compactHud ? `Hum: ${counts.up} →` : `Human higher: ${counts.up} →`}</text>
        </g>
        {view.yTicks.map(value => <g key={value}>
          <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#e2e8f0" />
          <text x={left - Math.round(8 * uiScale)} y={y(value) + tickFontSize * 0.36} textAnchor="end" fontSize={tickFontSize} fill="#475569">{tick(value)}</text>
        </g>)}
        {view.xTicks.map(value => <g key={value}>
          <line x1={x(value)} x2={x(value)} y1={top} y2={bottom} stroke={value === 0 ? "#64748b" : "#e2e8f0"} strokeDasharray={value === 0 ? "3 3" : undefined} />
          <text x={x(value)} y={bottom + Math.round(17 * uiScale)} textAnchor="middle" fontSize={tickFontSize} fill="#475569">{tick(value)}</text>
        </g>)}
        {view.xMin < 0 && view.xMax > 0 && !view.xTicks.includes(0) && (
          <line x1={x(0)} x2={x(0)} y1={top} y2={bottom} stroke="#64748b" strokeDasharray="3 3" />
        )}
        <g clipPath={`url(#${clipId})`}>
          {showNeighbors && selected && testedNeighbors.map(nb => (
            <line
              key={`nb-link-${nb.protein_id}`}
              x1={x(selected.log2_fc)}
              y1={y(negativeLogP(selected.adj_p))}
              x2={x(nb.log2_fc)}
              y2={y(negativeLogP(nb.adj_p))}
              stroke="#0d9488"
              strokeOpacity="0.28"
              strokeWidth="1.2"
              strokeDasharray="3 3"
              pointerEvents="none"
            />
          ))}
          {orderedPoints.map(p => {
            const dir = volcanoDirection(p, pCutoff, fcCutoff);
            const matches = matchingIds.has(p.protein_id);
            const isNeighbor = Boolean(showNeighbors && networkNeighborIds?.has(p.protein_id));
            const isHovered = activeHoverId === p.protein_id;
            const isFocus = p.protein_id === focus;
            const baseRadius = isHovered ? 5.2 : isNeighbor || (hasFilters && matches) || dir !== "ns" ? (isZoomed ? 3.5 : 3) : (isZoomed ? 2.8 : 2.3);
            const radius = baseRadius * uiScale;
            const opacity = isHovered || isFocus || isNeighbor ? 0.95 : hasFilters ? (matches ? 0.92 : 0.14) : dir === "ns" ? 0.52 : 0.88;
            return <circle
              key={p.protein_id}
              data-protein-id={p.protein_id}
              data-matches-table={matches}
              data-direction={dir}
              cx={x(p.log2_fc)}
              cy={y(negativeLogP(p.adj_p))}
              r={radius}
              fill={DIRECTION_COLORS[dir]}
              opacity={opacity}
              stroke={isHovered ? "#0f172a" : hasFilters && matches ? "#c2410c" : isNeighbor ? "#0d9488" : "none"}
              strokeWidth={(isHovered ? 2.2 : isNeighbor ? 1.6 : 1.2) * Math.min(1.4, uiScale)}
              style={{ cursor: boxSelect ? "crosshair" : "pointer" }}>
              <title>{pointTitle(p)}</title>
            </circle>;
          })}
          {showNeighbors && testedNeighbors.map(nb => inView(nb) ? (
            <circle
              key={`nb-ring-${nb.protein_id}`}
              cx={x(nb.log2_fc)}
              cy={y(negativeLogP(nb.adj_p))}
              r={5.5 * uiScale}
              fill="none"
              stroke="#0d9488"
              strokeWidth={1.4 * Math.min(1.4, uiScale)}
              strokeOpacity="0.85"
              pointerEvents="none"
            />
          ) : null)}
          {bounds && <rect data-testid="volcano-selection" x={x(bounds.minFc)} y={y(bounds.maxY)} width={x(bounds.maxFc) - x(bounds.minFc)} height={y(bounds.minY) - y(bounds.maxY)} fill="#c2410c" fillOpacity="0.08" stroke="#c2410c" strokeWidth="2" strokeDasharray="4 3" pointerEvents="none" />}
          {[...new Set([-fcCutoff, fcCutoff])].map(value => {
            const activeFc = thresholdDrag === "fc-left" || thresholdDrag === "fc-right" || hoveredThreshold === "fc-left" || hoveredThreshold === "fc-right";
            return (
              <line
                key={value}
                data-testid="volcano-fc-threshold"
                data-value={value}
                x1={x(value)}
                x2={x(value)}
                y1={top}
                y2={bottom}
                stroke={activeFc ? "#c2410c" : "#92400e"}
                strokeWidth={activeFc ? 2.4 : 1.6}
                strokeDasharray="6 4"
                pointerEvents="none"
              />
            );
          })}
          {(() => {
            const activeP = thresholdDrag === "p" || hoveredThreshold === "p";
            return (
              <line
                data-testid="volcano-p-threshold"
                data-value={pCutoff}
                x1={left}
                x2={right}
                y1={y(negativeLogP(pCutoff))}
                y2={y(negativeLogP(pCutoff))}
                stroke={activeP ? "#c2410c" : "#92400e"}
                strokeWidth={activeP ? 2.4 : 1.6}
                strokeDasharray="6 4"
                pointerEvents="none"
              />
            );
          })()}
          {selected && inView(selected) && (() => {
            const sx = x(selected.log2_fc);
            const sy = y(negativeLogP(selected.adj_p));
            const sDir = volcanoDirection(selected, pCutoff, fcCutoff);
            const sColor = DIRECTION_COLORS[sDir];
            const sName = selected.gene || selected.protein_id;
            const badgeW = Math.min(180, Math.max(78, sName.length * 7.5 + 48)) * Math.min(1.25, uiScale);
            const badgeH = 20 * Math.min(1.25, uiScale);
            const placeLeft = sx > right - badgeW - 18;
            const bx = placeLeft ? Math.max(left + 6, sx - badgeW - 14 * uiScale) : Math.min(right - badgeW - 6, sx + 14 * uiScale);
            const by = Math.max(top + 28 * uiScale, Math.min(bottom - badgeH - 6, sy - badgeH / 2));
            return <g pointerEvents="none" aria-label="Selected protein beacon">
              <line x1={sx} x2={sx} y1={top} y2={bottom} stroke="#0f172a" strokeOpacity="0.38" strokeWidth="1.2" strokeDasharray="4 3" />
              <line x1={left} x2={right} y1={sy} y2={sy} stroke="#0f172a" strokeOpacity="0.38" strokeWidth="1.2" strokeDasharray="4 3" />
              <circle cx={sx} cy={sy} r={11.5 * uiScale} fill={sColor} fillOpacity="0.16" stroke={sColor} strokeWidth={1.4 * Math.min(1.3, uiScale)} strokeOpacity="0.85" />
              <circle cx={sx} cy={sy} r={7.5 * uiScale} fill="none" stroke="#ffffff" strokeWidth={2.6 * Math.min(1.3, uiScale)} />
              <circle cx={sx} cy={sy} r={5.6 * uiScale} fill={sColor} stroke="#0f172a" strokeWidth={2.2 * Math.min(1.3, uiScale)}><title>{pointTitle(selected)} · selected</title></circle>
              <line x1={sx} y1={sy} x2={placeLeft ? bx + badgeW : bx} y2={by + badgeH / 2} stroke="#0f172a" strokeWidth="1.2" strokeOpacity="0.65" />
              <rect x={bx} y={by} width={badgeW} height={badgeH} rx={badgeH / 2} fill="#0f172a" fillOpacity="0.92" />
              <text x={bx + badgeW / 2} y={by + badgeH * 0.68} textAnchor="middle" fontSize={Math.round(10.5 * Math.min(1.25, uiScale))} fontWeight="700" fill="#ffffff">
                ✓ {sName} ({selected.log2_fc >= 0 ? "+" : ""}{selected.log2_fc.toFixed(1)})
              </text>
            </g>;
          })()}
          {hovered && hovered.protein_id !== selected?.protein_id && inView(hovered) && (() => {
            const hx = x(hovered.log2_fc);
            const hy = y(negativeLogP(hovered.adj_p));
            const hName = hovered.gene || hovered.protein_id;
            const sub = nearbyCount > 1 ? `FC ${hovered.log2_fc.toFixed(2)} · p ${hovered.adj_p.toExponential(1)} (+${nearbyCount - 1})` : `FC ${hovered.log2_fc.toFixed(2)} · p ${hovered.adj_p.toExponential(1)}`;
            const tipW = Math.max(138, Math.max(hName.length * 7.5, sub.length * 6.2) + 22) * Math.min(1.2, uiScale);
            const tipH = 34 * Math.min(1.2, uiScale);
            const tx = hx + 14 + tipW > right ? Math.max(left + 6, hx - tipW - 14) : hx + 14;
            const ty = hy - tipH - 8 < top + 24 ? Math.min(bottom - tipH - 6, hy + 12) : hy - tipH - 8;
            return <g pointerEvents="none" aria-label="Hovered protein guide">
              <line x1={hx} x2={hx} y1={top} y2={bottom} stroke="#0f766e" strokeOpacity="0.28" strokeDasharray="2 3" />
              <line x1={left} x2={right} y1={hy} y2={hy} stroke="#0f766e" strokeOpacity="0.28" strokeDasharray="2 3" />
              <circle cx={hx} cy={hy} r={9 * uiScale} fill="none" stroke="#0f766e" strokeWidth={1.8 * Math.min(1.3, uiScale)} />
              <rect x={tx} y={ty} width={tipW} height={tipH} rx="6" fill="#ffffff" fillOpacity="0.96" stroke="#0f766e" strokeWidth="1.2" />
              <text x={tx + 8} y={ty + 13 * Math.min(1.2, uiScale)} fontSize={Math.round(10.5 * Math.min(1.2, uiScale))} fontWeight="700" fill="#0f172a">
                {hName} {hovered.gene ? `(${hovered.protein_id})` : ""}
              </text>
              <text x={tx + 8} y={ty + 27 * Math.min(1.2, uiScale)} fontSize={Math.round(9.5 * Math.min(1.2, uiScale))} fill="#0f766e">
                {sub}
              </text>
            </g>;
          })()}
          {placedCallouts.filter(({ point }) => point.protein_id !== focus).map(({ point, px, py, lx, ly, anchor }) => {
            const label = point.gene || point.protein_id;
            return <g key={`callout-${point.protein_id}`} pointerEvents="none">
              <line x1={px} y1={py} x2={lx} y2={ly} stroke="#64748b" strokeWidth="1" strokeOpacity="0.7" />
              <text x={lx} y={ly} textAnchor={anchor} fontSize={calloutFontSize} fontWeight="600" fill="#334155" paintOrder="stroke" stroke="#ffffff" strokeWidth="3.5" strokeLinejoin="round">
                {label}
              </text>
            </g>;
          })}
        </g>
        {!boxSelect && (
          <g aria-label="Draggable threshold handles">
            {-fcCutoff >= view.xMin && -fcCutoff <= view.xMax && (
              <line
                x1={x(-fcCutoff)}
                x2={x(-fcCutoff)}
                y1={top}
                y2={bottom}
                stroke="transparent"
                strokeWidth={14}
                style={{ cursor: "ew-resize" }}
                onPointerEnter={() => setHoveredThreshold("fc-left")}
                onPointerLeave={() => { if (!thresholdDragRef.current) setHoveredThreshold(curr => curr === "fc-left" ? null : curr); }}
                onPointerDown={e => startThresholdDrag("fc-left", e)}
              >
                <title>Drag horizontally to adjust |log₂FC| threshold</title>
              </line>
            )}
            {fcCutoff >= view.xMin && fcCutoff <= view.xMax && (
              <line
                x1={x(fcCutoff)}
                x2={x(fcCutoff)}
                y1={top}
                y2={bottom}
                stroke="transparent"
                strokeWidth={14}
                style={{ cursor: "ew-resize" }}
                onPointerEnter={() => setHoveredThreshold("fc-right")}
                onPointerLeave={() => { if (!thresholdDragRef.current) setHoveredThreshold(curr => curr === "fc-right" ? null : curr); }}
                onPointerDown={e => startThresholdDrag("fc-right", e)}
              >
                <title>Drag horizontally to adjust |log₂FC| threshold</title>
              </line>
            )}
            {negativeLogP(pCutoff) >= view.yMin && negativeLogP(pCutoff) <= view.yMax && (
              <line
                x1={left}
                x2={right}
                y1={y(negativeLogP(pCutoff))}
                y2={y(negativeLogP(pCutoff))}
                stroke="transparent"
                strokeWidth={14}
                style={{ cursor: "ns-resize" }}
                onPointerEnter={() => setHoveredThreshold("p")}
                onPointerLeave={() => { if (!thresholdDragRef.current) setHoveredThreshold(curr => curr === "p" ? null : curr); }}
                onPointerDown={e => startThresholdDrag("p", e)}
              >
                <title>Drag vertically to adjust adj.p threshold</title>
              </line>
            )}
          </g>
        )}
        {-fcCutoff >= view.xMin && -fcCutoff <= view.xMax && (
          <text
            x={x(-fcCutoff) - 4}
            y={top + Math.round(14 * uiScale)}
            textAnchor="end"
            fontSize={Math.round(11 * Math.min(1.4, uiScale))}
            fontWeight={hoveredThreshold === "fc-left" || thresholdDrag === "fc-left" ? "700" : "500"}
            fill={hoveredThreshold === "fc-left" || thresholdDrag === "fc-left" ? "#c2410c" : "#92400e"}
            paintOrder="stroke"
            stroke="white"
            strokeWidth="3"
            style={{ cursor: boxSelect ? undefined : "ew-resize" }}
            onPointerEnter={() => { if (!boxSelect) setHoveredThreshold("fc-left"); }}
            onPointerLeave={() => { if (!thresholdDragRef.current) setHoveredThreshold(curr => curr === "fc-left" ? null : curr); }}
            onPointerDown={e => startThresholdDrag("fc-left", e)}
          >
            {fcCutoff === 0 ? "" : "−"}{tick(fcCutoff)}
          </text>
        )}
        {fcCutoff > 0 && fcCutoff >= view.xMin && fcCutoff <= view.xMax && (
          <text
            x={x(fcCutoff) + 4}
            y={top + Math.round(14 * uiScale)}
            fontSize={Math.round(11 * Math.min(1.4, uiScale))}
            fontWeight={hoveredThreshold === "fc-right" || thresholdDrag === "fc-right" ? "700" : "500"}
            fill={hoveredThreshold === "fc-right" || thresholdDrag === "fc-right" ? "#c2410c" : "#92400e"}
            paintOrder="stroke"
            stroke="white"
            strokeWidth="3"
            style={{ cursor: boxSelect ? undefined : "ew-resize" }}
            onPointerEnter={() => { if (!boxSelect) setHoveredThreshold("fc-right"); }}
            onPointerLeave={() => { if (!thresholdDragRef.current) setHoveredThreshold(curr => curr === "fc-right" ? null : curr); }}
            onPointerDown={e => startThresholdDrag("fc-right", e)}
          >
            +{tick(fcCutoff)}
          </text>
        )}
        {negativeLogP(pCutoff) >= view.yMin && negativeLogP(pCutoff) <= view.yMax && (
          <text
            x={right - 4}
            y={Math.max(top + Math.round(28 * uiScale), y(negativeLogP(pCutoff)) - 5)}
            textAnchor="end"
            fontSize={Math.round(11 * Math.min(1.4, uiScale))}
            fontWeight={hoveredThreshold === "p" || thresholdDrag === "p" ? "700" : "500"}
            fill={hoveredThreshold === "p" || thresholdDrag === "p" ? "#c2410c" : "#92400e"}
            paintOrder="stroke"
            stroke="white"
            strokeWidth="3"
            style={{ cursor: boxSelect ? undefined : "ns-resize" }}
            onPointerEnter={() => { if (!boxSelect) setHoveredThreshold("p"); }}
            onPointerLeave={() => { if (!thresholdDragRef.current) setHoveredThreshold(curr => curr === "p" ? null : curr); }}
            onPointerDown={e => startThresholdDrag("p", e)}
          >
            adj.p={formatPCutoff(pCutoff)}
          </text>
        )}
        <g aria-label="Volcano inline legend" transform={`translate(${left + Math.round(6 * uiScale)}, ${top + Math.round(8 * uiScale)}) scale(${Math.min(1.45, uiScale)})`} pointerEvents="none">
          <rect x="0" y="0" width={hasFilters ? 228 : 154} height="22" rx="4" fill="#ffffff" fillOpacity="0.9" stroke="#e2e8f0" />
          <circle cx="10" cy="11" r="3.8" fill="none" stroke="#0f172a" strokeWidth="1.6" />
          <text x="18" y="14.5" fontSize="10.8" fill="#334155">Focus</text>
          <circle cx="60" cy="11" r="3.8" fill="none" stroke="#0d9488" strokeWidth="1.5" />
          <text x="68" y="14.5" fontSize="10.8" fill="#334155">Neighbor ({testedNeighbors.length})</text>
          {hasFilters && <>
            <circle cx="149" cy="11" r="3.8" fill="none" stroke="#c2410c" strokeWidth="1.6" />
            <text x="157" y="14.5" fontSize="10.8" fill="#334155">Filter ({matchingIds.size})</text>
          </>}
        </g>
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#64748b" />
        <line x1={left} x2={left} y1={top} y2={bottom} stroke="#64748b" />
        <text x={(left + right) / 2} y={svgH - Math.round(8 * uiScale)} textAnchor="middle" fontSize={axisTitleSize} fill="#334155">log₂ fold change (Human − QC)</text>
        <text transform={`translate(${Math.round(15 * uiScale)} ${(top + bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize={axisTitleSize} fill="#334155">−log₁₀ adjusted p</text>
      </svg>
      {wheelView && (
        <button
          type="button"
          onClick={() => setWheelView(null)}
          className="absolute bottom-2 left-2 z-20 rounded border border-slate-300/90 bg-white/90 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-700 shadow-sm backdrop-blur-sm hover:bg-teal-50 hover:text-teal-900"
          title="Reset volcano zoom"
        >
          {Math.round(((fullXMax * 2) / Math.max(0.05, wheelView.xMax - wheelView.xMin)) * 100)}% · Reset
        </button>
      )}
      {clusterMenu && (
        <div
          className="absolute z-50 w-56 rounded-lg border border-teal-700/40 bg-white/95 p-1.5 text-xs shadow-xl backdrop-blur-sm"
          style={{ left: clusterMenu.x, top: clusterMenu.y }}
          role="dialog"
          aria-label="Choose protein from overlapping points"
          onPointerDown={e => e.stopPropagation()}
        >
          <div className="mb-1 flex items-center justify-between border-b border-slate-100 px-1.5 pb-1 text-[10.5px] font-semibold text-slate-600">
            <span>{clusterMenu.items.length} nearby</span>
            <button type="button" onClick={() => setClusterMenu(null)} className="rounded px-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Close">×</button>
          </div>
          <div className="max-h-44 space-y-0.5 overflow-auto">
            {clusterMenu.items.map(({ point }) => {
              const isSel = point.protein_id === focus;
              const dir = volcanoDirection(point, pCutoff, fcCutoff);
              const dotColor = DIRECTION_COLORS[dir];
              return (
                <button
                  key={point.protein_id}
                  type="button"
                  onClick={() => { onChoose(point.protein_id); setClusterMenu(null); }}
                  className={`flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left transition-colors ${isSel ? "bg-teal-800 text-white font-semibold" : "hover:bg-teal-50 text-slate-800"}`}
                >
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: isSel ? "#ffffff" : dotColor }} />
                    <span className="truncate">{point.gene || point.protein_id}</span>
                  </span>
                  <span className={`shrink-0 font-mono text-[10px] ${isSel ? "text-teal-100" : "text-slate-500"}`}>
                    {point.log2_fc >= 0 ? "+" : ""}{point.log2_fc.toFixed(1)} · {point.adj_p.toExponential(0)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div
        className={`pointer-events-none absolute top-[calc(100%+6px)] left-2 right-2 z-30 flex flex-wrap items-center gap-1.5 transition-opacity duration-150 before:content-[''] before:absolute before:inset-x-0 before:bottom-full before:h-3 [&_a]:pointer-events-auto [&_button]:pointer-events-auto ${hovered || brush ? "opacity-100" : "opacity-0 group-hover/panel:opacity-100 group-hover:opacity-100"}`}
        data-testid="volcano-inspector"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200/90 bg-white/90 px-2 py-1 text-[11px] text-slate-700 shadow-sm backdrop-blur-sm">
          {inspected ? (() => {
            const dir = volcanoDirection(inspected, pCutoff, fcCutoff);
            const fromNetworkHover = Boolean(hovered && hoveredProteinId && !hoveredId);
            return <>
              <span className="font-semibold text-slate-900">{fromNetworkHover ? "Net:" : hovered ? "Hover:" : "Focus:"} {inspected.gene || inspected.protein_id}</span>
              <span className="font-mono text-[10.5px] text-slate-500">{inspected.protein_id}</span>
              {inspected.organism && <span className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px]">{inspected.organism.split(" ")[0]}</span>}
              <span className={`rounded px-1.5 py-0.5 font-medium ${dir === "up" ? "bg-teal-100 text-teal-900" : dir === "down" ? "bg-amber-100 text-amber-900" : "bg-slate-200 text-slate-700"}`}>
                FC {inspected.log2_fc.toFixed(2)} · p {inspected.adj_p.toExponential(1)}
              </span>
              {hasFilters && matchingIds.has(inspected.protein_id) && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-900">Filter</span>}
              {networkNeighborIds?.has(inspected.protein_id) && <span className="rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-900">Neighbor</span>}
              {inspectedLocalPdb && onOpenPanel && (
                <button type="button" onClick={() => { onChoose(inspected.protein_id); onOpenPanel("structure"); }} className="rounded border border-teal-700 bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-teal-900 hover:bg-teal-50">
                  3D:{inspectedLocalPdb}
                </button>
              )}
            </>;
          })() : <>
            <span>{focus} · Not tested in Human − QC</span>
            {focusLocalPdb && onOpenPanel && (
              <button type="button" onClick={() => onOpenPanel("structure")} className="rounded border border-teal-700 bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-teal-900 hover:bg-teal-50">
                3D:{focusLocalPdb}
              </button>
            )}
          </>}
          {brush && <span className="rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10.5px] text-orange-900" data-testid="brush-bounds">FC [{brush.minFc.toFixed(1)}, {brush.maxFc.toFixed(1)}] · −logP [{brush.minY.toFixed(1)}, {brush.maxY.toFixed(1)}]{isZoomed ? " · Zoomed" : ""}</span>}
          {selectedSamples && selectedSamples.length > 0 && (
            <span className="flex flex-wrap items-center gap-1 border-l border-slate-300 pl-1.5 text-[10.5px]">
              {selectedSamples.map(sampleId => {
                const obs = focusedAbundance?.find(a => a.sample_id === sampleId);
                return <span key={sampleId} className="rounded border border-slate-200 bg-white px-1 py-0.5">{sampleId}: {obs ? (obs.log2_intensity === null ? <em className="text-amber-800">NA</em> : <strong>{obs.log2_intensity.toFixed(2)}</strong>) : "…"}</span>;
              })}
              {onOpenPanel && <button type="button" onClick={() => onOpenPanel("abundance")} className="text-teal-900 underline underline-offset-2">D2</button>}
            </span>
          )}
        </div>
      </div>
    </div>
  </section>;
}

function ThresholdInput({
  label,
  value,
  min,
  max,
  onStep,
  formatValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onStep: (direction: -1 | 1) => void;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatValue(value));
  const displayValue = editing ? draft : formatValue(value);
  const valid = !editing || (draft.trim() !== "" && Number.isFinite(Number(draft)) && Number(draft) >= min && Number(draft) <= max);
  return <div className="relative">
    <div className="inline-flex items-center overflow-hidden rounded border border-slate-300 bg-white text-xs text-slate-700">
      <label className="flex items-center gap-1 pl-1.5">
        <span>{label}</span>
        <input
          type="number"
          required
          min={min}
          max={max}
          step="any"
          value={displayValue}
          aria-invalid={!valid}
          onFocus={() => { setDraft(formatValue(value)); setEditing(true); }}
          onBlur={() => setEditing(false)}
          onKeyDown={e => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setEditing(false);
              onStep(1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setEditing(false);
              onStep(-1);
            }
          }}
          onChange={e => {
            const next = e.target.value;
            setDraft(next);
            setEditing(true);
            if (next.trim() !== "" && Number.isFinite(Number(next)) && Number(next) >= min && Number(next) <= max) {
              onChange(Number(next));
            }
          }}
          className="w-16 bg-white px-1 py-0.5 text-xs tabular-nums [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </label>
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={value <= min}
        className="border-l border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-700 hover:bg-teal-50 disabled:opacity-35"
        aria-label={`Decrease ${label}`}
        title="Decrease"
      >
        −
      </button>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={value >= max}
        className="border-l border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-700 hover:bg-teal-50 disabled:opacity-35"
        aria-label={`Increase ${label}`}
        title="Increase"
      >
        +
      </button>
    </div>
    {!valid && <p className="absolute left-0 top-full z-10 mt-0.5 whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-800 shadow" role="status">Invalid ({min}–{max})</p>}
  </div>;
}
