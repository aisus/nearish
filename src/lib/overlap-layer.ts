import L from "leaflet";

import { OverlapPainter, type CategoryReach, type OverlapStyle } from "./overlap";
import { OVERLAP_MAX_DPR, OVERLAP_PADDING, OVERLAP_PAN_REDRAW_MS } from "./tuning";

/**
 * The reaches and the overlap over the map, redrawn after every pan and
 * zoom as Leaflet's own renderer is, and during a pan where a redraw is
 * cheap, and scaled with CSS while a zoom animates. The tints sit below
 * the places and the dim above, in the panes the map gives them.
 */
export class OverlapLayer extends L.Layer {
  private readonly painter = new OverlapPainter();

  /** Set by `onAdd`, which `MapView` calls before anything else here runs. */
  private map!: L.Map;
  private reaches: CategoryReach[] = [];
  private style: OverlapStyle | null = null;

  /** The view the canvases were last drawn for, as Leaflet's own renderer keeps it. */
  private topLeft = L.point(0, 0);
  private center = L.latLng(0, 0);
  private zoom = 0;
  private dpr = 1;
  /** How long the last redraw took on the main thread, ms. */
  private drawMs = Infinity;
  /** A redraw asked for mid-pan, at most one a frame. */
  private panRedraw = 0;

  constructor() {
    super();
    for (const canvas of this.canvases()) {
      canvas.className = "leaflet-zoom-animated";
      canvas.style.position = "absolute";
      canvas.style.pointerEvents = "none";
    }
  }

  /** The two the map shows. */
  private canvases(): HTMLCanvasElement[] {
    return [this.painter.tint, this.painter.dim];
  }

  set(reaches: CategoryReach[], style: OverlapStyle): void {
    this.reaches = reaches;
    this.style = style;
    this.draw();
  }

  onAdd(map: L.Map): this {
    this.map = map;
    map.getPane("reaches")?.appendChild(this.painter.tint);
    map.getPane("overlap")?.appendChild(this.painter.dim);
    this.fitToView();
    return this;
  }

  onRemove(): this {
    cancelAnimationFrame(this.panRedraw);
    for (const canvas of this.canvases()) canvas.remove();
    return this;
  }

  getEvents(): Record<string, L.LeafletEventHandlerFn> {
    return {
      viewreset: this.fitToView,
      move: this.followPan,
      moveend: this.fitToView,
      resize: this.fitToView,
      zoom: this.followZoom,
      zoomanim: this.followAnimatedZoom,
    };
  }

  /** Sizes the canvases to the view and its padding, and draws them. */
  private readonly fitToView = (): void => {
    const map = this.map;
    const size = map.getSize();
    this.topLeft = map
      .containerPointToLayerPoint(size.multiplyBy(-OVERLAP_PADDING))
      .round();
    this.center = map.getCenter();
    this.zoom = map.getZoom();

    const css = size.multiplyBy(1 + 2 * OVERLAP_PADDING).round();
    this.dpr = Math.min(window.devicePixelRatio, OVERLAP_MAX_DPR);
    this.painter.resize(Math.round(css.x * this.dpr), Math.round(css.y * this.dpr));
    for (const canvas of this.canvases()) {
      canvas.style.width = `${css.x}px`;
      canvas.style.height = `${css.y}px`;
    }
    this.draw();
    this.transform(this.center, this.zoom);
  };

  /**
   * Redraws mid-pan once the view nears the drawn edge, so that a drag
   * does not reach it; never mid-zoom, which scales the last drawing.
   */
  private readonly followPan = (): void => {
    const map = this.map;
    if (this.panRedraw || this.drawMs > OVERLAP_PAN_REDRAW_MS) return;
    if (map.getZoom() !== this.zoom) return;
    const size = map.getSize();
    const view = map.containerPointToLayerPoint([0, 0]).subtract(this.topLeft);
    const drawn = size.multiplyBy(1 + 2 * OVERLAP_PADDING);
    const margin = Math.min(
      view.x,
      view.y,
      drawn.x - view.x - size.x,
      drawn.y - view.y - size.y,
    );
    if (margin > (Math.min(size.x, size.y) * OVERLAP_PADDING) / 2) return;
    this.panRedraw = requestAnimationFrame(() => {
      this.panRedraw = 0;
      this.fitToView();
    });
  };

  private readonly followZoom = (): void => {
    this.transform(this.map.getCenter(), this.map.getZoom());
  };

  private readonly followAnimatedZoom = (event: L.LeafletEvent): void => {
    const { center, zoom } = event as L.ZoomAnimEvent;
    this.transform(center, zoom);
  };

  /**
   * Leaflet's own renderer's transform: the drawn view scaled into the one
   * coming. `_getNewPixelOrigin` is private to Leaflet, as the renderer uses it.
   */
  private transform(center: L.LatLng, zoom: number): void {
    const map = this.map as L.Map & {
      _getNewPixelOrigin(center: L.LatLng, zoom: number): L.Point;
    };
    const scale = map.getZoomScale(zoom, this.zoom);
    const offset = map
      .getSize()
      .multiplyBy(0.5 + OVERLAP_PADDING)
      .multiplyBy(-scale)
      .add(map.project(this.center, zoom))
      .subtract(map._getNewPixelOrigin(center, zoom));
    for (const canvas of this.canvases()) L.DomUtil.setTransform(canvas, offset, scale);
  }

  private draw(): void {
    if (!this.style) return;
    const start = performance.now();
    const origin = this.map.getPixelOrigin();
    const { width, height } = this.painter.tint;
    const frame = {
      scale: 2 ** this.zoom * this.dpr,
      offsetX: (origin.x + this.topLeft.x) * this.dpr,
      offsetY: (origin.y + this.topLeft.y) * this.dpr,
      width,
      height,
    };
    this.painter.paint(this.reaches, frame, this.style, this.zoom, this.dpr);
    this.drawMs = performance.now() - start;
  }
}
