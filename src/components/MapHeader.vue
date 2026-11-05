<script setup lang="ts">
import { computed } from "vue";

import ThemeSwitch from "./ThemeSwitch.vue";
import { BASEMAPS, type BasemapKey } from "../lib/basemaps";
import { usesShareSheet } from "../lib/share";

defineProps<{
  regionLabel: string;
  /** Why there is nothing to share yet; null once the region's data is in. */
  loadStatus: string | null;
}>();

defineEmits<{ home: []; share: [] }>();

const basemapKey = defineModel<BasemapKey>("basemap", { required: true });

/** The two buttons pick within the theme; the switch beside them changes the theme. */
const themeBasemaps = computed(() => {
  const current = BASEMAPS[basemapKey.value].theme;
  return (Object.keys(BASEMAPS) as BasemapKey[]).filter(
    (key) => BASEMAPS[key].theme === current,
  );
});

const shareSheet = usesShareSheet();
</script>

<template>
  <header>
    <div class="bar">
      <div class="where">
        <h1>
          <button type="button" title="Back to regions" @click="$emit('home')">
            <svg class="back icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7l7 7" />
            </svg>
            <span class="wordmark">nearish</span>
          </button>
        </h1>
        <span class="region">{{ regionLabel }}</span>
      </div>
      <button
        v-if="loadStatus === null"
        type="button"
        class="copy-link"
        :aria-label="shareSheet ? 'Share link' : 'Copy link'"
        :title="`${shareSheet ? 'Shares' : 'Copies'} a link with your settings, pins included`"
        @click="$emit('share')"
      >
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"
          />
        </svg>
        <span class="copy-word">{{ shareSheet ? "Share link" : "Copy link" }}</span>
      </button>
      <p v-else class="status">{{ loadStatus }}</p>
      <div class="look">
        <div class="basemaps" role="radiogroup" aria-label="Basemap">
          <label v-for="key in themeBasemaps" :key="key" class="basemap">
            <input v-model="basemapKey" type="radio" name="basemap" :value="key" />
            {{ BASEMAPS[key].label }}
          </label>
        </div>
        <ThemeSwitch v-model:basemap="basemapKey" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.region {
  flex: none;
  font-size: 1.05rem;
  color: var(--text-muted);
}

.region::before {
  content: "/";
  margin: 0 0.45rem;
  color: var(--text-disabled);
}

header {
  padding: 0 0.6rem 0 1rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex: none;
}

.bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  height: 2.75rem;
}

/* As wide as the panel, so what follows starts over the map. */
.where {
  display: flex;
  align-items: baseline;
  gap: 0;
  width: 16rem;
  flex: none;
}

h1 {
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
  flex: none;
}

h1 button {
  font: inherit;
  color: var(--text-bright);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

h1 button:hover {
  text-decoration: underline;
}

.back {
  display: none;
}

/* Until the region's data is in, where *Copy link* will be. */
.status {
  margin: 0;
  flex: 0 1 auto;
  min-width: 0;
  font-size: 0.875rem;
  color: var(--text-muted);
}

/* Beside what a link shares; the basemap and theme, which it does not, are
   pushed apart. A phone shows only the icon. */
.copy-link {
  margin-left: -0.6rem;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex: none;
  padding: 0.3rem 0.5rem;
  font: inherit;
  font-size: 0.875rem;
  color: var(--text-bright);
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

@media (hover: hover) {
  .copy-link:hover {
    background-color: var(--surface-raised);
  }
}

.copy-link:focus-visible {
  background-color: var(--surface-raised);
}

.copy-link svg {
  width: 14px;
  height: 14px;
}

.look {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex: none;
}

/* The theme's two basemaps side by side, as walk and bike are: a dropdown
   hid one of two. */
.basemaps {
  display: flex;
  flex: none;
  gap: 2px;
  font-size: 0.8rem;
}

.basemap {
  display: flex;
  align-items: center;
  height: 1.5rem;
  padding: 0 0.55rem;
  white-space: nowrap;
  color: var(--text-dim);
  border-radius: 4px;
  cursor: pointer;
}

@media (hover: hover) {
  .basemap:hover:not(:has(input:checked)) {
    color: var(--text-muted);
  }
}

.basemap:has(input:checked) {
  color: var(--text-bright);
  background: var(--surface-raised);
}

.basemap:has(input:focus-visible) {
  outline: 2px solid var(--text-bright);
}

.basemap input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

@media (max-width: 640px) {
  header {
    padding: 0.4rem 0.75rem;
  }

  .bar {
    gap: 0.6rem;
  }

  .where {
    width: auto;
    align-items: center;
  }

  /* An arrow for the wordmark, with a 44px hit area reaching into the gap. */
  h1 button {
    display: flex;
    margin: 0 -10px 0 -12px;
    padding: 13px 14px 13px 12px;
  }

  /* As tall as the header allows beside the 44px back arrow and switch. */
  .basemap {
    height: 2.1rem;
  }

  /* The transparent border is hit area outside the hover background,
     which stays the desktop's size and clear of the basemap buttons. */
  .look .theme-switch {
    margin: 0 -6px;
    padding: 7px;
    border: 6px solid transparent;
    border-radius: 12px;
    background-clip: padding-box;
  }

  .back {
    display: block;
    width: 18px;
    height: 18px;
  }

  .wordmark {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .region::before {
    content: none;
  }

  .copy-word {
    display: none;
  }

  /* 44px hit areas over the same layout: the negative margins let them
     reach into the bar's gaps. */
  .copy-link {
    margin: 0 -6px 0 calc(-0.35rem - 6px);
    padding: 7px;
    border: 6px solid transparent;
    border-radius: 12px;
    background-clip: padding-box;
  }

  .copy-link svg {
    width: 18px;
    height: 18px;
  }
}
</style>
