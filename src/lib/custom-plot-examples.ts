import type { ScriptPlotLanguage } from "@/lib/types";

export type ScriptExample = {
  id: string;
  title: string;
  description: string;
  language: ScriptPlotLanguage;
  source: string;
};

export const SCRIPT_EXAMPLES: ScriptExample[] = [
  {
    id: "intensity-by-group",
    title: "Mean intensity by group",
    description: "Bar chart of mean median log₁₀ MaxLFQ per annotation group.",
    language: "python",
    source: `# Mean sample intensity (median log₁₀ MaxLFQ) by annotation group
by = defaultdict(list)
for s in samples:
    by[s["group"]].append(float(s["medianLog10"]))

data = []
for group, vals in sorted(by.items()):
    mean = sum(vals) / len(vals) if vals else 0
    data.append({"x": group, "y": round(mean, 3), "group": group})

chart = {
    "type": "bar",
    "title": "Mean median log₁₀ MaxLFQ by group",
    "data": data,
    "xKey": "x",
    "yKey": "y",
    "seriesKey": "group",
    "xLabel": "Group",
    "yLabel": "Mean median log₁₀",
}
`,
  },
  {
    id: "missingness-by-sample",
    title: "Missingness by sample",
    description: "Heatmap-style bars of missingness % per sample, colored by group.",
    language: "python",
    source: `# Missingness % per sample (bar), colored by annotation group
data = [
    {
        "x": s["sample"],
        "y": float(s["missingPct"]),
        "group": s["group"],
    }
    for s in samples
]
data.sort(key=lambda row: (-row["y"], row["x"]))

chart = {
    "type": "bar",
    "title": "Missingness % by sample",
    "data": data,
    "xKey": "x",
    "yKey": "y",
    "seriesKey": "group",
    "xLabel": "Sample",
    "yLabel": "Missing %",
}
`,
  },
];
