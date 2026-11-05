/**
 * Settings, remembered in the browser: each region's, and the basemap for
 * all of them. See `docs/architecture.md`.
 */

import * as v from "valibot";

import { BASEMAPS, THEME_BASEMAPS, type BasemapKey } from "./basemaps";
import { PREFERS_LIGHT, matches } from "./media";
import { MODES, type CategoryMeta } from "../types";
import type { AppState, CategoryState, DisplayState } from "./state";
import { MINUTES_MAX, MINUTES_MIN, PIN_DEFAULT_MINUTES, PIN_NAME_MAX } from "./tuning";

/** Bump when the stored shape changes; anything else is discarded. */
export const STORAGE_VERSION = 2;

/** The part of `AppState` that is stored. `placingPins` and `selectedPin` are not. */
export type SavedState = Pick<AppState, "categories" | "display" | "pins" | "pinControl">;

export const DEFAULT_DISPLAY: DisplayState = {
  overlap: true,
  reaches: true,
  places: true,
  pins: true,
};

/** Unticked: a pin is a marker until it is asked to be a category. */
const DEFAULT_PIN_CONTROL: CategoryState = {
  enabled: false,
  minutes: PIN_DEFAULT_MINUTES,
  mode: "walk",
};

const CategoryStateSchema = v.object({
  enabled: v.boolean(),
  minutes: v.pipe(
    v.number(),
    v.finite(),
    v.transform((minutes) =>
      Math.min(MINUTES_MAX, Math.max(MINUTES_MIN, Math.round(minutes))),
    ),
  ),
  mode: v.picklist(MODES),
});

const PinSchema = v.object({
  lat: v.pipe(v.number(), v.minValue(-90), v.maxValue(90)),
  lon: v.pipe(v.number(), v.minValue(-180), v.maxValue(180)),
  name: v.fallback(
    v.pipe(
      v.string(),
      v.trim(),
      v.transform((name) => name.slice(0, PIN_NAME_MAX)),
    ),
    "",
  ),
});

/**
 * Each level falls back on its own, so a bad value costs only itself: a
 * malformed category takes its defaults whole, a pin with bad coordinates is
 * dropped, and a bad name only loses the name.
 * A different `version` fails the whole parse.
 */
const StoredSchema = v.object({
  version: v.literal(STORAGE_VERSION),
  categories: v.fallback(
    v.record(v.string(), v.fallback(v.nullable(CategoryStateSchema), null)),
    () => ({}),
  ),
  display: v.fallback(
    v.object({
      overlap: v.fallback(v.boolean(), DEFAULT_DISPLAY.overlap),
      reaches: v.fallback(v.boolean(), DEFAULT_DISPLAY.reaches),
      places: v.fallback(v.boolean(), DEFAULT_DISPLAY.places),
      pins: v.fallback(v.boolean(), DEFAULT_DISPLAY.pins),
    }),
    () => ({ ...DEFAULT_DISPLAY }),
  ),
  pins: v.fallback(v.array(v.fallback(v.nullable(PinSchema), null)), () => []),
  pinControl: v.fallback(v.nullable(CategoryStateSchema), null),
});

/**
 * The state to start a region with: whatever of `saved` survives validation,
 * defaults for the rest.
 *
 * The set of categories always comes from `meta`, never from storage. Pins
 * are renumbered from 1, so the caller's id counter continues at
 * `pins.length + 1`.
 */
export function restore(meta: Record<string, CategoryMeta>, saved: unknown): SavedState {
  const parsed = v.safeParse(StoredSchema, saved);
  const stored = parsed.success ? parsed.output : null;

  return {
    categories: Object.fromEntries(
      Object.entries(meta).map(([cat, info]) => [
        cat,
        stored?.categories[cat] ?? {
          enabled: info.default_enabled,
          minutes: info.default_minutes,
          mode: info.default_mode,
        },
      ]),
    ),
    display: stored?.display ?? { ...DEFAULT_DISPLAY },
    pins: (stored?.pins ?? [])
      .filter((pin) => pin !== null)
      .map(({ lat, lon, name }, index) => ({ id: index + 1, lat, lon, name })),
    pinControl: stored?.pinControl ?? { ...DEFAULT_PIN_CONTROL },
  };
}

/** Whatever is stored for a region, unparsed beyond JSON. Null on any failure. */
export function loadSaved(regionId: string): unknown {
  try {
    const raw = window.localStorage.getItem(storageKey(regionId));
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    // Unavailable storage or a corrupt entry both mean "nothing stored".
    return null;
  }
}

/**
 * Writes only what differs from what is stored, so restoring a region and
 * following another tab's save write nothing, and tabs cannot echo.
 */
export function save(regionId: string, state: SavedState): void {
  const payload = {
    version: STORAGE_VERSION,
    categories: state.categories,
    display: state.display,
    pins: state.pins.map(({ lat, lon, name }) => ({ lat, lon, name })),
    pinControl: state.pinControl,
  };
  try {
    const json = JSON.stringify(payload);
    if (window.localStorage.getItem(storageKey(regionId)) === json) return;
    window.localStorage.setItem(storageKey(regionId), json);
  } catch {
    // Private mode, blocked site data or a full quota: the app works as it
    // did before persistence existed, and there is nobody useful to tell.
  }
}

export function storageKey(regionId: string): string {
  return `nearish:region:${regionId}`;
}

/** One for every region: a basemap is how the visitor likes a map, not a fact about a place. */
const BASEMAP_KEY = "nearish:basemap";

export function loadBasemap(): BasemapKey {
  try {
    const raw = window.localStorage.getItem(BASEMAP_KEY);
    if (raw !== null && Object.hasOwn(BASEMAPS, raw)) return raw as BasemapKey;
  } catch {
    // As for a region: unavailable storage means nothing stored.
  }
  return THEME_BASEMAPS[matches(PREFERS_LIGHT) ? "light" : "dark"];
}

export function saveBasemap(key: BasemapKey): void {
  try {
    window.localStorage.setItem(BASEMAP_KEY, key);
  } catch {
    // As in `save()`: the choice lasts until the page closes.
  }
}
