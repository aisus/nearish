import type { MultiPolygon, Polygon, Position } from "geojson";

import type { PlaceFeature, PlaceGeometry } from "../../types";
import type { Place } from "../places";

/** 5 dp is about a metre: finer is bytes for nothing at this scale. */
const COORD_PRECISION = 5;

/** The GeoJSON the map reads. Rounded, and stripped of tags nothing uses. */
export function toFeatures(places: Place[]): PlaceFeature[] {
  return places.map(toFeature);
}

function toFeature(place: Place): PlaceFeature {
  return {
    type: "Feature",
    geometry: toGeometry(place),
    properties: {
      cat: place.cat,
      ...(place.name ? { name: place.name } : {}),
    },
  };
}

/**
 * A point, or the place's shape rounded — decided by what the place carries
 * rather than what its category declared, so a node inside an area category
 * is still a point and needs no special case downstream. A polygon that
 * rounding leaves without area is dropped, and with none left the place is
 * its point again.
 */
function toGeometry(place: Place): PlaceGeometry {
  const polygons = place.shape ? polygonsOf(place.shape) : [];
  // Every polygon from `elementShape` is a single boundary: nothing inside it.
  const boundaries = polygons
    .map(([boundary]) => roundBoundary(boundary))
    .filter(hasArea);

  if (boundaries.length === 0) {
    return { type: "Point", coordinates: [round(place.lon), round(place.lat)] };
  }
  if (boundaries.length === 1) {
    return { type: "Polygon", coordinates: boundaries };
  }
  return { type: "MultiPolygon", coordinates: boundaries.map((boundary) => [boundary]) };
}

export function polygonsOf(shape: Polygon | MultiPolygon): Position[][][] {
  return shape.type === "Polygon" ? [shape.coordinates] : shape.coordinates;
}

/**
 * Round a boundary, drop the repeats rounding created, and close it again:
 * at 5 dp vertices centimetres apart collapse, and a zero-length segment is
 * at best wasted bytes and at worst a degenerate polygon.
 */
function roundBoundary(boundary: Position[]): Position[] {
  const out: Position[] = [];
  for (const [lon, lat] of boundary) {
    const point: Position = [round(lon), round(lat)];
    const last = out[out.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    out.push(point);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    out.push([first[0], first[1]]);
  }
  return out;
}

/** Four positions is the fewest a closed boundary with any area can have. */
function hasArea(boundary: Position[]): boolean {
  return boundary.length >= 4;
}

function round(value: number): number {
  return Number(value.toFixed(COORD_PRECISION));
}
