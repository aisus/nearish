/** "October 2026", from an `osm_as_of`; UTC, so a timestamp near midnight is the month Overpass meant. */
export function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Whole km² from 10: a decimal there claims more than a count of 512 px
 * knows. Below 0.1 km² a rounded "0.0 km²" reads as nothing, so a smaller
 * unit says how small.
 */
export function formatArea(km2: number): string {
  if (km2 >= 10) return `${Math.round(km2).toLocaleString("en")} km²`;
  if (km2 === 0 || km2 >= 0.1) return `${km2.toFixed(1)} km²`;
  // Rounded first, so that 9,990 m² reads as 1.0 ha rather than 10,000 m².
  const m2 = Number((km2 * 1_000_000).toPrecision(2));
  if (m2 >= 10_000) return `${(km2 * 100).toFixed(1)} ha`;
  return `${m2.toLocaleString("en")} m²`;
}
