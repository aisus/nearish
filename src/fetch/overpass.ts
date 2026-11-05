/** Overpass requests and the raw-response cache. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Bbox } from "../types";
import type { CategoryGeometry } from "./categories";
import type { OverpassElement } from "./geometry/overpass-geometry";

const ENDPOINT =
  process.env.NEARISH_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

const USER_AGENT =
  process.env.NEARISH_USER_AGENT ?? "nearish/0.1 (+https://github.com/aisus/nearish)";

export const REQUEST_GAP_MS = 3000;
const QUERY_TIMEOUT_S = 300;

/** How long past its own timeout Overpass gets to answer before the request is dropped. */
const RESPONSE_GRACE_S = 30;

const MAX_RETRY_AFTER_S = 120;

/** 502 is the capacity answer, from a full queue: 13 of 34 queries on 2026-11-04. */
const REFUSING_STATUSES = new Set([403, 502, 503]);

export class OverpassRefused extends Error {}
export class OverpassFailed extends Error {}

interface OverpassResponse {
  elements: OverpassElement[];
  remark?: string;
  /** `timestamp_osm_base` is the OSM database state the answer reflects. */
  osm3s: { timestamp_osm_base: string };
}

/**
 * Substitute the bbox and add the `out` clause, so no category can forget
 * it: `out center tags;` for points, `out geom;` for areas. Not `out geom
 * tags;`, which returns relations without members, and not `out geom center
 * tags;`, which Overpass accepts and answers with centres only.
 */
export function buildQuery(
  template: string,
  bbox: Bbox,
  geometry: CategoryGeometry,
): string {
  const body = template.replaceAll("{{bbox}}", bbox.join(",")).trim();
  const out = geometry === "area" ? "out geom;" : "out center tags;";
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];\n${body}\n${out}`;
}

/** The raw response, and beside it the exact query that produced it. */
function cacheFiles(
  cacheDir: string,
  category: string,
): { response: string; query: string } {
  return {
    response: path.join(cacheDir, `${category}.json`),
    query: path.join(cacheDir, `${category}.query`),
  };
}

/**
 * A cached raw response, used only for the query that produced it: keyed by
 * category name alone, a changed query or bbox silently got the old answer.
 */
async function loadCached(
  cacheDir: string,
  category: string,
  query: string,
): Promise<OverpassResponse> {
  const files = cacheFiles(cacheDir, category);
  let text: string;
  try {
    text = await readFile(files.response, "utf8");
  } catch {
    throw new OverpassFailed("nothing cached; --refresh queries Overpass");
  }
  const cachedQuery = await readFile(files.query, "utf8").catch(() => null);
  if (cachedQuery !== query) {
    throw new OverpassFailed(
      "cached for another query or bbox; --refresh queries Overpass",
    );
  }
  try {
    return parseResponse(text);
  } catch (error) {
    throw new OverpassFailed(
      `cached ${files.response} is unusable (${(error as Error).message})`,
    );
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** POST one query to Overpass and return the parsed response. */
async function fetchQuery(query: string): Promise<OverpassResponse> {
  let response = await post(query);

  if (response.status === 429) {
    response = await retryOnce(query, response);
  }

  if (REFUSING_STATUSES.has(response.status)) {
    throw new OverpassRefused(`Overpass returned ${response.status} — stopping`);
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new OverpassFailed(`Overpass returned ${response.status}: ${body}`);
  }

  return parseResponse(await response.text());
}

/**
 * One category's response: from the cache, or from Overpass only with
 * `refresh`, so that no query is ever a side effect of a missing file.
 */
export async function fetchCategory(
  category: string,
  query: string,
  cacheDir: string,
  refresh: boolean,
  since: number | null,
): Promise<{ payload: OverpassResponse; fromCache: boolean }> {
  if (!refresh) {
    return { payload: await loadCached(cacheDir, category, query), fromCache: true };
  }

  if (since !== null) {
    const cached = await loadCached(cacheDir, category, query).catch(() => null);
    if (cached && Date.parse(cached.osm3s.timestamp_osm_base) >= since) {
      return { payload: cached, fromCache: true };
    }
  }

  const payload = await fetchQuery(query);
  const files = cacheFiles(cacheDir, category);
  await mkdir(cacheDir, { recursive: true });
  // Query last: a write cut short leaves a response that no query matches.
  await writeFile(files.response, JSON.stringify(payload));
  await writeFile(files.query, query);
  return { payload, fromCache: false };
}

async function retryOnce(query: string, rateLimited: Response): Promise<Response> {
  const wait = retryAfterSeconds(rateLimited);
  if (wait === null) {
    throw new OverpassRefused("429 with no usable Retry-After — rate limited, stopping");
  }
  if (wait > MAX_RETRY_AFTER_S) {
    throw new OverpassRefused(
      `429 asking for ${Math.round(wait)}s, longer than we are willing to wait — stopping`,
    );
  }

  await sleep(wait * 1000);
  const response = await post(query);
  if (response.status === 429) {
    throw new OverpassRefused("429 again after honouring Retry-After — stopping");
  }
  return response;
}

/** `Retry-After` is either a count of seconds or an HTTP date. */
function retryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (header === null) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);

  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return Math.max(0, (at - Date.now()) / 1000);
}

function post(query: string): Promise<Response> {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout((QUERY_TIMEOUT_S + RESPONSE_GRACE_S) * 1000),
  });
}

function parseResponse(text: string): OverpassResponse {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new OverpassFailed(`Overpass returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!payload || typeof payload !== "object") {
    throw new OverpassFailed("Overpass response was not an object");
  }

  const response = payload as Partial<OverpassResponse>;
  // Overpass reports query errors and timeouts as a `remark` on an
  // otherwise-200 response. Without this check a timed-out query looks
  // exactly like a category with no results.
  if (response.remark) {
    throw new OverpassFailed(`Overpass remark: ${response.remark}`);
  }
  if (!Array.isArray(response.elements)) {
    throw new OverpassFailed("Overpass response had no 'elements'");
  }
  // The data's age on the page comes from here; without it there is none to show.
  if (typeof response.osm3s?.timestamp_osm_base !== "string") {
    throw new OverpassFailed("Overpass response had no 'osm3s.timestamp_osm_base'");
  }
  return response as OverpassResponse;
}
