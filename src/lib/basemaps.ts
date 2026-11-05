/**
 * The basemaps, all OpenFreeMap's vector tiles drawn from copies of its styles
 * in `public/styles/`, and the overlay colours that go with each.
 */

import { DRAWING, DRAWING_BY_BASEMAP } from "./tuning";
import { PALETTE_SLOTS, type PaletteSlot } from "../types";
import { COLOUR, DARK, DARK_GREY, LIGHT, type StyleOverrides } from "./vector-styles";

export type ThemeName = "dark" | "light";

interface Basemap {
  label: string;
  /** Which copy in `public/styles/` it is drawn from. */
  style: "dark" | "positron" | "bright";
  overrides: StyleOverrides;
  theme: ThemeName;
}

/** OpenStreetMap is credited once by the map, for the overlay, whatever the basemap. */
export const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a>';

/**
 * The more a basemap suppresses its own detail, the better the overlap reads on
 * it and the harder it is to tell where you are.
 */
export const BASEMAPS = {
  darkGrey: {
    label: "Dark grey",
    style: "positron",
    overrides: DARK_GREY,
    theme: "dark",
  },
  dark: {
    label: "Dark",
    style: "dark",
    overrides: DARK,
    theme: "dark",
  },
  light: {
    label: "Light",
    style: "positron",
    overrides: LIGHT,
    theme: "light",
  },
  colour: {
    label: "Colour",
    style: "bright",
    overrides: COLOUR,
    theme: "light",
  },
} as const satisfies Record<string, Basemap>;

export type BasemapKey = keyof typeof BASEMAPS;

/**
 * The basemap each theme opens on while none is chosen, picked by the
 * system's light or dark preference.
 */
export const THEME_BASEMAPS: Record<ThemeName, BasemapKey> = {
  dark: "darkGrey",
  light: "light",
};

/**
 * What the theme switch swaps each basemap for, so switching back returns to
 * it. Dark grey and Light are one style recoloured.
 */
export const THEME_PARTNERS: Record<BasemapKey, BasemapKey> = {
  darkGrey: "light",
  light: "darkGrey",
  dark: "colour",
  colour: "dark",
};

export interface OverlayTheme {
  /** Per-category colours, indexed by `color_index` from `meta.json`. */
  palette: string[];
  /** The overlap's outline: the most prominent thing on the map. */
  overlap: string;
  /** Pins. Distinct from every category colour on purpose. */
  pin: string;
  /** Round a place at street zoom, setting it apart from the basemap. */
  halo: string;
}

/** Overlay colours travel with the basemap's theme rather than being fixed. */
const DARK_HUES: Record<PaletteSlot, string> = {
  blue: "#60a5fa",
  pink: "#f472b6",
  green: "#4ade80",
  amber: "#fbbf24",
  violet: "#a78bfa",
  cyan: "#22d3ee",
  lime: "#a3e635",
  red: "#f87171",
  fuchsia: "#e879f9",
  teal: "#2dd4bf",
  indigo: "#818cf8",
  yellow: "#fde047",
  brown: "#b8875c",
};

/** The same hues, darkened, because a pastel is invisible on a light basemap. */
const LIGHT_HUES: Record<PaletteSlot, string> = {
  blue: "#1d4ed8",
  pink: "#be185d",
  green: "#15803d",
  amber: "#b45309",
  violet: "#6d28d9",
  cyan: "#0e7490",
  lime: "#4d7c0f",
  red: "#b91c1c",
  fuchsia: "#a21caf",
  teal: "#0f766e",
  indigo: "#4338ca",
  yellow: "#a16207",
  brown: "#5c3d1e",
};

/** Derived in `PALETTE_SLOTS` order, the contract `color_index` is written against. */
const DARK_PALETTE = PALETTE_SLOTS.map((slot) => DARK_HUES[slot]);
const LIGHT_PALETTE = PALETTE_SLOTS.map((slot) => LIGHT_HUES[slot]);

const OVERLAY_THEMES: Record<ThemeName, OverlayTheme> = {
  dark: {
    palette: DARK_PALETTE,
    overlap: "#f8fafc",
    pin: "#f97316",
    halo: "#18181b",
  },
  light: {
    palette: LIGHT_PALETTE,
    overlap: "#0f172a",
    pin: "#c2410c",
    halo: "#ffffff",
  },
};

export function overlayTheme(key: BasemapKey): OverlayTheme {
  return OVERLAY_THEMES[BASEMAPS[key].theme];
}

/** `DRAWING` with a basemap's overrides over it. */
export function drawingFor(key: BasemapKey): typeof DRAWING {
  return { ...DRAWING, ...DRAWING_BY_BASEMAP[key] };
}
