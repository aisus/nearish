# Basemap styles

Copies of three of [OpenFreeMap](https://openfreemap.org)'s styles, taken on 2026-10-25 from `https://tiles.openfreemap.org/styles/<name>` and re-indented, otherwise unedited:

- `positron.json`, which *Dark grey* and *Light* are drawn from;
- `dark.json`, for *Dark*;
- `bright.json`, for *Colour*.

They are copies so that a change upstream cannot change how the map looks. What this project changes is in `src/lib/vector-styles.ts`, applied as a style loads, not here: replace a file with a newer upstream copy and the overrides still apply, and the console warns about any layer they name that the new copy lacks. The tiles, fonts and icons the styles point to are still served by OpenFreeMap.

## Licences

From [openfreemap-styles](https://github.com/hyperknot/openfreemap-styles), MIT. Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL.

- **Positron** is a fork of [positron-gl-style](https://github.com/openmaptiles/positron-gl-style), derived from CartoDB Basemaps, designed by Stamen and Paul Norman for CartoDB Inc. Code under BSD 3-Clause, design under CC BY 4.0.
- **Dark** is a fork of OpenMapTiles' Dark Matter, under the same terms.
- **Bright** is a fork of [osm-bright-gl-style](https://github.com/openmaptiles/osm-bright-gl-style), derived from Mapbox Open Styles. Code under BSD 3-Clause, design under CC BY 4.0.
- The [OpenMapTiles](https://github.com/openmaptiles/openmaptiles) schema the tiles follow: code under BSD 3-Clause, design under CC BY 4.0.

The credit CC BY asks for is on the map: "OpenFreeMap © OpenMapTiles", beside the OpenStreetMap credit.
