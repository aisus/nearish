/**
 * Loading and validating the category library and the region files. Every
 * value that reaches geometry is checked here, unknown keys included, so a
 * typo fails naming its key instead of drawing a plausible wrong map. A
 * region entry is merged over its library entry and validated as one.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import * as v from "valibot";
import { parse } from "yaml";

import { MODES, PALETTE_SLOTS, type Bbox, type Mode } from "../types";

/**
 * Which `out` clause a category's query is wrapped with. Opt-in, because
 * `out geom;` everywhere would turn every supermarket into its outline.
 */
const GEOMETRIES = ["point", "area"] as const;

export type CategoryGeometry = (typeof GEOMETRIES)[number];

const DEFAULT_MINUTES = 15;
const DEFAULT_MODE: Mode = "walk";

const REGION_EXT = ".yaml";

/** The yaml is missing or malforming something the run needs. */
export class ConfigError extends Error {}

export interface Category {
  name: string;
  label: string;
  /** What the category is called in this region; null where the label serves. */
  localName: string | null;
  query: string;
  geometry: CategoryGeometry;
  /** 0 means no cut. */
  minAreaM2: number;
  /** The cut for a body with a name; `minAreaM2` when unset. */
  namedMinAreaM2: number;
  /** Each piece of a passing body must also reach this; 0 means no floor. */
  pieceMinAreaM2: number;
  /** 0 means no simplification. */
  simplifyM: number;
  /** 0 means an open way is a point, as in every other category. */
  lineWidthM: number;
  defaultMinutes: number;
  defaultMode: Mode;
  defaultEnabled: boolean;
  /** 0 means no merging, which area categories want. */
  dedupeM: number;
  /** null: no baseline observed yet, which the run reports rather than passes. */
  expectCount: [number, number] | null;
  colorIndex: number;
}

/**
 * The shared library. Specs stay raw until a region merges into them: a
 * library entry alone has no `default_enabled` and no `expect_count`.
 */
interface Library {
  defaultDedupeM: number;
  specs: Map<string, Record<string, unknown>>;
}

export interface Region {
  id: string;
  label: string;
  bbox: Bbox;
  /** In library order, with any region-only categories appended. */
  categories: Category[];
}

const finite = v.pipe(v.number(), v.finite());
const nonNegative = v.pipe(finite, v.minValue(0));
const positive = v.pipe(finite, v.gtValue(0));

/** valibot reports an unexpected key or item as "Expected never". */
const extra =
  (shape: string) =>
  (issue: v.BaseIssue<unknown>): string =>
    issue.expected === "never" ? "is not expected here" : `must be ${shape}`;

const LibrarySchema = v.strictObject(
  {
    default_dedupe_m: positive,
    categories: v.record(
      v.string(),
      v.pipe(
        // Declared, never derived from position: colour and panel order are
        // unrelated, and a region's colours must agree with every other's.
        v.looseObject({ color: v.picklist(PALETTE_SLOTS) }),
        // A count range is an observed fact about one place; applied silently
        // to another it is exactly the plausible wrong answer it exists to catch.
        v.check(
          (spec) => !("expect_count" in spec),
          "expect_count belongs in a region file, not in the library",
        ),
      ),
    ),
  },
  extra("a mapping"),
);

const RegionSchema = v.strictObject(
  {
    id: v.string(),
    label: v.nullish(v.string()),
    bbox: v.pipe(
      v.strictTuple([finite, finite, finite, finite], extra("four numbers")),
      v.check(
        ([south, west, north, east]) => south < north && west < east,
        "must be [south, west, north, east]",
      ),
    ),
    categories: v.pipe(
      v.record(v.string(), v.nullish(v.looseObject({}), {})),
      v.check((entries) => Object.keys(entries).length > 0, "enables no categories"),
    ),
  },
  extra("a mapping"),
);

const CategorySchema = v.pipe(
  v.strictObject(
    {
      query: v.pipe(
        v.string(),
        v.check((query) => query.trim() !== "", "must not be empty"),
      ),
      label: v.nullish(v.string()),
      local_name: v.nullish(v.string()),
      color: v.picklist(PALETTE_SLOTS),
      geometry: v.nullish(v.picklist(GEOMETRIES), "point"),
      min_area_m2: v.nullish(nonNegative),
      named_min_area_m2: v.nullish(nonNegative),
      min_piece_area_m2: v.nullish(nonNegative),
      simplify_m: v.nullish(nonNegative),
      line_width_m: v.nullish(nonNegative),
      default_minutes: v.nullish(positive, DEFAULT_MINUTES),
      default_mode: v.nullish(v.picklist(MODES), DEFAULT_MODE),
      default_enabled: v.nullish(v.boolean(), false),
      dedupe_m: v.nullish(nonNegative),
      expect_count: v.nullish(
        v.pipe(
          v.strictTuple([finite, finite], extra("two numbers [low, high]")),
          v.check(([low, high]) => low <= high, "is inverted: low is above high"),
        ),
      ),
    },
    extra("a mapping"),
  ),
  v.forward(
    v.check(
      (spec) => spec.geometry === "area" || spec.min_area_m2 == null,
      "needs geometry: area",
    ),
    ["min_area_m2"],
  ),
  v.forward(
    v.check(
      (spec) =>
        spec.named_min_area_m2 == null ||
        (spec.min_area_m2 != null && spec.named_min_area_m2 <= spec.min_area_m2),
      "needs min_area_m2, and must not exceed it",
    ),
    ["named_min_area_m2"],
  ),
  v.forward(
    v.check(
      (spec) =>
        spec.min_piece_area_m2 == null ||
        (spec.min_area_m2 != null &&
          spec.min_piece_area_m2 <= (spec.named_min_area_m2 ?? spec.min_area_m2)),
      "needs min_area_m2, and must not exceed either body cut",
    ),
    ["min_piece_area_m2"],
  ),
  v.forward(
    v.check(
      (spec) => spec.geometry === "area" || spec.simplify_m == null,
      "needs geometry: area",
    ),
    ["simplify_m"],
  ),
  v.forward(
    v.check(
      (spec) => spec.geometry === "area" || spec.line_width_m == null,
      "needs geometry: area",
    ),
    ["line_width_m"],
  ),
);

export async function loadLibrary(file: string): Promise<Library> {
  const raw = validate(LibrarySchema, await readYaml(file), file);

  const specs: Library["specs"] = new Map(Object.entries(raw.categories));
  if (specs.size === 0) throw new ConfigError(`${file} defines no categories`);
  assertOwnColors(
    Object.entries(raw.categories).map(([name, { color }]) => [name, color]),
    file,
  );

  return { defaultDedupeM: raw.default_dedupe_m, specs };
}

/** Region ids, from the files present. Sorted, so the index is deterministic. */
export async function listRegionIds(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    throw new ConfigError(`could not read ${dir}: ${(error as Error).message}`);
  }
  return names
    .filter((name) => name.endsWith(REGION_EXT))
    .map((name) => path.basename(name, REGION_EXT))
    .sort();
}

export async function loadRegion(
  dir: string,
  id: string,
  library: Library,
): Promise<Region> {
  const file = path.join(dir, `${id}${REGION_EXT}`);
  const raw = validate(RegionSchema, await readYaml(file), file);

  // Every output path is built from the id, and the file is what a person
  // edits; letting them disagree writes data where the name does not point.
  if (raw.id !== id) {
    throw new ConfigError(
      `${file} declares id ${JSON.stringify(raw.id)}, which does not match its filename`,
    );
  }

  const named = Object.keys(raw.categories);
  const order = [
    ...[...library.specs.keys()].filter((name) => named.includes(name)),
    ...named.filter((name) => !library.specs.has(name)),
  ];

  const categories = order.map((name) => {
    const known = library.specs.get(name);
    const override = raw.categories[name];
    if (!known && !("query" in override && "color" in override)) {
      throw new ConfigError(
        `${file} uses category '${name}', which the library does not define and which ` +
          `needs a query and a color of its own. Known: ${[...library.specs.keys()].join(", ")}`,
      );
    }
    return toCategory(name, { ...known, ...override }, library.defaultDedupeM, file);
  });
  assertOwnColors(
    categories.map(({ name, colorIndex }) => [name, PALETTE_SLOTS[colorIndex]]),
    file,
  );

  return { id, label: raw.label ?? id, bbox: raw.bbox, categories };
}

/** The categories to run, in the order asked for. Throws on an unknown name. */
export function selectCategories(region: Region, names: string[]): Category[] {
  if (names.length === 0) return region.categories;

  const known = new Map(region.categories.map((category) => [category.name, category]));
  const unknown = names.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new ConfigError(
      `unknown categor${unknown.length === 1 ? "y" : "ies"} for region ${region.id}: ` +
        `${unknown.join(", ")}. Known: ${[...known.keys()].join(", ")}`,
    );
  }
  return names.map((name) => known.get(name)!);
}

/**
 * Two categories on one map must not share a colour. The library fills every
 * slot, so a category only one region has reuses that of one it does not list.
 */
function assertOwnColors(
  categories: [name: string, color: string][],
  file: string,
): void {
  const owners = new Map<string, string>();
  for (const [name, color] of categories) {
    const owner = owners.get(color);
    if (owner !== undefined) {
      throw new ConfigError(
        `${file}: categories '${owner}' and '${name}' both take palette slot ${color}`,
      );
    }
    owners.set(color, name);
  }
}

function toCategory(
  name: string,
  spec: Record<string, unknown>,
  defaultDedupeM: number,
  file: string,
): Category {
  const parsed = validate(CategorySchema, spec, `${file}: category '${name}'`);
  return {
    name,
    label: parsed.label ?? name,
    localName: parsed.local_name ?? null,
    query: parsed.query,
    geometry: parsed.geometry,
    minAreaM2: parsed.min_area_m2 ?? 0,
    namedMinAreaM2: parsed.named_min_area_m2 ?? parsed.min_area_m2 ?? 0,
    pieceMinAreaM2: parsed.min_piece_area_m2 ?? 0,
    simplifyM: parsed.simplify_m ?? 0,
    lineWidthM: parsed.line_width_m ?? 0,
    defaultMinutes: parsed.default_minutes,
    defaultMode: parsed.default_mode,
    defaultEnabled: parsed.default_enabled,
    dedupeM: parsed.dedupe_m ?? defaultDedupeM,
    expectCount: parsed.expect_count ?? null,
    colorIndex: PALETTE_SLOTS.indexOf(parsed.color),
  };
}

/** Parse, or throw a `ConfigError` naming the first offending key. */
function validate<const TSchema extends v.GenericSchema>(
  schema: TSchema,
  value: unknown,
  where: string,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, value, { abortEarly: true });
  if (result.success) return result.output;
  const [issue] = result.issues;
  const key = v.getDotPath(issue);
  throw new ConfigError(`${where}${key ? `: ${key}` : ""}: ${issue.message}`);
}

async function readYaml(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    throw new ConfigError(`could not read ${file}: ${(error as Error).message}`);
  }
  try {
    return parse(text) ?? {};
  } catch (error) {
    throw new ConfigError(`${file} is not valid YAML: ${(error as Error).message}`);
  }
}
