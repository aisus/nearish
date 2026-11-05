# Architecture

How the code is structured, and the rules that keep the map correct. The main risk in this project is a map that is wrong but still looks plausible, and most of these rules exist to prevent that. Terms are defined in [`glossary.md`](glossary.md), the data side is in [`data.md`](data.md), and how the page looks and behaves is in [`design.md`](design.md).

## What it shows

An interactive map that answers questions like "where am I within 15 minutes' walk of a skatepark *and* 10 minutes of an S-Bahn station". The output is ground, not a list of places. Each ticked category's **reach** is the ground within its radius of any of its places, and the **overlap** is the ground within reach of every ticked category. Both are drawn, never computed as polygons.

**Reach is a circle scaled by a detour factor.** There is no routing and no street network. This is crude, but it keeps the tool instant and light on dependencies. The [README](../README.md#limitations) says what it costs. If the circles ever become too inaccurate, precomputed isochrones per place would fit the current code, because `fillReach()` is the only function that knows what shape a place is ([below](#drawing)).

**No server.** Data is fetched rarely, on a developer's machine, and committed. The page is static files on GitHub Pages and never queries Overpass. A visitor's settings stay in their own browser.

## Two halves, one file contract

The two halves share only the files in `public/data`, and `src/types.ts`, which describes those files and nothing else. That file is included in every TypeScript project, so browser-only state types live in `src/lib/state.ts` instead.

**The split is enforced by the compiler.** `tsconfig.app.json` gives the browser half DOM types and no Node types. `tsconfig.node.json` gives `src/fetch` Node types and no DOM types. A `node:fs` import in `src/lib/` is a TS2307 error, and using `document` in `src/fetch/` is a TS2584 error.

The fetch step writes these files for each region, in `public/data/<id>/`:

- `places.geojson`, with one `PlaceFeature` per place. Its geometry is `Point | Polygon | MultiPolygon`, never a `LineString`. A river's centre line is widened into a strip before it is written, so the app sees a polygon like any other.
- `meta.json`, which describes the region: its id, label, bbox and `osm_as_of`, and each category's label, colour slot, defaults and count.
- `thumbnail.json`, the region drawn small for the home screen.

Two more files cover all regions. `regions.json` is the index, rebuilt from every `meta.json` on each fetch so that it only lists data that exists. `home-sample.json` is the crop of central Berlin behind the home screen's animation. The index is committed because a static host cannot list a directory. A region file that was never fetched is not in the index, which is correct because the app could not load it.

**Validation uses valibot in both halves.** There is one schema per shape, with defaults and cross-field rules inside it, and unknown yaml keys are errors. It was chosen for the browser cost of the stored state's schema: 2.3 kB gzipped, against 10 for zod/mini and 27 for zod.

## The fetch step

`src/fetch/` is Node only and runs as `npm run fetch`. The network code is kept apart from the transforms:

    cli.ts                   flags, the run, its report and exit code
    categories.ts            loading and validating both yaml files
    overpass.ts              the network, and the raw-response cache
    places.ts                elements to places: dedupe, the count check
    geometry/
      overpass-geometry.ts   elements to points and GeoJSON shapes
      areas.ts               area, the body cut, strips, simplification
      geojson-conversion.ts  rounding and output
      thumbnail.ts           the home screen's pictures, as SVG paths
    thumbnails.ts            npm run thumbnails: those, from public/data

`places.ts` and `geometry/` are pure and must not import `node:*`. `cli.ts` stays thin. `--config`, `--regions`, `--out` and `--cache` are roots rather than fixed paths, so another caller can use the same functions. There is no spatial index, because dedupe runs once per fetch on a few thousand elements.

**OSM's vocabulary stops at `overpass-geometry.ts`.** In OSM an area is bounded by rings: a closed way, or a multipolygon relation's members joined into `outer` and `inner` rings. This file is the only place that needs those words. A place leaves it as a GeoJSON shape, with every outer ring as its own polygon and holes dropped. Everything after that uses standard geometry with Turf. The file is written by hand because `osmtogeojson` keeps the inner rings this project drops (Belgrade water 88 → 73 km²), emits `LineString`s and extra features, picks point or polygon from the response instead of the yaml, and has been a beta since 2022.

**The yaml decides a place's shape, not the response.** Shapes are built only for a category that sets `geometry: area`. If the shape came from the cached response, a category switched back to points would keep emitting polygons until someone fetched it again.

## The app

`src/` beside `fetch/` is the browser app, which has two screens. `App.vue` is a shell that reads the index and shows `HomeScreen` (pick a region) or `MapScreen` (one region and everything drawn over it). It also holds the basemap, which belongs to neither screen: it saves the basemap and sets the page's theme from it on the root element, so both screens use one theme.

    App.vue                  the shell: the index, the route, the basemap
    components/
      HomeScreen.vue         the regions, the text, and OverlapDemo
      OverlapDemo.vue        the home screen's animation
      MapScreen.vue          one region: its AppState and the watchers
      MapHeader.vue          the bar: the way home, the link, the basemap
      ControlPanel.vue       the panel, a CategoryRow per category
      CategoryRow.vue        a category's tick, time budget and radius
      ThemeSwitch.vue        the sun and moon
    lib/
      map.ts                 MapView: Leaflet, kept imperative
      overlap.ts             OverlapPainter and fillReach(): the drawing
      overlap-layer.ts       OverlapLayer: that drawing on the map
      overlap-estimate.ts    estimateOverlap(): that drawing, measured
      reach.ts               a reach's radius, and the region's area
      data.ts                reading the committed data
      format.ts              a month and a size, as the page writes them
      links.ts               addresses the page links to
      media.ts               media queries the code acts on
      basemaps.ts            the basemaps, and the palettes with them
      vector-basemap.ts      MapLibre, imported on demand
      vector-styles.ts       our overrides of OpenFreeMap's styles
      persist.ts             settings in storage, and restore()
      share.ts               settings in a link, and sending one
      state.ts               AppState and its parts
      tuning.ts              every tunable number, with its measurement
    assets/main.css          the chrome's colour tokens

The chrome's colours are tokens in `main.css`, each a `light-dark()` pair picked by the root's `color-scheme`. Before `App.vue` sets the theme, the `color-scheme` is the system's preference. A first visit also opens on that theme, so it does not flash from one to the other.

**`?region=` is all the routing there is.** A bare URL is the home screen. A `?region=` shows nothing until the index confirms it, so a link does not pass through the home screen on its way. A fresh load and the back button both go through `syncFromUrl`, so they always agree about what is on screen. A `?region=` that is not in the index goes to the home screen rather than guessing.

**A region is mounted, never switched.** `MapScreen` takes its region as a prop and is keyed by its id, so moving to another region remounts it. That gives an `AppState` restored from that region's storage and a new `MapView` fitted to the new bbox, and nothing has to be undone by hand. This matters for correctness. A cache of reaches keyed by category and radius, with nothing about *where*, once answered for Berlin with Munich's reach, and it looked like a switch that had not registered. Do not add a way to change region without remounting. This is also why choosing a region is a screen and not a control: nothing carries over from one region to the next, and two regions side by side are two tabs.

**The map is framed by `fitBounds` on the bbox**, never by a stored centre and zoom. The bbox is exactly the ground the data covers, and a shared link opens on it too.

## State

**State flows one way into the map.** A region's state is one reactive `AppState` in `MapScreen.vue`. Components bind to it with `v-model` and never touch the map or the geometry. Leaflet is created in `onMounted` and held in a non-reactive variable, with no `vue-leaflet`, and watchers are the only code that writes to it. The only way back up is the two click callbacks passed into `MapView`'s constructor, one for the map and one for a pin. They only edit state and never draw. That is why a pin is named and removed in the panel, and a click on one only selects it.

**Which watcher fires decides what is redone.** One watcher covers the criteria (`categories`, the pins' positions, `pinControl`). It estimates the overlap's size again, which draws the whole region once more, and then paints. The others only paint or only redraw the pins, because a pin's name and which pin is selected are not criteria. `AppState.display` groups the overlay toggles to keep this clear. A field added to `display` needs no new watcher, and a field added anywhere else needs a decision about which side it belongs to.

**A third watcher saves, and touches nothing else**: neither the map nor `state`. A save that wrote back would be a second writer. It saves nothing while a shared link is shown, which is why the panel is read-only then. Otherwise a change could not be saved and would be lost with no warning.

**`visiblePlaces` is a computed, not a function.** `MapView.setPlaces` skips the rebuild when its inputs are identical, and that check needs a stable reference. Rebuilding ~1000 markers is the most expensive thing a repaint can do.

## Settings and links

**Stored state is validated, never trusted.** Each region's settings are kept in `localStorage` under `nearish:region:<id>`, as JSON with a version. `restore(meta, saved)` in `persist.ts` is the only way in, for storage and links alike. Stored state outlives the code that wrote it, and any misreading of it still draws a plausible map, so:

- the set of categories comes from `meta.json`, never from storage: a category the region no longer has is dropped, and a new one takes its defaults;
- minutes are rounded and clamped to the slider's range;
- a category malformed in any other way takes all its defaults, rather than a stored budget with a default mode;
- pins keep only real coordinates and are renumbered from 1, because the pin id counter restarts on every mount, and a malformed name is dropped but its pin is kept;
- a different `STORAGE_VERSION`, or anything that is not an object, means all defaults. A change of shape bumps the version, which discards what was stored rather than migrating it.

`categories`, `display`, `pins` and `pinControl` are saved. Whether a pin is being placed or is selected is not. The `default_*` fields of `meta.json` are used for a first visit, a private window, a category added later, and what *Reset* returns to. Every read and write is wrapped, so with storage unavailable or full the page works as if nothing were stored. A save is synchronous on every change: the payload is a few hundred bytes, and with a debounce, closing the tab could lose an edit. `save()` writes only what differs from what is stored.

**The basemap is saved once, for every region**, under `nearish:basemap`, by `App.vue`. It is read back only if it names a basemap that exists. It is a visitor's preference, not a fact about a place, so no link carries it and *Reset* leaves it alone. Until one is chosen, the system's light or dark preference picks Light or Dark grey (`THEME_BASEMAPS`) on every load.

**A tab follows another tab's save.** Every tab of a region saves all its settings on any change, so a tab left open would overwrite another tab's save on its next change, including a shared link that was just saved. A `storage` event makes the tab restore the saved state in place, keeping the view and the basemap. A hidden tab does this when the visitor returns to it, and a visible tab after half a second of quiet. It never happens on focus, because focus arrives with a click. Following writes nothing, since nothing differs, so tabs cannot echo each other. Pins that arrive this way take no cursor, because only a drop asks for a name.

**A shared link carries a region's settings after the `#`**, except the basemap, in readable parameters:

    ?region=munich#v=1&c=metro.10w,skatepark.15b&pin=20w&p=48.1351,11.582,Office&hide=places

`share.ts` turns the hash into the stored shape, and `restore()` validates it like anything read from storage. A fragment never reaches a server, which has two benefits. Only the browser's length limit applies, while GitHub Pages refuses a path and query over 8192 characters, which 14 pins with long Chinese names would reach. Pins, which are often someone's home, also stay out of the host's logs. Categories share one parameter, `c`, because their ids come from yaml and could collide with any other parameter. A category the link does not name is unticked, never taken from storage or the defaults, because a mix of the two would be criteria nobody chose. A link with a different `SHARE_VERSION` is ignored.

The hash is read once, on mount. Leaving the region drops it. A new hash pasted over it remounts the map, since a hash change alone loads nothing. A link's settings are shown read-only and saved only on *Save and edit this* ([`design.md`](design.md#links)). The address bar is not kept up to date, because that would mean a write per slider step and would conflict with a shared link's hash. *Copy link* is how a link is made.

## Drawing

**The reaches and the overlap are drawn, not computed.** `OverlapPainter` in `overlap.ts` fills each ticked category's reach into a canvas and intersects them by compositing (`destination-in`). The tints, the dim with the overlap cut out, the overlap's fill and its outline all come from that. Nothing is unioned, so the cost depends on the pixels drawn rather than the number of places. With a GPU, a pan or a budget step takes about a frame: 11-19 ms for Berlin with supermarket at a 24 minute walk. Where a browser draws canvas in software, it takes 100-300 ms (2026-11-01). The polygons this replaced, a union of circles per category, took seconds for a dense category at a long budget: 11 s for Berlin's supermarket at 45 minutes. What drawing cannot give is an exact km² and a shape to export.

**`fillReach()` is the place to swap the shape.** It is the only function that knows what shape a place is. A point is filled as a circle. An area is filled and stroked 2r wide with round joins, which is exactly its buffer. Replacing circles with precomputed isochrones would change only this function and the shape stored in `places.geojson`, because an isochrone is filled the same way as an area.

**Shapes go to the GPU 128 to a path**, and areas 64, because a stroke can wind twice. A GPU counts a path's windings in an 8-bit stencil, so 256 circles over one pixel wrap to zero and punch a hole, and the outline then draws round the hole. Android Chrome drew contour lines of these through Berlin's supermarkets. Do not join the batches back into one path.

**`OverlapPainter` does not know where it is shown.** `OverlapLayer` puts it on the map and follows the view. The home screen's animation paints with it too, so the two always draw the overlap the same way. On the map it redraws after every pan and zoom, as Leaflet's own renderer does, and is scaled with CSS while a zoom animates. It is drawn 10% past each edge of the view, which a drag uses up quickly. So a pan also redraws once half of that is gone, as long as the last redraw took under 33 ms (`OVERLAP_PAN_REDRAW_MS`). In software that would stall the drag, so there it waits for the pan to end. The places, the pins and the bbox's edge are Leaflet's own SVG, which redraws only when a pan ends, so they are drawn half a view past each edge instead (`PATH_PADDING`). The two canvases sit in the map's panes, the tints below the places and the dim above, so the panes handle the stacking as they do for everything else.

**The size is an estimate, but "No overlap" is not.** The km² comes from drawing the whole region once more at 512 px across, ~90 m a pixel in Munich, and counting pixels. This lands within a few per cent of the exact figure, which is enough for a number nobody acts on. Calling the overlap empty also stops the dim and the outline, so a sliver must not vanish at street zoom. Before saying the overlap is empty, any partly covered pixel is drawn again, finer, up to 2048 px. A pin 2 m into a climbing gym's reach is found, and one 2 m outside it is not.

**Memory is four canvases the size of the view**, padding included: about 120 MB for a 1440×900 window at twice its density. The estimate's canvases, up to 16 MB each, are released after every read. Safari has not been tested. iOS limits one canvas to ~16.7 megapixels, and the largest here, on an iPad at twice its density with the padding, is about 8.

`tuning.ts` holds every tunable number with the measurement that justifies it. That includes `DRAWING`, which holds every part of how the overlap, the reaches and the places are drawn. Read the comments before changing a value.

## Basemaps

**Vector tiles from OpenFreeMap, drawn from styles we hold.** OpenFreeMap needs no key, sets no limits and allows commercial use. Esri's terms do not cover a public page without an account, and CARTO needs a key and watermarks every tile without one. OpenFreeMap is one operator funded by donations, but its tiles are open source and can be mirrored. `public/styles/` holds unedited copies of three upstream styles, so a change upstream cannot alter the look. The tiles, fonts and icons still come from OpenFreeMap. The `README.md` in that directory says where the copies come from and gives their licences. Our changes are in `vector-styles.ts`, as one override per decision, keyed by layer id and applied as a style loads. The alternative, editing in an editor, rewrites the whole style on every save. An override naming a layer the style does not have logs a warning in the console.

**MapLibre draws inside Leaflet**, through `@maplibre/maplibre-gl-leaflet`, so Leaflet still owns the map, the zoom and every overlay. MapLibre is most of the bundle, about 290 kB gzipped, three times the size of the app's own code. So `vector-basemap.ts` is imported on demand: the panel and the region's data do not wait for it, and the previous basemap stays up until the next is ready. A request counter in `MapView` drops a basemap that arrives after a later choice.

**The plugin's zoom handling is patched twice** in `vector-basemap.ts`. Leaflet stretches the last frame with CSS for 250 ms and tells MapLibre the new view only when that ends. MapLibre then draws coarser cached tiles until the new zoom's tiles arrive, which flashed after every wheel step. The plugin also settles its canvas a frame late, so a chained zoom, such as a wheel or pinch zoom, reset it mid-animation. The patches skip that late step while a zoom animates, and cover the canvas with the stretched frame until the tiles are in, which needs `preserveDrawingBuffer`. Both patches reach into the plugin's private code, pinned at 0.1.4. They could only be removed if MapLibre owned the camera and drew the overlay as its own layers. That would mean redrawing the overlap on every frame in WebGL and rebuilding every interaction.

`basemaps.ts` holds the basemaps, the overlay palettes that go with them, each derived from `PALETTE_SLOTS`, and `drawingFor()`, which gives the `DRAWING` values a basemap draws differently. `tuning.ts` keys those by name.
