<script setup lang="ts">
/**
 * One region's map. Remounted, never switched: see docs/architecture.md.
 *
 * Watchers are the only writers to the map. A change of criteria also
 * re-estimates the overlap's size; the others only repaint; one saves and
 * touches nothing.
 */
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from "vue";

import ControlPanel from "./ControlPanel.vue";
import MapHeader from "./MapHeader.vue";
import { drawingFor, overlayTheme, type BasemapKey } from "../lib/basemaps";
import { MapView } from "../lib/map";
import { fetchData } from "../lib/data";
import { formatArea } from "../lib/format";
import { projectPlaces, type CategoryReach } from "../lib/overlap";
import { estimateOverlap, type OverlapEstimate } from "../lib/overlap-estimate";
import { bboxAreaKm2, radiusM } from "../lib/reach";
import { loadSaved, restore, save, storageKey } from "../lib/persist";
import { PHONE, SHEET_OPEN_SHARE, TOUCH, matches } from "../lib/media";
import { decodeShare, linkTo, sendLink } from "../lib/share";
import type { AppState } from "../lib/state";
import { COPIED_NOTICE_MS, FOLLOW_SAVED_MS } from "../lib/tuning";
import type { Meta, PlaceCollection, PlaceFeature, RegionSummary } from "../types";

const props = defineProps<{ region: RegionSummary }>();

const emit = defineEmits<{ home: []; reopen: [] }>();

/** Pin ids only key the list and selection. Restoring renumbers from 1. */
let nextPinId = 1;

const mapElement = ref<HTMLElement | null>(null);
const meta = ref<Meta | null>(null);
const loadError = ref<string | null>(null);
/** Every region's, so it is held and saved above the map, in `App.vue`. */
const basemapKey = defineModel<BasemapKey>("basemap", { required: true });

let view: MapView | null = null;
const placesByCat: Record<string, PlaceFeature[]> = {};

/** The overlap's km² and whether it is empty, null with nothing ticked. */
const estimate = shallowRef<OverlapEstimate | null>(null);

/** No categories until `meta.json` arrives; the panel waits for it. */
const state = reactive<AppState>({
  ...restore({}, null),
  placingPins: false,
  selectedPin: null,
});

/**
 * Set while a link's settings are shown: nothing is saved and the panel is
 * read-only, so the visitor's own settings survive until they choose.
 */
const shared = ref<{ ownSaved: boolean } | null>(null);

/** Clicks on the read-only panel; each re-keys the notice, which replays its pulse. */
const nudges = ref(0);

/** The phone layout's panel. A map tap closes it, so that whatever the tap picks out is in view. */
const sheetOpen = ref(false);

/** Set by a drop, so that only a drop asks for a name. */
const droppedPin = ref<number | null>(null);

/** Another tab saved this region while this one was hidden. */
let stale = false;
let followTimer: number | undefined;

const tickedCategories = computed(() =>
  Object.entries(state.categories).filter(([, control]) => control.enabled),
);

/** Pins only count toward the overlap once at least one exists. */
const pinsActive = computed(() => state.pinControl.enabled && state.pins.length > 0);

/** With one category ticked the overlap is its reach, and drawing it would hide the tint. */
const overlapDrawable = computed(
  () => tickedCategories.value.length + (pinsActive.value ? 1 : 0) > 1,
);

/** The overlap was asked for and came back empty; the tints show how close it came. */
const noOverlap = computed(
  () => overlapDrawable.value && state.display.overlap && estimate.value?.empty === true,
);

const loadStatus = computed(() => {
  if (meta.value) return null;
  return loadError.value ? `Could not load the places — ${loadError.value}` : "Loading…";
});

/** Nothing ticked asks nothing, and the whole region answers it. */
const size = computed(() =>
  formatArea(estimate.value?.km2 ?? bboxAreaKm2(props.region.bbox)),
);

/** With one category ticked the size is its reach, as the greyed *Overlap* toggle says. */
const sizeLabel = computed(() => {
  if (!estimate.value) return "Region";
  return overlapDrawable.value ? "Overlap" : "Reach";
});

const theme = computed(() => overlayTheme(basemapKey.value));

/** Overlay colours, from the slot each category carries in `meta.json`. */
const colors = computed<Record<string, string>>(() =>
  Object.fromEntries(
    Object.entries(meta.value?.categories ?? {}).map(([cat, info]) => [
      cat,
      theme.value.palette[info.color_index],
    ]),
  ),
);

const labels = computed<Record<string, string>>(() =>
  Object.fromEntries(
    Object.entries(meta.value?.categories ?? {}).map(([cat, info]) => [cat, info.label]),
  ),
);

/** That the link went: the button's title says what it carries. */
const copiedNotice = ref("");
let copiedTimer: number | undefined;

async function shareLink(): Promise<void> {
  const url = linkTo(props.region.id, state);
  const notice = await sendLink(url, `nearish: ${props.region.label}`);
  if (notice === null) return;
  copiedNotice.value = notice;
  window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => (copiedNotice.value = ""), COPIED_NOTICE_MS);
}

/** A computed, not a function: `setPlaces` skips a rebuild on the same reference. */
const visiblePlaces = computed<PlaceFeature[]>(() => {
  if (!state.display.places) return [];
  return tickedCategories.value.flatMap(([cat]) => placesByCat[cat] ?? []);
});

onMounted(async () => {
  window.addEventListener("keydown", onEscape);
  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", onVisibilityChange);
  try {
    await loadRegionData();
  } catch (error) {
    loadError.value = (error as Error).message;
    return;
  }

  // Let Vue render the panel first, so the map is built at its final size.
  await nextTick();

  // Gone if the visitor left before the data arrived.
  if (!mapElement.value) return;
  view = new MapView(mapElement.value, props.region.bbox, basemapKey.value, {
    onMapClick: clickMap,
    onPinClick: selectPin,
  });
  reestimate();
  paint();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onEscape);
  window.removeEventListener("storage", onStorage);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.clearTimeout(followTimer);
  view?.destroy();
  view = null;
});

// The criteria: the overlap's size again, then a repaint. Pins by position
// only: a rename leaves the criteria alone.
watch(
  () => [
    state.categories,
    state.pins.map(({ lat, lon }) => [lat, lon]),
    state.pinControl,
  ],
  () => {
    reestimate();
    paint();
  },
  { deep: true },
);

// Visual only: the size stays.
watch(() => state.display, paint, { deep: true });
watch(() => [state.pins, state.selectedPin, state.display.pins], paintPins, {
  deep: true,
});
watch(
  () => state.selectedPin,
  (id) => {
    const pin = state.pins.find((candidate) => candidate.id === id);
    if (pin) view?.reveal(pin.lat, pin.lon);
  },
);
// What was in view stays in view: the open sheet covers the map's foot.
watch(sheetOpen, (open) => {
  if (!matches(PHONE)) return;
  const element = mapElement.value;
  if (!element) return;
  const covered =
    window.innerHeight * SHEET_OPEN_SHARE -
    (window.innerHeight - element.getBoundingClientRect().bottom);
  view?.shift(((open ? 1 : -1) * Math.max(0, covered)) / 2);
});
watch(basemapKey, (key) => {
  view?.setBasemap(key);
  paint();
});
watch(
  () => state.placingPins,
  (placing) => {
    view?.setPlacing(placing);
    // The tap that drops the pin needs the map in view.
    if (placing) sheetOpen.value = false;
  },
);

// Saving touches neither the map nor `state`.
watch(
  () => [state.categories, state.display, state.pins, state.pinControl],
  () => {
    if (!shared.value) save(props.region.id, state);
  },
  { deep: true },
);

async function loadRegionData(): Promise<void> {
  const id = props.region.id;
  const [loadedMeta, places] = await Promise.all([
    fetchData<Meta>(`${id}/meta.json`),
    fetchData<PlaceCollection>(`${id}/places.geojson`),
  ]);

  for (const feature of places.features) {
    (placesByCat[feature.properties.cat] ??= []).push(feature);
  }

  const saved = loadSaved(id);
  const link = decodeShare(loadedMeta.categories, window.location.hash);
  if (link) shared.value = { ownSaved: saved !== null };
  Object.assign(state, restore(loadedMeta.categories, link ?? saved));
  nextPinId = state.pins.length + 1;
  meta.value = loadedMeta;
}

/** Drawing, about a frame's work: safe to call on its own. */
function paint(): void {
  if (!view) return;
  view.setOverlap(categoryReaches(), {
    tintReaches: state.display.reaches,
    drawOverlap: state.display.overlap && overlapDrawable.value && !estimate.value?.empty,
    theme: theme.value,
    drawing: drawingFor(basemapKey.value),
  });
  view.setPlaces(visiblePlaces.value, colors.value, labels.value);
  paintPins();
}

/** What the reaches are drawn from: each ticked category, and the pins once ticked. */
function categoryReaches(): CategoryReach[] {
  const reaches: CategoryReach[] = tickedCategories.value.map(([cat, control]) => ({
    color: colors.value[cat],
    places: projectPlaces(placesByCat[cat] ?? []),
    radiusM: radiusM(control),
  }));
  if (pinsActive.value) {
    const pins = state.pins.map(({ lat, lon }) => ({
      geometry: { type: "Point" as const, coordinates: [lon, lat] },
    }));
    reaches.push({
      color: theme.value.pin,
      places: projectPlaces(pins),
      radiusM: radiusM(state.pinControl),
    });
  }
  return reaches;
}

function reestimate(): void {
  const reaches = categoryReaches();
  estimate.value =
    reaches.length === 0 ? null : estimateOverlap(reaches, props.region.bbox);
}

function paintPins(): void {
  view?.setPins(state.display.pins ? state.pins : [], state.selectedPin, theme.value.pin);
}

/** Deselects; while placing, drops one pin and stops placing. */
function clickMap(lat: number, lon: number): void {
  state.selectedPin = null;
  sheetOpen.value = false;
  if (!state.placingPins) return;
  const id = nextPinId++;
  state.pins.push({ id, lat, lon, name: "" });
  state.placingPins = false;
  droppedPin.value = id;
}

/** Esc cancels placing and lets a kept label go, with the pin it belonged to. */
function onEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  state.placingPins = false;
  state.selectedPin = null;
  view?.releaseLabel();
}

/** Not a toggle: a picked pin keeps its label, and a click elsewhere lets both go. */
function selectPin(id: number): void {
  state.selectedPin = id;
}

function removePin(id: number): void {
  state.pins = state.pins.filter((pin) => pin.id !== id);
  if (state.selectedPin === id) state.selectedPin = null;
}

function clearPins(): void {
  state.pins = [];
  state.selectedPin = null;
  state.placingPins = false;
}

/**
 * Another tab saved this region: follow it rather than overwrite it with
 * the next change here. A shared link stays as it is; only whether the
 * visitor has settings of their own can change.
 */
function onStorage(event: StorageEvent): void {
  if (event.key !== storageKey(props.region.id)) return;
  if (shared.value) {
    shared.value.ownSaved = event.newValue !== null;
    return;
  }
  // Removed only with the site's data: the next change here saves again.
  if (event.newValue === null) return;
  window.clearTimeout(followTimer);
  if (document.hidden) stale = true;
  // Not on focus: that arrives with a press, and a panel rebuilt between a
  // press and its release never receives the click.
  else followTimer = window.setTimeout(followSaved, FOLLOW_SAVED_MS);
}

function onVisibilityChange(): void {
  if (!document.hidden && stale) followSaved();
}

/** In place, so the view and the basemap stay. */
function followSaved(): void {
  stale = false;
  if (!meta.value || shared.value) return;
  Object.assign(state, restore(meta.value.categories, loadSaved(props.region.id)));
  nextPinId = state.pins.length + 1;
  state.selectedPin = null;
  state.placingPins = false;
  droppedPin.value = null;
}

/** The link's settings become the visitor's own, and saving resumes. */
function keepShared(): void {
  shared.value = null;
  save(props.region.id, state);
  dropHash();
}

/** Mounted again from storage, as a reload without the link would be. */
function revertShared(): void {
  dropHash();
  emit("reopen");
}

function dropHash(): void {
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(window.history.state, "", url);
}

/** Whether *Reset* would change anything, so it is offered only then. */
const resettable = computed(() => {
  if (!meta.value) return false;
  const { categories, display, pinControl } = restore(meta.value.categories, null);
  return (
    JSON.stringify({ categories, display, pinControl }) !==
    JSON.stringify({
      categories: state.categories,
      display: state.display,
      pinControl: state.pinControl,
    })
  );
});

/** Back to the region's defaults. The pins stay, and so does the basemap, which is not the region's. */
function reset(): void {
  if (!meta.value) return;
  const fresh = restore(meta.value.categories, null);
  state.categories = fresh.categories;
  state.display = fresh.display;
  state.pinControl = fresh.pinControl;
}
</script>

<template>
  <div class="layout">
    <MapHeader
      v-model:basemap="basemapKey"
      :region-label="region.label"
      :load-status="loadStatus"
      @home="$emit('home')"
      @share="shareLink"
    />

    <div class="body">
      <ControlPanel
        v-if="meta"
        v-model:states="state.categories"
        v-model:display="state.display"
        v-model:pin-control="state.pinControl"
        v-model:placing-pins="state.placingPins"
        v-model:pins="state.pins"
        v-model:selected-pin="state.selectedPin"
        v-model:sheet-open="sheetOpen"
        :categories="meta.categories"
        :colors="colors"
        :overlap-drawable="overlapDrawable"
        :pin-color="theme.pin"
        :readonly="shared !== null"
        :resettable="resettable"
        :dropped-pin="droppedPin"
        :size="size"
        :size-label="sizeLabel"
        :region-label="region.label"
        :osm-as-of="region.osm_as_of"
        @remove-pin="removePin"
        @clear-pins="clearPins"
        @reset="reset"
        @blocked="nudges++"
      />
      <div class="map-area">
        <div ref="mapElement" class="map"></div>
        <div v-if="copiedNotice" class="notice quiet" role="status">
          {{ copiedNotice }}
        </div>
        <div
          v-else-if="shared"
          :key="`shared-${nudges}`"
          class="notice"
          :class="{ nudged: nudges > 0 }"
          role="status"
        >
          <span>
            Shared link.
            <template v-if="shared.ownSaved">
              You have saved settings for {{ region.label }}.
            </template>
          </span>
          <button type="button" class="primary" @click="keepShared">
            Save and edit this
          </button>
          <button v-if="shared.ownSaved" type="button" @click="revertShared">
            Revert to my settings
          </button>
        </div>
        <div v-else-if="state.placingPins" class="notice" role="status">
          {{ matches(TOUCH) ? "Tap" : "Click" }} the map to drop a pin
          <button type="button" @click="state.placingPins = false">Cancel</button>
        </div>
        <div v-else-if="noOverlap" class="notice quiet" role="status">
          No overlap: nowhere is within reach of all categories
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}

.body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}

.map-area {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
}

.map {
  flex: 1;
  min-width: 0;
}

/* On the map, where the eye is; above Leaflet's controls. */
.notice {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1001;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.3rem 0.3rem 0.3rem 0.85rem;
  font-size: 0.85rem;
  white-space: nowrap;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--armed-border);
  border-radius: 8px;
}

.notice.quiet {
  padding: 0.3rem 0.75rem;
  border-color: var(--border-strong);
}

/* A click on the read-only panel: a ring spreads from the border once. */
.notice.nudged {
  animation: nudge 0.6s ease-out;
}

@keyframes nudge {
  from {
    box-shadow: 0 0 0 0 var(--armed-border);
  }
  to {
    box-shadow: 0 0 0 10px transparent;
  }
}

/* Without motion, the notice flashes orange instead of a ring spreading. */
@keyframes nudge-still {
  from {
    background: var(--armed);
    color: var(--armed-text);
  }
}

@media (prefers-reduced-motion: reduce) {
  .notice.nudged {
    animation: nudge-still 0.6s ease-out;
  }
}

.notice button {
  padding: 0.2rem 0.6rem;
  font: inherit;
  color: var(--text);
  background: var(--surface-raised);
  border: none;
  border-radius: 5px;
  cursor: pointer;
}

.notice button:hover {
  background: var(--surface-hover);
}

/* The way forward, in the orange that means "yours": saving makes it so. */
.notice button.primary {
  color: var(--armed-text);
  background: var(--armed);
}

.notice button.primary:hover {
  background: var(--armed-border);
}

@media (max-width: 640px) {
  /* The panel's bar sits below the map, not over its controls. */
  .map-area {
    margin-bottom: calc(var(--sheet-bar) + env(safe-area-inset-bottom));
  }

  .notice {
    left: 8px;
    right: 8px;
    transform: none;
    flex-wrap: wrap;
    justify-content: center;
    white-space: normal;
  }
}
</style>
