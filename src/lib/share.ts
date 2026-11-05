/**
 * A region's settings as the hash of a shareable link, and sending one on.
 * See `docs/architecture.md`.
 *
 *   #v=1&c=metro.10w,skatepark.15b&pin=20w&p=48.1351,11.582,Office&hide=places
 *
 * Nothing after `#` reaches the server: GitHub Pages refuses a path and
 * query over 8192 characters, and pins are often someone's home.
 */

import { TOUCH, matches } from "./media";
import { DEFAULT_DISPLAY, STORAGE_VERSION, type SavedState } from "./persist";
import type { CategoryState, DisplayState } from "./state";
import type { CategoryMeta, Mode } from "../types";

/** Bump when the format changes; a link of any other version is ignored. */
const SHARE_VERSION = 1;

const MODE_CODES: Record<Mode, string> = { walk: "w", bike: "b" };

const DISPLAY_KEYS = Object.keys(DEFAULT_DISPLAY) as (keyof DisplayState)[];

/** About a metre. */
const COORD_DECIMALS = 5;

/** The hash for `state`, without the `#`. Only ticked categories carry a time budget. */
export function encodeShare(state: SavedState): string {
  const parts = [`v=${SHARE_VERSION}`];
  const ticked = Object.entries(state.categories).filter(
    ([, control]) => control.enabled,
  );
  if (ticked.length > 0) {
    parts.push(
      `c=${ticked.map(([cat, control]) => `${encodeURIComponent(cat)}.${budget(control)}`).join(",")}`,
    );
  }
  if (state.pinControl.enabled) parts.push(`pin=${budget(state.pinControl)}`);
  if (state.pins.length > 0) {
    const pins = state.pins.map(
      ({ lat, lon, name }) =>
        `${coord(lat)},${coord(lon)},${encodeURIComponent(name.trim())}`,
    );
    parts.push(`p=${pins.join(";")}`);
  }
  const hidden = DISPLAY_KEYS.filter((key) => !state.display[key]);
  if (hidden.length > 0) parts.push(`hide=${hidden.join(",")}`);
  return parts.join("&");
}

/**
 * The link's settings in the stored shape, for `restore()` to validate, or
 * null when `hash` is not a link of this version. A category the link does
 * not name is unticked, not taken from storage or the defaults: a blend
 * would be nobody's criteria. A malformed entry costs only itself.
 */
export function decodeShare(meta: Record<string, CategoryMeta>, hash: string): unknown {
  // Split by hand: URLSearchParams would decode a name's `,` or `;` before
  // the pins are split on them.
  const params = new Map<string, string>();
  for (const part of hash.replace(/^#/, "").split("&")) {
    const at = part.indexOf("=");
    if (at > 0) params.set(part.slice(0, at), part.slice(at + 1));
  }
  if (params.get("v") !== String(SHARE_VERSION)) return null;

  const named = new Map<string, CategoryState>();
  for (const entry of list(params.get("c"))) {
    const match = /^(.+)\.([^.]+)$/.exec(entry);
    const control = match && parseBudget(match[2]);
    const cat = match && decode(match[1]);
    if (control && cat) named.set(cat, control);
  }

  const hidden = new Set(list(params.get("hide")));
  return {
    version: STORAGE_VERSION,
    categories: Object.fromEntries(
      Object.entries(meta).map(([cat, info]) => [
        cat,
        named.get(cat) ?? {
          enabled: false,
          minutes: info.default_minutes,
          mode: info.default_mode,
        },
      ]),
    ),
    display: Object.fromEntries(DISPLAY_KEYS.map((key) => [key, !hidden.has(key)])),
    pins: (params.get("p") ?? "")
      .split(";")
      .filter((entry) => entry !== "")
      .map(parsePin),
    pinControl: parseBudget(params.get("pin") ?? ""),
  };
}

/** The page's address for this region with `state` in its hash. */
export function linkTo(regionId: string, state: SavedState): string {
  const url = new URL(window.location.href);
  url.search = new URLSearchParams({ region: regionId }).toString();
  url.hash = encodeShare(state);
  return url.href;
}

/** A touch screen shares through the system's sheet, where copying is one of the choices. */
export function usesShareSheet(): boolean {
  return matches(TOUCH) && typeof navigator.share === "function";
}

/** Sends `url` on and says how it went, or null when the visitor dismissed the sheet. */
export async function sendLink(url: string, title: string): Promise<string | null> {
  if (usesShareSheet()) {
    try {
      await navigator.share({ title, url });
      return "Link shared";
    } catch (error) {
      // Dismissing the sheet is a choice; anything else falls back to copying.
      if (error instanceof DOMException && error.name === "AbortError") return null;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "Link copied";
  } catch {
    // No clipboard without a secure context.
    return "Could not copy the link";
  }
}

function budget({ minutes, mode }: CategoryState): string {
  return `${minutes}${MODE_CODES[mode]}`;
}

function parseBudget(text: string): CategoryState | null {
  const match = /^(\d+)([a-z])$/.exec(text);
  const mode =
    match &&
    (Object.keys(MODE_CODES) as Mode[]).find((key) => MODE_CODES[key] === match[2]);
  return mode ? { enabled: true, minutes: Number(match[1]), mode } : null;
}

/** Null coordinates fail validation, so a broken pin is dropped and its neighbours stay. */
function parsePin(entry: string): {
  lat: number | null;
  lon: number | null;
  name: string;
} {
  const [lat = "", lon = "", ...name] = entry.split(",");
  return {
    lat: parseCoord(lat),
    lon: parseCoord(lon),
    name: decode(name.join(",")) ?? "",
  };
}

/** Number("") is 0, which would put a pin off the coast of Africa. */
function parseCoord(text: string): number | null {
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}

function coord(value: number): string {
  return String(Number(value.toFixed(COORD_DECIMALS)));
}

function list(value: string | undefined): string[] {
  return value ? value.split(",") : [];
}

function decode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}
