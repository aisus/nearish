# Design

How the page looks and behaves, and the reasons that are not obvious from using it. The code is described in [`architecture.md`](architecture.md), and the numbers are in `src/lib/tuning.ts`, each beside its measurement.

## The overlap is the part left clear

Everything outside the overlap is dimmed, each category's reach is tinted in its colour with the overlap cut out, and only the overlap is outlined, in white. The streets inside the overlap stay as the basemap draws them, because a fill over the overlap washed them out. Dimmed, four tints mix to a muted shade rather than to mud. Zoomed out to the region there are no streets to wash out, and an overlap is mostly pieces a few pixels across. So up to zoom 11 it takes a faint fill on the dark basemaps, which makes the pieces read as patches rather than specks. Every part is a setting in `DRAWING`. The icon is the same drawing of real ground: 1.75 km of the home screen's Berlin, the overlap of its supermarkets and water, with the water and parks thickened to read in a tab.

**Categories are intersected, never unioned.** A union across categories was built and removed, because with one dense category ticked it only answers "are you in Munich". Restoring it would be one compositing operation in `overlap.ts`.

**Places are small, and drawn at every zoom.** A marker grows with the zoom, from 1 px at zoom 10 to 5 px at 15. A region opens at zoom 10-11 on a desktop and 9-10 on a phone, and at those zooms the places must not hide the overlap. No category of Paris covers more than 14% of the busiest 240 px of a desktop map at any zoom, where 3 px markers covered 49%. Zoomed out, the dots show where a category is dense, which its tint does not. Parks and water are a half-pixel outline over a faint fill. A small marker responds to the pointer through an invisible outline wider than itself. Markers are restyled once per zoom step rather than rebuilt: 14-29 ms for Berlin's 3300 with every category ticked.

**A name shows on hover, and a click keeps it**, for places and pins alike. One label is kept at a time, until a click elsewhere or Esc. A tap is the only way a phone shows one. A second click does not remove it: as a toggle, it left a pin picked out with no name beside it. A hover label shows only under the pointer, and not at all while a zoom animates. Otherwise Leaflet opens a label hovered mid-drag when the drag ends, wherever the pointer is by then, and places a label opened mid-zoom using the previous view.

## Theme and basemaps

**The theme is a property of the basemap.** Light and Colour are light, Dark grey and Dark are dark, and the overlay's palette, the panel and the home screen all follow it. On a light panel the thirteen swatches measure 4.7-9.4:1, where a light basemap's palette on a dark panel measured as low as 1.8:1. One sun and moon button switches the theme on both screens by swapping the basemap for its partner in the other theme (`THEME_PARTNERS`). The pairs are Dark grey and Light, which are one style recoloured, and Dark and Colour, so switching back returns to the same basemap. Within a theme, the map offers that theme's two basemaps side by side. A separate theme setting could contradict the basemap.

**Light and Dark grey are the defaults**, one quiet style made for an overlay. Colour has more detail than the overlay needs and Dark's contrast loses some, so they are options for a visitor rather than how the tool is shown. The home screen draws in the theme's default, whichever basemap is chosen. With nothing stored, the system's light or dark preference picks the theme.

**Dark grey is Positron darkened**, to colours sampled from Esri's World Dark Gray Base. Positron outlines every town at every zoom, where Dark Matter's built-up areas are nearly invisible by design. Positron's `park` layer is protected land, conservation areas and drinking-water zones, so it is hidden, and city parks are drawn from landcover instead. The labels are Light's, recoloured, so the basemaps agree.

**One typeface, bundled**: Fira Sans, from `@fontsource/fira-sans`, about 24 kB a weight for Latin. It is readable at the panel's 12 px, has tabular figures for counts and radii, and covers Cyrillic and Greek for pin names. `system-ui` is a different face on every system, and Google Fonts would be a third party, beside OpenFreeMap, that sees every visit.

## The home screen

The animation fills the window's width across the top, and the title and introduction sit just below where it fades out. The regions' grid takes at most seven across, in rows as even as the count allows, so that nineteen regions fit a 2560x1300 window. The sun and moon sits exactly where the map screen's bar has it, on a chip of the panel's surface so that it stays readable over the animation. Going between the screens moves nothing.

**The animation is 12 km of central Berlin**, shown at 2.7x across a desktop and at no less than 1.4x on a phone. At 7 km it was blown up into a few flat shapes, and at 14 km it was busy, with every patch outlined. It is painted with the map's own `OverlapPainter`, with the ground and the places drawn once. Where a browser draws canvas in software, painting blocks the page's own thread, 45 ms a frame at phone size in headless Chromium. If such a device turns up, the answer is a lower resolution there. It is drawn only as tall as the fade leaves it in view.

**The fade is an arc, placed from the text.** The page's colour rises on the left behind the left-aligned text, and the map keeps the top and the right. Its stops follow Andreas Larsen's scrim curve, steep from solid with a long faint tail, which leaves no visible edge. It is solid 20 px above the title's letters at any window height. Placed from the window's height instead, it let the text slide through it, so each word had a different backing. On a phone the blurb fills the width and the fade is flat, solid before the blurb. The screen is sized in `svh`, not `dvh`, because `dvh` changes when a phone's toolbar hides at the end of a fling, which made the animation jump.

## The panel

- **A category's checkbox is its swatch.** There is one mark per row, outlined in its colour while unticked, so the panel still works as a legend. The slider is filled in that colour up to the thumb, and the thumb is that colour too, with a ring in the panel's colour. It stays a native checkbox, restyled, so the keyboard and screen readers handle it like any other.
- **A ticked row shows its time budget**: the minutes on the name's line, the slider at the row's full width, and the mode and the metres under it. The count of places is the row's tooltip, because nothing on the map depends on it, and on the row it looked like one column with the radius.
- **Time budgets are per category**, because "10 minutes from transit, 20 from a skatepark" is the realistic question. Every category still starts at a 15 minute walk, because mixed defaults opened the map answering something a newcomer had not asked.
- **The detour factor is stated, not adjustable.** It is the largest source of error, so it is disclosed, under *More* at the foot of the panel with the speeds. A control over a figure that is uncertain by a quarter would imply a precision the model does not have.
- **The overlap's size is on the *Overlap* row under *Show***, beside the toggle for what it measures. It is an estimate nobody acts on, and the map already says when there is no overlap.
- ***Reset* and *Clear all* are words on their sections' headings**. They show only while there is something to undo, so a fresh panel shows neither. They are out of the flow, so nothing moves when they appear. *Reset* returns the categories, the pins' time budget and what is shown to the region's defaults. It keeps the pins, which *Clear all* removes, and the basemap.
- ***Copy link* is in the header**, because it shares the whole map, and apart from the basemap and the theme, which a link does not carry. Its tooltip says the pins go with the link, since a pin is often someone's home. Copying then says only "Link copied".

## Pins

- **A pin is a marker until *Use as a category* is ticked**, which starts unticked, so a pin does not drop a circle of reach by default. *Use as a category* is a row of its own under the list rather than a coloured box, which everywhere else means "in the overlap". Whether pins are drawn is a toggle under *Show*, on by default. *+ Add pin* turns it back on, otherwise a dropped pin would seem to vanish.
- **One pin per *+ Add pin*.** A click on the map drops one, ends placing and puts the cursor in its name. The instruction and *Cancel* are on the map, and Esc also cancels. A mode that kept dropping pins had its exit in the panel while the eye was on the map, and left rows to be matched to dots afterwards. The button sits under the list, so the new row appears where it was pressed.
- **A pin is named and removed in the panel. A click on the map only selects it**, which draws it larger and opens the list at its row. A popup would be a second place to edit the same pin. A name is only a label: a time budget per pin would make each pin its own category. An unnamed pin is "Pin", with no number, because ids are renumbered on reload.
- **The list is always shown.** Each row is marked by a small grey dot in the checkboxes' column, which takes the pins' colour only while that pin is selected.

## Links

**A shared link is read-only until it is saved.** Opening one shows its settings without saving them, and the panel cannot change them until *Save and edit this* makes them the visitor's own. A visitor with settings of their own is also offered *Revert to my settings*. The alternatives are all worse. Replacing a visitor's settings on open would delete their pins for clicking a link. Saving on the first change would delete them at a moment nothing marks. Editing without saving leaves a screen that matches neither the link nor storage, and a reload discards it. To try a change without giving up your own settings, use a private window. A click on the read-only panel pulses the notice on the map, which says why nothing changed. A line at the top of the panel would show that to every visitor of a link.

**On a touch screen *Copy link* opens the system's share sheet**, which includes copying, because on a phone a link is sent through an app. Where copying fails, without a secure context, the notice says so.

## On a phone

**The panel is a sheet over the foot of the map.** Closed, it is a bar showing the ticked categories' colours and the overlap's size. A tap opens it over the lower 55%, and the map shifts up by half that, so what was in view stays in view while a slider moves. A panel behind a button would cover the map while it is used. A notice that the tool is built for a desktop would make a link opened on a phone, the usual way a link is opened, a dead end. It opens and closes on a tap rather than being dragged to a height. In the header, *Copy link* is an icon and the wordmark is replaced by a back arrow. A dropped pin's name field takes no focus on a touch screen, and the pin is named by tapping its row.

**The map's credit folds to an (i)** on the first pan, zoom or tap, or after five seconds, and a tap on the (i) opens it again, as the [OSMF attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) allow. Unfolded, it is a full-width strip of 10 px text over the foot of the map. A desktop has room for it, so there it stays open.

## Left out on purpose

- **"Locate me"**: the browser's geolocation needs no third party, but its permission prompt is a lot to ask of a hobby site, and a position outside the region would need its own handling. A pin can mark home just as well.
- **Address search**: Nominatim's usage policy forbids autocomplete.
- **A view in the link**: a link opens on the whole region, as a reload does. A centre and zoom would have to be honoured by every link from then on.
