/**
 * Links, where a name that breaks the separators or a category that falls
 * back on storage would still open a plausible map, just not the one sent.
 */

import { describe, expect, it } from "vitest";

import { restore, type SavedState } from "./persist";
import { decodeShare, encodeShare } from "./share";
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

const STATE: SavedState = {
  categories: {
    park: { enabled: false, minutes: 20, mode: "walk" },
    cinema: { enabled: true, minutes: 25, mode: "bike" },
  },
  display: { overlap: true, reaches: false, places: true, pins: false },
  pins: [
    { id: 1, lat: 48.135123, lon: 11.581987, name: "Flat; 3rd floor, left" },
    { id: 2, lat: -33.8688, lon: 151.2093, name: "" },
    { id: 3, lat: 48.1, lon: 11.5, name: "Wohnung Lindwurmstraße 100%" },
  ],
  pinControl: { enabled: true, minutes: 10, mode: "walk" },
};

describe("share links", () => {
  it("round-trips through restore, names with separators included", () => {
    const hash = encodeShare(STATE);
    const back = restore(META, decodeShare(META, hash));
    expect(back.categories.cinema).toEqual(STATE.categories.cinema);
    expect(back.display).toEqual(STATE.display);
    expect(back.pinControl).toEqual(STATE.pinControl);
    expect(back.pins.map(({ name }) => name)).toEqual(STATE.pins.map(({ name }) => name));
    expect(back.pins[0]).toMatchObject({ lat: 48.13512, lon: 11.58199 });
  });

  it("unticks a category the link does not name, though its default is ticked", () => {
    const back = restore(META, decodeShare(META, "#v=1&c=cinema.25b"));
    expect(back.categories.park.enabled).toBe(false);
    expect(back.categories.cinema).toEqual({ enabled: true, minutes: 25, mode: "bike" });
  });

  it("drops a malformed entry and keeps the rest", () => {
    const back = restore(
      META,
      decodeShare(
        META,
        "#v=1&c=cinema.25x,park.20w&p=48.1,,Gone;48.2,11.6,Kept;;48.3,11.7,%E0%A4%A",
      ),
    );
    expect(back.categories.cinema.enabled).toBe(false);
    expect(back.categories.park.enabled).toBe(true);
    expect(back.pins).toEqual([
      { id: 1, lat: 48.2, lon: 11.6, name: "Kept" },
      { id: 2, lat: 48.3, lon: 11.7, name: "" },
    ]);
  });

  it("ignores a hash that is not a link of this version", () => {
    expect(decodeShare(META, "#v=2&c=cinema.25b")).toBeNull();
    expect(decodeShare(META, "#section")).toBeNull();
    expect(decodeShare(META, "")).toBeNull();
  });
});
