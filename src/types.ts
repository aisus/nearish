/**
 * The file contract between the two halves: what `src/fetch` writes into
 * `public/data` and the app reads back. Nothing else belongs here.
 */

import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";

export const MODES = ["walk", "bike"] as const;

export type Mode = (typeof MODES)[number];

/** Overlay palette slots; `color_index` indexes this order. */
export const PALETTE_SLOTS = [
  "blue",
  "pink",
  "green",
  "amber",
  "violet",
  "cyan",
  "lime",
  "red",
  "fuchsia",
  "teal",
  "indigo",
  "yellow",
  "brown",
] as const;

export type PaletteSlot = (typeof PALETTE_SLOTS)[number];

/** south, west, north, east — the order Overpass expects. */
export type Bbox = [number, number, number, number];

interface PlaceProps {
  cat: string;
  name?: string;
}

/**
 * A point for anything `out center tags;` collapses, a polygon for an area
 * category. Deliberately no `LineString`: see docs/architecture.md.
 */
export type PlaceGeometry = Point | Polygon | MultiPolygon;

export type PlaceFeature = Feature<PlaceGeometry, PlaceProps>;

export type PlaceCollection = FeatureCollection<PlaceGeometry, PlaceProps>;

/** One category as `meta.json` describes it. */
export interface CategoryMeta {
  label: string;
  /** What the category is called in this region, shown beside `label`. */
  local_name?: string;
  count: number;
  default_minutes: number;
  default_mode: Mode;
  default_enabled: boolean;
  /** Index into `PALETTE_SLOTS`, resolved from the category's declared `color`. */
  color_index: number;
  /**
   * The OSM database state this category was built from: Overpass's
   * `timestamp_osm_base`, which a rebuild from cache keeps.
   */
  osm_as_of: string;
}

/** `meta.json`: one per region, describing the data beside it. */
export interface Meta {
  region: string;
  label: string;
  /** When this file was written; a rebuild from cache moves it. Not the data's age. */
  fetched_at: string;
  /** The oldest of the categories' `osm_as_of`: how old the region's data is. */
  osm_as_of: string;
  bbox: Bbox;
  categories: Record<string, CategoryMeta>;
}

/** One region as the index lists it: enough for the home screen and to frame the map. */
export interface RegionSummary {
  id: string;
  label: string;
  bbox: Bbox;
  /** As in `meta.json`. */
  osm_as_of: string;
}

/** `regions.json`: which regions exist. */
export interface RegionIndex {
  regions: RegionSummary[];
}

/** `thumbnail.json`: one per region, the region drawn small for the home screen. */
export interface Thumbnail {
  /** Its own pixels, Web Mercator, the bbox exactly. */
  width: number;
  height: number;
  /** Drawn in order. */
  layers: ThumbnailLayer[];
}

export interface ThumbnailLayer {
  cat: string;
  /** As in `meta.json`, so the app colours it as the map does. */
  color_index: number;
  /** Areas are filled paths; dots are zero-length strokes, round-capped. */
  shape: "areas" | "dots";
  /** An SVG path in the thumbnail's pixels. */
  d: string;
}

/** `home-sample.json`: a crop of one region for the home screen's animation, in its own pixels. */
export interface HomeSample {
  width: number;
  height: number;
  /** Outer rings, each a list of [x, y]. */
  water: [number, number][][];
  park: [number, number][][];
  supermarket: [number, number][];
}
