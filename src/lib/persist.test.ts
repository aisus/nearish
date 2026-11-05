/**
 * Restoring stored state, where a stale category, an out-of-range budget or
 * a colliding pin id would all still draw a plausible map.
 */

import { describe, expect, it } from "vitest";

import { STORAGE_VERSION, restore } from "./persist";
import { MINUTES_MAX } from "./tuning";
import type { CategoryMeta } from "../types";

function meta(defaultEnabled: boolean): CategoryMeta {
  return {
    label: "x",
    count: 1,
    default_minutes: 15,
    default_mode: "walk",
    default_enabled: defaultEnabled,
    color_index: 0,
    osm_as_of: "2026-10-07T23:03:10Z",
  };
}

const META = { park: meta(true), cinema: meta(false) };

describe("restore", () => {
  it("takes the region's defaults when nothing is stored", () => {
    const state = restore(META, null);
    expect(state.categories).toEqual({
      park: { enabled: true, minutes: 15, mode: "walk" },
      cinema: { enabled: false, minutes: 15, mode: "walk" },
    });
    expect(state.pins).toEqual([]);
  });

  it("takes the categories from meta, not from storage", () => {
    const state = restore(META, {
      version: STORAGE_VERSION,
      categories: {
        park: { enabled: false, minutes: 30, mode: "bike" },
        removed: { enabled: true, minutes: 10, mode: "walk" },
      },
    });
    expect(Object.keys(state.categories).sort()).toEqual(["cinema", "park"]);
    expect(state.categories.park).toEqual({ enabled: false, minutes: 30, mode: "bike" });
    expect(state.categories.cinema.enabled).toBe(false);
  });

  it("clamps minutes but rejects a malformed category whole", () => {
    const state = restore(META, {
      version: STORAGE_VERSION,
      categories: {
        park: { enabled: true, minutes: 999, mode: "bike" },
        cinema: { enabled: true, minutes: 40, mode: "teleport" },
      },
    });
    expect(state.categories.park).toEqual({
      enabled: true,
      minutes: MINUTES_MAX,
      mode: "bike",
    });
    expect(state.categories.cinema).toEqual({
      enabled: false,
      minutes: 15,
      mode: "walk",
    });
  });

  it("keeps only real pins, renumbered from 1, and a bad name only loses the name", () => {
    const state = restore(META, {
      version: STORAGE_VERSION,
      pins: [
        { id: 7, lat: 48.1, lon: 11.5, name: " Office " },
        { lat: "48", lon: 11, name: "Gone" },
        { lat: 95, lon: 11 },
        { id: 7, lat: 48.2, lon: 11.6, name: 42 },
      ],
    });
    expect(state.pins).toEqual([
      { id: 1, lat: 48.1, lon: 11.5, name: "Office" },
      { id: 2, lat: 48.2, lon: 11.6, name: "" },
    ]);
  });

  it("keeps what is shown when it was stored before a toggle existed", () => {
    const state = restore(META, {
      version: STORAGE_VERSION,
      display: { overlap: false, reaches: true, places: false },
    });
    expect(state.display).toEqual({
      overlap: false,
      reaches: true,
      places: false,
      pins: true,
    });
  });

  it("discards everything stored under another version", () => {
    const state = restore(META, {
      version: STORAGE_VERSION + 1,
      categories: { park: { enabled: false, minutes: 30, mode: "bike" } },
      display: { overlap: false },
      pins: [{ lat: 48.1, lon: 11.5 }],
    });
    expect(state).toEqual(restore(META, null));
  });
});
