/** Overpass elements to places: extraction, dedupe, count checks. Pure. */

import distance from "@turf/distance";
import type { LineString, MultiPolygon, Polygon } from "geojson";

import {
  elementLine,
  elementPoint,
  elementShape,
  type OverpassElement,
} from "./geometry/overpass-geometry";

/**
 * One place on its way to GeoJSON. `lat`/`lon` is always the representative
 * point, shape or not, which keeps `dedupe` one code path and gives an area
 * whose shape will not assemble somewhere to fall back to.
 */
export interface Place {
  cat: string;
  lat: number;
  lon: number;
  name?: string;
  /** Area categories only, from `elementShape`. */
  shape?: Polygon | MultiPolygon;
  /** Categories that widen lines only; `widenLines` turns it into a shape. */
  line?: LineString;
}

/**
 * Overpass elements to places, counting those with no coordinates. Whether
 * to keep shapes and lines comes from the yaml, not from what a cached
 * response happens to hold, so the yaml stays authoritative.
 */
export function elementsToPlaces(
  elements: OverpassElement[],
  cat: string,
  { shapes = false, lines = false }: { shapes?: boolean; lines?: boolean } = {},
): { places: Place[]; skipped: number } {
  const places: Place[] = [];
  let skipped = 0;

  for (const element of elements) {
    const point = elementPoint(element);
    if (point === null) {
      skipped += 1;
      continue;
    }
    const [lat, lon] = point;
    const shape = shapes ? elementShape(element) : null;
    const line = lines && !shape ? elementLine(element) : null;
    places.push({
      cat,
      lat,
      lon,
      name: element.tags?.name,
      ...(shape ? { shape } : {}),
      ...(line ? { line } : {}),
    });
  }

  return { places, skipped };
}

/**
 * Drop places within `radiusM` of one already kept. First wins, except that a
 * shape displaces a bare point: OSM often maps one facility as a node and a
 * way, and Overpass returns nodes first. A shape never displaces a shape, so
 * the result stays deterministic.
 */
export function dedupe(places: Place[], radiusM: number): Place[] {
  const kept: Place[] = [];
  for (const place of places) {
    const at = kept.findIndex(
      (k) =>
        distance([place.lon, place.lat], [k.lon, k.lat], { units: "meters" }) < radiusM,
    );
    if (at < 0) {
      kept.push(place);
      continue;
    }
    if (place.shape && !kept[at].shape) kept[at] = place;
  }
  return kept;
}

/** A warning if `count` falls outside `expect`, else null. */
export function countWarning(
  cat: string,
  count: number,
  expect: [number, number] | null,
): string | null {
  if (!expect) return null;
  const [low, high] = expect;
  if (count < low) {
    return `${cat}: ${count} places, below expected ${low}-${high} — query may be too narrow`;
  }
  if (count > high) {
    return `${cat}: ${count} places, above expected ${low}-${high} — query may be catching neighbours`;
  }
  return null;
}
