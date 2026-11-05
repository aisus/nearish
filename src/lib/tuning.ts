/**
 * Every tunable number of the page, with the measurement behind it. Most were
 * measured, not chosen: read the comment before changing a value.
 */

import type { BasemapKey } from "./basemaps";
import type { Mode } from "../types";

/** Straight-line travel speeds, km/h. */
export const SPEED_KMH: Record<Mode, number> = {
  walk: 4.8,
  bike: 16,
};

/**
 * Straight-line distance per unit of path distance: 15 minutes' walk is
 * 1.2 km along streets but about 900 m from the start. One number for both
 * modes (0.75 walk, 0.70 bike is small against the uncertainty), disclosed
 * in the panel rather than adjustable.
 */
export const DETOUR_FACTOR = 0.75;

/** Minutes slider bounds. */
export const MINUTES_MIN = 5;
export const MINUTES_MAX = 60;

/** The pins' default minutes, as every category's. */
export const PIN_DEFAULT_MINUTES = 15;

/** Longest pin name kept. */
export const PIN_NAME_MAX = 60;

/** Regions across the home screen, at most: the most that leaves the whole page in one 2560x1300 window with three rows. */
export const REGION_COLUMNS_MAX = 7;

/** How long *Copy link*'s notice stays, ms. */
export const COPIED_NOTICE_MS = 2500;

/** Quiet after another tab's save before a visible tab follows it, ms. */
export const FOLLOW_SAVED_MS = 500;

/** The OSMF guidelines' figure: a credit may fold after five seconds on screen, ms. */
export const ATTRIBUTION_SHOWN_MS = 5000;

/** Zoom snaps to this: whole zooms left Munich's bbox, which needs 10.98, at 40% of a 1440 px window. */
export const ZOOM_SNAP = 0.25;

/** Room kept round a pin panned into view, px. */
export const REVEAL_PADDING_PX = 40;

/**
 * The reaches and the overlap are drawn this far beyond each edge of the
 * view, as a share of it, so that a pan shows them before it ends. Leaflet's
 * own renderer pads the same.
 */
export const OVERLAP_PADDING = 0.1;

/**
 * Places, pins and the bbox's edge, drawn by Leaflet as SVG, are drawn this
 * far beyond each edge of the view, as a share of it. Leaflet's 0.1 left a
 * hard edge a moment into a drag.
 */
export const PATH_PADDING = 0.5;

/**
 * A pan redraws the overlap before it ends, once half the padding is used
 * up, while the last redraw took less than this, ms. With a GPU one takes
 * about a frame (13-19 ms); in software 116-216 ms would stall the drag,
 * which there waits for the pan's end.
 */
export const OVERLAP_PAN_REDRAW_MS = 33;

/**
 * Device pixels per CSS pixel the overlap is drawn at, at most. The cost is
 * in the pixels: 1.6x them cost 1.6x the time in software (2026-11-01), and
 * a phone's 3 would draw 2.25x the pixels of 2.
 */
export const OVERLAP_MAX_DPR = 2;

/**
 * Shapes in one path. A GPU fills a path by counting windings in an 8-bit
 * stencil, so 256 circles over one pixel wrap to zero and punch a hole:
 * contour lines through supermarket at a 41 minute walk in Berlin, on
 * Android Chrome (2026-11-01). A stroke can wind twice, so areas take half.
 */
export const CIRCLES_PER_PATH = 128;
export const AREAS_PER_PATH = 64;

/**
 * The long side, px, of the region drawn for the overlap's km²: ~90 m a
 * pixel in Munich, 6 ms with a GPU. At twice this the km² ran 1-3% above
 * an exact union of 16-gons over thinned places.
 */
export const ESTIMATE_PX = 512;

/**
 * The long side, px, a near-empty overlap is drawn again at before it is
 * called empty. A pin 2 m into a climbing gym's 600 m reach was found, and
 * one 2 m outside it was not (2026-11-01).
 */
export const REFINE_PX = 2048;

/** A value by zoom or by count: straight between the stops given, level past them. */
type Stops = Record<number, number>;

export function interpolate(stops: Stops, x: number): number {
  const points = Object.entries(stops)
    .map(([at, value]) => [Number(at), value] as const)
    .sort(([a], [b]) => a - b);
  const next = points.findIndex(([at]) => at > x);
  if (next === -1) return points[points.length - 1][1];
  if (next === 0) return points[0][1];
  const [fromAt, from] = points[next - 1];
  const [toAt, to] = points[next];
  return from + ((to - from) * (x - fromAt)) / (toAt - fromAt);
}

/** How the overlap, the reaches, the places, the pins and the bbox's edge are drawn. */
export const DRAWING = {
  /**
   * Black over everything outside the overlap. 0.4-0.6 all read; at 0.65
   * the whole-region view lost the lakes and towns around Munich.
   */
  outsideDim: 0.45,
  /**
   * The overlap's own fill in the theme's overlap colour, by zoom. It washes
   * out the streets, which region zoom has none of: there an overlap is
   * mostly pieces a few pixels across, which an outline alone draws as specks.
   */
  overlapFill: { 10: 0.2, 12: 0 } as Stops,
  /** The overlap's outline, px. */
  overlapOutline: 1,
  overlapOutlineOpacity: 0.95,
  /** Each reach tinted in its category's colour, by how many are drawn. One reach alone at 0.11 read as a smudge. */
  reachFill: { 1: 0.18, 2: 0.15, 3: 0.11, 5: 0.08 } as Stops,
  /** A park's or water body's outline, px. */
  areaOutline: 0.5,
  areaOutlineOpacity: 0.9,
  areaFill: 0.07,
  /**
   * Width of the invisible stroke an area's label answers to, px. The
   * outline is a fraction of a pixel and a river strip is 20 m, a pixel at
   * city zoom.
   */
  areaHitWidth: 12,
  /**
   * A place's marker radius, px, by zoom. Every category of Paris covers at
   * most 14% of the busiest 240 px of a desktop map at any zoom, and its
   * 1745 supermarkets 7%; 3 px at every zoom covered 49%. Capped below a
   * pin's radius.
   */
  markerRadius: { 10: 1, 11: 1.25, 12: 1.75, 13: 2.75, 14: 4, 15: 5 } as Stops,
  /** A place's marker fill, by zoom. */
  markerFill: { 0: 0.85, 13: 1 } as Stops,
  /**
   * How far from its centre a place answers the pointer, px. A 3 px marker
   * with a 1 px outline answered to 3.5; a finger needs no help, a mouse does.
   */
  markerHitRadius: 5,
  /** A glow round every place in the theme's halo colour, px. Without an edge a dot sank among Colour's own icons. */
  markerHalo: 1,
  /** The halo is drawn from this zoom on, where a dot is big enough to edge. */
  markerHaloMinZoom: 14,
  pinRadius: 7,
  pinRadiusSelected: 9,
  pinOutline: 2,
  pinOutlineSelected: 3,
  /** The bbox's dashed edge, px. */
  bboxOutline: 1,
  bboxOutlineOpacity: 0.6,
  bboxOutlineDash: "4 4",
};

/** What one basemap draws differently from `DRAWING`: only what a basemap switch repaints. */
export type BasemapDrawing = Partial<Pick<typeof DRAWING, "outsideDim" | "overlapFill">>;

export const DRAWING_BY_BASEMAP: Partial<Record<BasemapKey, BasemapDrawing>> = {
  /** The basemap is near black, so dimming outside left the overlap a hole. */
  dark: { overlapFill: { 11: 0.25, 12: 0.1 } },
  /**
   * Black at 0.45 turned the light grey to mud, and left light-palette
   * markers outside the overlap at 1.3-1.4:1 contrast. The overlap's colour
   * here is near black, so a fill would darken the overlap rather than lift it.
   */
  light: { outsideDim: 0.25, overlapFill: { 0: 0 } },
  colour: { outsideDim: 0.25, overlapFill: { 0: 0 } },
};

/** The home screen's animation. */
export const DEMO = {
  /** `SAMPLE_CROP` in `fetch/thumbnails.ts`: 12 km across 960 px. */
  metresPerPx: 12.5,
  /** The map's zoom at that scale in Berlin, one sample pixel to a CSS pixel. */
  zoom: 12.9,
  /** A place's dot, CSS px: the map's at street zoom, whatever the crop's scale. */
  markerPx: 4,
  /**
   * Canvas past each edge of the box, CSS px, wider than the overlap's
   * outline: the outline is the overlap less itself shifted, so at a canvas
   * edge it also outlines the edge. The map pads its canvases for the same.
   */
  paddingPx: 4,
  /**
   * The least a sample px is shown at, CSS px: a phone's width alone would
   * show the 12 km crop at 0.94x, too many small shapes behind its text. A
   * desktop's backdrop shows it at 2.7x.
   */
  minScale: 1.4,
  /** A park's or water body's fill under its outline. */
  areaFill: 0.3,
  /**
   * A budget takes `moveS` to move, and the next category starts `stepS`
   * after the last, so each change gets a moment to land.
   */
  moveS: 1.6,
  stepS: 1.9,
  /**
   * Each category's radius, sample px, and the budgets it moves through in
   * turn, as shares of it. The first are the opening frame, a third of it
   * overlap, which reduced motion keeps. Simulated every 0.25 s over the
   * whole loop: the overlap covered 15-45% of what a 2560x1300 window shows,
   * 27% typically, and 21-57% of a phone's, 36% typically; never empty.
   * Equal step counts close the loop.
   */
  water: { radius: 50, steps: [1, 0.75, 1.2, 0.85, 1.3] },
  park: { radius: 50, steps: [1, 1.25, 0.8, 1.12, 0.75] },
  supermarket: { radius: 80, steps: [1, 1.25, 0.85, 0.72, 1.15] },
};
