import L from "leaflet";

import {
  composite,
  context,
  fillReach,
  pxPerMetre,
  type CategoryReach,
  type Frame,
} from "./overlap";
import { ESTIMATE_PX, REFINE_PX } from "./tuning";
import type { Bbox } from "../types";

export interface OverlapEstimate {
  km2: number;
  /** No overlap anywhere, to within a few metres: what "No overlap" says. */
  empty: boolean;
}

/** The frame covering zoom-0 pixels from (x0, y0) to (x1, y1) at `scale`. */
function frameAt(x0: number, y0: number, x1: number, y1: number, scale: number): Frame {
  return {
    scale,
    offsetX: x0 * scale,
    offsetY: y0 * scale,
    width: Math.ceil((x1 - x0) * scale),
    height: Math.ceil((y1 - y0) * scale),
  };
}

/** Pixel bounds, inclusive. */
interface PixelBounds {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

/** The overlap drawn into `frame` and read back; the canvases are let go after. */
function overlapPixels(reaches: CategoryReach[], frame: Frame): Uint8ClampedArray {
  const overlapCanvas = document.createElement("canvas");
  const reachCanvas = document.createElement("canvas");
  for (const canvas of [overlapCanvas, reachCanvas]) {
    canvas.width = frame.width;
    canvas.height = frame.height;
  }
  const overlap = context(overlapCanvas, true);
  const reach = context(reachCanvas);
  reaches.forEach((category, i) => {
    reach.clearRect(0, 0, frame.width, frame.height);
    fillReach(reach, category, frame);
    composite(overlap, i === 0 ? "copy" : "destination-in", reachCanvas);
  });
  const { data } = overlap.getImageData(0, 0, frame.width, frame.height);
  // A canvas holds its memory until it is resized: 16 MB each at 2048 px.
  for (const canvas of [overlapCanvas, reachCanvas]) canvas.width = canvas.height = 0;
  return data;
}

/**
 * Pixels at least half covered make the m², each its size at its latitude.
 * A pixel covered less holds a sliver or a near miss: `touched` bounds them.
 */
function countPixels(
  data: Uint8ClampedArray,
  frame: Frame,
): { m2: number; touched: PixelBounds | null } {
  const crs = L.CRS.EPSG3857;
  let m2 = 0;
  let touched: PixelBounds | null = null;
  for (let row = 0; row < frame.height; row++) {
    let covered = 0;
    for (let col = 0, at = row * frame.width * 4 + 3; col < frame.width; col++, at += 4) {
      const alpha = data[at];
      if (alpha >= 128) covered++;
      else if (alpha > 0) {
        touched ??= { minCol: col, maxCol: col, minRow: row, maxRow: row };
        touched.minCol = Math.min(touched.minCol, col);
        touched.maxCol = Math.max(touched.maxCol, col);
        touched.maxRow = row;
      }
    }
    if (covered === 0) continue;
    const y = (frame.offsetY + row + 0.5) / frame.scale;
    const metresPerPx =
      1 / (pxPerMetre(crs.pointToLatLng(L.point(0, y), 0).lat) * frame.scale);
    m2 += covered * metresPerPx * metresPerPx;
  }
  return { m2, touched };
}

/**
 * The overlap's km² over the region and the reach beyond its edge, drawn at
 * `ESTIMATE_PX` across the bbox. When no pixel is half covered but some are
 * touched, that part is drawn again at up to `REFINE_PX`, so that a sliver
 * is not called empty: "No overlap" also stops the dim and the outline, and
 * would hide it at street zoom.
 */
export function estimateOverlap(reaches: CategoryReach[], bbox: Bbox): OverlapEstimate {
  const [south, west, north, east] = bbox;
  const crs = L.CRS.EPSG3857;
  const nw = crs.latLngToPoint(L.latLng(north, west), 0);
  const se = crs.latLngToPoint(L.latLng(south, east), 0);
  const margin =
    Math.max(...reaches.map(({ radiusM }) => radiusM)) * pxPerMetre((south + north) / 2);
  const scale = ESTIMATE_PX / Math.max(se.x - nw.x, se.y - nw.y);
  const coarse = frameAt(
    nw.x - margin,
    nw.y - margin,
    se.x + margin,
    se.y + margin,
    scale,
  );

  const { m2: coarseM2, touched } = countPixels(overlapPixels(reaches, coarse), coarse);
  let m2 = coarseM2;
  if (m2 === 0 && touched) {
    // Back to zoom-0 pixels, with a coarse pixel's margin round what was touched.
    const x0 = (coarse.offsetX + touched.minCol - 1) / scale;
    const x1 = (coarse.offsetX + touched.maxCol + 2) / scale;
    const y0 = (coarse.offsetY + touched.minRow - 1) / scale;
    const y1 = (coarse.offsetY + touched.maxRow + 2) / scale;
    const fine = frameAt(x0, y0, x1, y1, REFINE_PX / Math.max(x1 - x0, y1 - y0));
    m2 = countPixels(overlapPixels(reaches, fine), fine).m2;
  }
  return { km2: m2 / 1_000_000, empty: m2 === 0 };
}
