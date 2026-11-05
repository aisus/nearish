/**
 * Overpass elements, read as OSM shapes them.
 *
 * In OSM an area is bounded by rings: a closed way is one, and a
 * multipolygon relation's members join into `outer` rings and `inner` ones,
 * its holes. This file is where that vocabulary stops. An area leaves here
 * as a GeoJSON `Polygon` or `MultiPolygon`, every outer ring its own
 * polygon, and holes dropped: a hole smaller than twice the radius closes up
 * under the buffer anyway, and a larger one is precision the detour factor
 * cannot carry (`docs/data.md`). An open way leaves as a `LineString`, for
 * the fetch step to widen; none reaches the app.
 *
 * `natural=coastline` is the exception: always a line, closed or not. Land
 * lies on its left, so a closed one rings an island, and read as an area it
 * would draw the island as water. OSM has no sea polygon to fetch instead.
 */

import type { LineString, MultiPolygon, Polygon, Position } from "geojson";

/** A coordinate as Overpass writes it, inside `geometry`. */
interface OverpassPoint {
  lat?: number;
  lon?: number;
}

/** One member of a relation, under `out geom;`. */
interface OverpassMember {
  type?: string;
  role?: string;
  geometry?: (OverpassPoint | null)[];
}

/** One element as Overpass returns it. Only the parts we read are typed. */
export interface OverpassElement {
  type?: string;
  lat?: number;
  lon?: number;
  center?: OverpassPoint;
  bounds?: { minlat?: number; minlon?: number; maxlat?: number; maxlon?: number };
  geometry?: (OverpassPoint | null)[];
  members?: OverpassMember[];
  tags?: Record<string, string>;
}

/**
 * Representative lat/lon, or null when there is none — a query without a
 * usable `out` clause, which the caller reports rather than skips.
 *
 * Under `out geom;` there is no `center`, so a way is reduced from its
 * geometry and a relation from its `bounds`: the bbox centre either way,
 * which is what `center` means, so the two paths agree on where a place is.
 */
export function elementPoint(element: OverpassElement): [number, number] | null {
  if (element.lat != null && element.lon != null) {
    return [element.lat, element.lon];
  }
  const center = element.center;
  if (center && center.lat != null && center.lon != null) {
    return [center.lat, center.lon];
  }

  const points = definedPoints(element.geometry);
  if (points.length > 0) {
    const lats = points.map(([lat]) => lat);
    const lons = points.map(([, lon]) => lon);
    return [
      (Math.min(...lats) + Math.max(...lats)) / 2,
      (Math.min(...lons) + Math.max(...lons)) / 2,
    ];
  }

  const bounds = element.bounds;
  if (
    bounds &&
    bounds.minlat != null &&
    bounds.maxlat != null &&
    bounds.minlon != null &&
    bounds.maxlon != null
  ) {
    return [(bounds.minlat + bounds.maxlat) / 2, (bounds.minlon + bounds.maxlon) / 2];
  }
  return null;
}

/**
 * The element's area as GeoJSON, or null when it has none: an open way is a
 * line, and a relation whose rings will not close is not a shape. Either
 * falls back to the representative point.
 *
 * One outer ring is a `Polygon`; several are a `MultiPolygon` with each its
 * own polygon. Written as one `Polygon`, rings after the first would read as
 * holes — Westpark's three separate patches as one park with two lakes.
 */
export function elementShape(element: OverpassElement): Polygon | MultiPolygon | null {
  if (isCoastline(element)) return null;
  const rings = element.members
    ? assembleRings(element.members)
    : [closedRing(element.geometry)].filter((ring) => ring !== null);
  if (rings.length === 0) return null;
  return rings.length === 1
    ? { type: "Polygon", coordinates: rings }
    : { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) };
}

/**
 * An open way or a coastline as a line, or null for anything else. Only
 * categories that widen lines ask: elsewhere an open way falls back to its
 * point.
 */
export function elementLine(element: OverpassElement): LineString | null {
  if (element.type !== "way" || element.members) return null;
  const geometry = element.geometry;
  if (!geometry || geometry.length < 2) return null;
  if (closedRing(geometry) && !isCoastline(element)) return null;
  const points = definedPoints(geometry);
  if (points.length !== geometry.length) return null;
  return {
    type: "LineString",
    coordinates: toPositions(points),
  };
}

function isCoastline(element: OverpassElement): boolean {
  return element.tags?.natural === "coastline";
}

/**
 * A ring, or null. Overpass writes `null` for vertices it clipped, and a
 * clipped ring can still have matching ends, so gaps are checked too.
 */
function closedRing(geometry: (OverpassPoint | null)[] | undefined): Position[] | null {
  if (!geometry || geometry.length < 4) return null;

  const points = definedPoints(geometry);
  if (points.length !== geometry.length) return null;

  const [firstLat, firstLon] = points[0];
  const [lastLat, lastLon] = points[points.length - 1];
  if (firstLat !== lastLat || firstLon !== lastLon) return null;

  return toPositions(points);
}

/**
 * Join chains sharing an endpoint, in either direction, until none will.
 * Chains left open are discarded: closing one would invent ground. Exact
 * comparison is sound because adjacent members share an OSM node.
 */
function assembleRings(members: OverpassMember[]): Position[][] {
  const rings: Position[][] = [];
  const chains: (Position[] | null)[] = [];

  for (const member of members) {
    if (member.role !== "outer" && member.role !== "") continue;
    const closed = closedRing(member.geometry);
    if (closed) {
      rings.push(closed);
      continue;
    }
    const points = definedPoints(member.geometry);
    if (!member.geometry || points.length !== member.geometry.length) continue;
    if (points.length < 2) continue;
    chains.push(toPositions(points));
  }

  let joined = true;
  while (joined) {
    joined = false;
    for (let i = 0; i < chains.length && !joined; i += 1) {
      const a = chains[i];
      if (!a) continue;
      for (let j = 0; j < chains.length; j += 1) {
        const b = chains[j];
        if (i === j || !b) continue;
        const merged = join(a, b);
        if (!merged) continue;
        chains[i] = merged;
        chains[j] = null;
        joined = true;
        break;
      }
    }
  }

  for (const chain of chains) {
    if (chain && chain.length >= 4 && samePosition(chain[0], chain[chain.length - 1])) {
      rings.push(chain);
    }
  }
  return rings;
}

function join(a: Position[], b: Position[]): Position[] | null {
  if (samePosition(a[a.length - 1], b[0])) return [...a, ...b.slice(1)];
  if (samePosition(a[a.length - 1], b[b.length - 1]))
    return [...a, ...b.slice(0, -1).reverse()];
  if (samePosition(a[0], b[b.length - 1])) return [...b, ...a.slice(1)];
  if (samePosition(a[0], b[0])) return [...b.slice().reverse(), ...a.slice(1)];
  return null;
}

/** Exact: positions from one OSM node are the identical numbers. */
export function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function toPositions(points: [number, number][]): Position[] {
  return points.map(([lat, lon]) => [lon, lat]);
}

function definedPoints(
  geometry: (OverpassPoint | null)[] | undefined,
): [number, number][] {
  if (!geometry) return [];
  const points: [number, number][] = [];
  for (const point of geometry) {
    if (point && point.lat != null && point.lon != null)
      points.push([point.lat, point.lon]);
  }
  return points;
}
