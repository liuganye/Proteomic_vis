/**
 * Shared chart palette — mirrors CSS variables in globals.css.
 * Prefer these tokens over ad-hoc hex so QC and Downstream stay cohesive.
 */

export const CHART = {
  ink: "var(--chart-ink, #14212b)",
  muted: "var(--chart-muted, #5a6b76)",
  grid: "var(--chart-grid, #d7e0e6)",
  surface: "var(--chart-surface, #ffffff)",
  accent: "var(--chart-accent, #0d7377)",
  accentSoft: "var(--chart-accent-soft, #e6f3f3)",
  warn: "var(--chart-warn, #c45c26)",
  warnSoft: "var(--chart-warn-soft, #fff1e8)",
  down: "var(--chart-down, #b45309)",
  up: "var(--chart-up, #0d7377)",
  ns: "var(--chart-ns, #8a9aa5)",
  highlight: "var(--chart-highlight, #c2410c)",
  /** Solid hex fallbacks for canvas/SVG contexts that ignore CSS vars */
  hex: {
    ink: "#14212b",
    muted: "#5a6b76",
    grid: "#d7e0e6",
    accent: "#0d7377",
    accentDeep: "#0a5c5f",
    warn: "#c45c26",
    down: "#b45309",
    up: "#0d7377",
    ns: "#8a9aa5",
    highlight: "#c2410c",
    series: [
      "#0d7377", // teal
      "#c45c26", // burnt orange
      "#2f5d8c", // steel blue
      "#5a7a3a", // olive
      "#8b4a3a", // brick
      "#3d6b6e", // sea glass
      "#a67c2d", // ochre
      "#4a5560", // slate
      "#1f6f5b", // forest
      "#9a3412", // rust
    ] as const,
  },
} as const;

export const VOLCANO_COLORS = {
  up: CHART.hex.up,
  down: CHART.hex.down,
  ns: CHART.hex.ns,
} as const;

export const GO_ASPECT_COLORS = {
  BP: CHART.hex.up,
  MF: CHART.hex.series[2],
  CC: CHART.hex.down,
} as const;
