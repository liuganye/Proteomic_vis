/** Pure helpers for the Cα structure view; kept free of React so they can be tested. */

export type Residue = {
  chain: string;
  resSeq: number;
  insCode: string;
  resName: string;
  x: number;
  y: number;
  z: number;
  /** B-factor column; AlphaFold stores per-residue pLDDT (0–100) here. */
  bFactor: number;
};

export type ColorMode = "plddt" | "position";

/** Cα–Cα distance across a peptide bond is ~3.8 Å; a larger jump is a chain break. */
export const CHAIN_BREAK_ANGSTROM = 4.5;

/**
 * Cα atoms of one chain from the first model. Alternate locations keep only the first
 * conformer ("" or "A"). If `chain` is absent from the file, the first chain with Cα atoms
 * is used, so a mislabeled chain never leaves the view empty without explanation.
 */
export function parseCalpha(pdbText: string, chain?: string | null): { chain: string | null; residues: Residue[] } {
  const byChain = new Map<string, Residue[]>();
  const seen = new Set<string>();
  let modelCount = 0;
  for (const line of pdbText.split(/\r?\n/)) {
    if (line.startsWith("MODEL ")) {
      modelCount += 1;
      if (modelCount > 1) break;
      continue;
    }
    if (line.startsWith("ENDMDL")) break;
    if (!line.startsWith("ATOM  ") || line.slice(12, 16).trim() !== "CA") continue;
    const altLoc = line[16] ?? " ";
    if (altLoc !== " " && altLoc !== "A") continue;
    const chainId = line[21] ?? " ";
    const resSeq = Number(line.slice(22, 26));
    const insCode = (line[26] ?? " ").trim();
    const key = `${chainId}:${resSeq}:${insCode}`;
    if (seen.has(key)) continue;
    const residue = {
      chain: chainId,
      resSeq,
      insCode,
      resName: line.slice(17, 20).trim(),
      x: Number(line.slice(30, 38)),
      y: Number(line.slice(38, 46)),
      z: Number(line.slice(46, 54)),
      bFactor: Number(line.slice(60, 66)),
    };
    if (![residue.resSeq, residue.x, residue.y, residue.z].every(Number.isFinite)) continue;
    seen.add(key);
    const list = byChain.get(chainId) ?? [];
    list.push(residue);
    byChain.set(chainId, list);
  }
  const chosen = chain && byChain.has(chain) ? chain : [...byChain.keys()][0] ?? null;
  return { chain: chosen, residues: chosen === null ? [] : byChain.get(chosen)! };
}

/** Index pairs (i-1, i) that should not be connected because the chain is broken there. */
export function chainBreaks(residues: Residue[]): Set<number> {
  const breaks = new Set<number>();
  for (let i = 1; i < residues.length; i++) {
    const a = residues[i - 1], b = residues[i];
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > CHAIN_BREAK_ANGSTROM) breaks.add(i);
  }
  return breaks;
}

/**
 * Rotate about the centroid (yaw around y, then pitch around x) and scale so the
 * molecule's largest projected extent fits the viewport at zoom 1.
 * Returns screen coordinates plus depth (larger = nearer) for draw ordering.
 */
export function project(
  residues: Residue[],
  [yaw, pitch]: [number, number],
  zoom: number,
  width: number,
  height: number,
): { x: number; y: number; depth: number }[] {
  if (!residues.length) return [];
  const n = residues.length;
  const cx = residues.reduce((s, r) => s + r.x, 0) / n;
  const cy = residues.reduce((s, r) => s + r.y, 0) / n;
  const cz = residues.reduce((s, r) => s + r.z, 0) / n;
  const rotated = residues.map(r => {
    const x = r.x - cx, y = r.y - cy, z = r.z - cz;
    const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
    const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
    const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
    const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
    return [x1, y2, z2];
  });
  // Use the radius (rotation-invariant) so the scale does not jump while dragging.
  const radius = Math.max(1, ...rotated.map(([x, y, z]) => Math.hypot(x, y, z)));
  const scale = (Math.min(width, height) / 2 - 12) / radius * zoom;
  // Screen y grows downward; flip so structural "up" stays up.
  return rotated.map(([x, y, z]) => ({ x: width / 2 + x * scale, y: height / 2 - y * scale, depth: z }));
}

/** AlphaFold DB confidence bands and colors. */
export const PLDDT_BANDS = [
  { min: 90, label: "Very high (pLDDT > 90)", color: "#0053D6" },
  { min: 70, label: "Confident (90 > pLDDT > 70)", color: "#65CBF3" },
  { min: 50, label: "Low (70 > pLDDT > 50)", color: "#FFDB13" },
  { min: -Infinity, label: "Very low (pLDDT < 50)", color: "#FF7D45" },
] as const;

export function plddtColor(value: number): string {
  return PLDDT_BANDS.find(band => value > band.min)?.color ?? PLDDT_BANDS[3].color;
}

/** N→C gradient from blue (N-terminus) to red (C-terminus), via HSL hue 240 → 0. */
export function positionColor(index: number, count: number): string {
  const t = count > 1 ? index / (count - 1) : 0;
  return `hsl(${Math.round(240 * (1 - t))} 70% 45%)`;
}

export function residueColor(residues: Residue[], index: number, mode: ColorMode): string {
  return mode === "plddt" ? plddtColor(residues[index].bFactor) : positionColor(index, residues.length);
}

/** Nearest projected residue within `maxDistance` pixels, preferring the nearer one in depth. */
export function nearestResidue(
  points: { x: number; y: number; depth: number }[],
  x: number,
  y: number,
  maxDistance = 8,
): number | null {
  let best: number | null = null;
  let bestScore = Infinity;
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance > maxDistance) return;
    const score = distance - point.depth * 1e-6;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

export function residueLabel(residue: Residue): string {
  return `${residue.resName} ${residue.resSeq}${residue.insCode}${residue.chain.trim() ? ` (chain ${residue.chain})` : ""}`;
}

/** Fraction of residues per pLDDT band, for the text summary next to the canvas. */
export function plddtSummary(residues: Residue[]): { label: string; color: string; fraction: number }[] {
  return PLDDT_BANDS.map(band => ({
    label: band.label,
    color: band.color,
    fraction: residues.length
      ? residues.filter(r => plddtColor(r.bFactor) === band.color).length / residues.length
      : 0,
  }));
}
