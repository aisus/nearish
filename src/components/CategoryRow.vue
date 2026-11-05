<script setup lang="ts">
import { useId } from "vue";
import { MODES, type Mode } from "../types";
import { radiusM } from "../lib/reach";
import type { CategoryState } from "../lib/state";
import { MINUTES_MAX, MINUTES_MIN } from "../lib/tuning";

defineProps<{
  label: string;
  /** What the category is called in this region, after the label. */
  localName?: string;
  /** The label's title: "99 places in Munich". */
  hint?: string;
  color: string;
  /** Shown, not changed: a shared link before it is saved. */
  readonly?: boolean;
}>();

const model = defineModel<CategoryState>({ required: true });

/** Stroked on a 24-unit grid; drawn for this project, so no licence travels with them. */
const MODE_ICONS: Record<Mode, string> = {
  walk: "M13.5 3.5a1 1 0 1 0 0.01 0M12.5 8l-1.5 6l-2.5 6.5M11 14l3 3l1 3.5M7 12.5l2.5-3.5l3-1l2 3l3 1",
  bike: "M2 16.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M15 16.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M5.5 16.5l3-6.5h7.5l-5 6.5zM16 10l2.5 6.5M16 10l-1-3h2M7 10h3",
};

// A radio group needs a name of its own, or arrow keys walk into the next row.
const group = useId();
</script>

<template>
  <div class="row" :class="{ disabled: !model.enabled }">
    <div class="head">
      <label class="toggle" :title="hint">
        <input
          v-model="model.enabled"
          type="checkbox"
          :disabled="readonly"
          :style="{ '--c': color }"
        />
        <span class="name"
          >{{ label }} <span v-if="localName" class="local">({{ localName }})</span></span
        >
      </label>
      <span v-if="model.enabled" class="minutes">{{ model.minutes }} min</span>
    </div>

    <div v-if="model.enabled" class="controls">
      <input
        v-model.number="model.minutes"
        type="range"
        :disabled="readonly"
        :style="{
          '--c': color,
          '--fill': `${((model.minutes - MINUTES_MIN) / (MINUTES_MAX - MINUTES_MIN)) * 100}%`,
        }"
        :min="MINUTES_MIN"
        :max="MINUTES_MAX"
        :aria-label="`${label}: minutes`"
      />
      <div class="readout">
        <div class="modes" role="radiogroup" :aria-label="`${label}: travel mode`">
          <label v-for="mode in MODES" :key="mode" class="mode">
            <input
              v-model="model.mode"
              type="radio"
              :disabled="readonly"
              :name="group"
              :value="mode"
              :aria-label="mode"
            />
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path :d="MODE_ICONS[mode]" />
            </svg>
          </label>
        </div>
        <span class="radius">{{ radiusM(model) }} m</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row {
  padding: 0.3rem 0;
}

.row:has(.controls) {
  padding-bottom: 0.55rem;
}

.row.disabled .name {
  color: var(--text-dim);
}

.head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  cursor: pointer;
}

.toggle:has(input:disabled) {
  cursor: default;
}

.name {
  flex: 1;
  color: var(--text);
}

/* Wraps whole, should a name and its local name outgrow the row. */
.local {
  color: var(--text-dim);
  white-space: nowrap;
}

/* The time budget, where the eye reads down the ticked rows. */
.minutes {
  flex: none;
  font-size: 0.75rem;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

/* At the swatch, where the pin list starts too; `--body-x` is the panel's. */
.controls {
  margin-top: 0.3rem;
  padding-left: var(--body-x);
}

.readout {
  display: flex;
  align-items: center;
}

/* Under the minutes it follows from. */
.radius {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* The icons, not their hit areas, start at the swatch. */
.modes {
  display: flex;
  margin-left: -0.2rem;
}

/* The padding is the hit area: an 18px glyph alone is too small to tap.
   The other mode is a choice, not disabled: `--text-disabled` measured
   2.3-2.5:1, under the 3:1 a control's state needs. */
.mode {
  display: flex;
  padding: 0.2rem;
  border-radius: 4px;
  color: var(--text-dim);
  cursor: pointer;
}

/* Only a real hover: a touch screen keeps the last tapped icon "hovered". */
@media (hover: hover) {
  .mode:hover:not(:has(input:checked, input:disabled)) {
    color: var(--text-muted);
  }
}

.mode:has(input:disabled) {
  cursor: default;
}

.mode:has(input:checked) {
  color: var(--text-bright);
  background-color: var(--surface-raised);
}

.mode:has(input:focus-visible) {
  outline: 1px solid var(--border-strong);
}

.mode input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.mode svg {
  width: 18px;
  height: 18px;
}

/* A finger's height for every target: rows 19px tall, 28px apart, took
   the neighbour's tap. Hit areas grow; glyphs keep their size. */
@media (max-width: 640px) {
  .row {
    padding: 0;
  }

  .head {
    min-height: 44px;
  }

  .toggle {
    align-self: stretch;
  }

  .controls {
    margin-top: 0;
  }

  /* The transparent border is hit area outside the pill, which stays the
     desktop's size. */
  .modes {
    margin-left: -11px;
  }

  .mode {
    padding: 3px;
    border: 8px solid transparent;
    border-radius: 12px;
    background-clip: padding-box;
  }

  .mode:has(input:focus-visible) {
    outline-offset: -8px;
  }
}
</style>
