/** The browser app's state, in one place. */

import type { Mode } from "../types";

/** Per-category controls, bound to the panel with v-model. */
export interface CategoryState {
  enabled: boolean;
  minutes: number;
  mode: Mode;
}

/** What is shown. */
export interface DisplayState {
  /** Never drawn for one category, where it would hide that category's tint. */
  overlap: boolean;
  reaches: boolean;
  places: boolean;
  /** The pins' markers; their reach is drawn while they are a category, shown or not. */
  pins: boolean;
}

/** What an unnamed pin is called. */
export const PIN_LABEL = "Pin";

/** A point the visitor dropped on the map, remembered per region (`persist.ts`). */
export interface Pin {
  /** Monotonic, only ever used as a list key and for selection. */
  id: number;
  lat: number;
  lon: number;
  /** As typed; empty until the visitor names it. */
  name: string;
}

export function pinLabel(pin: Pin): string {
  return pin.name.trim() || PIN_LABEL;
}

/** The entire app state: one object, and only its watchers touch the map. */
export interface AppState {
  categories: Record<string, CategoryState>;
  display: DisplayState;
  pins: Pin[];
  /**
   * The pins' time budget. `enabled` means the pins are a category, with a
   * reach and a part in the overlap, not whether they are drawn: they stay
   * until cleared, being useful as plain markers too.
   */
  pinControl: CategoryState;
  /**
   * Whether the next map click drops a pin. Armed for one pin at a time:
   * clicking is also how you explore.
   */
  placingPins: boolean;
  /** The pin picked on the map or in the panel. Drawing only, never stored. */
  selectedPin: number | null;
}
