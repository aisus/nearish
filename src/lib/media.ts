/** Media queries the code acts on. The CSS repeats `PHONE` in its own media queries. */

/** The phone layout: the map full width, the panel a sheet over its foot. */
export const PHONE = "(max-width: 640px)";

/** A finger for a pointer: no hover, and a keyboard that covers half the screen. */
export const TOUCH = "(pointer: coarse)";

/** Picks the theme until a basemap is chosen. */
export const PREFERS_LIGHT = "(prefers-color-scheme: light)";

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** How much of the screen the open sheet takes; `--sheet-open` in main.css repeats it. */
export const SHEET_OPEN_SHARE = 0.55;

export function matches(query: string): boolean {
  return window.matchMedia(query).matches;
}
