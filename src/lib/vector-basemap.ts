/**
 * MapLibre, which draws the vector basemaps. Imported on demand: it is most
 * of the bundle (290 kB gzipped against the app's 85), and the panel and the
 * region's data need not wait for it.
 */

import L from "leaflet";
import "@maplibre/maplibre-gl-leaflet";
import {
  setWorkerUrl,
  type Map as MaplibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

import { applyOverrides, type StyleOverrides } from "./vector-styles";

// MapLibre finds its worker relative to its own module, which a bundler moves.
setWorkerUrl(workerUrl);

const EMPTY_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] };

/** What the override below touches of the plugin (0.1.4), none of it typed. */
interface PluginLayer {
  _map: (L.Map & { _animatingZoom?: boolean }) | null;
  _glMap: MaplibreMap & { _actualCanvas: HTMLElement };
  _resizeContainer(): void;
  _zoomEnd(): void;
  _transitionEnd(): void;
}

/*
 * The plugin settles its canvas a frame after a zoom animation ends. When the
 * next zoom has begun by then, as wheel and pinch zooms chain, that reset the
 * canvas to the unscaled view mid-animation: 60 times in a one-second pinch,
 * seen as the basemap flashing. The plugin's own code, but for the guard: the
 * zoom that is animating settles the canvas when it ends.
 */
(L.MaplibreGL.prototype as unknown as PluginLayer)._transitionEnd = function (
  this: PluginLayer,
) {
  L.Util.requestAnimFrame(() => {
    const map = this._map;
    if (!map || map._animatingZoom) return;
    const center = map.getCenter();
    const offset = map.latLngToContainerPoint(map.getBounds().getNorthWest());
    this._resizeContainer();
    L.DomUtil.setTransform(this._glMap._actualCanvas, offset, 1);
    this._glMap.once("moveend", () => this._zoomEnd());
    this._glMap.jumpTo({ center, zoom: map.getZoom() - 1 });
  });
};

export function createVectorLayer(
  styleUrl: string,
  overrides: StyleOverrides,
  attribution: string,
): L.Layer {
  // Given as the layer's own, so Leaflet drops it with the layer.
  const layer = L.maplibreGL({
    style: EMPTY_STYLE,
    attributionControl: { customAttribution: attribution },
    // The last frame stays readable, for the cover below to copy.
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  // The style is only changed on its way in: the copy on disk stays upstream's.
  layer.on("add", () => {
    layer.getMaplibreMap().setStyle(styleUrl, {
      transformStyle: (_, next) => applyOverrides(next, overrides),
    });
  });
  coverUntilLoaded(layer);
  return layer;
}

/*
 * Leaflet zooms by stretching the last frame, and MapLibre loads the new
 * zoom's tiles only once that ends, drawing coarser cached tiles until they
 * arrive: Berlin from 10.75 to 12 drew 12 missing tiles' worth for 370 ms,
 * seen as a flash of another zoom. The stretched frame is copied over the
 * canvas when the zoom ends and kept until the tiles are in.
 */
function coverUntilLoaded(layer: L.MaplibreGL): void {
  const cover = document.createElement("canvas");
  cover.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;display:none";
  // The stretch a zoom animates to, and where the canvas's box stood before it.
  let stretched: { matrix: DOMMatrixReadOnly; left: number; top: number } | null = null;
  let map: L.Map | null = null;

  const hide = (): void => {
    cover.style.display = "none";
  };
  // These run after the plugin's own handlers, which set the stretch and then undo it.
  const onZoomAnim = (): void => {
    const canvas = layer.getCanvas();
    const box = canvas.parentElement?.getBoundingClientRect();
    if (!box) return;
    stretched = {
      matrix: new DOMMatrixReadOnly(canvas.style.transform),
      left: box.left,
      top: box.top,
    };
  };
  const onZoomEnd = (): void => {
    const canvas = layer.getCanvas();
    const box = canvas.parentElement?.getBoundingClientRect();
    const context = cover.getContext("2d");
    if (!stretched || !box || !context) return;
    if (cover.parentElement !== canvas.parentElement) canvas.after(cover);
    cover.width = canvas.width;
    cover.height = canvas.height;
    cover.style.width = canvas.style.width;
    cover.style.height = canvas.style.height;
    // The stretch is in CSS pixels, and the box moved when the zoom ended;
    // the canvas has devicePixelRatio pixels to each CSS one.
    const ratio = canvas.width / canvas.clientWidth;
    const { a: scale, e, f } = stretched.matrix;
    const x = e + stretched.left - box.left;
    const y = f + stretched.top - box.top;
    context.setTransform(scale, 0, 0, scale, x * ratio, y * ratio);
    context.drawImage(canvas, 0, 0);
    cover.style.display = "";
    stretched = null;
  };
  const onRender = (): void => {
    if (cover.style.display !== "none" && layer.getMaplibreMap().areTilesLoaded()) hide();
  };

  layer.on("add", () => {
    // Leaflet clears the layer's map before it fires "remove".
    map = (layer as unknown as PluginLayer)._map;
    map?.on({ zoomanim: onZoomAnim, zoomend: onZoomEnd, movestart: hide });
    layer.getMaplibreMap().on("render", onRender);
  });
  layer.on("remove", () => {
    map?.off({ zoomanim: onZoomAnim, zoomend: onZoomEnd, movestart: hide });
    map = null;
    cover.remove();
  });
}
