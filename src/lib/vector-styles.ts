/**
 * Our changes to OpenFreeMap's styles, kept apart from the styles themselves:
 * `public/styles/` holds fixed copies, unedited, and each line here is one
 * decision. See `public/styles/README.md`.
 */

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

export interface LayerOverride {
  minzoom?: number;
  hidden?: boolean;
  paint?: Record<string, unknown>;
  /** A layer of our own, drawn just under this one. */
  addBelow?: LayerSpecification;
}

/** By layer id. */
export type StyleOverrides = Record<string, LayerOverride>;

export function applyOverrides(
  style: StyleSpecification,
  overrides: StyleOverrides,
): StyleSpecification {
  const known = new Set(style.layers.map((layer) => layer.id));
  for (const id of Object.keys(overrides)) {
    if (!known.has(id)) console.warn(`Style override for a layer the style lacks: ${id}`);
  }
  return {
    ...style,
    layers: style.layers.flatMap((layer) => {
      const change = overrides[layer.id];
      if (!change) return [layer];
      const changed = {
        ...layer,
        ...(change.minzoom === undefined ? {} : { minzoom: change.minzoom }),
        ...(change.hidden ? { layout: { ...layer.layout, visibility: "none" } } : {}),
        ...(change.paint ? { paint: { ...layer.paint, ...change.paint } } : {}),
      } as typeof layer;
      return change.addBelow ? [change.addBelow, changed] : [changed];
    }),
  };
}

const hide = (...ids: string[]): StyleOverrides =>
  Object.fromEntries(ids.map((id) => [id, { hidden: true }]));

/** Later sets win per field, and paints merge, so a zoom and a colour can come from two. */
function merge(...sets: StyleOverrides[]): StyleOverrides {
  const merged: StyleOverrides = {};
  for (const set of sets) {
    for (const [id, change] of Object.entries(set)) {
      const before = merged[id] ?? {};
      merged[id] = {
        ...before,
        ...change,
        ...(before.paint || change.paint
          ? { paint: { ...before.paint, ...change.paint } }
          : {}),
      };
    }
  }
  return merged;
}

/** Positron and Bright share their label layers. */
const THINNED_LABELS: StyleOverrides = {
  label_other: { minzoom: 14 },
  label_village: { minzoom: 12 },
  label_town: { minzoom: 10 },
  "highway-name-major": { minzoom: 14 },
  airport: { minzoom: 12 },
  water_name_point_label: { minzoom: 11 },
  // Road numbers, of no use on foot or by bike; street names stay.
  ...hide("highway-shield-non-us", "highway-shield-us-interstate", "road_shield_us"),
};

/*
 * Esri's World Dark Gray Base, sampled from its tiles: land 71,71,73; built-up
 * 77,77,79; buildings 80,80,82; parks 73,75,74 with an 84,86,85 edge; water
 * 35,34,39; airports 66,66,68; roads 84-97, 102 close in. No forest; minor
 * roads from zoom 11 and buildings from 16. Drawn from Positron, whose
 * built-up areas outline every town at every zoom, where Dark's are near
 * invisible; its labels are Light's, recoloured, rather than Esri's few.
 *
 * Positron's `park` layer is protected land, not parks: around Munich, 137
 * conservation areas, 91 wildlife refuges and drinking-water zones against
 * no park at all. City parks are landcover, which Positron leaves uncoloured.
 */
const LAND = "rgb(71,71,73)";
const WATER = "rgb(35,34,39)";
const ROAD = "rgb(84,84,86)";
const MAJOR = "rgb(95,95,97)";
const MOTORWAY = "rgb(100,100,102)";
const halo = (text: string) => ({
  paint: { "text-color": text, "text-halo-color": LAND },
});
const PLACE = halo("rgb(150,150,154)");
const CITY = halo("rgb(170,170,174)");
const WATER_NAME = halo("rgb(110,110,114)");
const STREET_NAME = halo("rgb(120,120,124)");

/** Positron's label colours, for a dark ground: black text becomes the lightest. */
const DARK_GREY_LABELS: StyleOverrides = {
  waterway_line_label: WATER_NAME,
  water_name_point_label: WATER_NAME,
  water_name_line_label: WATER_NAME,
  "highway-name-path": STREET_NAME,
  "highway-name-minor": STREET_NAME,
  "highway-name-major": STREET_NAME,
  airport: STREET_NAME,
  label_other: PLACE,
  label_village: PLACE,
  label_town: PLACE,
  label_state: PLACE,
  label_city: CITY,
  label_city_capital: CITY,
  label_country_3: CITY,
  label_country_2: CITY,
  label_country_1: CITY,
};

const CITY_PARKS: LayerSpecification = {
  id: "city_parks",
  type: "fill",
  source: "openmaptiles",
  "source-layer": "landcover",
  filter: [
    "match",
    ["get", "subclass"],
    ["park", "garden", "recreation_ground"],
    true,
    false,
  ],
  paint: { "fill-color": "rgb(73,75,74)", "fill-outline-color": "rgb(84,86,85)" },
};

const DARK_GREY_GROUND: StyleOverrides = {
  background: { paint: { "background-color": LAND } },
  // Above the built-up areas a park sits in.
  landcover_wood: { hidden: true, addBelow: CITY_PARKS },
  water: { paint: { "fill-color": WATER } },
  waterway: { paint: { "line-color": WATER } },
  landuse_residential: { paint: { "fill-color": "rgb(77,77,79)", "fill-opacity": 1 } },
  building: {
    minzoom: 16,
    paint: { "fill-color": "rgb(80,80,82)", "fill-outline-color": ROAD },
  },
  tunnel_motorway_inner: { paint: { "line-color": "rgb(77,77,79)" } },
  "aeroway-area": { paint: { "fill-color": "rgb(66,66,68)" } },
  "aeroway-runway": { paint: { "line-color": "rgb(98,96,99)" } },
  "aeroway-taxiway": { paint: { "line-color": ROAD } },
  road_area_pier: { paint: { "fill-color": LAND } },
  road_pier: { paint: { "line-color": LAND } },
  highway_path: { paint: { "line-color": "rgb(80,80,82)" } },
  highway_minor: { minzoom: 11, paint: { "line-color": ROAD } },
  highway_major_inner: { paint: { "line-color": MAJOR } },
  highway_major_subtle: { paint: { "line-color": "rgb(80,80,82)" } },
  highway_motorway_inner: { paint: { "line-color": MOTORWAY } },
  highway_motorway_subtle: { paint: { "line-color": "rgb(84,84,86)" } },
  highway_motorway_bridge_inner: { paint: { "line-color": MOTORWAY } },
  railway: { paint: { "line-color": ROAD } },
  railway_dashline: { paint: { "line-color": LAND } },
  railway_transit: { paint: { "line-color": ROAD } },
  railway_transit_dashline: { paint: { "line-color": LAND } },
  railway_service: { paint: { "line-color": ROAD } },
  railway_service_dashline: { paint: { "line-color": LAND } },
  boundary_2: { paint: { "line-color": "rgb(92,92,94)" } },
  boundary_3: { paint: { "line-color": "rgb(88,88,90)" } },
  boundary_disputed: { paint: { "line-color": "rgb(92,92,94)" } },
  ...hide(
    "park",
    "tunnel_motorway_casing",
    "aeroway-runway-casing",
    "highway_major_casing",
    "highway_motorway_casing",
    "highway_motorway_bridge_casing",
  ),
};

export const DARK_GREY: StyleOverrides = merge(
  DARK_GREY_GROUND,
  THINNED_LABELS,
  DARK_GREY_LABELS,
);

/** Dark's own colours; place names only where a region's view is close enough to read them. */
export const DARK: StyleOverrides = {
  place_other: { minzoom: 14 },
  place_suburb: { minzoom: 12 },
  place_village: { minzoom: 12 },
  place_town: { minzoom: 10 },
  highway_name_other: { minzoom: 14 },
  // Motorway numbers, of no use on foot or by bike.
  highway_name_motorway: { hidden: true },
  water_name: { minzoom: 11 },
};

export const LIGHT: StyleOverrides = THINNED_LABELS;

export const COLOUR: StyleOverrides = {
  ...THINNED_LABELS,
  poi_transit: { minzoom: 15 },
  // Bright's own shops, schools and museums, which crowd out the places drawn over it.
  poi_r1: { minzoom: 17 },
  ...hide("poi_r7", "poi_r20"),
};
