/** Area categories: measuring, cutting, simplifying and widening their shapes. */

import area from "@turf/area";
import turfBbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import buffer from "@turf/buffer";
import { featureCollection, multiLineString, polygon } from "@turf/helpers";
import intersect from "@turf/intersect";
import distance from "@turf/distance";
import { coordEach } from "@turf/meta";
import simplify from "@turf/simplify";
import type { BBox, LineString, MultiPolygon, Polygon, Position } from "geojson";

import type { Bbox } from "../../types";
import type { Place } from "../places";
import { samePosition } from "./overpass-geometry";

/** Metres per degree of latitude, to express a tolerance in degrees. */
const M_PER_DEGREE_LAT = 111_320;

/** Arc segments per quarter turn on a strip's bends and ends; turf's default is 8. */
const STRIP_STEPS = 2;

/** Steps, each a strip's width long, below which a stretch between two areas goes. */
const MIN_RUN_STEPS = 3;

/** Ground a place covers, m². Zero for a point. */
export function placeAreaM2(place: Place): number {
  return place.shape ? area(place.shape) : 0;
}

/**
 * Drop places whose whole body covers less than `minAreaM2`.
 *
 * OSM cuts a river into polygons at bridges and boundaries; judging the
 * pieces separately draws it as a dashed line. Pieces OSM split share
 * their join nodes exactly, so features sharing a vertex are one body.
 * A place with no shape cannot show it qualifies, so it goes. An open line is
 * exempt: its tag already says it is a river, and its width is ours. A
 * closed line rings an island, and is judged by the land it encloses.
 * A body with a name on any piece passes at `namedMinAreaM2` instead.
 * Within a body that passes, a piece under `pieceMinAreaM2` still goes: a
 * Dutch polder's ditches all touch, and pass on the size of their lake.
 */
export function dropBelowArea(
  places: Place[],
  minAreaM2: number,
  namedMinAreaM2: number = minAreaM2,
  pieceMinAreaM2: number = 0,
): Place[] {
  if (minAreaM2 <= 0) return places;

  const parent = places.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]];
      root = parent[root];
    }
    return root;
  };

  // Raw Overpass coordinates, before rounding: a shared node is the
  // identical number, and 7 dp is the precision Overpass emits.
  const seen = new Map<string, number>();
  places.forEach((place, index) => {
    if (!place.shape) return;
    coordEach(place.shape, ([lon, lat]) => {
      const key = `${lon.toFixed(7)},${lat.toFixed(7)}`;
      const first = seen.get(key);
      if (first === undefined) seen.set(key, index);
      else parent[find(first)] = find(index);
    });
  });

  const bodyArea = new Map<number, number>();
  const named = new Set<number>();
  places.forEach((place, index) => {
    const root = find(index);
    bodyArea.set(root, (bodyArea.get(root) ?? 0) + placeAreaM2(place));
    if (place.name) named.add(root);
  });

  return places.filter((place, index) => {
    if (place.line) {
      const ring = place.line.coordinates;
      if (!samePosition(ring[0], ring[ring.length - 1])) return true;
      return area(polygon([ring])) >= (place.name ? namedMinAreaM2 : minAreaM2);
    }
    const root = find(index);
    const cut = named.has(root) ? namedMinAreaM2 : minAreaM2;
    return (bodyArea.get(root) ?? 0) >= cut && placeAreaM2(place) >= pieceMinAreaM2;
  });
}

/**
 * Simplify every shape, tolerance in metres.
 *
 * Reach buffers by hundreds of metres, so finer boundary detail is
 * invisible in the output. Measured on Munich's 413 parks over 1 ha: 17823
 * vertices raw, 4203 at 25 m, for 0.77% of area. Converted at latitude
 * degrees, so it simplifies slightly less east–west, which errs towards
 * keeping shape.
 */
export function simplifyPlaces(places: Place[], toleranceM: number): Place[] {
  if (toleranceM <= 0) return places;
  const tolerance = toleranceM / M_PER_DEGREE_LAT;
  return places.map((place) =>
    place.shape ? { ...place, shape: simplify(place.shape, { tolerance }) } : place,
  );
}

/**
 * Turn every line into a strip `widthM` wide, clipped to the bbox: a
 * `waterway=river` way runs on regardless of the bbox that selected it.
 * A line wholly outside goes. Simplified at half the width, so the real
 * centre line stays inside its strip: at the category's 25 m, 11% of the
 * Würm fell outside. A line is widened only where it runs outside the
 * category's own areas, so a river mapped as both is drawn once, as its
 * polygon. An unnamed area takes the name of the line with the most length
 * inside it: OSM names the Thames and the Isar on the line alone.
 */
export function widenLines(
  places: Place[],
  widthM: number,
  [south, west, north, east]: Bbox,
): Place[] {
  if (widthM <= 0) return places;
  const tolerance = widthM / 2 / M_PER_DEGREE_LAT;
  const box = polygon([
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ]);
  const areas = new Map<Place, Area>();
  for (const place of places) {
    if (place.shape) {
      areas.set(place, {
        shape: place.shape,
        extent: turfBbox(place.shape),
        names: new Map(),
      });
    }
  }
  const all = [...areas.values()];
  const strips = new Map<Place, Place | null>();
  for (const place of places) {
    if (!place.line) continue;
    const { line, ...rest } = place;
    const runs = outsideAreas(line, all, widthM, place.name);
    const strip =
      runs.length > 0
        ? buffer(simplify(multiLineString(runs), { tolerance }), widthM / 2, {
            units: "meters",
            steps: STRIP_STEPS,
          })
        : null;
    const clipped = strip ? intersect(featureCollection([strip, box])) : null;
    strips.set(place, clipped ? { ...rest, shape: clipped.geometry } : null);
  }
  return places.flatMap((place) => {
    if (place.line) return strips.get(place) ?? [];
    const names = areas.get(place)?.names;
    if (place.name || !names || names.size === 0) return [place];
    const [name] = [...names].reduce((longest, entry) =>
      entry[1] > longest[1] ? entry : longest,
    );
    return [{ ...place, name }];
  });
}

/** An area as `outsideAreas` sees it: metres of each named line inside it. */
interface Area {
  shape: Polygon | MultiPolygon;
  extent: BBox;
  names: Map<string, number>;
}

/**
 * The stretches of a line outside every area, judged every `stepM` along
 * it by the midpoint of each step. A stretch under `MIN_RUN_STEPS` with an
 * area at both ends is a centre line straying from its own polygon, and goes.
 * Each step inside counts towards `name` on the area it fell in.
 */
function outsideAreas(
  line: LineString,
  areas: Area[],
  stepM: number,
  name?: string,
): Position[][] {
  const [west, south, east, north] = turfBbox(line);
  const near = areas.filter(
    ({ extent: [w, s, e, n] }) => w <= east && e >= west && s <= north && n >= south,
  );
  const coords = line.coordinates;
  if (near.length === 0) return [coords];

  const inside = ([lon, lat]: Position): Area | undefined =>
    near.find(
      ({ shape, extent: [w, s, e, n] }) =>
        lon >= w &&
        lon <= e &&
        lat >= s &&
        lat <= n &&
        booleanPointInPolygon([lon, lat], shape),
    );
  const runs: Position[][] = [];
  let run: Position[] = [];
  let afterArea = false;
  for (let i = 1; i < coords.length; i += 1) {
    const [a, b] = [coords[i - 1], coords[i]];
    const lengthM = distance(a, b, { units: "meters" });
    const steps = Math.max(1, Math.ceil(lengthM / stepM));
    for (let k = 0; k < steps; k += 1) {
      const from = lerp(a, b, k / steps);
      const to = lerp(a, b, (k + 1) / steps);
      const hit = inside(lerp(from, to, 0.5));
      if (hit) {
        if (name) hit.names.set(name, (hit.names.get(name) ?? 0) + lengthM / steps);
        if (run.length > 1 && !(afterArea && run.length <= MIN_RUN_STEPS)) runs.push(run);
        run = [];
        afterArea = true;
      } else {
        if (run.length === 0) run.push(from);
        run.push(to);
      }
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

function lerp(a: Position, b: Position, t: number): Position {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
