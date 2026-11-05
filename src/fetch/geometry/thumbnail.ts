/**
 * A region drawn small for the home screen: water and parks as their
 * shapes, which give a city its outline, and supermarkets as dots, which
 * find where people live. Pure: the data in, SVG paths out.
 */

import { lineString } from "@turf/helpers";
import simplify from "@turf/simplify";
import type { Position } from "geojson";

import type {
  HomeSample,
  Meta,
  PlaceFeature,
  Thumbnail,
  ThumbnailLayer,
} from "../../types";
import { polygonsOf } from "./geojson-conversion";

/** Twice the width a card shows it at, so it is sharp on a high-density screen. */
const WIDTH_PX = 240;

/** Drawn in this order; a category the region lacks is left out. */
const LAYERS: readonly { cat: string; shape: ThumbnailLayer["shape"] }[] = [
  { cat: "water", shape: "areas" },
  { cat: "sea", shape: "areas" },
  { cat: "park", shape: "areas" },
  { cat: "supermarket", shape: "dots" },
];

/**
 * Simplification, px. A card shows a pixel at under half a screen pixel, so
 * whole pixels and this tolerance look the same as a tenth and 0.35: all
 * nine regions 80 kB gzipped against 234, Amsterdam 16 against 52.
 */
const SIMPLIFY_PX = 1;

/** A shape smaller than this both ways is a speck, and goes. */
const MIN_EXTENT_PX = 2;

/** Web Mercator, the world 1 across, so the thumbnail matches the map. */
function mercator([lon, lat]: Position): [number, number] {
  const phi = (lat * Math.PI) / 180;
  return [
    (lon + 180) / 360,
    (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2,
  ];
}

/** Whole pixels; see `SIMPLIFY_PX`. */
function num(value: number): string {
  return String(Math.round(value));
}

export function thumbnailFor(
  features: PlaceFeature[],
  meta: Pick<Meta, "bbox" | "categories">,
): Thumbnail {
  const [south, west, north, east] = meta.bbox;
  const [x0, y0] = mercator([west, north]);
  const [x1, y1] = mercator([east, south]);
  const scale = WIDTH_PX / (x1 - x0);
  const toPx = (position: Position): [number, number] => {
    const [x, y] = mercator(position);
    return [(x - x0) * scale, (y - y0) * scale];
  };

  const layers: ThumbnailLayer[] = [];
  for (const { cat, shape } of LAYERS) {
    const category = meta.categories[cat];
    if (!category) continue;
    const places = features.filter((feature) => feature.properties.cat === cat);
    const d = shape === "areas" ? areasPath(places, toPx) : dotsPath(places, toPx);
    if (d) layers.push({ cat, color_index: category.color_index, shape, d });
  }
  return {
    width: WIDTH_PX,
    height: Math.round((y1 - y0) * scale),
    layers,
  };
}

function areasPath(
  places: PlaceFeature[],
  toPx: (position: Position) => [number, number],
): string {
  const parts: string[] = [];
  for (const { geometry } of places) {
    if (geometry.type === "Point") continue;
    for (const [outer] of polygonsOf(geometry)) {
      const ring = outer.map(toPx);
      const xs = ring.map(([x]) => x);
      const ys = ring.map(([, y]) => y);
      const extent = Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      );
      if (extent < MIN_EXTENT_PX) continue;
      const kept = simplify(lineString(ring), { tolerance: SIMPLIFY_PX }).geometry
        .coordinates;
      if (kept.length < 3) continue;
      const [[x, y], ...rest] = kept;
      parts.push(
        `M${num(x)} ${num(y)}${rest.map(([px, py]) => ` ${num(px)} ${num(py)}`).join("")}Z`,
      );
    }
  }
  return parts.join("");
}

/** A set, because dots on the same pixel are one dot. */
function dotsPath(
  places: PlaceFeature[],
  toPx: (position: Position) => [number, number],
): string {
  const dots = new Set<string>();
  for (const { geometry } of places) {
    if (geometry.type !== "Point") continue;
    const [x, y] = toPx(geometry.coordinates);
    dots.add(`M${num(x)} ${num(y)}h0`);
  }
  return [...dots].join("");
}

/** Earth's circumference at the equator, km: Web Mercator's world is 1 across it. */
const EQUATOR_KM = 40075.017;

export interface SampleCrop {
  /** [lat, lon] of the crop's centre. */
  center: [number, number];
  widthKm: number;
  widthPx: number;
  heightPx: number;
  /** Supermarkets kept: a handful, spread out, so their reach can limit the overlap. */
  shops: number;
  /** Simplification, px: enough to read as mapped rather than drawn. */
  simplifyPx: number;
  /** Shapes this far outside the crop still reach into it, px. */
  marginPx: number;
  /** Supermarkets nearer the edge than this lose half their reach to it, px. */
  insetPx: number;
}

/** A crop of one region's water, parks and supermarkets, for the home screen. */
export function homeSample(features: PlaceFeature[], crop: SampleCrop): HomeSample {
  const [lat, lon] = crop.center;
  const [cx, cy] = mercator([lon, lat]);
  const scale =
    crop.widthPx / (crop.widthKm / (EQUATOR_KM * Math.cos((lat * Math.PI) / 180)));
  const x0 = cx - crop.widthPx / 2 / scale;
  const y0 = cy - crop.heightPx / 2 / scale;
  const toPx = (position: Position): [number, number] => {
    const [x, y] = mercator(position);
    return [(x - x0) * scale, (y - y0) * scale];
  };
  const within = ([x, y]: [number, number], pad: number) =>
    x >= -pad && x <= crop.widthPx + pad && y >= -pad && y <= crop.heightPx + pad;
  const round = ([x, y]: Position): [number, number] => [
    Math.round(x * 10) / 10,
    Math.round(y * 10) / 10,
  ];

  const rings = (cat: string): [number, number][][] =>
    features
      .filter((feature) => feature.properties.cat === cat)
      .flatMap(({ geometry }) => (geometry.type === "Point" ? [] : polygonsOf(geometry)))
      .map(([outer]) => outer.map(toPx))
      .filter((ring) => ring.some((point) => within(point, crop.marginPx)))
      .map(
        (ring) =>
          simplify(lineString(ring), { tolerance: crop.simplifyPx }).geometry.coordinates,
      )
      .filter((ring) => ring.length >= 4)
      .map((ring) => ring.map(round));

  const shops = features
    .filter((feature) => feature.properties.cat === "supermarket")
    .flatMap(({ geometry }) =>
      geometry.type === "Point" ? [toPx(geometry.coordinates)] : [],
    )
    .filter((point) => within(point, -crop.insetPx));

  return {
    width: crop.widthPx,
    height: crop.heightPx,
    water: rings("water"),
    park: rings("park"),
    supermarket: spreadOut(shops, crop.shops, [crop.widthPx / 2, crop.heightPx / 2]).map(
      round,
    ),
  };
}

/** `count` of `points`, from the one nearest `start`, each next the farthest from all chosen. */
function spreadOut(
  points: [number, number][],
  count: number,
  start: [number, number],
): [number, number][] {
  const distance2 = (a: [number, number], b: [number, number]) =>
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const nearest = points.reduce((best, point) =>
    distance2(point, start) < distance2(best, start) ? point : best,
  );
  const chosen = [nearest];
  while (chosen.length < Math.min(count, points.length)) {
    const next = points.reduce((best, point) =>
      Math.min(...chosen.map((c) => distance2(point, c))) >
      Math.min(...chosen.map((c) => distance2(best, c)))
        ? point
        : best,
    );
    chosen.push(next);
  }
  return chosen;
}
