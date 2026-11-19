export type AbundancePoint = {
  sample_id: string;
  display_group: string;
  log2_intensity: number | null;
};

export type AbundanceGroup = {
  name: string;
  width: number;
  points: (AbundancePoint & { x: number })[];
};

/** Preserve missing values; they must not contribute to the display domain. */
export function abundanceDomain(values: (number | null)[]): { min: number; max: number; ticks: number[] } | null {
  const observed = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!observed.length) return null;
  const low = Math.min(...observed);
  const high = Math.max(...observed);
  const padding = high === low ? Math.max(Math.abs(low) * 0.05, 0.5) : (high - low) * 0.1;
  const min = low - padding;
  const max = high + padding;
  return { min, max, ticks: Array.from({ length: 5 }, (_, index) => min + index * (max - min) / 4) };
}

/** Allocate positions for all samples, including missing ones, so positions are stable. */
export function abundanceGroups(points: AbundancePoint[]): AbundanceGroup[] {
  const grouped = new Map<string, AbundancePoint[]>();
  for (const point of points) {
    const group = grouped.get(point.display_group) ?? [];
    group.push(point);
    grouped.set(point.display_group, group);
  }
  return Array.from(grouped, ([name, group]) => {
    const width = Math.max(120, group.length * 12 + 36);
    const step = (width - 36) / Math.max(group.length, 1);
    return { name, width, points: group.map((point, index) => ({ ...point, x: 18 + (index + 0.5) * step })) };
  });
}
