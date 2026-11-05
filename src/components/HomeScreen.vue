<script setup lang="ts">
import { computed, reactive, watch } from "vue";

import { overlayTheme, type BasemapKey } from "../lib/basemaps";
import { fetchData } from "../lib/data";
import { formatMonth } from "../lib/format";
import { OSM_COPYRIGHT_URL, SOURCE_URL } from "../lib/links";
import { REGION_COLUMNS_MAX } from "../lib/tuning";
import OverlapDemo from "./OverlapDemo.vue";
import ThemeSwitch from "./ThemeSwitch.vue";
import type { RegionSummary, Thumbnail } from "../types";

const props = defineProps<{
  regions: RegionSummary[];
  error: string;
}>();

/** The map's: choosing a theme here chooses the basemap the map opens on. */
const basemap = defineModel<BasemapKey>("basemap", { required: true });

/** In the map's own colours, each layer in its category's. */
const palette = computed(() => overlayTheme(basemap.value).palette);

/**
 * Rows as even as the count allows: nine take two rows of five, not seven
 * and two. Narrower windows fit what they can.
 */
const columns = computed(() => {
  const count = props.regions.length;
  return Math.ceil(count / Math.ceil(count / REGION_COLUMNS_MAX));
});

/** The oldest region's month, so the page never claims fresher data than it has. */
const dataMonth = computed(() => {
  const oldest = props.regions.map((region) => region.osm_as_of).sort()[0];
  return oldest === undefined ? "" : `, ${formatMonth(oldest)}`;
});

/** Each region's thumbnail as it arrives; a card without one still opens its map. */
const thumbnails = reactive<Record<string, Thumbnail>>({});

watch(
  () => props.regions,
  (regions) => {
    for (const { id } of regions) {
      fetchData<Thumbnail>(`${id}/thumbnail.json`)
        .then((thumbnail) => (thumbnails[id] = thumbnail))
        .catch(() => undefined);
    }
  },
  { immediate: true },
);

defineEmits<{ open: [id: string] }>();
</script>

<template>
  <div class="home">
    <div class="backdrop">
      <OverlapDemo :basemap="basemap" class="backdrop-demo" />
    </div>
    <ThemeSwitch v-model:basemap="basemap" class="theme" />
    <section class="hero">
      <div class="hero-column">
        <h1>nearish</h1>
        <p class="blurb">
          Pick places you want nearby and how far you're willing to walk or cycle.<br />
          The map shows where all of them are within reach.
        </p>
      </div>
    </section>
    <main>
      <p v-if="error" class="error">{{ error }}</p>

      <template v-else>
        <h2>Regions</h2>
        <ul class="regions" :style="{ '--columns': columns }">
          <li v-for="region in regions" :key="region.id">
            <button type="button" @click="$emit('open', region.id)">
              <svg
                v-if="thumbnails[region.id]"
                class="thumbnail"
                :viewBox="`0 0 ${thumbnails[region.id].width} ${thumbnails[region.id].height}`"
                preserveAspectRatio="xMidYMid slice"
                aria-hidden="true"
              >
                <path
                  v-for="layer in thumbnails[region.id].layers"
                  :key="layer.cat"
                  :class="layer.shape"
                  :d="layer.d"
                  :style="{ color: palette[layer.color_index] }"
                />
              </svg>
              <span v-else class="thumbnail"></span>
              <span class="label">{{ region.label }}</span>
            </button>
          </li>
        </ul>
      </template>

      <p class="note">
        Data from <a :href="OSM_COPYRIGHT_URL">OpenStreetMap</a> (ODbL){{ dataMonth }}.
        Source code and issues on <a :href="SOURCE_URL">GitHub</a> (MIT).
      </p>
    </main>
  </div>
</template>

<style scoped>
.home {
  /* The hero's height: the text sits at its foot, and the fade is placed
     from it rather than from the window, so the two cannot drift apart.
     Everything inside is sized in svh, never dvh: dvh changes when a
     phone's toolbar hides or returns at the end of a fling, and resized
     the hero and the animation under the visitor's finger. */
  --hero: max(18rem, calc(50svh + 3rem));
  position: relative;
  height: 100dvh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/*
 * The animation behind the whole first screen, cropped to fill it, under
 * one oval of the page's colour: the map on top, the page below, rising
 * on the left as a quiet backdrop for the text. It scrolls with the page.
 * Only as tall as the fade leaves it in view, solid 8px above its foot at
 * the right edge, its lowest point: drawn under the solid page it cost a
 * phone half its frame rate, 35 fps against 60 with the CPU slowed four
 * times.
 */
.backdrop {
  position: absolute;
  inset: 0 0 auto;
  height: calc(var(--hero) - 10.5rem + 24.5svh);
  overflow: hidden;
}

/* Ends under the fade's solid foot: the canvas's clip and the fade round the
   fractional edge to device pixels apart, which showed as a hairline. */
.backdrop-demo {
  position: absolute;
  inset: 0 0 2px;
}

/* An arc whose crest is solid 11rem above the hero's foot, 20px above the
   title's letters over a two-line blurb, so the title and the blurb sit
   wholly on the page and the map keeps the top and the right. Placed from
   the window's height, the text slid through it: at 2560x1300 the title
   had 60% of the map behind its letters' tops and 20% behind its baseline.
   The stops are Andreas Larsen's scrim curve, steep from solid with a long
   faint tail, which leaves no edge where the fade starts; 110.88svh is
   154% of 72svh, and 97.57svh is 88% of that. */
.backdrop::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(
    120% 110.88svh at 30% calc(var(--hero) - 11rem + 97.57svh),
    var(--page) 88%,
    color-mix(in srgb, var(--page) 73.8%, transparent) 90.7%,
    color-mix(in srgb, var(--page) 54.1%, transparent) 92.8%,
    color-mix(in srgb, var(--page) 38.2%, transparent) 94.6%,
    color-mix(in srgb, var(--page) 27.8%, transparent) 95.9%,
    color-mix(in srgb, var(--page) 19.4%, transparent) 97.1%,
    color-mix(in srgb, var(--page) 12.6%, transparent) 98.2%,
    color-mix(in srgb, var(--page) 7.5%, transparent) 99.2%,
    color-mix(in srgb, var(--page) 4.2%, transparent) 100.1%,
    color-mix(in srgb, var(--page) 2.1%, transparent) 100.7%,
    color-mix(in srgb, var(--page) 0.8%, transparent) 101.3%,
    color-mix(in srgb, var(--page) 0.2%, transparent) 101.7%,
    transparent 102%
  );
  pointer-events: none;
}

/* Where the map screen's bar has it, on a chip of the panel's surface so
   that it reads over the animation. The ring is inset: on a phone the
   transparent border around it is hit area. */
.theme {
  position: absolute;
  top: 6px;
  right: 0.6rem;
  z-index: 2;
  color: var(--text-strong);
  background-color: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border-strong);
  border-radius: 8px;
}

@media (hover: hover) {
  .theme:hover {
    color: var(--text-bright);
    background-color: var(--surface-raised);
  }
}

/* The top half of the screen and 3rem, with the title and the blurb at its foot. */
.hero {
  position: relative;
  z-index: 1;
  align-self: stretch;
  flex: none;
  height: var(--hero);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.hero-column {
  width: min(72rem, 100%);
  margin: 0 auto;
  padding: 0 1.5rem 0.5rem;
}

h1 {
  font-size: clamp(3rem, 8vw, 4.75rem);
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.03em;
  margin: 0;
  color: var(--text-bright);
}

/* One sentence a line where the width allows; narrower, no word alone on a line. */
.blurb {
  max-width: 34em;
  text-wrap: pretty;
  margin: 0.9rem 0 0;
  font-size: clamp(1.1rem, 2.2vw, 1.35rem);
  color: var(--text-strong);
  line-height: 1.5;
}

/* The rest of the window's height, so a short list leaves the note at its foot. */
main {
  position: relative;
  z-index: 1;
  width: min(72rem, 100%);
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  padding: 0.5rem 1.5rem 2.5rem;
}

h2 {
  margin: 1.5rem 0 1rem;
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-strong);
}

.regions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
  gap: 1.25rem 1rem;
}

@media (min-width: 1100px) {
  .regions {
    grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
  }
}

.regions button {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0;
  font: inherit;
  text-align: left;
  color: var(--text);
  background: none;
  border: none;
  cursor: pointer;
}

.label {
  font-size: 0.95rem;
  color: var(--text-strong);
}

.regions button:hover .label,
.regions button:focus-visible .label {
  color: var(--text-bright);
}

.regions button:focus-visible {
  outline: none;
}

/* The region drawn small: water and parks as shapes, supermarkets as dots. */
.thumbnail {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 3 / 2;
  border-radius: 6px;
  background: var(--land);
  outline: 1px solid var(--border-strong);
  outline-offset: -1px;
  box-shadow: var(--raised);
  transition: outline-color 0.15s;
}

.regions button:hover .thumbnail,
.regions button:focus-visible .thumbnail {
  outline: 1px solid var(--text-dim);
}

.regions button:focus-visible .thumbnail {
  outline: 2px solid var(--text-bright);
}

.thumbnail .areas {
  fill: currentColor;
  fill-opacity: 0.45;
  stroke: currentColor;
  stroke-opacity: 0.7;
  stroke-width: 0.6px;
  vector-effect: non-scaling-stroke;
}

.thumbnail .dots {
  fill: none;
  stroke: currentColor;
  stroke-opacity: 0.8;
  stroke-width: 1.5px;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

.error {
  margin: 1.5rem 0 0;
  padding: 0.9rem 1rem;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-muted);
}

.regions,
.error {
  margin-bottom: 1.75rem;
}

.note {
  margin: auto 0 0;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--text-dim);
}

.note a {
  color: var(--text-muted);
}

@media (max-width: 640px) {
  /* The blurb fills the width, so the arc would cross it: a flat fade on
     the same curve, clear down to 14% of the window and solid from 35%,
     which puts the title on the faded map and the blurb on the page. */
  .home {
    --hero: max(18rem, 50svh);
  }

  .backdrop {
    height: 45svh;
  }

  .backdrop::after {
    background: linear-gradient(
      to top,
      var(--page) 22%,
      color-mix(in srgb, var(--page) 73.8%, transparent) 31.1%,
      color-mix(in srgb, var(--page) 54.1%, transparent) 38.3%,
      color-mix(in srgb, var(--page) 38.2%, transparent) 44.6%,
      color-mix(in srgb, var(--page) 27.8%, transparent) 49.1%,
      color-mix(in srgb, var(--page) 19.4%, transparent) 53.2%,
      color-mix(in srgb, var(--page) 12.6%, transparent) 57%,
      color-mix(in srgb, var(--page) 7.5%, transparent) 60.5%,
      color-mix(in srgb, var(--page) 4.2%, transparent) 63.3%,
      color-mix(in srgb, var(--page) 2.1%, transparent) 65.7%,
      color-mix(in srgb, var(--page) 0.8%, transparent) 67.7%,
      color-mix(in srgb, var(--page) 0.2%, transparent) 69.1%,
      transparent 70%
    );
  }

  /* Where the map screen's phone bar has it, with a 44px hit area. */
  .theme {
    right: 6px;
    padding: 7px;
    border: 6px solid transparent;
    border-radius: 14px;
    background-clip: padding-box;
  }

  .blurb {
    font-size: 1rem;
  }

  .regions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.25rem 0.75rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .thumbnail {
    transition: none;
  }
}
</style>
