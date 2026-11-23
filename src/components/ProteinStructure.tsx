"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  chainBreaks,
  nearestResidue,
  parseCalpha,
  plddtSummary,
  project,
  residueColor,
  residueLabel,
  type ColorMode,
  type Residue,
} from "@/lib/structure";

// Same backend base URL as the rest of the explore view.
const API = process.env.NEXT_PUBLIC_PROTEIN_API ?? "http://127.0.0.1:8000";
const WIDTH = 600;
const HEIGHT = 340;
const DEFAULT_ANGLE: [number, number] = [0.4, 0.3];

export type StructureModel = {
  protein_id: string;
  source: "local" | "pdb" | "alphafold";
  model_id: string;
  chain_id: string | null;
  method: string | null;
  resolution: number | null;
  unp_start: number | null;
  unp_end: number | null;
  coverage: number | null;
  source_url: string;
  coloring: ColorMode;
  coordinates_url: string;
};

type Load =
  | { state: "loading"; key: string }
  | { state: "ready"; key: string; model: StructureModel; chain: string | null; residues: Residue[] }
  | { state: "error"; key: string; code: string; message: string };

/** One sentence that says exactly what is drawn: which entry, chain, method and range. */
export function describeModel(model: StructureModel, residueCount: number): string {
  const parts =
    model.source === "alphafold"
      ? [`AlphaFold prediction ${model.model_id}`]
      : [`PDB ${model.model_id}`, model.chain_id ? `chain ${model.chain_id}` : null, model.method, model.resolution !== null ? `${model.resolution.toFixed(2)} Å` : null];
  if (model.unp_start !== null && model.unp_end !== null) parts.push(`UniProt residues ${model.unp_start}–${model.unp_end}`);
  if (model.coverage !== null) parts.push(`${Math.round(model.coverage * 100)}% of the sequence`);
  parts.push(`${residueCount} Cα drawn`);
  if (model.source === "local") parts.push("bundled file");
  return parts.filter(Boolean).join(" · ");
}

function errorText(code: string, message: string): string {
  switch (code) {
    case "structure_offline": return "Online structure download is turned off on this server, and no bundled file exists for this protein.";
    case "structure_source_unreachable": return "PDBe, RCSB and AlphaFold could not be reached. Check the network or proxy, then retry.";
    case "structure_not_found": return "No experimental structure and no AlphaFold prediction exist for this protein.";
    case "structure_not_uniprot": return "This identifier is not a UniProt accession, so no structure can be looked up.";
    default: return message || "Could not load a structure.";
  }
}

/** Render with `key={proteinId}` so rotation, zoom, color and hover reset per protein. */
export function ProteinStructure({
  proteinId,
  references,
  structureEndpoint,
}: {
  proteinId: string;
  references: { pdb_id: string }[];
  /** Optional Next.js proxy endpoint (e.g. "/api/protein-structure") for standalone/uploaded datasets. */
  structureEndpoint?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = `${proteinId}#${retry}`;
  const [load, setLoad] = useState<Load>({ state: "loading", key });
  const [angle, setAngle] = useState<[number, number]>(DEFAULT_ANGLE);
  const [zoom, setZoom] = useState(1);
  const [wheelActive, setWheelActive] = useState(false);
  const [mode, setMode] = useState<ColorMode | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const wheelActiveRef = useRef(false);

  useEffect(() => {
    wheelActiveRef.current = wheelActive;
  }, [wheelActive]);

  useEffect(() => {
    if (!wheelActive) return;
    const onOutsideDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest("[data-panel-kind='structure']")) setWheelActive(false);
    };
    window.addEventListener("pointerdown", onOutsideDown);
    return () => window.removeEventListener("pointerdown", onOutsideDown);
  }, [wheelActive]);

  useEffect(() => {
    const controller = new AbortController();
    const fail = (code: string, message: string) => setLoad({ state: "error", key, code, message });
    (async () => {
      const metaUrl = structureEndpoint
        ? `${structureEndpoint}?id=${encodeURIComponent(proteinId)}`
        : `${API}/api/v1/proteins/${encodeURIComponent(proteinId)}/structure`;
      const response = await fetch(metaUrl, { signal: controller.signal });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        return fail(body.code ?? `http_${response.status}`, body.message ?? "");
      }
      const model = (await response.json()) as StructureModel;
      const coordUrl = structureEndpoint
        ? model.coordinates_url
        : `${API}${model.coordinates_url}`;
      const coordinates = await fetch(coordUrl, { signal: controller.signal });
      if (!coordinates.ok) return fail(`http_${coordinates.status}`, "Could not download the coordinates.");
      const parsed = parseCalpha(await coordinates.text(), model.chain_id);
      if (!parsed.residues.length) return fail("structure_chain_empty", "The downloaded model has no Cα atoms to draw.");
      setLoad({ state: "ready", key, model, chain: parsed.chain, residues: parsed.residues });
    })().catch(error => {
      if (error?.name !== "AbortError") fail("network", "The structure request failed. Check the connection and try again.");
    });
    return () => controller.abort();
  }, [proteinId, key, structureEndpoint]);

  const current = load.key === key ? load : { state: "loading" as const, key };
  const ready = current.state === "ready" ? current : null;
  const isReady = ready !== null;

  useEffect(() => {
    const el = canvas.current;
    if (!el || !isReady) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      const isSolo = Boolean(el.closest("[data-panel-solo='true']"));
      if (!wheelActiveRef.current && !isSolo && !e.ctrlKey) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0014);
      setZoom(z => {
        const next = Math.max(0.4, Math.min(4, z * factor));
        return Math.abs(next - 1) < 0.03 ? 1 : next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isReady]);
  const residues = ready?.residues ?? [];
  const colorMode: ColorMode = mode ?? ready?.model.coloring ?? "position";
  const points = useMemo(() => project(residues, angle, zoom, WIDTH, HEIGHT), [residues, angle, zoom]);
  const breaks = useMemo(() => chainBreaks(residues), [residues]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (!points.length) return;
    const depths = points.map(p => p.depth);
    const near = Math.max(...depths), far = Math.min(...depths);
    // Painter's algorithm: far bonds first, near bonds thicker and on top.
    const bonds = points.slice(1).map((_, k) => k + 1).filter(i => !breaks.has(i))
      .sort((a, b) => (points[a].depth + points[a - 1].depth) - (points[b].depth + points[b - 1].depth));
    ctx.lineCap = "round";
    for (const i of bonds) {
      const t = near === far ? 1 : ((points[i].depth + points[i - 1].depth) / 2 - far) / (near - far);
      ctx.strokeStyle = residueColor(residues, i, colorMode);
      ctx.globalAlpha = 0.45 + 0.55 * t;
      ctx.lineWidth = 1.2 + 1.8 * t;
      ctx.beginPath();
      ctx.moveTo(points[i - 1].x, points[i - 1].y);
      ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (hovered !== null && points[hovered]) {
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(points[hovered].x, points[hovered].y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [points, breaks, residues, colorMode, hovered]);

  const toCanvas = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.current!.getBoundingClientRect();
    return [(event.clientX - rect.left) * (WIDTH / rect.width), (event.clientY - rect.top) * (HEIGHT / rect.height)];
  };
  const reset = () => { setAngle(DEFAULT_ANGLE); setZoom(1); };
  const hoveredResidue = hovered !== null ? residues[hovered] : undefined;

  return <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="structure-heading">
    <h3 id="structure-heading" className="text-lg font-semibold">Structure</h3>
    {current.state === "loading" && <p className="mt-2 text-sm text-slate-600" role="status">Finding the best available structure… The first request for a protein downloads it and can take several seconds.</p>}
    {current.state === "error" && <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm" role="status" data-testid="structure-error">
      <p>{errorText(current.code, current.message)}</p>
      {current.code === "structure_source_unreachable" || current.code === "network"
        ? <button type="button" onClick={() => setRetry(r => r + 1)} className="mt-2 rounded border border-slate-300 px-3 py-1 hover:bg-white">Retry</button> : null}
    </div>}
    {ready && <>
      <p className="mt-1 text-sm text-slate-600" data-testid="structure-source">
        {describeModel(ready.model, residues.length)} · <a href={ready.model.source_url} target="_blank" rel="noreferrer" className="text-teal-800 underline underline-offset-2">open source entry</a>
      </p>
      {ready.model.source !== "alphafold" && <p className="mt-1 text-xs text-slate-500">Experimental coordinates can miss flexible regions; gaps in the trace are unresolved residues.</p>}
      {ready.model.source === "alphafold" && <p className="mt-1 text-xs text-slate-500">Predicted model, not an experimental structure. Low-confidence regions are often disordered.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <label className="flex items-center gap-2">Color by
          <select value={colorMode} onChange={e => setMode(e.target.value as ColorMode)} className="rounded-md border border-slate-300 bg-white px-2 py-1">
            <option value="position">Sequence position (N → C)</option>
            {ready.model.source === "alphafold" && <option value="plddt">Prediction confidence (pLDDT)</option>}
          </select>
        </label>
        {colorMode === "plddt"
          ? <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="pLDDT legend">{plddtSummary(residues).map(band => <li key={band.label} className="flex items-center gap-1"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: band.color }}/>{band.label} · {Math.round(band.fraction * 100)}%</li>)}</ul>
          : <span className="flex items-center gap-2" aria-label="Color runs from blue at the N-terminus to red at the C-terminus">N-term <span aria-hidden="true" className="inline-block h-2.5 w-24 rounded-sm" style={{ background: "linear-gradient(90deg, hsl(240 70% 45%), hsl(120 70% 45%), hsl(0 70% 45%))" }}/> C-term</span>}
      </div>
    </>}
    <canvas ref={canvas} width={WIDTH} height={HEIGHT} tabIndex={ready ? 0 : -1}
      className={`mt-3 w-full touch-none rounded-lg bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${ready ? "cursor-grab" : "hidden"}`}
      role="application" aria-roledescription="3D structure viewer" aria-label={ready ? `Cα trace of ${describeModel(ready.model, residues.length)}. Drag or use arrow keys to rotate, plus and minus to zoom, 0 to reset.` : "Structure not loaded"}
      onPointerDownCapture={() => setWheelActive(true)}
      onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => {
        const d = drag.current;
        if (d) {
          setAngle(([yaw, pitch]) => [yaw + (e.clientX - d.x) * 0.01, pitch + (e.clientY - d.y) * 0.01]);
          drag.current = { x: e.clientX, y: e.clientY };
          return;
        }
        const [x, y] = toCanvas(e);
        setHovered(nearestResidue(points, x, y, 10));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onPointerLeave={() => { if (!drag.current) setHovered(null); }}
      onKeyDown={e => {
        const step = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, -0.15], ArrowDown: [0, 0.15] }[e.key];
        if (step) { e.preventDefault(); setAngle(([yaw, pitch]) => [yaw + step[0], pitch + step[1]]); }
        else if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom(z => Math.min(z * 1.2, 4)); }
        else if (e.key === "-") { e.preventDefault(); setZoom(z => Math.max(z / 1.2, 0.4)); }
        else if (e.key === "0") { e.preventDefault(); reset(); }
      }}/>
    {ready && <>
      <p className="mt-1 min-h-5 text-xs text-slate-600" aria-live="polite" data-testid="structure-hover">
        {hoveredResidue
          ? `${residueLabel(hoveredResidue)}${ready.model.source === "alphafold" ? ` · pLDDT ${hoveredResidue.bFactor.toFixed(1)}` : ""}`
          : "Hover the trace to identify a residue."}
      </p>
      <div className="mt-2 flex gap-2 text-sm">
        <button type="button" className="rounded border px-3 py-1" onClick={() => setZoom(z => Math.min(z * 1.2, 4))}>Zoom in</button>
        <button type="button" className="rounded border px-3 py-1" onClick={() => setZoom(z => Math.max(z / 1.2, 0.4))}>Zoom out</button>
        <button type="button" className="rounded border px-3 py-1" onClick={reset}>
          Reset view{Math.abs(zoom - 1) > 0.02 ? ` (${Math.round(zoom * 100)}%)` : ""}
        </button>
      </div>
    </>}
    {references.length > 0 && <details className="mt-3 text-xs text-slate-600">
      <summary className="cursor-pointer font-semibold text-teal-900">PDB references in the dataset ({references.length})</summary>
      <p className="mt-1 flex flex-wrap gap-x-2">{references.map(ref => <a key={ref.pdb_id} href={`https://www.rcsb.org/structure/${ref.pdb_id}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">{ref.pdb_id}</a>)}</p>
    </details>}
  </section>;
}
