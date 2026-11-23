import { NextRequest, NextResponse } from "next/server";

type StringInteractionRow = {
  preferredName_A?: string;
  preferredName_B?: string;
  score?: number;
};

type CachedEntry = {
  expiresAt: number;
  data: {
    query: string;
    partners: { gene: string; score: number }[];
    interEdges: { source: string; target: string; score: number }[];
  };
};

type CachedChordsEntry = {
  expiresAt: number;
  interEdges: { source: string; target: string; score: number }[];
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CachedEntry>();
const chordsCache = new Map<string, CachedChordsEntry>();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawChordsFor = (searchParams.get("chords_for") ?? "").trim();
  const rawQuery = (searchParams.get("identifier") ?? "").trim();
  const species = /^\d+$/.test(searchParams.get("species") ?? "")
    ? searchParams.get("species")!
    : "9606";
  const rawCutoff = Number(searchParams.get("score_cutoff") ?? "0.4");
  const scoreCutoff = Number.isFinite(rawCutoff)
    ? Math.max(0.15, Math.min(0.99, rawCutoff))
    : 0.4;
  const requiredScore = Math.round(scoreCutoff * 1000);

  // Stage-2 lightweight chord lookup for an explicit small list of in-dataset genes.
  if (rawChordsFor) {
    const genes = rawChordsFor
      .split(",")
      .map((g) => g.trim())
      .filter((g) => g && /^[A-Za-z0-9_.\-:]+$/.test(g) && g.length <= 40)
      .slice(0, 25);
    if (genes.length < 2) {
      return NextResponse.json({ interEdges: [] });
    }
    const cKey = `${species}|${requiredScore}|${[...genes].map((g) => g.toUpperCase()).sort().join(",")}`;
    const cHit = chordsCache.get(cKey);
    if (cHit && cHit.expiresAt > Date.now()) {
      return NextResponse.json({ interEdges: cHit.interEdges });
    }
    try {
      const netUrl = `https://string-db.org/api/json/network?identifiers=${genes.map(encodeURIComponent).join("%0d")}&species=${species}&required_score=${requiredScore}`;
      const netRes = await fetch(netUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(7000),
      });
      if (!netRes.ok) {
        return NextResponse.json({ interEdges: [] });
      }
      const netRows = (await netRes.json()) as StringInteractionRow[];
      const seen = new Set<string>();
      const interEdges: { source: string; target: string; score: number }[] = [];
      for (const row of netRows) {
        const a = (row.preferredName_A ?? "").trim();
        const b = (row.preferredName_B ?? "").trim();
        const score = Number(row.score ?? 0);
        if (!a || !b || a === b || !Number.isFinite(score)) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        interEdges.push({ source: a, target: b, score });
      }
      if (chordsCache.size > 200) chordsCache.clear();
      chordsCache.set(cKey, { expiresAt: Date.now() + CACHE_TTL_MS, interEdges });
      return NextResponse.json({ interEdges });
    } catch {
      return NextResponse.json({ interEdges: [] });
    }
  }

  const rawLimit = Number(searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(rawLimit)
    ? Math.max(5, Math.min(120, Math.round(rawLimit)))
    : 100;

  if (!rawQuery || !/^[A-Za-z0-9_.\-:]+$/.test(rawQuery) || rawQuery.length > 40) {
    return NextResponse.json(
      { error: "Invalid protein/gene identifier." },
      { status: 400 },
    );
  }

  const cacheKey = `${species}|${rawQuery.toUpperCase()}|${requiredScore}|${limit}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return NextResponse.json(hit.data);
  }

  try {
    const partnerUrl = `https://string-db.org/api/json/interaction_partners?identifiers=${encodeURIComponent(
      rawQuery,
    )}&species=${species}&limit=${limit}&required_score=${requiredScore}`;
    const partnerRes = await fetch(partnerUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!partnerRes.ok) {
      return NextResponse.json(
        { error: `STRING DB returned HTTP ${partnerRes.status}` },
        { status: 502 },
      );
    }
    const rows = (await partnerRes.json()) as StringInteractionRow[];
    const partnerMap = new Map<string, number>();
    let resolvedCenter = rawQuery;
    for (const row of rows) {
      const a = (row.preferredName_A ?? "").trim();
      const b = (row.preferredName_B ?? "").trim();
      const score = Number(row.score ?? 0);
      if (!a || !b || !Number.isFinite(score)) continue;
      if (a.toUpperCase() === rawQuery.toUpperCase()) {
        resolvedCenter = a;
        const prev = partnerMap.get(b) ?? 0;
        if (score > prev) partnerMap.set(b, score);
      } else if (b.toUpperCase() === rawQuery.toUpperCase()) {
        resolvedCenter = b;
        const prev = partnerMap.get(a) ?? 0;
        if (score > prev) partnerMap.set(a, score);
      } else {
        // Fallback when queried by UniProt accession (preferredName_A is the resolved gene symbol).
        resolvedCenter = a;
        const prev = partnerMap.get(b) ?? 0;
        if (score > prev) partnerMap.set(b, score);
      }
    }

    const partners = [...partnerMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([gene, score]) => ({ gene, score }));

    const payload = { query: resolvedCenter, partners, interEdges: [] as { source: string; target: string; score: number }[] };
    if (cache.size > 200) cache.clear();
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: payload });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to query STRING DB." },
      { status: 502 },
    );
  }
}
