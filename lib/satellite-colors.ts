export const SATELLITE_COLORS: [number, number, number][] = [
  [0, 220, 255], // cyan
  [60, 255, 120], // green
  [255, 210, 0], // yellow
  [255, 140, 0], // orange
  [255, 70, 150], // magenta
  [140, 90, 255], // violet
];
export const MAX_SELECTED = 6;

export function colorForId(
  id: number,
  selectedIds: number[]
): [number, number, number] | null {
  const idx = selectedIds.indexOf(id);
  return idx === -1 ? null : SATELLITE_COLORS[idx];
}
