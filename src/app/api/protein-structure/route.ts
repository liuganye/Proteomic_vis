import { NextRequest, NextResponse } from "next/server";

type StructureModelPayload = {
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
  coloring: "chain" | "plddt";
  coordinates_url: string;
};

type ResolvedEntry = {
  expiresAt: number;
  model: StructureModelPayload;
  pdbFetchUrl: string;
  pdbText?: string;
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, ResolvedEntry>();
const UA_HEADERS = {
  "User-Agent": "ProteomicVis/1.0",
  Accept: "application/json",
};

async function resolveStructure(uniprotId: string): Promise<ResolvedEntry | null> {
  const key = uniprotId.toUpperCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  // 1. Prefer best experimental PDB structure via PDBe best_structures mapping.
  try {
    const pdbeRes = await fetch(
      `https://www.ebi.ac.uk/pdbe/api/mappings/best_structures/${encodeURIComponent(key)}`,
      { headers: UA_HEADERS, signal: AbortSignal.timeout(6000) },
    );
    if (pdbeRes.ok) {
      const data = (await pdbeRes.json()) as Record<
        string,
        {
          pdb_id: string;
          chain_id?: string;
          experimental_method?: string;
          resolution?: number | null;
          unp_start?: number;
          unp_end?: number;
          coverage?: number;
        }[]
      >;
      const list = data[key] ?? data[uniprotId] ?? [];
      const best = list.find((item) => item.pdb_id);
      if (best) {
        const pdbId = best.pdb_id.toUpperCase();
        const entry: ResolvedEntry = {
          expiresAt: Date.now() + CACHE_TTL_MS,
          pdbFetchUrl: `https://files.rcsb.org/download/${pdbId}.pdb`,
          model: {
            protein_id: key,
            source: "pdb",
            model_id: pdbId,
            chain_id: best.chain_id ?? null,
            method: best.experimental_method ?? null,
            resolution:
              typeof best.resolution === "number" && Number.isFinite(best.resolution)
                ? best.resolution
                : null,
            unp_start: typeof best.unp_start === "number" ? best.unp_start : null,
            unp_end: typeof best.unp_end === "number" ? best.unp_end : null,
            coverage: typeof best.coverage === "number" ? best.coverage : null,
            source_url: `https://www.rcsb.org/structure/${pdbId}`,
            coloring: "chain",
            coordinates_url: `/api/protein-structure?id=${encodeURIComponent(key)}&download=1`,
          },
        };
        if (cache.size > 120) cache.clear();
        cache.set(key, entry);
        return entry;
      }
    }
  } catch {
    // Fall through to AlphaFold DB.
  }

  // 2. Fallback to AlphaFold DB predicted structure (with pLDDT coloring).
  try {
    const afRes = await fetch(
      `https://alphafold.ebi.ac.uk/api/prediction/${encodeURIComponent(key)}`,
      { headers: UA_HEADERS, signal: AbortSignal.timeout(7000) },
    );
    if (afRes.ok) {
      const items = (await afRes.json()) as {
        entryId?: string;
        pdbUrl?: string;
        uniprotStart?: number;
        uniprotEnd?: number;
      }[];
      const first = items.find((item) => item.pdbUrl);
      if (first?.pdbUrl) {
        const modelId = first.entryId ?? `AF-${key}-F1`;
        const entry: ResolvedEntry = {
          expiresAt: Date.now() + CACHE_TTL_MS,
          pdbFetchUrl: first.pdbUrl,
          model: {
            protein_id: key,
            source: "alphafold",
            model_id: modelId,
            chain_id: "A",
            method: "AlphaFold",
            resolution: null,
            unp_start: typeof first.uniprotStart === "number" ? first.uniprotStart : null,
            unp_end: typeof first.uniprotEnd === "number" ? first.uniprotEnd : null,
            coverage: 1,
            source_url: `https://alphafold.ebi.ac.uk/entry/${encodeURIComponent(key)}`,
            coloring: "plddt",
            coordinates_url: `/api/protein-structure?id=${encodeURIComponent(key)}&download=1`,
          },
        };
        if (cache.size > 120) cache.clear();
        cache.set(key, entry);
        return entry;
      }
    }
  } catch {
    // Handled below as not found / unreachable.
  }

  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawId = (searchParams.get("id") ?? "").trim().split("-")[0];
  const download = searchParams.get("download") === "1";

  if (!rawId || !/^[A-Za-z0-9_]+$/.test(rawId) || rawId.length > 20) {
    return NextResponse.json(
      { code: "structure_not_uniprot", message: "Invalid UniProt accession." },
      { status: 400 },
    );
  }

  const entry = await resolveStructure(rawId);
  if (!entry) {
    return NextResponse.json(
      {
        code: "structure_not_found",
        message: "No experimental PDB or AlphaFold structure found for this protein.",
      },
      { status: 404 },
    );
  }

  if (!download) {
    return NextResponse.json(entry.model);
  }

  if (entry.pdbText) {
    return new NextResponse(entry.pdbText, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const pdbRes = await fetch(entry.pdbFetchUrl, {
      headers: { "User-Agent": "ProteomicVis/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!pdbRes.ok) {
      return NextResponse.json(
        { code: "structure_source_unreachable", message: `Coordinate download failed (${pdbRes.status}).` },
        { status: 502 },
      );
    }
    const text = await pdbRes.text();
    entry.pdbText = text;
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return NextResponse.json(
      { code: "structure_source_unreachable", message: "Could not download PDB coordinates." },
      { status: 502 },
    );
  }
}
