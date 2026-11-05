/**
 * The home screen's pictures, from the data already in `public/data`: every
 * region's `thumbnail.json`, and the crop of central Berlin its animation
 * plays over. For a change to how either is drawn, which needs no fetch;
 * the fetch step writes a region's thumbnail itself whenever it writes the
 * region.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Meta, PlaceCollection, RegionIndex } from "../types";
import { homeSample, thumbnailFor } from "./geometry/thumbnail";

const DATA = path.resolve(import.meta.dirname, "../../public/data");
const SAMPLE = path.join(DATA, "home-sample.json");

/**
 * The Spree from Charlottenburg to Friedrichshain, Tiergarten and the
 * Landwehrkanal: water and parks dense enough to shape an overlap, 12.5 m
 * a pixel. A desktop's backdrop shows it at 2.7x; 24 supermarkets is
 * 0.4 a km², spread out.
 */
const SAMPLE_REGION = "berlin";
const SAMPLE_CROP = {
  center: [52.5092, 13.39] as [number, number],
  widthKm: 12,
  widthPx: 960,
  heightPx: 400,
  shops: 24,
  simplifyPx: 2.5,
  marginPx: 110,
  insetPx: 30,
};

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

const index = await readJson<RegionIndex>(path.join(DATA, "regions.json"));
for (const { id } of index.regions) {
  const dir = path.join(DATA, id);
  const meta = await readJson<Meta>(path.join(dir, "meta.json"));
  const places = await readJson<PlaceCollection>(path.join(dir, "places.geojson"));
  const json = JSON.stringify(thumbnailFor(places.features, meta));
  await writeFile(path.join(dir, "thumbnail.json"), json);
  console.log(`${id}: ${(json.length / 1024).toFixed(1)} kB`);
  if (id !== SAMPLE_REGION) continue;
  const sample = JSON.stringify(homeSample(places.features, SAMPLE_CROP));
  await writeFile(SAMPLE, `${sample}\n`);
  console.log(`home sample from ${id}: ${(sample.length / 1024).toFixed(1)} kB`);
}
