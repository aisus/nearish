# Data

How a yaml file becomes the `places.geojson` the app draws: how categories and regions are defined, how to add a region, how queries are checked, and the rules for categories drawn as shapes. The code is described in [`architecture.md`](architecture.md#the-fetch-step), and the commands are in [`CONTRIBUTING.md`](../CONTRIBUTING.md#fetching).

The main risk here is a query that returns a plausible number of the wrong things. On a map, that looks entirely correct.

## Categories and regions

**The yaml is data, not code.** Adding, removing or retuning a category or a whole region is a yaml edit and a fetch. If it ever needs a code change, the schema is wrong and should be fixed.

**`categories.yaml` is the library: what applies everywhere.** It holds queries, labels and defaults that are as true in Berlin as in Munich. Its header lists every key a category can set, and each query has the evidence for it beside it.

**`regions/<id>.yaml` holds what is specific to one region:** the bbox, the categories the region uses, which ones start ticked (`default_enabled`), `expect_count`, a `local_name`, and any library key it overrides, including a whole `query:`. A region entry is merged over its library entry key by key and validated as one category, so there is one validation path and no second schema.

**`expect_count` in the library is a config error.** A count range is an observed fact about one place. Applied to another place, it is exactly the plausible wrong answer the check exists to catch. A region without a range has no baseline yet, and the run names it instead of reporting that a check passed.

**Every value is validated in `categories.ts` before it reaches geometry**, including unknown keys. An unchecked `default_mode` becomes `undefined` km/h, then a NaN radius, then a map that is wrong but plausible.

**A region is a bbox, not a boundary.** A boundary would look better and is only a clip away, but it is not what the tool is testing. Two regions can overlap, and their counts then do not add up.

**A region is a place, not saved criteria.** Time budgets and ticks stay in the app. Otherwise "Munich for flat-hunting" and "Munich for a weekend" would be two regions that drift apart as soon as a query changes.

## Adding a region

Write `regions/<id>.yaml`, with the id matching the filename:

```yaml
id: hamburg
label: "Hamburg"
bbox: [53.40, 9.70, 53.75, 10.30]   # south, west, north, east
categories:
  supermarket:
  suburban_rail:
    default_enabled: true
```

Naming a category is enough. The rest comes from the library.

1. **Probe the queries** in [overpass-turbo](https://overpass-turbo.eu/) first. An `out count;` query checks several categories in one cheap request, without a full run. If a query comes back wrong for the city, override its `query:` in the region file, as Belgrade does for BG Voz.
2. **Fetch** with `npm run fetch -- --region hamburg --refresh`, which sends one query per category. Read the [etiquette](#fetching) first.
3. **Reconcile each count against a real list** ([below](#choosing-a-query)), read the names, and write the ranges into `expect_count`.
4. **Commit** the region file, `public/data/<id>/` and the updated `public/data/regions.json`. In the pull request, give the counts and what each was reconciled against.

## Colours

**A category declares its colour.** `color: green` in `categories.yaml` is resolved against `PALETTE_SLOTS` in `src/types.ts` and written into `meta.json` as a slot, which the app uses as an index into each palette. Two categories claiming one slot is a config error, in the library and on any one region's map. So a category has the same colour in every region, whatever else the region lists, and a hue can have a meaning: green for parks, blue for water. The library fills every slot, so a category only one region has declares the colour of a category that region does not list. `basemaps.ts` derives each palette by mapping over `PALETTE_SLOTS` from a `Record<PaletteSlot, string>`, so a missing hue is a compile error.

Thirteen categories fill thirteen slots, which is more than hues can cleanly separate. Three near-pairs are accepted: indigo and violet, yellow and amber, teal and cyan. The overlap is the part left clear, so a tint that is hard to tell from its neighbour only makes it harder to see *why* a place is outside the overlap.

**Slots are assigned under simulated colour blindness**, deuteranopia and protanopia (Machado 2009), not only by eye. Suburban rail's fuchsia is 4.5 ΔE from water's blue, where violet was 0.3, which made two of the most-ticked categories one colour. Fitness's lime stays within 2 of metro's red and tram's amber, because no order of twelve hues separates red, amber and lime for a red-green viewer. A new slot is chosen by the same check. Brown took the thirteenth at 4.1 from its nearest, where orange was 0.2 from amber.

## Fetching

**The Overpass etiquette is mandatory.** One query per category, sequential with a gap, a descriptive User-Agent, raw responses cached, `--refresh` only on purpose, and never on a schedule.

**If Overpass refuses, stop.** A `403`, `502` or `503` ends the run, and so does a `429`, except that one carrying `Retry-After` is honoured once. 504s from this endpoint are often transient, so re-run the category rather than rewriting the query. A 502 is the server saying its queue is full. Counting it as a failed category sent 34 queries at a full server on 2026-11-04, 13 of them refused, with the run still going.

**Refresh one region at a time, by hand.** Start the next only once the last has finished and its counts have been read. The same 502 says the endpoint is meant for human-operated tools, and that high-volume use should run its own instance, so a busy server is waited out by a person coming back later. Nothing in this repository waits or retries for them.

**`overpass-api.de` is the default, but it is often full.** Distributed load from cloud networks has crowded it since at least April 2026, and the [wiki](https://wiki.openstreetmap.org/wiki/Overpass_API) lists it as overloaded.

**Overpass Europe is the fallback.** It covers Europe only, from a daily Geofabrik extract, so `--since` must not name a date later than its data. It is free with no key, at 16 parallel queries per address, but it is one small server, so the same etiquette and limits apply.

**A refresh can be resumed.** A refused run writes nothing for that region, but every response it received is already in the cache. `--since` reuses a cached response whose `timestamp_osm_base` is at least that new, so the same command run again queries only what is missing.

The [acceptable use guidelines](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) allow about 10,000 requests and 1 GB a day per user, identified by IP. A refresh of every region is about 120 queries, and the page never queries Overpass at all, because visitors are served committed files. Following the etiquette keeps a re-run free and a mistake cheap.

**The cache answers only the query that produced it.** Each raw response is kept in `cache/<region>/` beside the exact query it answered, including the wrapper and bbox. Without `--refresh`, a category whose cache is missing or was made by another query fails instead of fetching. A cache keyed by name alone once answered a changed skatepark query with the old query's skate shops, and a fresh clone would have queried Overpass for every category of every region without being asked.

**`osm_as_of` is the data's age, and `fetched_at` is not.** Each category records Overpass's `timestamp_osm_base`, the state of the database its response reflects. A region's `osm_as_of` is the oldest of its categories' timestamps. A rebuild from cache keeps it and updates `fetched_at`, which only says when the file was written. The page shows `osm_as_of` as a month. The home screen's footer shows the oldest region's, so it never claims fresher data than a region has, and the foot of the panel shows the region's own.

**A category that fails keeps its previous output**, so a transient 504 during a full refresh cannot silently delete its places. A category only disappears when it is removed from the region file.

## Choosing a query

**Most of the work is in tag selection, not geometry.** Validate a new query against live Overpass before committing it, and record what you found in `categories.yaml`. Traps documented there: `leisure=skatepark` returns *zero* in Munich, Berlin and Warsaw (skateparks are `leisure=pitch` + `sport=skateboard`), and `railway=station` returns 219 stations in Munich, mostly not S-Bahn.

**Check a count against a real list, not against a sense of what is plausible.** `metro` returned 62 stations in Warsaw and nobody noticed a problem, but 24 were `railway=proposed`, an entire unbuilt line. Warsaw's 38 can be trusted because it reconciles: M1's 21 plus M2's 18, minus the interchange they share. Lifecycle values are matched as a family (`proposed`, `planned`, `construction`) and also as a key prefix: London's eight ghost Tube stations are `disused:railway=station` with no `railway` tag.

**Read the names.** A count range cannot catch a related concept that is included at a steady rate. Skate shops carry `sport=skateboard` too, and they stayed inside every region's range for six regions, until Milan's names were read: 8 of 59.

**A query that works in one region may not work in another.** The suburban-rail selection returned 26 route relations in Munich under `route=train` and *zero* in Berlin, which tags the same system `route=light_rail`. The library asks for both. That failure was total, which made it easy to spot. Four regions of ten use the library's suburban-rail query as it is. The others select by network, service or station in their own file, each with its reason beside it.

**Prefer a proxy that mappers actually apply over a tag that is merely correct.** `service=commuter` should separate city rail from regional rail, but across Warsaw's 115 train relations it misses every WKD relation and two SKM ones, and catches four regional operators' relations. The S-numbering convention has no such gaps in three countries, and `expect_count` checks the result.

## Merging points

**`dedupe_m` is set by the worst interchange in any region.** OSM has a stop position per track, so a station arrives as up to six points. 100 m gave one point per station in Munich but left Berlin 74 over its station count, because Westkreuz and Ostkreuz spread their platforms over several hundred metres. Paris's long suburban platforms then moved it to 250 m, which changes nothing elsewhere. The check compares the points kept with the distinct station names in the cached response, so retuning needs no fetch. Names overstate the count wherever mappers name platforms per track ("Gare du Nord – Voie 41"), so read which names a radius merges, not only the count.

**When there is no clean radius, stay narrow.** Tram stops are ~300 m apart, so a radius wide enough to catch one stop's stray platforms also merges its neighbours. The two errors are not equal. A surplus point sits on ground that is already covered, while merging two real stops punches a hole in the map. Tram takes 100 m and a count 6-31% above the true stop count, rather than 140 m and nine of Berlin's stops lost.

Area categories take `dedupe_m: 0` ([below](#areas-parks-water-and-the-sea)).

## Choosing a category

**A category present almost everywhere adds nothing to an overlap.** It only answers "are you in Munich". The measure is **coverage**: how much of the region its reach covers at a 15 minute walk. Over Munich's 2135 km² (2026-08, park 2026-10):

    supermarket     870 places   29%   <- the dense one
    park            126          15%
    skatepark        90          10%
    tram            190           5%
    climbing_gym     14           2%

The categories that work sit at 2-10%, and a new one is measured against that band. Count and coverage do not track each other: tram has twice skatepark's places and half its coverage. Measured and left out as too dense: bus stops (3065-9167 places across the first four regions), playgrounds (746-6778) and bakeries (509-1544), which have the same weakness as supermarket.

**The band flags a category for review, but does not rule it out.** Supermarket covers 29% of Munich and stays. Water covers about a third of Belgrade because the Danube and the Sava meet in the middle of it, which is a true fact about the place. The band is there to catch a category that answers *yes everywhere*. A category that says no to most of a region is still useful.

**The distance has to matter.** A category belongs here if people go there weekly or more, and if distance is what limits them, not whether a place is free. So library is in and cinema is not: a cinema is a monthly trip people cross a city for, and its reach only shows that a place is central. Schools and kindergartens are left out because a catchment or a free place decides them, and OSM holds neither. At 27% and 40% of Munich they are also dense.

**A category can depend on a region's laws.** `leisure=dog_park` is a fenced run in Helsinki (214) and Milan (535), where dogs must otherwise be leashed. In Munich (19) half are dog clubs. Dogs may run free there by default, and the park category already answers a dog owner. A region lists dog park only where the names show fenced runs.

## Areas: parks, water and the sea

`park`, `water` and `sea` set `geometry: area`. The query is wrapped in `out geom;` instead of `out center tags;`, a place arrives as its shape, and reach is measured from its edge rather than its middle. This matters because the Englischer Garten is four kilometres end to end. Areas are for places where the size matters. A skatepark inside a 900 m radius is a point at city scale.

There are two Overpass traps. `out geom` and `out center` are mutually exclusive: `out geom center tags;` is accepted and returns only the centre. And `out geom tags;` silently returns relations with no members.

A relation whose rings will not close falls back to the centre of its `bounds`. Only outer rings are kept. A hole smaller than twice the radius closes up under the reach anyway, and a larger one is more precision than the detour factor can support. Areas are simplified at `simplify_m`, 25 m.

**The cut is what makes an area category useful.** `leisure=park` returns 1464 in Munich, more than its supermarkets, and most of it is traffic islands. `natural=water` returns 3271, mostly ponds and fragments. Each category drops bodies below `min_area_m2`: park 10 ha, water 5. At 1 ha the parks covered 27% of Munich, the same as supermarket, and the reach was the whole city. At 20 ha only the parks a Munich resident would name survived, which dropped green that is clearly a park in the other cities. 10 ha came from drawing what each cut drops over a basemap that renders green space, in four regions. The cut is not in the label: it is a tuning fact, not something a reader chooses by.

**The cut judges a body, not a piece.** OSM cuts a river into polygons at bridges and boundaries (the Isar arrives as 89), and judging the pieces separately draws it as a dashed line. Ways that OSM split share their join nodes exactly, so pieces sharing a vertex are one body, and its area is the sum of theirs. In Munich's water, 103 pieces pass on their own and 342 as bodies. For parks it adds pieces next to parks that already pass, and coverage barely moves.

**A name lowers the cut, because a name is what makes ground a place.** `named_min_area_m2` lets through a body with a name on any piece at 2 ha for water and 5 ha for park. Drawn over the basemap, the named bodies in those bands are Teufelssee, the Grunewald lakes, Tašmajdan and Bavariapark. The unnamed ones are fish-farm ponds, retention basins and estate greens. Below those sizes names stop helping, because squares and moats are named too. With names, park covers 15% of Munich and 25% of Berlin.

**Only Zurich lowers the park cut**, to 3 ha, or 1 ha with a name. Its large green ground is forest on its hills, which is not `leisure=park`, so the library's cut left 12 parks and 1.7% of the region, and dropped Josefwiese, Bäckeranlage and Lindenhof. At the lower cut it has 92 and 8.5%, and the names are still parks. A cut is measured against what a region's parks are, so a park count does not compare between regions.

**Water filters on size alone.** 1755 of Munich's 3271 water pieces have no `water=*` tag, so any inclusive filter drops more than half of them. An exclusive filter does no better: `water=basin` covers the Ismaninger Teichgebiet, open water tagged as retention.

**Area categories take `dedupe_m: 0`.** Proximity dedupe compares bounding-box centres, and at 50 m it discarded Riemer Park, 138.7 ha, because a small park sits near its middle. A facility mapped as both a node and a way keeps the way: a shape replaces a bare point, and a node has no shape for the cut to judge.

**Only Amsterdam sets `min_piece_area_m2`**, at 2 ha. Polder ditches are mapped as water polygons that all touch, so a whole network passes on the size of the lake it drains into: 11049 pieces. The floor drops pieces below it from a body that passes. It was set because of the cost of computing the overlap, which drawing removed. It stays until Amsterdam is drawn without it and checked.

**A river is a centre line as often as an area.** 80% of Munich's Würm has no `natural=water` polygon at all. So `water` also fetches `waterway=river` ways, except culverts and tunnels, and `line_width_m` widens each into a 20 m strip in the fetch step. The app still sees only polygons. A strip:

- is exempt from the area cut, because the tag already says river;
- is clipped to the bbox, because a river way runs on past it;
- is simplified at half its width rather than at `simplify_m`, so the real line stays inside it: at 25 m, 11% of the Würm fell outside;
- is made only where the line leaves the category's polygons, otherwise a river mapped both ways is drawn twice, as the Thames was. The line is cut, not the strip: subtracting polygons from strips left a sliver along every bank narrower than 20 m.

The cut line still gives the polygon its name. OSM names the Thames and the Isar on the centre line only, so an unnamed area takes the name of the line with the most length inside it. Streams are left out because they would cover nearly everywhere, and canals because they include hydro channels.

**The sea is a coastline, and its own category.** OSM has no sea polygon. The sea is implied by `natural=coastline` ways with land on their left, so `sea` fetches those and widens them like rivers. For anywhere on land, reach from the shore is the same as reach from the sea. A closed coastline rings an island, so `overpass-geometry.ts` keeps it a line whatever its shape, and the area cut judges it by the land it rings, which drops skerries. Closing clipped coastline along the bbox edge into a polygon would flood the whole box on one reversed way. Merged into `water`, the sea took Helsinki from 47% to 71% of the bbox, and a lake is not the sea.

**Known errors in the numbers.** These were measured and left alone because the map is correct:

- A body's area is summed rather than unioned, and is not clipped to the bbox, so the km² a run reports is too high. Munich's water claims 88 km² with 31 inside the bbox, and most of the rest is the Starnberger See. Neither changes a keep-or-drop decision, except at a few lakes almost entirely outside.
- A category's count is pieces and strips, not bodies. Munich's 543 water places are some 130 bodies and the strips of about twenty rivers. `expect_count` counts the same way, so the check still works.
- Pieces join only on a shared node. Joining by distance glued unrelated ponds into bodies that passed the cut, from 15 m on.
- Streams with traced banks are missing: Berlin's Panke, Wuhle and Erpe.
