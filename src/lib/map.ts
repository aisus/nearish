/**
 * Leaflet, kept imperative: no Vue in here. `MapScreen.vue` drives one from watchers.
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { BASEMAP_ATTRIBUTION, BASEMAPS, overlayTheme, type BasemapKey } from "./basemaps";
import type { CategoryReach, OverlapStyle } from "./overlap";
import { OverlapLayer } from "./overlap-layer";
import { OSM_COPYRIGHT_URL } from "./links";
import { PHONE, matches } from "./media";
import { pinLabel, type Pin } from "./state";
import {
  ATTRIBUTION_SHOWN_MS,
  DRAWING,
  PATH_PADDING,
  REVEAL_PADDING_PX,
  ZOOM_SNAP,
  interpolate,
} from "./tuning";
import type { Bbox, PlaceFeature } from "../types";

/** The overlay is OpenStreetMap data, and ODbL wants it credited on every basemap. */
const DATA_ATTRIBUTION = `&copy; <a href="${OSM_COPYRIGHT_URL}">OpenStreetMap</a> contributors`;

/**
 * One pane per kind of overlay, stacked between Leaflet's `overlayPane` (400) and `shadowPane` (500).
 */
const PANES = {
  bbox: 405,
  reaches: 410,
  // Below points: an area's hit target is its whole interior, and would
  // otherwise take the hover from every point inside it.
  areas: 425,
  points: 430,
  // Above areas and points, so the dim covers places outside the overlap too.
  overlap: 435,
  pins: 440,
} as const;

/** Leaflet's renderers for the panes drawn as SVG: one set per map. */
type PaneRenderers = Record<"bbox" | "areas" | "points" | "pins", L.Renderer>;

/**
 * Leaflet builds a pane's renderer with its default 10% padding, which a
 * drag uses up in moments; these take `PATH_PADDING`.
 */
function paneRenderers(): PaneRenderers {
  const svg = (pane: string) => L.svg({ pane, padding: PATH_PADDING });
  return {
    bbox: svg("bbox"),
    areas: svg("areas"),
    points: svg("points"),
    pins: svg("pins"),
  };
}

/** The map's only way of talking back: plain callbacks, so Vue stays out. */
export interface MapHandlers {
  onMapClick(lat: number, lon: number): void;
  onPinClick(id: number): void;
}

/** Bbox order is Overpass's; Leaflet wants two corners. */
function bounds([south, west, north, east]: Bbox): L.LatLngBoundsExpression {
  return [
    [south, west],
    [north, east],
  ];
}

/** Where the data ends. */
function bboxEdge([south, west, north, east]: Bbox, renderer: L.Renderer): L.Polygon {
  const ring: L.LatLngTuple[] = [
    [south, west],
    [north, west],
    [north, east],
    [south, east],
  ];
  return L.polygon(ring, {
    pane: "bbox",
    renderer,
    interactive: false,
    fill: false,
    color: "#888",
    weight: DRAWING.bboxOutline,
    opacity: DRAWING.bboxOutlineOpacity,
    dashArray: DRAWING.bboxOutlineDash,
  });
}

function textNode(text: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

/** A kept label's hover options, restored when it is released. */
const hoverOptions = new WeakMap<L.Layer, L.TooltipOptions>();

/**
 * Rebinds a layer's label as permanent or as a hover label. Leaflet closes a
 * hover label on mouseout and fixes `permanent` at binding, so a kept label
 * is a new binding. It is never sticky: it stays where it was clicked.
 */
function rebindTooltip(layer: L.Layer, permanent: boolean): void {
  const tooltip = layer.getTooltip()!;
  const content = tooltip.getContent()!;
  if (permanent) hoverOptions.set(layer, tooltip.options);
  const options = permanent
    ? { ...tooltip.options, permanent, sticky: false }
    : hoverOptions.get(layer);
  layer.unbindTooltip().bindTooltip(content, options);
}

/** A marker's size, fill and pointer target at a zoom. */
function markerStyle(zoom: number): L.CircleMarkerOptions {
  const radius = interpolate(DRAWING.markerRadius, zoom);
  return {
    radius,
    // An invisible outline is what the pointer finds.
    weight: 2 * Math.max(0, DRAWING.markerHitRadius - radius),
    opacity: 0,
    fillOpacity: interpolate(DRAWING.markerFill, zoom),
  };
}

function placeLayer(
  place: PlaceFeature,
  color: string,
  style: L.CircleMarkerOptions,
  renderers: PaneRenderers,
): L.Layer {
  if (place.geometry.type === "Point") {
    const [lon, lat] = place.geometry.coordinates;
    return L.circleMarker([lat, lon], {
      pane: "points",
      renderer: renderers.points,
      color,
      ...style,
    });
  }

  // The shape is drawn; the copy over it is what the pointer finds. The
  // renderer rides in the style, which every polygon takes before it is
  // added: Leaflet's types leave it out of the GeoJSON options.
  const renderer = renderers.areas;
  return L.featureGroup([
    L.geoJSON(place, {
      pane: "areas",
      interactive: false,
      style: {
        renderer,
        color,
        weight: DRAWING.areaOutline,
        opacity: DRAWING.areaOutlineOpacity,
        fillOpacity: DRAWING.areaFill,
      },
    }),
    L.geoJSON(place, {
      pane: "areas",
      style: {
        renderer,
        color,
        weight: DRAWING.areaHitWidth,
        opacity: 0,
        fill: true,
        fillOpacity: 0,
      },
    }),
  ]);
}

export class MapView {
  private readonly map: L.Map;
  private readonly placeGroup: L.LayerGroup;
  private readonly pinGroup: L.LayerGroup;
  private readonly handlers: MapHandlers;
  /** The one label a click keeps open; hovering shows the others' meanwhile. */
  private keptLabel: L.Layer | null = null;
  /** The one hover label open; a second closes it, and so does a zoom. */
  private hoverLabel: L.Tooltip | null = null;
  private zooming = false;
  private placing = false;
  /**
   * Pins by id, restyled in place. Rebuilt between a press and its release,
   * a pin never receives the click.
   */
  private readonly pinMarkers = new Map<
    number,
    { marker: L.CircleMarker; label: string }
  >();

  private basemapLayer: L.Layer | null = null;
  private basemapKey: BasemapKey;
  /** Bumped per basemap shown, so that a slow MapLibre load cannot land over a later choice. */
  private basemapRequest = 0;
  private drawnPlaces: {
    places: PlaceFeature[];
    colors: Record<string, string>;
    labels: Record<string, string>;
  } | null = null;
  /** What the markers are drawn with, so a zoom that changes nothing restyles nothing. */
  private drawnMarkerStyle: L.CircleMarkerOptions | null = null;
  /** The reaches and the overlap, drawn on canvases of their own. */
  private readonly overlap = new OverlapLayer();
  private readonly renderers = paneRenderers();
  private attributionTimer: number | undefined;
  /**
   * Leaflet focuses the map on every press, and Chrome rings it when the
   * window returns by Alt+Tab, a keypress; Tab finds it again.
   */
  private readonly dropFocus = (): void => {
    const container = this.map.getContainer();
    if (document.activeElement === container) container.blur();
  };

  constructor(
    element: HTMLElement,
    bbox: Bbox,
    basemap: BasemapKey,
    handlers: MapHandlers,
  ) {
    // Framed by the bbox, never a stored view: it is exactly the ground the data covers.
    this.map = L.map(element, { zoomSnap: ZOOM_SNAP, zoomDelta: 1 }).fitBounds(
      bounds(bbox),
    );
    this.map.attributionControl.addAttribution(DATA_ATTRIBUTION);
    // Leaflet's own credit, optional under its licence, would wrap the line on a phone.
    if (matches(PHONE)) {
      this.map.attributionControl.setPrefix(false);
      this.collapseAttribution();
    }
    this.handlers = handlers;

    for (const [name, zIndex] of Object.entries(PANES)) {
      this.map.createPane(name).style.zIndex = String(zIndex);
    }

    this.basemapKey = basemap;
    this.showBasemap(basemap);
    bboxEdge(bbox, this.renderers.bbox).addTo(this.map);

    // Groups clear as a unit; stacking order is the panes' job.
    this.overlap.addTo(this.map);
    this.placeGroup = L.layerGroup().addTo(this.map);
    this.pinGroup = L.layerGroup().addTo(this.map);

    // Leaflet does not fire this for drags, so panning cannot drop a pin.
    this.map.on("click", (event: L.LeafletMouseEvent) => {
      // A place's click reaches the map too, after keeping its own label.
      const target = event.originalEvent.target;
      if (!(
        target instanceof Element && target.classList.contains("leaflet-interactive")
      )) {
        this.releaseLabel();
      }
      handlers.onMapClick(event.latlng.lat, event.latlng.lng);
    });
    window.addEventListener("blur", this.dropFocus);
    this.map.on("tooltipopen", ({ tooltip }: L.TooltipEvent) =>
      this.onLabelOpen(tooltip),
    );
    this.map.on("zoomstart", () => {
      this.zooming = true;
      this.hoverLabel?.close();
    });
    this.map.on("zoomend", () => {
      this.zooming = false;
      this.followZoom();
    });
    this.followZoom();
  }

  destroy(): void {
    window.removeEventListener("blur", this.dropFocus);
    window.clearTimeout(this.attributionTimer);
    this.basemapRequest++;
    this.map.remove();
  }

  /**
   * A full-width strip over a phone's map, so it folds to an (i) on the
   * first pan, zoom or tap, or after five seconds, and a tap on it opens it
   * again: what the OSMF attribution guidelines allow
   * (osmfoundation.org/wiki/Licence/Attribution_Guidelines).
   */
  private collapseAttribution(): void {
    const box = this.map.attributionControl.getContainer();
    if (!box) return;
    const collapse = (): void => box.classList.add("collapsed");
    this.attributionTimer = window.setTimeout(collapse, ATTRIBUTION_SHOWN_MS);
    this.map.on("movestart zoomstart click", collapse);
    const expand = (event: Event): void => {
      if (!box.classList.contains("collapsed")) return;
      event.preventDefault();
      box.classList.remove("collapsed");
    };
    // Capture, so that a tap on the folded credit opens it rather than a link.
    box.addEventListener("click", expand, true);
    box.addEventListener("focusin", expand);
  }

  setBasemap(key: BasemapKey): void {
    if (key === this.basemapKey) return;
    this.basemapKey = key;
    this.showBasemap(key);
    this.showHalo(this.map.getZoom());
  }

  /** The previous basemap stays until the next is ready, so the map is never blank. */
  private showBasemap(key: BasemapKey): void {
    const request = ++this.basemapRequest;
    const { style, overrides } = BASEMAPS[key];
    const styleUrl = `${import.meta.env.BASE_URL}styles/${style}.json`;
    void import("./vector-basemap").then(({ createVectorLayer }) => {
      if (request !== this.basemapRequest) return;
      if (this.basemapLayer) this.map.removeLayer(this.basemapLayer);
      this.basemapLayer = createVectorLayer(
        styleUrl,
        overrides,
        BASEMAP_ATTRIBUTION,
      ).addTo(this.map);
    });
  }

  /** Each ticked category's reach, and the overlap where all of them meet. */
  setOverlap(reaches: CategoryReach[], style: OverlapStyle): void {
    this.overlap.set(reaches, style);
  }

  /** Skips the rebuild when called with the same references. */
  setPlaces(
    places: PlaceFeature[],
    colors: Record<string, string>,
    labels: Record<string, string>,
  ): void {
    const drawn = this.drawnPlaces;
    if (drawn?.places === places && drawn.colors === colors && drawn.labels === labels) {
      return;
    }
    this.drawnPlaces = { places, colors, labels };
    if (this.keptLabel && this.placeGroup.hasLayer(this.keptLabel)) this.keptLabel = null;
    this.drawnMarkerStyle = markerStyle(this.map.getZoom());
    this.placeGroup.clearLayers();
    for (const place of places) {
      const { cat, name } = place.properties;
      const layer = placeLayer(place, colors[cat], this.drawnMarkerStyle, this.renderers);
      // Sticky for areas: a park's centre can be off screen while it is hovered.
      layer
        .bindTooltip(textNode(name ? `${labels[cat]} - ${name}` : labels[cat]), {
          sticky: place.geometry.type !== "Point",
        })
        .on("click", (event: L.LeafletMouseEvent) => {
          // While placing, a click on a place drops a pin there instead.
          if (!this.placing) this.keepLabel(layer, event.latlng);
        })
        .addTo(this.placeGroup);
    }
  }

  setPins(pins: Pin[], selected: number | null, color: string): void {
    const ids = new Set(pins.map((pin) => pin.id));
    for (const [id, { marker }] of this.pinMarkers) {
      if (ids.has(id)) continue;
      if (this.keptLabel === marker) this.keptLabel = null;
      marker.remove();
      this.pinMarkers.delete(id);
    }

    let selectedMarker: L.CircleMarker | undefined;
    for (const pin of pins) {
      const isSelected = pin.id === selected;
      const style = {
        radius: isSelected ? DRAWING.pinRadiusSelected : DRAWING.pinRadius,
        weight: isSelected ? DRAWING.pinOutlineSelected : DRAWING.pinOutline,
        fillColor: color,
      };
      const label = pinLabel(pin);
      let drawn = this.pinMarkers.get(pin.id);
      if (drawn) {
        // Another tab's save renumbers pins, so an id can come back elsewhere.
        drawn.marker.setLatLng([pin.lat, pin.lon]).setStyle(style);
        if (drawn.label !== label) drawn.marker.setTooltipContent(textNode(label));
        drawn.label = label;
      } else {
        const marker = L.circleMarker([pin.lat, pin.lon], {
          pane: "pins",
          renderer: this.renderers.pins,
          color: "#ffffff",
          fillOpacity: 1,
          bubblingMouseEvents: false,
          ...style,
        })
          .bindTooltip(textNode(label))
          .on("click", () => {
            this.handlers.onPinClick(pin.id);
            this.keepLabel(marker);
          })
          .addTo(this.pinGroup);
        drawn = { marker, label };
        this.pinMarkers.set(pin.id, drawn);
      }
      if (isSelected) selectedMarker = drawn.marker;
    }
    selectedMarker?.bringToFront();
  }

  /** Pan just enough to bring a point into view; no-op when it already is. */
  reveal(lat: number, lon: number): void {
    this.map.panInside([lat, lon], {
      padding: [REVEAL_PADDING_PX, REVEAL_PADDING_PX],
    });
  }

  /** Move the view by `dy` pixels, without animating: positive moves the content up. */
  shift(dy: number): void {
    this.map.panBy([0, dy], { animate: false });
  }

  /** Cursor feedback for the armed state — the map is the only affordance. */
  setPlacing(active: boolean): void {
    this.placing = active;
    this.map.getContainer().classList.toggle("placing", active);
    if (active) this.releaseLabel();
  }

  /**
   * Keeps a clicked label open until a click elsewhere or Esc. Clicking it
   * again keeps it, moved to the click on an area: a toggle left a picked
   * pin highlighted with no name beside it.
   */
  private keepLabel(layer: L.Layer, at?: L.LatLng): void {
    if (this.keptLabel === layer) {
      layer.openTooltip(at);
      return;
    }
    this.releaseLabel();
    rebindTooltip(layer, true);
    // A hover label closes on blur, and unbinding leaves that listener on the
    // element, so a press on the map to drag it would close the kept label.
    const element = layer instanceof L.Path ? layer.getElement() : undefined;
    if (element) {
      // An SVG path: Leaflet types the parameter narrower than it handles. The
      // method and its layer are the key Leaflet removes the listener by.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      L.DomEvent.off(element as HTMLElement, "blur", layer.closeTooltip, layer);
    }
    layer.openTooltip(at);
    this.keptLabel = layer;
  }

  private followZoom(): void {
    const zoom = this.map.getZoom();
    this.restyleMarkers(zoom);
    this.showHalo(zoom);
  }

  /** One CSS filter on the pane: a stroke would take the place of the pointer's target. */
  private showHalo(zoom: number): void {
    const pane = this.map.getPane("points");
    if (!pane) return;
    const color = overlayTheme(this.basemapKey).halo;
    pane.style.filter =
      zoom >= DRAWING.markerHaloMinZoom
        ? `drop-shadow(0 0 ${DRAWING.markerHalo}px ${color})`
        : "";
  }

  /** Resizes the markers to the zoom: one update each, not a rebuild. */
  private restyleMarkers(zoom: number): void {
    const style = markerStyle(zoom);
    const drawn = this.drawnMarkerStyle;
    if (
      !drawn ||
      (drawn.radius === style.radius && drawn.fillOpacity === style.fillOpacity)
    ) {
      return;
    }
    this.drawnMarkerStyle = style;
    this.placeGroup.eachLayer((layer) => {
      if (layer instanceof L.CircleMarker) layer.setStyle(style);
    });
  }

  /**
   * A hover label opens only under the pointer, one at a time. Opened while a
   * zoom animated, one was placed by the view before it and moved when it
   * ended. Leaflet opens a label hovered mid-drag when the drag ends, after
   * its mouseout has passed, which left it open with the pointer elsewhere.
   */
  private onLabelOpen(tooltip: L.Tooltip): void {
    if (tooltip.options.permanent) return;
    const source = (tooltip as unknown as { _source?: L.Layer })._source;
    const element = source instanceof L.Path ? source.getElement() : undefined;
    if (this.zooming || (element && !element.matches(":hover"))) {
      tooltip.close();
      return;
    }
    if (this.hoverLabel !== tooltip) this.hoverLabel?.close();
    this.hoverLabel = tooltip;
  }

  /** The kept label goes back to showing on hover only. */
  releaseLabel(): void {
    const layer = this.keptLabel;
    this.keptLabel = null;
    if (layer) rebindTooltip(layer, false);
  }
}
