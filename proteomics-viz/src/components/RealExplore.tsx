"use client";

import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_PROTEIN_API ?? "http://127.0.0.1:8000";
type Protein = { protein_id: string; gene: string | null; organism: string; description: string };
type Detail = Protein & { sequence: string; locations: string[]; structure_status: string; structures: { pdb_id: string; local_available: boolean; download_url: string | null }[] };
type Point = { protein_id: string; gene: string | null; organism: string; log2_fc: number; p_value: number; adj_p: number; significant: boolean };
type Abundance = { points: { sample_id: string; display_group: string; log2_intensity: number | null }[] };
type Network = { nodes: Protein[]; edges: { source: string; target: string; score: number }[]; total_neighbors: number; truncated: boolean };
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}${path}`, { signal });
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function RealExplore() {
  const [focus, setFocus] = useState("O00148");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Protein[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [abundance, setAbundance] = useState<Abundance | null>(null);
  const [network, setNetwork] = useState<Network | null>(null);
  const [networkLoading, setNetworkLoading] = useState(true);
  const [networkError, setNetworkError] = useState("");
  const [scoreCutoff, setScoreCutoff] = useState(0.4);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pCutoff, setPCutoff] = useState(0.05);
  const [fcCutoff, setFcCutoff] = useState(0.7);
  useEffect(() => {
    const c = new AbortController();
    get<{items: Point[]}>("/api/v1/contrasts/human-vs-qc/results?limit=10000", c.signal)
      .then(data => setPoints(data.items)).catch(e => { if (e.name !== "AbortError") setError("Cannot connect to the backend. Start the API on port 8000 and reload this page."); });
    return () => c.abort();
  }, []);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true); setDetail(null); setAbundance(null);
    Promise.all([
      get<Detail>(`/api/v1/proteins/${encodeURIComponent(focus)}`, c.signal),
      get<Abundance>(`/api/v1/proteins/${encodeURIComponent(focus)}/abundance`, c.signal),
    ]).then(([d,a]) => { setDetail(d); setAbundance(a); setError(""); setLoading(false); })
      .catch(e => { if (e.name !== "AbortError") { setError(`Could not load ${focus}. Check the backend and try again.`); setLoading(false); } });
    return () => c.abort();
  }, [focus]);
  useEffect(() => {
    const c = new AbortController();
    setNetwork(null); setNetworkLoading(true); setNetworkError("");
    get<Network>(`/api/v1/networks/${encodeURIComponent(focus)}/neighbors?max_nodes=30&score_cutoff=${scoreCutoff}`, c.signal)
      .then(n => { setNetwork(n); setNetworkLoading(false); })
      .catch(e => { if (e.name !== "AbortError") { setNetworkError("Could not load the STRING neighborhood. Check the backend connection."); setNetworkLoading(false); } });
    return () => c.abort();
  }, [focus, scoreCutoff]);
  useEffect(() => {
    const c = new AbortController();
    if (!query.trim()) return;
    const timer = setTimeout(() => get<{items: Protein[]}>(`/api/v1/proteins?q=${encodeURIComponent(query.trim())}&limit=10`, c.signal).then(d => setMatches(d.items)).catch(e => { if (e.name !== "AbortError") setMatches([]); }), 250);
    return () => { clearTimeout(timer); c.abort(); };
  }, [query]);
  const selected = points.find(p => p.protein_id === focus);
  const significant = (p: Point) => p.adj_p < pCutoff && Math.abs(p.log2_fc) > fcCutoff;
  const maxX = Math.max(1, ...points.map(p => Math.abs(p.log2_fc)));
  const maxY = Math.max(1, ...points.map(p => -Math.log10(Math.max(p.adj_p, 1e-300))));
  const choose = (id: string) => { setFocus(id); setQuery(""); setMatches([]); };
  return <div className="space-y-6">
    <header><h2 className="font-serif text-3xl">Explore real proteins</h2><p className="mt-2 text-sm text-slate-600">Human − QC · existing limma results · select a point or search by protein ID or gene.</p></header>
    {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">{error}</div>}
    <div className="relative max-w-xl"><label htmlFor="protein-search" className="block text-sm font-semibold">Find a protein</label><input id="protein-search" value={query} onChange={e => { setQuery(e.target.value); setMatches([]); }} placeholder="Protein ID or gene, e.g. O00148" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
      {query.trim() && matches.length > 0 && <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">{matches.map(p => <li key={p.protein_id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-teal-50" onClick={() => choose(p.protein_id)}><strong>{p.gene || p.protein_id}</strong> · {p.protein_id}<span className="block text-xs text-slate-600">{p.organism}</span></button></li>)}</ul>}
    </div>
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><h3 className="text-lg font-semibold">Human − QC volcano</h3><p className="text-sm text-slate-600">{points.length.toLocaleString()} tested proteins · {points.filter(significant).length} pass the filters. Adjusted p-values are not recalculated.</p></div><div className="flex gap-4 text-sm"><label>Adjusted p &lt; <input type="number" min="0.000001" max="1" step="0.01" value={pCutoff} onChange={e => setPCutoff(Number(e.target.value))} className="w-20 rounded border border-slate-300 p-1" /></label><label>|log₂FC| &gt; <input type="number" min="0" step="0.1" value={fcCutoff} onChange={e => setFcCutoff(Number(e.target.value))} className="w-20 rounded border border-slate-300 p-1" /></label></div></div>
      <svg viewBox="0 0 700 300" className="mt-4 w-full" role="img" aria-label="Volcano plot of Human minus QC. Select a point to focus a protein."><line x1="45" y1="260" x2="680" y2="260" stroke="#94a3b8"/><line x1="45" y1="20" x2="45" y2="260" stroke="#94a3b8"/>{points.map(p => <circle key={p.protein_id} cx={45+(p.log2_fc/maxX+1)*317.5} cy={260-(-Math.log10(Math.max(p.adj_p,1e-300))/maxY)*235} r={p.protein_id === focus ? 5 : 2.5} fill={p.protein_id === focus ? "#0f172a" : significant(p) ? "#0f766e" : "#94a3b8"} opacity={p.protein_id === focus ? 1 : 0.7} onClick={() => choose(p.protein_id)} style={{cursor:"pointer"}}><title>{p.gene || p.protein_id} ({p.protein_id}) · log₂FC {p.log2_fc.toFixed(2)} · adj p {p.adj_p.toExponential(2)}</title></circle>)}<text x="355" y="292" textAnchor="middle" fontSize="12" fill="#475569">log₂ fold change</text><text transform="translate(15 145) rotate(-90)" textAnchor="middle" fontSize="12" fill="#475569">−log₁₀ adjusted p</text></svg>
      <p className="text-xs text-slate-500">Zero p-values are plotted at 10⁻³⁰⁰. Search also provides keyboard access to proteins.</p></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-live="polite"><h3 className="text-lg font-semibold">Focused protein</h3>{loading ? <p className="mt-3 text-sm">Loading {focus}…</p> : detail && <><div className="mt-3 flex flex-wrap items-baseline gap-x-3"><strong className="text-2xl text-teal-900">{detail.gene || detail.protein_id}</strong><span>{detail.protein_id}</span><span className="text-sm text-slate-600">{detail.organism}</span></div><p className="mt-1 text-sm">{detail.description}</p><p className="mt-2 text-sm">{selected ? `Human − QC: log₂FC ${selected.log2_fc.toFixed(3)}, adjusted p ${selected.adj_p.toExponential(3)}${significant(selected) ? " · passes filters" : " · does not pass filters"}` : "Not evaluated in the Human − QC result."}</p><p className="mt-2 text-sm"><strong>Location:</strong> {detail.locations.length ? detail.locations.join(", ") : "Not available"}</p><details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold">Sequence ({detail.sequence.length} amino acids)</summary><p className="mt-2 break-all font-mono text-xs">{detail.sequence || "Not available"}</p></details></>}</section>
    {abundance && <AbundanceChart abundance={abundance}/>}
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h3 className="text-lg font-semibold">STRING one-hop neighborhood</h3>
          <p className="mt-1 text-sm text-slate-600">Select a node to focus that protein. Edge width represents STRING confidence, not binding strength.</p></div>
        <label className="text-sm font-medium">Minimum confidence <select value={scoreCutoff} onChange={e => setScoreCutoff(Number(e.target.value))} className="ml-2 rounded border border-slate-300 bg-white px-2 py-1">{[0,0.4,0.6,0.7,0.9].map(score => <option key={score} value={score}>{score.toFixed(1)}</option>)}</select></label>
      </div>
      {networkLoading && <p className="mt-4 text-sm" role="status">Loading network for {focus}…</p>}
      {networkError && <p className="mt-4 text-sm text-red-800" role="alert">{networkError}</p>}
      {network && <>
        <p className="mt-2 text-sm text-slate-600">{network.total_neighbors} neighbors at confidence ≥ {scoreCutoff.toFixed(1)}. {network.truncated ? "Showing the 29 strongest neighbors; the network is truncated." : "All matching neighbors shown."} The local STRING export is incomplete.</p>
        <NetworkGraph network={network} focus={focus} onChoose={choose} />
      </>}
    </section>
    {detail && <Structure detail={detail}/>}
    <p className="text-xs leading-relaxed text-slate-500">This benchmark compares mixture abundances, not disease effects. Sample group labels and replicate types require review. The STRING export is incomplete.</p>
  </div>;
}

function NetworkGraph({ network, focus, onChoose }: { network: Network; focus: string; onChoose: (id: string) => void }) {
  const [zoom, setZoom] = useState(1);
  const [showNeighborEdges, setShowNeighborEdges] = useState(false);
  const neighbors = network.nodes.filter(node => node.protein_id !== focus);
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(focus, { x: 500, y: 380 });
  // Distribute nodes across two rings to keep labels legible in the 30-node view.
  neighbors.forEach((node, index) => {
    const innerCount = Math.min(neighbors.length, 10);
    const inner = index < innerCount;
    const count = inner ? innerCount : neighbors.length - innerCount;
    const angle = -Math.PI / 2 + 2 * Math.PI * (inner ? index : index - innerCount) / count;
    const radius = inner ? 165 : 300;
    positions.set(node.protein_id, { x: 500 + radius * Math.cos(angle), y: 380 + radius * Math.sin(angle) });
  });
  return <>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-slate-600"><span className="font-semibold text-teal-900">●</span> Focused protein <span className="ml-3 font-semibold text-slate-500">●</span> Neighbor · hover over an edge for its score</p>
      <div className="flex gap-2"><button type="button" onClick={() => setZoom(z => Math.min(2, z + 0.2))} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">Zoom in</button><button type="button" onClick={() => setZoom(z => Math.max(0.6, z - 0.2))} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">Zoom out</button><button type="button" onClick={() => setZoom(1)} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">Reset</button></div>
    </div>
    {neighbors.length > 1 && <label className="mt-3 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={showNeighborEdges} onChange={e => setShowNeighborEdges(e.target.checked)} /> Show associations between neighbors</label>}
    {neighbors.length === 0 && <p className="mt-3 text-sm text-slate-600">No matching neighbors in the local export at this threshold.</p>}
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <svg viewBox="0 0 1000 760" className="block w-full" role="group" aria-label="Interactive STRING network. Select a neighbor to change the focused protein.">
        <g transform={`translate(500 380) scale(${zoom}) translate(-500 -380)`}>
          {network.edges.filter(edge => showNeighborEdges || edge.source === focus || edge.target === focus).map((edge, i) => {
            const source = positions.get(edge.source), target = positions.get(edge.target);
            if (!source || !target) return null;
            return <line aria-hidden="true" key={`${edge.source}-${edge.target}-${i}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="#64748b" strokeOpacity="0.5" strokeWidth={1 + edge.score * 3}><title>{edge.source} ↔ {edge.target}: confidence {edge.score.toFixed(3)}</title></line>;
          })}
          {network.nodes.map(node => {
            const pos = positions.get(node.protein_id); if (!pos) return null;
            const isFocus = node.protein_id === focus;
            const label = node.gene || node.protein_id;
            return <g key={node.protein_id} role="button" tabIndex={0} aria-label={`${isFocus ? "Focused protein" : "Focus protein"}: ${label}, ${node.protein_id}, ${node.organism}`} onClick={() => onChoose(node.protein_id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChoose(node.protein_id); } }} className="group cursor-pointer focus:outline-none" >
              <title>{label} ({node.protein_id}) · {node.organism}</title>
              <circle className="group-focus-visible:stroke-orange-600 group-focus-visible:[stroke-width:6]" cx={pos.x} cy={pos.y} r={isFocus ? 23 : 18} fill={isFocus ? "#115e59" : "#fff"} stroke={isFocus ? "#115e59" : "#64748b"} strokeWidth="3" />
              <text x={pos.x} y={pos.y + (isFocus ? 40 : 35)} textAnchor="middle" fontSize="14" fontWeight="600" fill="#0f172a" paintOrder="stroke" stroke="#f8fafc" strokeWidth="4" strokeLinejoin="round">{label.length > 14 ? `${label.slice(0, 13)}…` : label}</text>
            </g>;
          })}
        </g>
      </svg>
    </div>
    {neighbors.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-teal-900">Neighbor list and confidence scores</summary><ul className="mt-2 flex flex-wrap gap-2">{neighbors.map(node => {
      const score = Math.max(...network.edges.filter(e => (e.source === focus && e.target === node.protein_id) || (e.target === focus && e.source === node.protein_id)).map(e => e.score));
      return <li key={node.protein_id}><button type="button" onClick={() => onChoose(node.protein_id)} className="rounded border border-slate-300 px-3 py-1.5 text-left hover:bg-teal-50">{node.gene || node.protein_id} · {node.protein_id}{Number.isFinite(score) ? ` · ${score.toFixed(3)}` : ""}</button></li>;
    })}</ul></details>}
  </>;
}

function AbundanceChart({abundance}: {abundance: Abundance}) {
  const groups = [...new Set(abundance.points.map(p => p.display_group))];
  const vals = abundance.points.flatMap(p => p.log2_intensity === null ? [] : [p.log2_intensity]);
  const min = Math.min(...vals, 0), max = Math.max(...vals, 1);
  return <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6"><h3 className="text-lg font-semibold">Observed abundance by sample</h3><p className="mt-1 text-sm text-slate-600">log₂ MaxLFQ; each dot is a sample. Zero and blank values are missing, with no imputation. Group labels are unreviewed.</p><svg viewBox="0 0 700 230" className="mt-3 w-full" role="img" aria-label="Observed abundance by sample group"><line x1="60" y1="180" x2="680" y2="180" stroke="#94a3b8"/>{groups.map((g,i) => <g key={g}><text x={70+(i+0.5)*600/groups.length} y="202" textAnchor="middle" fontSize="11" fill="#475569">{g}</text>{abundance.points.filter(p=>p.display_group===g && p.log2_intensity !== null).map((p,j) => <circle key={p.sample_id} cx={70+(i+0.5)*600/groups.length + ((j%7)-3)*5} cy={175-((p.log2_intensity! - min)/(max-min))*145} r="4" fill="#0f766e" opacity="0.75"><title>{p.sample_id}: {p.log2_intensity!.toFixed(2)}</title></circle>)}</g>)}<text x="5" y="30" fontSize="10">{max.toFixed(1)}</text><text x="5" y="180" fontSize="10">{min.toFixed(1)}</text></svg><p className="text-xs text-slate-600">{groups.map(g => `${g}: ${abundance.points.filter(p=>p.display_group===g && p.log2_intensity===null).length} missing`).join(" · ")}</p></section>;
}

function Structure({detail}: {detail: Detail}) {
  const local = detail.structures.find(s => s.local_available && s.download_url);
  return <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6"><h3 className="text-lg font-semibold">Structure</h3>{local ? <><p className="mt-1 text-sm text-slate-600">Local PDB {local.pdb_id} · Cα trace. Drag to rotate; use the zoom buttons.</p><StructureCanvas url={`${API}${local.download_url}`} key={local.pdb_id}/></> : <p className="mt-2 text-sm text-slate-600">{detail.structure_status === "reference_only" ? "PDB references exist, but coordinates are not packaged locally." : "No PDB reference is available in the dataset."}</p>}{detail.structures.length > 0 && <p className="mt-2 text-xs text-slate-600">References: {detail.structures.map(s => s.pdb_id).join(", ")}</p>}</section>;
}
function StructureCanvas({url}: {url: string}) {
  const canvas = useRef<HTMLCanvasElement>(null); const [atoms,setAtoms] = useState<number[][]>([]); const [angle,setAngle] = useState([0.4,0.3]); const [zoom,setZoom] = useState(1); const [err,setErr] = useState(""); const drag = useRef<{x:number;y:number}|null>(null);
  useEffect(()=>{const c=new AbortController(); fetch(url,{signal:c.signal}).then(r=>{if(!r.ok) throw Error();return r.text();}).then(text=>{const rows=text.split(/\r?\n/).filter(l=>l.startsWith("ATOM  ") && l.slice(12,16).trim()==="CA" && (l[16]===" " || l[16]==="A")); setAtoms(rows.map(l=>[Number(l.slice(30,38)),Number(l.slice(38,46)),Number(l.slice(46,54))]).filter(a=>a.every(Number.isFinite)));}).catch(e=>{if(e.name!=="AbortError") setErr("Could not load local coordinates.");}); return()=>c.abort();},[url]);
  useEffect(()=>{const ctx=canvas.current?.getContext("2d"); if(!ctx || !atoms.length)return; ctx.clearRect(0,0,600,340); const center=[0,1,2].map(i=>atoms.reduce((s,a)=>s+a[i],0)/atoms.length); const xyz=atoms.map(a=>{const x=a[0]-center[0],y=a[1]-center[1],z=a[2]-center[2]; const x1=x*Math.cos(angle[0])+z*Math.sin(angle[0]), z1=-x*Math.sin(angle[0])+z*Math.cos(angle[0]); return [x1,y*Math.cos(angle[1])-z1*Math.sin(angle[1])];}); const extent=Math.max(...xyz.flatMap(a=>a.map(Math.abs)),1); const scale=145/extent*zoom; ctx.strokeStyle="#0f766e";ctx.lineWidth=1.4;ctx.beginPath();xyz.forEach((p,i)=>{if(i===0 || Math.hypot(...atoms[i].map((v,j)=>v-atoms[i-1][j]))>8)ctx.moveTo(300+p[0]*scale,170+p[1]*scale);else ctx.lineTo(300+p[0]*scale,170+p[1]*scale);});ctx.stroke();},[atoms,angle,zoom]);
  return <><canvas ref={canvas} width={600} height={340} className="mt-3 w-full touch-none rounded-lg bg-slate-50" aria-label="Rotatable protein structure C alpha trace" onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current){const d=drag.current;setAngle(a=>[a[0]+(e.clientX-d.x)*0.01,a[1]+(e.clientY-d.y)*0.01]);drag.current={x:e.clientX,y:e.clientY};}}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}/><div className="mt-2 flex gap-2 text-sm"><button className="rounded border px-3 py-1" onClick={()=>setZoom(z=>Math.min(z*1.2,4))}>Zoom in</button><button className="rounded border px-3 py-1" onClick={()=>setZoom(z=>Math.max(z/1.2,0.4))}>Zoom out</button><button className="rounded border px-3 py-1" onClick={()=>{setZoom(1);setAngle([0.4,0.3]);}}>Reset view</button></div>{err && <p role="alert">{err}</p>}{!err && !atoms.length && <p className="text-sm">Loading coordinates…</p>}</>;
}
