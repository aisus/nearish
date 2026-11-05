/**
 * The reaches and the overlap, drawn rather than computed: each reach is
 * filled into a canvas, and canvas compositing intersects them. No polygon
 * is unioned, so nothing here waits on the places' count. `overlap-layer.ts`
 * shows this on the map, and `overlap-estimate.ts` measures it.
 *
 * `fillReach` is the only function that knows what shape a place is, which
 * makes it the seam that precomputed isochrones would replace.
 */

import type { Position } from "geojson";
import L from "leaflet";

import type { OverlayTheme } from "./basemaps";
import { AREAS_PER_PATH, CIRCLES_PER_PATH, interpolate, type DRAWING } from "./tuning";
import type { PlaceFeature } from "../types";

/** SphericalMercator's radius, so that metres agree with Leaflet's projection. */
const EARTH_RADIUS_M = 6378137;

export interface OverlapStyle {
  tintReaches: boolean;
  /** The dim, the fill and the outline: two categories or more, shown, not empty. */
  drawOverlap: boolean;
  theme: OverlayTheme;
  drawing: typeof DRAWING;
}

/** An area's outer rings, wound one way so that one non-zero fill is their union. */
interface ProjectedArea {
  rings: Float64Array[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * A category's places in pixels: Web Mercator's at zoom 0, the world 256
 * across, for the map; a sample's own for the home screen.
 */
export interface ProjectedPlaces {
  /** x, y and pixels per metre there, three numbers per point. */
  points: Float64Array;
  areas: ProjectedArea[];
  /** Pixels per metre at the areas' mean latitude: one stroke width serves them all. */
  areaScale: number;
}

/** One ticked category, or the pins once ticked, as it is drawn. */
export interface CategoryReach {
  color: string;
  places: ProjectedPlaces;
  radiusM: number;
}

/** Where a canvas lies over the places: its x is the places' x × scale − offsetX. */
export interface Frame {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export function pxPerMetre(lat: number): number {
  return 256 / (2 * Math.PI * EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180));
}

function toPixels([lon, lat]: Position): [number, number] {
  const { x, y } = L.CRS.EPSG3857.latLngToPoint(L.latLng(lat, lon), 0);
  return [x, y];
}

type Located = Pick<PlaceFeature, "geometry">;

/** Keyed by each category's array of places, which a region keeps for its lifetime. */
const projections = new WeakMap<Located[], ProjectedPlaces>();

export function projectPlaces(places: Located[]): ProjectedPlaces {
  const cached = projections.get(places);
  if (cached) return cached;

  const points: number[] = [];
  const areas: ProjectedArea[] = [];
  let latSum = 0;
  for (const { geometry } of places) {
    if (geometry.type === "Point") {
      points.push(...toPixels(geometry.coordinates), pxPerMetre(geometry.coordinates[1]));
      continue;
    }
    const polygons =
      geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const rings = polygons.map(([outer]) => outer);
    areas.push(areaOf(rings, toPixels));
    latSum += rings[rings.length - 1][0][1];
  }

  const projected: ProjectedPlaces = {
    points: Float64Array.from(points),
    areas,
    areaScale: areas.length > 0 ? pxPerMetre(latSum / areas.length) : 0,
  };
  projections.set(places, projected);
  return projected;
}

/**
 * Places already in pixels, as the home screen's sample is: `scale` of them
 * to a metre, everywhere.
 */
export function placesInPixels(
  points: [number, number][],
  areas: [number, number][][],
  scale: number,
): ProjectedPlaces {
  return {
    points: Float64Array.from(points.flatMap(([x, y]) => [x, y, scale])),
    areas: areas.map((ring) => areaOf([ring], (p) => p)),
    areaScale: scale,
  };
}

/** Outer rings in pixels, wound one way, and their bounds. */
function areaOf<P>(rings: P[][], toPx: (position: P) => [number, number]): ProjectedArea {
  const area: ProjectedArea = {
    rings: [],
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const outer of rings) {
    const ring = new Float64Array(outer.length * 2);
    outer.forEach((position, i) => {
      const [x, y] = toPx(position);
      ring[2 * i] = x;
      ring[2 * i + 1] = y;
      area.minX = Math.min(area.minX, x);
      area.minY = Math.min(area.minY, y);
      area.maxX = Math.max(area.maxX, x);
      area.maxY = Math.max(area.maxY, y);
    });
    area.rings.push(signedArea(ring) < 0 ? reverseRing(ring) : ring);
  }
  return area;
}

function signedArea(ring: Float64Array): number {
  const n = ring.length / 2;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += ring[2 * i] * ring[2 * j + 1] - ring[2 * j] * ring[2 * i + 1];
  }
  return sum;
}

function reverseRing(ring: Float64Array): Float64Array {
  const out = new Float64Array(ring.length);
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    out[2 * i] = ring[2 * (n - 1 - i)];
    out[2 * i + 1] = ring[2 * (n - 1 - i) + 1];
  }
  return out;
}

/** Paints the current path every `limit` shapes, and once more for the rest. */
function batchedPath(ctx: CanvasRenderingContext2D, limit: number, paint: () => void) {
  let shapes = 0;
  ctx.beginPath();
  return {
    added(): void {
      if (++shapes < limit) return;
      paint();
      ctx.beginPath();
      shapes = 0;
    },
    finish(): void {
      if (shapes > 0) paint();
    },
  };
}

/**
 * A category's reach, filled: a circle round each point, and each area
 * filled and stroked 2r wide with round joins, which is exactly its buffer.
 */
export function fillReach(
  ctx: CanvasRenderingContext2D,
  { color, places, radiusM }: CategoryReach,
  frame: Frame,
): void {
  const { scale, offsetX, offsetY, width, height } = frame;
  const offCanvas = (minX: number, minY: number, maxX: number, maxY: number): boolean =>
    maxX < 0 || minX > width || maxY < 0 || minY > height;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  const circles = batchedPath(ctx, CIRCLES_PER_PATH, () => ctx.fill());
  const { points } = places;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i] * scale - offsetX;
    const y = points[i + 1] * scale - offsetY;
    const r = radiusM * points[i + 2] * scale;
    if (offCanvas(x - r, y - r, x + r, y + r)) continue;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    circles.added();
  }
  circles.finish();

  if (places.areas.length === 0) return;
  const r = radiusM * places.areaScale * scale;
  ctx.lineWidth = 2 * r;
  ctx.lineJoin = "round";
  const areas = batchedPath(ctx, AREAS_PER_PATH, () => {
    ctx.fill();
    ctx.stroke();
  });
  for (const area of places.areas) {
    if (
      offCanvas(
        area.minX * scale - offsetX - r,
        area.minY * scale - offsetY - r,
        area.maxX * scale - offsetX + r,
        area.maxY * scale - offsetY + r,
      )
    ) {
      continue;
    }
    for (const ring of area.rings) {
      ctx.moveTo(ring[0] * scale - offsetX, ring[1] * scale - offsetY);
      for (let i = 2; i < ring.length; i += 2) {
        ctx.lineTo(ring[i] * scale - offsetX, ring[i + 1] * scale - offsetY);
      }
      ctx.closePath();
    }
    areas.added();
  }
  areas.finish();
}

export function context(
  canvas: HTMLCanvasElement,
  readBack = false,
): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: readBack });
  if (!ctx) throw new Error("no 2D canvas");
  return ctx;
}

/** Composites `source` into `target` with `operation`, and puts the default back. */
export function composite(
  target: CanvasRenderingContext2D,
  operation: GlobalCompositeOperation,
  source: HTMLCanvasElement,
  dx = 0,
  dy = 0,
): void {
  target.globalCompositeOperation = operation;
  target.drawImage(source, dx, dy);
  target.globalCompositeOperation = "source-over";
}

/** Draws `source` into `target` at `alpha`. */
function blend(
  target: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  alpha: number,
): void {
  target.globalAlpha = alpha;
  target.drawImage(source, 0, 0);
  target.globalAlpha = 1;
}

/** Whatever `target` holds, in one color. */
function recolor(target: CanvasRenderingContext2D, color: string): void {
  target.globalCompositeOperation = "source-in";
  target.fillStyle = color;
  target.fillRect(0, 0, target.canvas.width, target.canvas.height);
  target.globalCompositeOperation = "source-over";
}

/**
 * The reaches and the overlap, painted into canvases that know nothing of
 * where they are shown: the map and the home screen's animation both paint
 * with it. The tints go under the places and the dim over them.
 */
export class OverlapPainter {
  /** Each reach tinted in its colour, the overlap cut out. */
  readonly tint = document.createElement("canvas");
  /** Outside the overlap dimmed, and the overlap's fill and outline. */
  readonly dim = document.createElement("canvas");
  /** One reach at a time, then the overlap recolored, then shrunk for its outline. */
  private readonly scratch = document.createElement("canvas");
  /** Every reach intersected, then the outline's ring cut from it. */
  private readonly overlap = document.createElement("canvas");

  /** Sizes every canvas in device pixels; their size on screen is the caller's. */
  resize(width: number, height: number): void {
    for (const canvas of [this.tint, this.dim, this.scratch, this.overlap]) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
  }

  /** `zoom` picks the overlap's fill; `dpr` turns its outline's CSS px into the canvas's. */
  paint(
    reaches: CategoryReach[],
    frame: Frame,
    style: OverlapStyle,
    zoom: number,
    dpr: number,
  ): void {
    context(this.tint).clearRect(0, 0, this.tint.width, this.tint.height);
    context(this.dim).clearRect(0, 0, this.dim.width, this.dim.height);

    this.fillReaches(reaches, frame, style);
    if (!style.drawOverlap) return;

    const { drawing, theme } = style;
    if (style.tintReaches) {
      composite(context(this.tint), "destination-out", this.overlap);
    }
    this.dimOutside(drawing.outsideDim);
    const fill = interpolate(drawing.overlapFill, zoom);
    if (fill > 0) this.fillOverlap(theme.overlap, fill);
    this.outlineOverlap(
      theme.overlap,
      drawing.overlapOutline * dpr,
      drawing.overlapOutlineOpacity,
    );
  }

  /** Each reach into `scratch`, then tinted and intersected into the overlap. */
  private fillReaches(reaches: CategoryReach[], frame: Frame, style: OverlapStyle): void {
    const scratch = context(this.scratch);
    const overlap = context(this.overlap);
    const tintAlpha = interpolate(style.drawing.reachFill, reaches.length);
    reaches.forEach((reach, i) => {
      scratch.clearRect(0, 0, frame.width, frame.height);
      fillReach(scratch, reach, frame);
      if (style.tintReaches) blend(context(this.tint), this.scratch, tintAlpha);
      if (style.drawOverlap) {
        composite(overlap, i === 0 ? "copy" : "destination-in", this.scratch);
      }
    });
  }

  private dimOutside(alpha: number): void {
    const dim = context(this.dim);
    dim.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    dim.fillRect(0, 0, this.dim.width, this.dim.height);
    composite(dim, "destination-out", this.overlap);
  }

  private fillOverlap(color: string, alpha: number): void {
    const scratch = context(this.scratch);
    composite(scratch, "copy", this.overlap);
    recolor(scratch, color);
    blend(context(this.dim), this.scratch, alpha);
  }

  /** The overlap less itself shrunk by `widthPx` each way; uses up the overlap canvas. */
  private outlineOverlap(color: string, widthPx: number, alpha: number): void {
    const w = Math.max(1, Math.round(widthPx));
    const shrunk = context(this.scratch);
    composite(shrunk, "copy", this.overlap);
    for (const [dx, dy] of [
      [w, 0],
      [-w, 0],
      [0, w],
      [0, -w],
    ]) {
      composite(shrunk, "destination-in", this.overlap, dx, dy);
    }
    const ring = context(this.overlap);
    composite(ring, "destination-out", this.scratch);
    recolor(ring, color);
    blend(context(this.dim), this.overlap, alpha);
  }
}
