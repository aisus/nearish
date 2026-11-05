# Contributing

This guide is for anyone changing the code or the data. Pull requests are welcome. Bug reports and requests for a new region or category go in the issue templates.

## What to read

- **This file**: setup, commands, conventions and pull request requirements.
- **[`docs/glossary.md`](docs/glossary.md)**: the terms used on the page, in the docs and in the code.
- **[`docs/architecture.md`](docs/architecture.md)**: how the code is structured, and the rules that keep the map correct.
- **[`docs/data.md`](docs/data.md)**: categories, regions, how queries are checked, and the rules for parks, water and the sea.
- **[`docs/design.md`](docs/design.md)**: how the page looks and behaves, and why.

## Setup

Requires Node 22.13 or newer. Development uses Node 24. Run everything from the repository root.

```bash
npm install
```

## Commands

```bash
npm run dev            # Vite dev server; a file:// page cannot fetch() local JSON
npm run dev -- --host  # the same, reachable from a phone on the same network
npm run build          # vue-tsc --build && vite build -> dist/
npm run preview        # serve the built dist/
npm run typecheck      # vue-tsc --build
npm run lint           # eslint, type-aware
npm run format         # prettier --write (code only; Markdown is left as written)
npm run format:check   # prettier --check, as CI runs it
npm run test           # vitest run
npm run thumbnails     # the home screen's pictures from public/data, no fetch

npx vitest run -t "respects the radius"     # one test, by name
npx vitest run src/fetch/places.test.ts       # one file
```

### Fetching

```bash
npm run fetch -- --region munich                     # every category, from cache/ only
npm run fetch -- --region munich --refresh           # query Overpass (rarely, on purpose)
npm run fetch -- --region munich --category metro    # one category; repeatable
npm run fetch -- --region munich --dry-run           # report counts, write nothing
npm run fetch -- --region munich --refresh --since 2026-11-04    # query only what is not that fresh in the cache
NEARISH_OVERPASS_URL=https://ovp.dresel.systems/api/interpreter npm run fetch -- --region munich --refresh    # through Overpass Europe
```

`--region` is optional while there is one region file and required once there are two, so the command never has to guess. `--out` and `--cache` are root directories: each region gets a subdirectory under them. `--config` and `--regions` point to another library file and region directory.

Only `--refresh` queries Overpass. Without it, a category fails and keeps its previous output if it has no cache, or if its cache was made for another query or bbox. A fresh clone has no cache, so the first fetch of a region needs `--refresh`. After changing a query, refresh that category.

Exit codes: `0` ok, `1` a category was empty or failed, `2` config error, `3` Overpass refused.

To refresh every region, run them one at a time and read each one's counts before starting the next. If a run ends with exit 3 or a failed category, run the same command again later: `--since`, with the day the refresh began, keeps what has already arrived.

Requests to Overpass send a User-Agent that names this project. If you fetch from your own copy, set `NEARISH_USER_AGENT` to one that names you. `NEARISH_OVERPASS_URL` points `--refresh` at another Overpass instance. [`data.md`](docs/data.md#fetching) says when to use one, and which.

Before running `--refresh`, read the [Overpass etiquette](docs/data.md#fetching) and follow it.

### Checking that a refactor left the data alone

Rebuild every region from the cache, without network access, and compare the result with what is committed. No output means nothing changed. This needs a cache from an earlier `--refresh` of the same queries, because a category without one fails instead of fetching.

```bash
for f in regions/*.yaml; do npm run fetch -- --region "$(basename "$f" .yaml)"; done
git diff --stat -I '"fetched_at"' -- public/data
git checkout -- public/data                          # discard the rebuild
```

## Deploy

Every push to `main` deploys the page to GitHub Pages (`.github/workflows/ci.yml`). Pull requests only run the checks and tests. The build needs no keys or variables, and CI never queries Overpass: the page serves the committed data.

GitHub Pages caches files for ten minutes, so visitors can see the previous deploy for that long after a merge.

## Conventions

- **Formatting.** Prettier formats the code, and ESLint runs type-aware. Neither covers Markdown. In Markdown a paragraph is one line, with manual line breaks only where they help.
- **Every command is documented here.** Any command used more than once goes in this file, as a runnable line with a one-line description. The [README](README.md) lists only the commands that run the page. 
- **One word per thing.** The page, the docs and the code all use the terms in [`docs/glossary.md`](docs/glossary.md), including in identifiers, so comments and docs never have to translate.
- **Comments state invariants and measurements only.** Use one to three lines for what the code cannot say itself, and put measured numbers beside the constant they justify, as `src/lib/tuning.ts` does for every tunable number. Reasons go in `docs/`. Don't add comments that restate the code.
- **Docs say what is, and why.** The README briefly says what the project is, how it works, what its limitations are and how to run it. This file and `docs/` are for working on it. They describe the code and the data as they are now, with the measurements behind them. Mention an alternative only where someone would otherwise propose it again. Docs hold no changelogs or plans: git history is the log. When a rule changes, change it where it is written, in the same commit.
- **Self-contained.** Do not refer to anything a reader of the repository cannot open.

## Tests

**Test the pure transforms that would fail silently and still look plausible. Nothing else.** There are three test files:

- `src/fetch/places.test.ts` covers coordinate extraction, proximity dedupe, shape emission, area cuts, the simplification tolerance's units and the `expect_count` guard.
- `src/lib/persist.test.ts` covers restoring stored state. A stale category or a colliding pin id would still draw a map.
- `src/lib/share.test.ts` covers links. A name that breaks a separator, or a category taken from storage, would still open a map, but not the one that was sent.

Not tested: the Overpass HTTP path, yaml loading, CLI wiring, components and the map. TypeScript covers most of these, and the map is checked by opening it and looking at it.

Do not add tests for coverage. Before adding one, ask what wrong behaviour it catches that would not otherwise be obvious. Config validation and the CLI's merge-on-failure path are left out on purpose: running the command checks them in seconds, with no network.

## Pull requests

- `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm run test` must pass. CI runs the same checks, plus the build, on Node 22 and 24.
- **A change to the fetch step** must leave the data alone unless it is meant to change it. Run the check above and report any differences.
- **A changed or new category or region** comes with its data regenerated and committed, and the counts in the description. For a new region, say what each count was reconciled against, e.g. a real number of stations ([`docs/data.md`](docs/data.md#choosing-a-query)).
- **The docs change with the code.** A new command goes in this file. A new rule goes in `architecture.md`, `data.md` or `design.md`, replacing the rule it changes.
- Never run `--refresh` on a schedule, in CI or from any other automation. Overpass is a free, shared service which guidelines and limits should be respected.

## Scope

Some things are left out on purpose, and a pull request adding one is unlikely to be accepted:

- transit timetables at runtime;
- a server, accounts, or visitor state stored anywhere but the visitor's own browser;
- anything that tries to make it into a general GIS tool.

Two other things are not ruled out, but they are hard to do fast enough in a browser with no server. A pull request that solves either one is welcome:

- **Routing or isochrones at runtime.** They need a street network in the browser. Reach is currently a circle to keep the page instant and light on dependencies ([`architecture.md`](docs/architecture.md#what-it-shows)).
- **The overlap as polygons.** They would give an exact size and a shape to export, but a union of circles takes 10+ seconds for dense categories (e.g. Berlin's supermarkets), so the overlap is drawn on a canvas ([`architecture.md`](docs/architecture.md#drawing)).
