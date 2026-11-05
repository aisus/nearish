<script setup lang="ts">
/**
 * Reads the region index and shows home or one region's map, keyed by
 * region id so arriving at a different one remounts it.
 */
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from "vue";

import HomeScreen from "./components/HomeScreen.vue";
import MapScreen from "./components/MapScreen.vue";
import { BASEMAPS, type BasemapKey } from "./lib/basemaps";
import { fetchData } from "./lib/data";
import { loadBasemap, saveBasemap } from "./lib/persist";
import type { RegionIndex, RegionSummary } from "./types";

const regions = ref<RegionSummary[]>([]);
/** From the URL at once, so that a region link never shows the home screen on its way. */
const regionId = ref<string | null>(askedRegion());
const error = ref("");
/** Part of the map's key: a link pasted over the current one changes only the hash. */
const mount = ref(0);

/**
 * One for every region, and above them, so that the home screen's theme and
 * the map's basemap are one choice. Saved only once chosen: until then the
 * system's preference keeps deciding.
 */
const basemap = ref<BasemapKey>(loadBasemap());
watch(basemap, saveBasemap);
watchEffect(() => {
  document.documentElement.dataset.theme = BASEMAPS[basemap.value].theme;
});

const region = computed<RegionSummary | null>(
  () => regions.value.find((entry) => entry.id === regionId.value) ?? null,
);

onMounted(async () => {
  try {
    regions.value = (await fetchData<RegionIndex>("regions.json")).regions;
    if (regions.value.length === 0) throw new Error("the index lists no regions");
  } catch (cause) {
    // The home screen is the only thing that can report this, so it has to
    // survive to be rendered — silence would look like an empty install.
    error.value = `Could not load the regions — ${(cause as Error).message}`;
  }
  syncFromUrl();
  window.addEventListener("popstate", syncFromUrl);
  window.addEventListener("hashchange", reopen);
});

onUnmounted(() => {
  window.removeEventListener("popstate", syncFromUrl);
  window.removeEventListener("hashchange", reopen);
});

function askedRegion(): string | null {
  return new URL(window.location.href).searchParams.get("region");
}

/**
 * A `?region=` naming something the index does not have lands on the home
 * screen rather than on a guess.
 */
function syncFromUrl(): void {
  const asked = askedRegion();
  regionId.value = regions.value.some((entry) => entry.id === asked) ? asked : null;
}

function reopen(): void {
  mount.value++;
}

// pushState rather than replaceState: leaving the home screen is a
// navigation, so the browser's back button belongs to it. A shared link's
// hash belongs to the region it was opened with.
function navigate(id: string | null): void {
  const url = new URL(window.location.href);
  url.hash = "";
  if (id === null) url.searchParams.delete("region");
  else url.searchParams.set("region", id);
  window.history.pushState(null, "", url);
  regionId.value = id;
}
</script>

<template>
  <MapScreen
    v-if="region"
    :key="`${region.id}:${mount}`"
    v-model:basemap="basemap"
    :region="region"
    @home="navigate(null)"
    @reopen="reopen"
  />
  <HomeScreen
    v-else-if="regionId === null"
    v-model:basemap="basemap"
    :regions="regions"
    :error="error"
    @open="navigate"
  />
</template>
