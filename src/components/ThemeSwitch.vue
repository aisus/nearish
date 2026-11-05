<script setup lang="ts">
import { computed } from "vue";

import { BASEMAPS, THEME_PARTNERS, type BasemapKey } from "../lib/basemaps";

/** The theme is the basemap's, so switching it swaps the basemap for its partner. */
const basemap = defineModel<BasemapKey>("basemap", { required: true });

const label = computed(() =>
  BASEMAPS[basemap.value].theme === "dark" ? "Light theme" : "Dark theme",
);
</script>

<template>
  <button
    type="button"
    class="theme-switch"
    :aria-label="label"
    :title="label"
    @click="basemap = THEME_PARTNERS[basemap]"
  >
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        v-if="BASEMAPS[basemap].theme === 'dark'"
        d="M12 8a4 4 0 1 0 0.01 0M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"
      />
      <path v-else d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />
    </svg>
  </button>
</template>

<style scoped>
.theme-switch {
  display: flex;
  flex: none;
  padding: 0.45rem;
  color: var(--text-dim);
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

/* Only a real hover: a touch screen keeps the last tapped button "hovered". */
@media (hover: hover) {
  .theme-switch:hover {
    color: var(--text-bright);
    background-color: var(--surface-raised);
  }
}

.theme-switch:focus-visible {
  color: var(--text-bright);
  background-color: var(--surface-raised);
}

.icon {
  width: 18px;
  height: 18px;
}
</style>
