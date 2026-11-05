/**
 * The fetch step's CLI: Overpass to one region's `places.geojson`,
 * `meta.json` and `thumbnail.json`, plus the region index. Kept thin, so
 * that another caller can drive the same functions.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import type {
  CategoryMeta,
  Meta,
  PlaceCollection,
  PlaceFeature,
  RegionIndex,
  RegionSummary,
} from "../types";
import {
  ConfigError,
  listRegionIds,
  loadLibrary,
  loadRegion,
  selectCategories,
  type Category,
  type Region,
} from "./categories";
import {
  buildQuery,
  fetchCategory,
  OverpassFailed,
  OverpassRefused,
  REQUEST_GAP_MS,
  sleep,
} from "./overpass";
import { dropBelowArea, placeAreaM2, simplifyPlaces, widenLines } from "./geometry/areas";
import { toFeatures } from "./geometry/geojson-conversion";
import { thumbnailFor } from "./geometry/thumbnail";
import { countWarning, dedupe, elementsToPlaces, type Place } from "./places";

/**
 * Resolved from this file, not the cwd, so any caller gets the same paths.
 * `--out` and `--cache` are roots with a directory per region: the cache is
 * keyed by category name, which regions share.
 */
const HERE = import.meta.dirname;
const DEFAULT_LIBRARY = path.resolve(HERE, "../../categories.yaml");
const DEFAULT_REGIONS = path.resolve(HERE, "../../regions");
const DEFAULT_OUT = path.resolve(HERE, "../../public/data");
const DEFAULT_CACHE = path.resolve(HERE, "../../cache");

const INDEX_FILE = "regions.json";

const EXIT_INCOMPLETE = 1;
const EXIT_CONFIG = 2;
const EXIT_REFUSED = 3;

interface CategoryResult {
  meta: CategoryMeta;
  places: Place[];
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      config: { type: "string", default: DEFAULT_LIBRARY },
      regions: { type: "string", default: DEFAULT_REGIONS },
      region: { type: "string" },
      out: { type: "string", default: DEFAULT_OUT },
      cache: { type: "string", default: DEFAULT_CACHE },
      category: { type: "string", multiple: true, default: [] },
      refresh: { type: "boolean", default: false },
      since: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  let region: Region;
  let selected: Category[];
  let since: number | null;
  try {
    since = resolveSince(values.refresh, values.since);
    const library = await loadLibrary(values.config);
    const id = await resolveRegionId(values.regions, values.region);
    region = await loadRegion(values.regions, id, library);
    selected = selectCategories(region, values.category);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`config error: ${error.message}`);
      return EXIT_CONFIG;
    }
    throw error;
  }

  const outDir = path.join(values.out, region.id);
  const cacheDir = path.join(values.cache, region.id);
  console.log(`Region: ${region.label} (${region.id})\n`);

  if (values.refresh) {
    console.log("--refresh: querying Overpass (please don't run this on a schedule)\n");
  }

  const fetched = new Map<string, CategoryResult>();
  const warnings: string[] = [];
  const unobserved: string[] = [];
  const failed: string[] = [];
  const empty: string[] = [];

  let queried = false;
  for (const category of selected) {
    // Only a query needs the gap; a category read from the cache does not.
    if (queried) await sleep(REQUEST_GAP_MS);

    let kept: Place[];
    let osmAsOf: string;
    try {
      const result = await runCategory(category, region, cacheDir, values.refresh, since);
      kept = result.kept;
      osmAsOf = result.osmAsOf;
      queried = !result.fromCache;
      console.log(result.note);
    } catch (error) {
      if (error instanceof OverpassRefused) {
        console.error(`\nOverpass refused: ${error.message}`);
        console.error("Stopping. Nothing was written.");
        return EXIT_REFUSED;
      }
      if (error instanceof OverpassFailed) {
        console.error(`  ${category.name}: FAILED — ${error.message}`);
        failed.push(category.name);
        queried = values.refresh;
        continue;
      }
      throw error;
    }

    fetched.set(category.name, {
      meta: {
        label: category.label,
        ...(category.localName ? { local_name: category.localName } : {}),
        count: kept.length,
        default_minutes: category.defaultMinutes,
        default_mode: category.defaultMode,
        default_enabled: category.defaultEnabled,
        color_index: category.colorIndex,
        osm_as_of: osmAsOf,
      },
      places: kept,
    });

    if (kept.length === 0) empty.push(category.name);
    if (category.expectCount === null) {
      unobserved.push(
        `${category.name}: ${kept.length} places, no expect_count recorded yet`,
      );
    }
    const warning = countWarning(category.name, kept.length, category.expectCount);
    if (warning) warnings.push(warning);
  }

  report(warnings, unobserved, region.id, failed, empty);
  const incomplete = failed.length > 0 || empty.length > 0;

  if (values["dry-run"]) {
    console.log("\n--dry-run: nothing written.");
    return incomplete ? EXIT_INCOMPLETE : 0;
  }

  if (fetched.size === 0) {
    console.error("\nNothing fetched successfully — existing output left untouched.");
    return EXIT_INCOMPLETE;
  }

  const { written, preserved } = await write(outDir, region, fetched);
  if (preserved.length > 0) {
    console.log(`\nKept the previous data for: ${preserved.join(", ")}`);
  }
  console.log(`\nWrote ${written} places to ${path.join(outDir, "places.geojson")}`);

  const listed = await writeIndex(values.out, values.regions);
  console.log(`Indexed ${listed.join(", ")} in ${path.join(values.out, INDEX_FILE)}`);

  return incomplete ? EXIT_INCOMPLETE : 0;
}

function resolveSince(refresh: boolean, since: string | undefined): number | null {
  if (since === undefined) return null;
  if (!refresh) throw new ConfigError("--since needs --refresh");
  const ms = Date.parse(since);
  if (Number.isNaN(ms)) throw new ConfigError(`--since is not a time: '${since}'`);
  return ms;
}

async function resolveRegionId(dir: string, requested?: string): Promise<string> {
  const ids = await listRegionIds(dir);
  if (ids.length === 0) throw new ConfigError(`no region files in ${dir}`);

  if (requested === undefined) {
    if (ids.length === 1) return ids[0];
    throw new ConfigError(`--region is required; defined: ${ids.join(", ")}`);
  }
  if (!ids.includes(requested)) {
    throw new ConfigError(`unknown region '${requested}'; defined: ${ids.join(", ")}`);
  }
  return requested;
}

async function runCategory(
  category: Category,
  region: Region,
  cacheDir: string,
  refresh: boolean,
  since: number | null,
): Promise<{ kept: Place[]; note: string; osmAsOf: string; fromCache: boolean }> {
  const query = buildQuery(category.query, region.bbox, category.geometry);
  const { payload, fromCache } = await fetchCategory(
    category.name,
    query,
    cacheDir,
    refresh,
    since,
  );

  const { places, skipped } = elementsToPlaces(payload.elements, category.name, {
    shapes: category.geometry === "area",
    lines: category.lineWidthM > 0,
  });
  const merged = dedupe(places, category.dedupeM);
  const large = dropBelowArea(
    merged,
    category.minAreaM2,
    category.namedMinAreaM2,
    category.pieceMinAreaM2,
  );
  const areas = large.filter((place) => !place.line);
  const kept = widenLines(
    simplifyPlaces(large, category.simplifyM),
    category.lineWidthM,
    region.bbox,
  );

  let note =
    `  ${category.name}: ${payload.elements.length} raw -> ${merged.length} after ` +
    `${category.dedupeM} m dedupe (${fromCache ? "cached" : "fetched"})`;
  if (category.minAreaM2 > 0 && areas.length > 0) {
    const named =
      category.namedMinAreaM2 < category.minAreaM2
        ? ` (${category.namedMinAreaM2 / 10000} ha if named)`
        : "";
    const piece =
      category.pieceMinAreaM2 > 0
        ? `, no piece under ${category.pieceMinAreaM2 / 10000} ha`
        : "";
    note += `\n    -> ${areas.length} over ${category.minAreaM2 / 10000} ha${named}${piece}, ${totalAreaKm2(areas).toFixed(1)} km² of ground`;
  }
  if (category.lineWidthM > 0) {
    const strips = kept.length - areas.length;
    note += `\n    -> ${large.length - areas.length} lines widened to ${category.lineWidthM} m, ${strips} inside the bbox`;
  }
  if (skipped > 0) {
    note += `  [!] ${skipped} element(s) had no coordinates`;
  }
  return { kept, note, osmAsOf: payload.osm3s.timestamp_osm_base, fromCache };
}

function totalAreaKm2(places: Place[]): number {
  return places.reduce((total, place) => total + placeAreaM2(place), 0) / 1_000_000;
}

/** The earliest of at least one timestamp. */
function oldest(timestamps: readonly string[]): string {
  return timestamps.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));
}

function report(
  warnings: string[],
  unobserved: string[],
  regionId: string,
  failed: string[],
  empty: string[],
): void {
  if (warnings.length > 0) {
    console.log("\nCount warnings:");
    for (const warning of warnings) console.log(`  ! ${warning}`);
  }
  if (unobserved.length > 0) {
    console.log("\nNo baseline to check against (nothing was verified):");
    for (const note of unobserved) console.log(`  ? ${note}`);
    console.log(`  Read the counts above, then record them in regions/${regionId}.yaml.`);
  }
  if (failed.length > 0) {
    console.error("\nCategories that could not be fetched:");
    for (const name of failed) console.error(`  ! ${name}`);
  }
  if (empty.length > 0) {
    console.error("\nCategories that returned nothing (this is an error):");
    for (const name of empty) console.error(`  ! ${name}`);
  }
}

/**
 * Write one region's three output files. Categories this run did not produce
 * keep their previous output, so a transient failure cannot delete them; a
 * category removed from the region file is not kept, which is how it goes.
 */
async function write(
  outDir: string,
  region: Region,
  fetched: Map<string, CategoryResult>,
): Promise<{ written: number; preserved: string[] }> {
  await mkdir(outDir, { recursive: true });
  const geojsonPath = path.join(outDir, "places.geojson");
  const metaPath = path.join(outDir, "meta.json");

  const complete = region.categories.every((category) => fetched.has(category.name));
  const previous = complete ? null : await readPrevious(geojsonPath, metaPath);

  const features: PlaceFeature[] = [];
  const categories: Record<string, CategoryMeta> = {};
  const preserved: string[] = [];

  // In the region's category order, always, so a partial rebuild leaves the diff to its own category.
  for (const { name } of region.categories) {
    const result = fetched.get(name);
    if (result) {
      features.push(...toFeatures(result.places));
      categories[name] = result.meta;
      continue;
    }

    const keptMeta = previous?.categories[name];
    if (!keptMeta) continue;
    features.push(...(previous?.features.get(name) ?? []));
    categories[name] = keptMeta;
    preserved.push(name);
  }

  const collection: PlaceCollection = { type: "FeatureCollection", features };
  const meta: Meta = {
    region: region.id,
    label: region.label,
    fetched_at: new Date().toISOString(),
    osm_as_of: oldest(Object.values(categories).map((entry) => entry.osm_as_of)),
    bbox: region.bbox,
    categories,
  };

  await writeFile(geojsonPath, JSON.stringify(collection));
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  await writeFile(
    path.join(outDir, "thumbnail.json"),
    JSON.stringify(thumbnailFor(features, meta)),
  );
  return { written: features.length, preserved };
}

/** Rebuild `regions.json` from the region data that exists. */
async function writeIndex(outRoot: string, regionsDir: string): Promise<string[]> {
  const regions: RegionSummary[] = [];

  for (const id of await listRegionIds(regionsDir)) {
    const meta = await readJson<Meta>(path.join(outRoot, id, "meta.json"));
    if (!meta) continue;
    regions.push({
      id: meta.region,
      label: meta.label,
      bbox: meta.bbox,
      osm_as_of: meta.osm_as_of,
    });
  }

  const index: RegionIndex = { regions };
  await writeFile(path.join(outRoot, INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);
  return regions.map((entry) => entry.id);
}

async function readPrevious(
  geojsonPath: string,
  metaPath: string,
): Promise<{
  features: Map<string, PlaceFeature[]>;
  categories: Record<string, CategoryMeta>;
} | null> {
  const collection = await readJson<PlaceCollection>(geojsonPath);
  const meta = await readJson<Meta>(metaPath);
  if (!collection || !meta) return null;

  const features = new Map<string, PlaceFeature[]>();
  for (const feature of collection.features) {
    const existing = features.get(feature.properties.cat);
    if (existing) existing.push(feature);
    else features.set(feature.properties.cat, [feature]);
  }
  return { features, categories: meta.categories };
}

/**
 * A previous output file, or null if there is none. Corrupt is an error, not
 * "none": a partial run would otherwise drop every category it did not fetch.
 */
async function readJson<T>(file: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`${file} is not valid JSON; fix or delete it`, { cause: error });
  }
}

process.exitCode = await main();
