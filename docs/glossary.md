# Glossary

The terms this project uses on the page, in the docs and in the code. A term means one thing everywhere, and a thing has one term. Code is named after these terms, so an identifier needs no translation: `Place` is a place and `fillReach()` draws a reach. A code name is given beside a term only where it is not the obvious one.

A new concept gets its term here first, in the same commit as the code that introduces it. When a term changes, change it here and everywhere it is used, together.

## The map

**Region.** A bbox and the categories worth asking about inside it, defined by `regions/<id>.yaml`. The app shows one region at a time. Not "city": a city is the real place a region covers.

**Category.** A kind of place: metro station, park, supermarket. It is defined in `categories.yaml`, listed in a region's file, and shown as a row in the panel, where it is ticked and given a time budget. The pins are a category too. Not "layer", which is Leaflet's word for something drawn on the map.

**Local name.** What one region calls a category, shown after its name in the panel, in brackets: S-Bahn for train in Berlin, Tube & DLR for metro in London. The category's own name comes from the library and is the same in every region, like its colour. Code: `local_name`, set in a region's file.

**Place.** One thing a category is made of, from OpenStreetMap: a station, a supermarket, a park. Code: `Place` in the fetch step, and `PlaceFeature` once it is GeoJSON in `places.geojson`. Not "POI", because a lake is not a point of interest. Not "location", and not "feature", which is GeoJSON's word for the object a place is stored as.

**Point and area.** The two shapes a place can have, set by a category's `geometry`. A point is a station or a shop. An area is a park, a body of water, or a strip of river or coast. "Area" as a size is written with its unit (`min_area_m2`, "5 ha"), and is never a reach or the overlap.

**Marker.** The dot a point or a pin is drawn as. An area is drawn as its outline.

**Thumbnail.** A region drawn small on the home screen. Its water and parks are shapes, which give a city its outline, and its supermarkets are dots, which show where people live. Code: `thumbnail.json`, written with the region's data.

**Pin.** A point the visitor drops on the map and may name. Pins are markers until *Use as a category* is ticked, which makes them a category with its own time budget.

## The criteria

**Time budget.** How long a visitor will travel to a category: minutes and a mode.

**Mode.** `walk` or `bike`. "Cycling" is fine as a verb, but the mode is `bike`.

**Detour factor.** How much of the distance travelled along streets counts in a straight line. At 0.75, 15 minutes' walk is 1.2 km of pavement and 900 m from the start. Code: `DETOUR_FACTOR`. It is disclosed in the panel under *More* and is not adjustable.

**Radius.** A time budget as a straight-line distance: speed × minutes × detour factor. Shown in the panel in metres.

**Criteria.** What the overlap depends on: which categories are ticked, their time budgets, and where the pins are. Always plural: each ticked category is one of them, and so are the pins once ticked. A change to the criteria also estimates the overlap's size again, and any other change only redraws. Not "question", which stays plain English, and not "query", which is for Overpass.

## Reach and overlap

**Reach.** The ground within a category's radius of any of its places: a circle round each point and a buffer round each area, together. Code: `CategoryReach` is what a reach is drawn from, and `fillReach()` draws it. Not "coverage", which is a share of it, and not "blob".

**Overlap.** The ground within reach of every ticked category: the part of the map left clear. It is drawn once two categories are ticked. With one, it is that category's reach. Code: `OverlapPainter` draws it, on the map through `OverlapLayer`, and `estimateOverlap()` measures it. Not "answer": it says where to look, and the visitor judges whether a place there suits them. Not "result", "intersection" or "coverage area" either: intersecting is how the overlap is drawn, not what it is called.

**Coverage.** How much of a region a reach covers, as a share: park covers 15% of Munich at a 15 minute walk. It is a measurement used in choosing categories ([`data.md`](data.md#choosing-a-category)). The ground itself is the reach.

**Dim and tint.** How the overlap is drawn. Everything outside it is dimmed, and each reach is tinted in its category's colour, with the overlap cut out of the tint.

## Settings

**Settings.** What a visitor has chosen. For a region: the categories ticked and their time budgets, the pins and their time budget, and what is shown. For every region at once: the basemap. They are remembered in the browser. *Reset*, beside the categories' heading, returns a region's categories, the pins' time budget and what is shown to the defaults, and keeps the pins and the basemap. Code: `SavedState`. `AppState` is a region's settings plus what is never saved.

**Shared link.** A link that carries a region's settings after the `#`, except the basemap. It is read-only until *Save and edit this*.

**Basemap and overlay.** The basemap is the map underneath, from OpenFreeMap. The overlay is everything drawn over it: the reaches, the overlap, the places and the pins. Overlay is a term for the docs and the code. The page never shows it, so it cannot be confused with the overlap.

**Theme.** Light or dark, and a property of the basemap: Light and Colour are light, Dark grey and Dark are dark. The overlay's palette, the panel and the home screen all follow it, so choosing a theme is choosing a basemap. The sun and moon switch swaps a basemap for its partner in the other theme. Code: `ThemeName`, and `data-theme` on the page's root.

## The data

**Query.** The Overpass selection a category is fetched with, from the library or a region's own file.

**Body and piece.** OSM cuts a lake or a park into polygons at bridges and boundaries. Each polygon is a piece. Pieces sharing a vertex are one body, and the area cut judges the body.

**Cut.** The size below which an area category drops a body, `min_area_m2`, lower for a body with a name (`named_min_area_m2`).

**Strip.** A line widened into an area: a river's centre line or a coastline, `line_width_m` wide.

**Dedupe.** Merging points closer than `dedupe_m` into one place, which turns a station's platforms into one station.
