/**
 * The pure transforms that fail silently and still draw: extraction, dedupe,
 * the count check, shape emission and area cuts. See CONTRIBUTING.md → Tests.
 */

import type { Polygon, Position } from "geojson";
import { describe, expect, it } from "vitest";

import fixture from "./fixtures/overpass_sample.json";
import { dropBelowArea, placeAreaM2, simplifyPlaces, widenLines } from "./geometry/areas";
import { toFeatures } from "./geometry/geojson-conversion";
import {
  elementPoint,
  elementShape,
  type OverpassElement,
} from "./geometry/overpass-geometry";
import { countWarning, dedupe, elementsToPlaces, type Place } from "./places";

// TypeScript infers a per-object literal type for an imported JSON
// module, so tag keys absent from one element become `undefined` there
// and the union no longer matches Record<string, string>. The fixture is
// a real Overpass response; the double assertion says so.
const elements = fixture.elements as unknown as OverpassElement[];

const polygon = (boundary: Position[]): Polygon => ({
  type: "Polygon",
  coordinates: [boundary],
});

describe("coordinate extraction", () => {
  it("uses lat/lon directly for a node", () => {
    expect(elementPoint(elements[0])).toEqual([48.1330475, 11.5315412]);
  });

  it("uses center for ways and relations", () => {
    const way = elements.find((e) => e.type === "way" && e.center)!;
    const relation = elements.find((e) => e.type === "relation")!;
    expect(elementPoint(way)).toEqual([48.3174233, 11.560325]);
    expect(elementPoint(relation)).toEqual([48.1, 11.4]);
  });

  it("returns null when there is no coordinate at all", () => {
    // A missing center means the query omitted `out center` — the caller
    // surfaces that rather than silently dropping the element.
    const broken = elements.find((e) => !e.center && e.lat == null)!;
    expect(elementPoint(broken)).toBeNull();
  });

  it("reports how many elements were skipped", () => {
    const { places, skipped } = elementsToPlaces(elements, "skatepark");
    expect(places).toHaveLength(6);
    expect(skipped).toBe(1);
  });
});

describe("dedupe", () => {
  it("merges colocated stop positions", () => {
    // The three Heimeranplatz stop positions are 10-25 m apart: one
    // station, three OSM nodes. This is the case dedupe exists for.
    const { places } = elementsToPlaces(elements, "suburban_rail");
    const kept = dedupe(places, 50);
    expect(kept.filter((p) => p.name === "Heimeranplatz")).toHaveLength(1);
  });

  it("keeps genuinely distinct places", () => {
    const { places } = elementsToPlaces(elements, "skatepark");
    expect(dedupe(places, 50)).toHaveLength(4); // 3 collapse to 1, plus 3 far apart
  });

  it("is first-wins", () => {
    const { places } = elementsToPlaces(elements, "suburban_rail");
    expect(dedupe(places, 50)[0]).toBe(places[0]);
  });

  it("respects the radius", () => {
    // ~120 m apart: merged at 200 m, kept at 50 m. Guards against a unit
    // slip, which would otherwise only show up as a subtly wrong map.
    const a: Place = { cat: "c", lat: 48.1, lon: 11.4 };
    const b: Place = { cat: "c", lat: 48.1011, lon: 11.4 };
    expect(dedupe([a, b], 50)).toHaveLength(2);
    expect(dedupe([a, b], 200)).toHaveLength(1);
  });
});

describe("count warnings", () => {
  it.each([
    [150, false], // inside
    [120, false], // lower bound is inclusive
    [200, false], // upper bound is inclusive
    [40, true], // too narrow
    [400, true], // swallowed regional rail
  ])("count %i warns: %s", (count, expected) => {
    expect(countWarning("suburban_rail", count, [120, 200]) !== null).toBe(expected);
  });

  it("is silent without an expectation", () => {
    expect(countWarning("suburban_rail", 9999, null)).toBeNull();
  });
});

describe("shape emission", () => {
  const place = (boundary?: Position[]): Place => ({
    cat: "park",
    lat: 48.005,
    lon: 11.005,
    ...(boundary ? { shape: polygon(boundary) } : {}),
  });

  it("emits a point when there is no shape", () => {
    expect(toFeatures([place()])[0].geometry).toEqual({
      type: "Point",
      coordinates: [11.005, 48.005],
    });
  });

  it("closes a polygon that rounding left open", () => {
    // The last vertex differs from the first by less than a rounded place,
    // so rounding collapses it onto its neighbour and the boundary stops
    // being closed — still valid-looking GeoJSON, still drawable, subtly wrong.
    const geometry = toFeatures([
      place([
        [11, 48],
        [11.01, 48],
        [11.01, 48.01],
        [11, 48.01],
        [11.0000001, 48.0000001],
      ]),
    ])[0].geometry;
    const boundary = geometry.type === "Polygon" ? geometry.coordinates[0] : [];
    expect(boundary[0]).toEqual(boundary[boundary.length - 1]);
  });

  it("drops vertices that rounding made duplicates", () => {
    const geometry = toFeatures([
      place([
        [11, 48],
        [11.000001, 48.000001],
        [11.01, 48],
        [11.01, 48.01],
        [11, 48],
      ]),
    ])[0].geometry;
    expect(geometry.type === "Polygon" && geometry.coordinates[0]).toHaveLength(4);
  });

  it("falls back to the representative point when a polygon degenerates", () => {
    // Everything inside one rounded place: there is no area left, and a
    // two-vertex "polygon" is the shape that breaks turf rather than
    // looking merely odd.
    const geometry = toFeatures([
      place([
        [11, 48],
        [11.000001, 48],
        [11, 48],
      ]),
    ])[0].geometry;
    expect(geometry).toEqual({ type: "Point", coordinates: [11.005, 48.005] });
  });
});

describe("geometry from out geom", () => {
  const closed = [
    { lat: 48, lon: 11 },
    { lat: 48, lon: 11.01 },
    { lat: 48.01, lon: 11.01 },
    { lat: 48, lon: 11 },
  ];

  it("reads a closed way as a polygon, in lon/lat order", () => {
    expect(elementShape({ type: "way", geometry: closed })).toEqual(
      polygon([
        [11, 48],
        [11.01, 48],
        [11.01, 48.01],
        [11, 48],
      ]),
    );
  });

  it("reads a closed coastline as a line, because it rings land", () => {
    // As an area it would draw every island as water.
    const island = {
      type: "way",
      id: 1,
      geometry: closed,
      tags: { natural: "coastline" },
    };
    const { places } = elementsToPlaces([island], "water", { shapes: true, lines: true });
    expect(places[0].shape).toBeUndefined();
    expect(places[0].line?.coordinates).toHaveLength(closed.length);
  });

  it("keeps each outer ring its own polygon rather than a hole", () => {
    // The failure this exists for: Westpark's three separate patches
    // emitted as one polygon would read as an outer ring with two holes,
    // which draws perfectly happily and puts two lakes in a park.
    const shifted = closed.map(({ lat, lon }) => ({ lat, lon: lon + 0.5 }));
    const shape = elementShape({
      type: "relation",
      members: [
        { type: "way", role: "outer", geometry: closed },
        { type: "way", role: "outer", geometry: shifted },
      ],
    });
    expect(shape?.type).toBe("MultiPolygon");
    expect(shape?.type === "MultiPolygon" && shape.coordinates).toHaveLength(2);
    expect(shape?.type === "MultiPolygon" && shape.coordinates[0]).toHaveLength(1);
  });

  it("refuses an unclosed way", () => {
    // An open way is a line, not an area. Treated as one it becomes a
    // polygon GeoJSON will happily draw and turf will happily buffer.
    const open = closed.slice(0, -1).concat({ lat: 48.01, lon: 11 });
    expect(elementShape({ type: "way", geometry: open })).toBeNull();
  });

  it("refuses a way Overpass clipped", () => {
    // Overpass writes null into `geometry` for vertices outside the query
    // area, so a gap means the ring is not the shape it appears to be —
    // and the first and last vertices can still match.
    const gapped = [closed[0], null, closed[2], closed[3]];
    expect(elementShape({ type: "way", geometry: gapped })).toBeNull();
  });

  it("falls back to the bounds centre for a relation", () => {
    // `out geom;` gives a relation bounds but no centre, and this is what
    // lets one whose members will not assemble stay where it belongs
    // instead of vanishing.
    const relation: OverpassElement = {
      type: "relation",
      // Halving exactly, so the assertion tests the midpoint rather than
      // binary floating point.
      bounds: { minlat: 48, minlon: 11, maxlat: 48.5, maxlon: 11.5 },
    };
    expect(elementPoint(relation)).toEqual([48.25, 11.25]);
    expect(elementShape(relation)).toBeNull();
  });

  it("lets a shape displace a colocated point, but not another shape", () => {
    // Overpass returns nodes before ways, and dedupe is first-wins, so
    // without the exception a skatepark mapped as both would keep the dot
    // and throw away the outline — right count, wrong answer.
    const shape = polygon([
      [11, 48],
      [11.001, 48],
      [11.001, 48.001],
      [11, 48],
    ]);
    const node: Place = { cat: "skatepark", lat: 48, lon: 11 };
    const way: Place = { cat: "skatepark", name: "way", lat: 48, lon: 11, shape };
    const other: Place = { cat: "skatepark", name: "other", lat: 48, lon: 11, shape };

    expect(dedupe([node, way], 50)).toEqual([way]);
    // A shape never displaces a shape, so distinct areas still resolve by
    // order and the result stays deterministic.
    expect(dedupe([way, other], 50)).toEqual([way]);
    expect(dedupe([way, node], 50)).toEqual([way]);
  });
});

describe("areas", () => {
  /** ~100 m x ~100 m at 48N, i.e. about 1 ha. */
  const hectare: [number, number][] = [
    [11, 48],
    [11.001343, 48],
    [11.001343, 48.000905],
    [11, 48.000905],
    [11, 48],
  ];
  const place = (boundary?: Position[]): Place => ({
    cat: "park",
    lat: 48,
    lon: 11,
    ...(boundary ? { shape: polygon(boundary) } : {}),
  });

  it("measures a shape in square metres", () => {
    // Square metres, not degrees or km²: within 1% of a hectare.
    expect(Math.abs(placeAreaM2(place(hectare)) - 10_000)).toBeLessThan(100);
  });

  it("counts a point as no area at all", () => {
    expect(placeAreaM2(place())).toBe(0);
  });

  it("judges a connected body as a whole, not piece by piece", () => {
    // OSM splits a river into polygons at bridges and boundaries, and the
    // pieces share their join nodes exactly. Judged individually they pass
    // and fail alternately, which draws the river as a dashed line — the
    // Isar arrives as 89 pieces. Two halves of a hectare each are one
    // hectare of water.
    const left: [number, number][] = [
      [11, 48],
      [11.000671, 48],
      [11.000671, 48.000905],
      [11, 48.000905],
      [11, 48],
    ];
    const right: [number, number][] = [
      [11.000671, 48],
      [11.001343, 48],
      [11.001343, 48.000905],
      [11.000671, 48.000905],
      [11.000671, 48],
    ];
    expect(dropBelowArea([place(left), place(right)], 9000)).toHaveLength(2);

    // Move the second one away so they share no vertex, and neither passes.
    const apart = right.map(([x, y]): [number, number] => [x + 1, y]);
    expect(dropBelowArea([place(left), place(apart)], 9000)).toHaveLength(0);
  });

  it("drops a place with no geometry to prove its size", () => {
    // A node-mapped park carries no evidence it meets the cut. Exempting it
    // would keep a node-mapped traffic island while dropping a way-mapped
    // one of the same size.
    expect(dropBelowArea([place(), place(hectare)], 5000)).toHaveLength(1);
    // ...and no cut means no filtering, so a point category is untouched.
    expect(dropBelowArea([place(), place(hectare)], 0)).toHaveLength(2);
  });

  it("lets a named body through at the lower cut, and only a named one", () => {
    // A name is the evidence a small lake is a place: Teufelssee is 2.2 ha.
    // An unnamed body of the same size is a fish-farm pond or a basin.
    const named: Place = { ...place(hectare), name: "Teufelssee" };
    const elsewhere = hectare.map(([x, y]): [number, number] => [x + 1, y]);
    expect(dropBelowArea([named, place(elsewhere)], 50_000, 5_000)).toEqual([named]);
    // Without a named cut, a name changes nothing.
    expect(dropBelowArea([named], 50_000)).toHaveLength(0);
  });

  it("drops a small piece of a passing body only under a piece floor", () => {
    // A polder ditch touching a lake is one body with it and passes on the
    // lake's size: Amsterdam kept 11049 pieces that way. The floor drops
    // the ditch and keeps the lake; unset, the body rule is unchanged.
    const lake = place(hectare);
    const ditch = place([
      [11.001343, 48],
      [11.001443, 48],
      [11.001443, 48.000905],
      [11.001343, 48.000905],
      [11.001343, 48],
    ]);
    expect(dropBelowArea([lake, ditch], 9000)).toHaveLength(2);
    expect(dropBelowArea([lake, ditch], 9000, 9000, 5000)).toEqual([lake]);
  });

  it("judges an island's coastline by the land it rings, and exempts an open one", () => {
    const line = (coordinates: Position[]): Place => ({
      ...place(),
      line: { type: "LineString", coordinates },
    });
    const island = line(hectare);
    const shore = line(hectare.slice(0, 3));
    expect(dropBelowArea([island, shore], 20_000)).toEqual([shore]);
    expect(dropBelowArea([island, shore], 5_000)).toHaveLength(2);
  });

  it("keeps a river line through the cut, then widens it inside the bbox only", () => {
    // A centre line has no area until it is widened, so the cut would drop
    // every river — the Würm is 80% centre line with no polygon in OSM.
    const river: Place = {
      ...place(),
      line: {
        type: "LineString",
        coordinates: [
          [10.99, 48.0005],
          [11.01, 48.0005],
        ],
      },
    };
    const [kept] = dropBelowArea([river], 50_000);
    expect(kept.line).toBeDefined();

    // Half the 1.49 km line lies inside a bbox ending at 11.0: 745 m by 20 m.
    const [strip] = widenLines([kept], 20, [47.99, 10.98, 48.01, 11.0]);
    expect(strip.line).toBeUndefined();
    const m2 = placeAreaM2(strip);
    expect(m2).toBeGreaterThan(0.95 * 745 * 20);
    expect(m2).toBeLessThan(1.05 * 745 * 20);

    // A line wholly outside the bbox goes rather than drawing elsewhere.
    expect(widenLines([kept], 20, [47.0, 10.0, 47.1, 10.1])).toHaveLength(0);
  });

  it("widens a river line only where it leaves its own polygon", () => {
    // The Thames is mapped as both; its strip drew a second river inside
    // the first. The polygon holds the west half of the line, so only the
    // east 745 m is widened, and the polygon itself is untouched.
    const river: Place = {
      ...place(),
      line: {
        type: "LineString",
        coordinates: [
          [10.99, 48.0005],
          [11.01, 48.0005],
        ],
      },
    };
    const water = place([
      [10.98, 47.999],
      [11.0, 47.999],
      [11.0, 48.002],
      [10.98, 48.002],
      [10.98, 47.999],
    ]);
    const [kept, strip] = widenLines([water, river], 20, [47.9, 10.9, 48.1, 11.1]);
    expect(kept).toBe(water);
    const m2 = placeAreaM2(strip);
    expect(m2).toBeGreaterThan(0.95 * 745 * 20);
    expect(m2).toBeLessThan(1.05 * 745 * 20);
  });

  it("names an unnamed polygon after the longest line inside it", () => {
    // OSM names the Thames on its centre line only. The Isar runs 745 m
    // through the polygon and a brook 370 m, so the polygon is the Isar.
    const line = (name: string, west: number, east: number, lat: number): Place => ({
      ...place(),
      name,
      line: {
        type: "LineString",
        coordinates: [
          [west, lat],
          [east, lat],
        ],
      },
    });
    const water = place([
      [10.98, 47.999],
      [11.0, 47.999],
      [11.0, 48.002],
      [10.98, 48.002],
      [10.98, 47.999],
    ]);
    const [named] = widenLines(
      [water, line("Isar", 10.99, 11.01, 48.0005), line("Brook", 10.985, 10.99, 48.0015)],
      20,
      [47.9, 10.9, 48.1, 11.1],
    );
    expect(named.name).toBe("Isar");
    expect(named.shape).toBe(water.shape);
  });
});

describe("simplification", () => {
  /** A straight edge broken by vertices that deviate by under a metre. */
  const noisy = (): Polygon => {
    const boundary: Position[] = [[11, 48]];
    for (let i = 1; i < 20; i += 1) {
      boundary.push([11 + i * 0.0005, 48 + (i % 2) * 0.000004]);
    }
    boundary.push([11.01, 48.005], [11, 48.005], [11, 48]);
    return polygon(boundary);
  };
  const place = (shape: Polygon): Place => ({
    cat: "park",
    lat: 48,
    lon: 11,
    shape,
  });

  it("removes vertices finer than the tolerance, and only those", () => {
    // The noise is under a metre and the corners are hundreds apart, so a
    // 25 m tolerance leaves exactly the four corners, closed. Too few means
    // the metres were read as something larger; too many, something smaller.
    const shape = simplifyPlaces([place(noisy())], 25)[0].shape as Polygon;
    expect(shape.coordinates[0]).toHaveLength(5);
  });

  it("does nothing at all with no tolerance", () => {
    const shape = noisy();
    expect(simplifyPlaces([place(shape)], 0)[0].shape).toBe(shape);
  });
});
