export interface ZoneOption {
  id: number;
  zone: string;
  borough: string;
}

/**
 * Option labels. A few TLC zones share a name (Corona is 56 and 57; Governor's,
 * Ellis and Liberty Islands are 103, 104 and 105), so repeated names get their
 * LocationID to keep every option distinguishable.
 */
export function zoneLabels(zones: readonly ZoneOption[]): Map<number, string> {
  const count = new Map<string, number>();
  for (const z of zones) count.set(z.zone, (count.get(z.zone) ?? 0) + 1);
  return new Map(zones.map((z) => [z.id, count.get(z.zone)! > 1 ? `${z.zone} (#${z.id})` : z.zone]));
}
