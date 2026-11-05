/**
 * A reach's radius, and the region's own area: all the page computes. The
 * reaches and the overlap are drawn, in `overlap.ts`.
 */

import type { CategoryState } from "./state";
import { DETOUR_FACTOR, SPEED_KMH } from "./tuning";
import type { Bbox } from "../types";

/** The mean radius Turf measures with, which the fetch step's areas use too. */
const EARTH_RADIUS_M = 6371008.8;

/** A time budget as a straight-line distance: speed × minutes × detour factor. */
export function radiusM({ mode, minutes }: CategoryState): number {
  return Math.round((SPEED_KMH[mode] * minutes * DETOUR_FACTOR * 1000) / 60);
}

/** Exact on the sphere for a box whose sides follow meridians and parallels. */
export function bboxAreaKm2([south, west, north, east]: Bbox): number {
  const rad = Math.PI / 180;
  const m2 =
    EARTH_RADIUS_M ** 2 *
    (east - west) *
    rad *
    (Math.sin(north * rad) - Math.sin(south * rad));
  return m2 / 1_000_000;
}
