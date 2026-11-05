<script setup lang="ts">
import { computed, onMounted, onUnmounted, useTemplateRef, watch } from "vue";
import {
  BASEMAPS,
  THEME_BASEMAPS,
  drawingFor,
  overlayTheme,
  type BasemapKey,
} from "../lib/basemaps";
import { fetchData } from "../lib/data";
import { REDUCED_MOTION, matches } from "../lib/media";
import {
  OverlapPainter,
  placesInPixels,
  type CategoryReach,
  type Frame,
  type ProjectedPlaces,
} from "../lib/overlap";
import { DEMO, OVERLAP_MAX_DPR } from "../lib/tuning";
import { PALETTE_SLOTS, type HomeSample, type PaletteSlot } from "../types";

/**
 * Central Berlin's water, parks and a handful of its supermarkets, painted
 * by the map's own `OverlapPainter`: each reach tinted, everything outside
 * the overlap dimmed, the overlap outlined. The places stay put and the
 * time budgets move in turn, as a visitor's would.
 */

/** Places as the map has them: points, or areas whose reach is their buffer. */
interface DemoCategory {
  slot: PaletteSlot;
  points: [number, number][];
  areas: [number, number][][];
  places: ProjectedPlaces;
  /** Sample px. */
  radius: number;
  /** The budgets it moves through in turn, as shares of `radius`. */
  steps: number[];
}

function demoCategory(
  slot: PaletteSlot,
  points: [number, number][],
  areas: [number, number][][],
  { radius, steps }: { radius: number; steps: number[] },
): DemoCategory {
  const places = placesInPixels(points, areas, 1 / DEMO.metresPerPx);
  return { slot, points, areas, places, radius, steps };
}

function categoriesOf({ water, park, supermarket }: HomeSample): DemoCategory[] {
  return [
    demoCategory("blue", [], water, DEMO.water),
    demoCategory("green", [], park, DEMO.park),
    demoCategory("pink", supermarket, [], DEMO.supermarket),
  ];
}

/** Drawn on the theme's default basemap, Light or Dark grey, whichever of its two is chosen. */
const props = defineProps<{ basemap: BasemapKey }>();
const shown = computed(() => THEME_BASEMAPS[BASEMAPS[props.basemap].theme]);
const theme = computed(() => overlayTheme(shown.value));
const drawing = computed(() => drawingFor(shown.value));
const colorOf = (slot: PaletteSlot) => theme.value.palette[PALETTE_SLOTS.indexOf(slot)];

const box = useTemplateRef<HTMLDivElement>("box");
const placesCanvas = document.createElement("canvas");
const painter = new OverlapPainter();

/** Both set once the sample arrives, which is when anything is drawn. */
let sample = { width: 0, height: 0 };
let categories: DemoCategory[] = [];

/** Where the sample lies on the canvases, and how many device px a CSS px is. */
let frame: Frame = { scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 };
let dpr = 1;
let zoom: number = DEMO.zoom;

/** Fills the box edge to edge, cropping the sample. */
function fit({ width, height }: { width: number; height: number }): void {
  dpr = Math.min(window.devicePixelRatio, OVERLAP_MAX_DPR);
  const css = Math.max(width / sample.width, height / sample.height, DEMO.minScale);
  const scale = css * dpr;
  const pad = DEMO.paddingPx * dpr;
  const w = Math.round((width + 2 * DEMO.paddingPx) * dpr);
  const h = Math.round((height + 2 * DEMO.paddingPx) * dpr);
  frame = {
    scale,
    offsetX: (sample.width * scale - width * dpr) / 2 - pad,
    offsetY: (sample.height * scale - height * dpr) / 2 - pad,
    width: w,
    height: h,
  };
  zoom = DEMO.zoom + Math.log2(css);
  painter.resize(w, h);
  placesCanvas.width = w;
  placesCanvas.height = h;
}

/** The parks, the water and the dots: drawn once, over the tints and under the dim. */
function drawPlaces(): void {
  const ctx = placesCanvas.getContext("2d")!;
  ctx.clearRect(0, 0, frame.width, frame.height);
  ctx.setTransform(frame.scale, 0, 0, frame.scale, -frame.offsetX, -frame.offsetY);
  const px = dpr / frame.scale;
  for (const { slot, points, areas } of categories) {
    const color = colorOf(slot);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    const path = new Path2D();
    for (const [first, ...rest] of areas) {
      path.moveTo(...first);
      for (const point of rest) path.lineTo(...point);
      path.closePath();
    }
    ctx.globalAlpha = DEMO.areaFill;
    ctx.fill(path);
    ctx.globalAlpha = 1;
    ctx.lineWidth = drawing.value.areaOutline * px;
    ctx.stroke(path);
    ctx.beginPath();
    for (const [x, y] of points) {
      ctx.moveTo(x + DEMO.markerPx * px, y);
      ctx.arc(x, y, DEMO.markerPx * px, 0, 2 * Math.PI);
    }
    ctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/** Category `i` starts its `k`th move at (i + k × count) steps, and eases to the next budget. */
function budgetAt({ steps }: DemoCategory, i: number, t: number): number {
  const count = categories.length;
  const at = (n: number) => steps[n % steps.length];
  const sinceFirst = t / DEMO.stepS - i;
  if (sinceFirst < 0) return at(0);
  const k = Math.floor(sinceFirst / count);
  const startedAt = (i + k * count) * DEMO.stepS;
  const progress = ease(Math.min(1, (t - startedAt) / DEMO.moveS));
  return at(k) + (at(k + 1) - at(k)) * progress;
}

let seconds = 0;

function paint(): void {
  // A frame can come before the first resize: a zero-sized canvas cannot be composited.
  if (frame.width === 0) return;
  const reaches: CategoryReach[] = categories.map((category, i) => ({
    color: colorOf(category.slot),
    places: category.places,
    radiusM: category.radius * budgetAt(category, i, seconds) * DEMO.metresPerPx,
  }));
  painter.paint(
    reaches,
    frame,
    { tintReaches: true, drawOverlap: true, theme: theme.value, drawing: drawing.value },
    zoom,
    dpr,
  );
}

function redraw(): void {
  drawPlaces();
  paint();
}

const resize = new ResizeObserver(([entry]) => {
  fit(entry.contentRect);
  redraw();
});
watch(shown, redraw);

let request = 0;
let started = 0;

function tick(now: number): void {
  seconds = (now - started) / 1000;
  paint();
  request = requestAnimationFrame(tick);
}

onMounted(async () => {
  const data = await fetchData<HomeSample>("home-sample.json").catch(() => null);
  // No box: the home screen has gone, as a region link leaves it, and nothing may start.
  const el = box.value;
  if (!data || !el) return;
  sample = data;
  categories = categoriesOf(data);
  for (const canvas of [painter.tint, placesCanvas, painter.dim]) {
    canvas.style.inset = `${-DEMO.paddingPx}px`;
    canvas.style.width = canvas.style.height = `calc(100% + ${2 * DEMO.paddingPx}px)`;
    el.appendChild(canvas);
  }
  resize.observe(el);
  if (matches(REDUCED_MOTION)) return;
  started = performance.now();
  request = requestAnimationFrame(tick);
});

onUnmounted(() => {
  cancelAnimationFrame(request);
  resize.disconnect();
});
</script>

<template>
  <div
    ref="box"
    class="demo"
    role="img"
    aria-label="Water, parks and supermarkets in central Berlin, each one's reach growing and shrinking; the part left clear is where all three overlap."
  ></div>
</template>

<style scoped>
/* Sized and placed by whoever shows it. */
.demo {
  overflow: hidden;
  background: var(--land);
}

/* Built in script, so scoped styles' attributes never reach them. */
.demo :deep(canvas) {
  position: absolute;
}
</style>
