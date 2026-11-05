<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from "vue";

import CategoryRow from "./CategoryRow.vue";
import { PIN_LABEL, type CategoryState, type DisplayState, type Pin } from "../lib/state";
import { formatMonth } from "../lib/format";
import { PHONE, SHEET_OPEN_SHARE, TOUCH, matches } from "../lib/media";
import { DETOUR_FACTOR, PIN_NAME_MAX, SPEED_KMH } from "../lib/tuning";
import type { CategoryMeta } from "../types";

const props = defineProps<{
  categories: Record<string, CategoryMeta>;
  colors: Record<string, string>;
  /** False with fewer than two categories ticked: the overlap would be one reach. */
  overlapDrawable: boolean;
  pinColor: string;
  /** The pin just dropped on the map, whose name is asked for next. */
  droppedPin: number | null;
  /** A shared link before it is saved: every setting is shown, none changed. */
  readonly: boolean;
  /** Something differs from the region's defaults. */
  resettable: boolean;
  /** The size of the overlap, the one reach or the region, as `sizeLabel` says. */
  size: string;
  /** What `size` measures: "Overlap", "Reach" or "Region". */
  sizeLabel: string;
  /** For the categories' titles: "99 places in Munich". */
  regionLabel: string;
  /** The region's `osm_as_of`. */
  osmAsOf: string;
}>();

const states = defineModel<Record<string, CategoryState>>("states", { required: true });
const display = defineModel<DisplayState>("display", { required: true });
const pinControl = defineModel<CategoryState>("pinControl", { required: true });
const placingPins = defineModel<boolean>("placingPins", { required: true });
const pins = defineModel<Pin[]>("pins", { required: true });
const selectedPin = defineModel<number | null>("selectedPin", { required: true });
/** The phone layout's sheet; the desktop panel ignores it. */
const sheetOpen = defineModel<boolean>("sheetOpen", { required: true });

const emit = defineEmits<{
  removePin: [id: number];
  clearPins: [];
  reset: [];
  /** A click on a control a shared link has disabled. */
  blocked: [];
}>();

/**
 * Disabled controls dispatch no click, so while read-only they let it
 * through (`.readonly` below) and their row takes it instead.
 */
function onPanelClick(event: MouseEvent): void {
  if (!props.readonly) return;
  const target = event.target as Element;
  if (
    target.closest("section label, .controls, .pin-actions, .pin-list li, .section-head")
  ) {
    emit("blocked");
  }
}

const sortedCategories = computed(() =>
  Object.entries(props.categories).sort(([, a], [, b]) => a.label.localeCompare(b.label)),
);

/** What the overlap is made of, in the list's order, for the phone's closed bar. */
const tickedColors = computed(() => {
  const result = sortedCategories.value
    .filter(([cat]) => states.value[cat]?.enabled)
    .map(([cat]) => ({ key: cat, color: props.colors[cat], pin: false }));
  if (pinControl.value.enabled && pins.value.length > 0) {
    result.push({ key: "pins", color: props.pinColor, pin: true });
  }
  return result;
});

const panel = useTemplateRef<HTMLElement>("panel");
const pinList = useTemplateRef<HTMLElement>("pinList");

// A pin picked on the map opens the list at its row, once the panel is in view.
watch(selectedPin, async (id) => {
  if (id === null) return;
  if (matches(PHONE) && !sheetOpen.value) return;
  await nextTick();
  showSelectedRow();
});

watch(sheetOpen, async (open) => {
  if (!open || selectedPin.value === null) return;
  await nextTick();
  showSelectedRow();
});

/**
 * Scrolls the panel, never the page: scrollIntoView scrolls every ancestor,
 * and on a phone that moved the map from under the tap that picked the pin.
 * Measured within the content, because the sheet may still be growing.
 */
function showSelectedRow(): void {
  const box = panel.value;
  const row = pinList.value?.querySelector(".selected");
  if (!box || !row) return;
  const handle = box.querySelector<HTMLElement>(".sheet-handle")?.offsetHeight ?? 0;
  const height = matches(PHONE)
    ? window.innerHeight * SHEET_OPEN_SHARE
    : box.clientHeight;
  const rect = row.getBoundingClientRect();
  const top = rect.top - box.getBoundingClientRect().top + box.scrollTop;
  const shown =
    top >= box.scrollTop + handle && top + rect.height <= box.scrollTop + height;
  // Centred, clear of the edges a phone's own toolbars may cover.
  if (!shown) box.scrollTop = top - handle - (height - handle - rect.height) / 2;
}

// A dropped pin is named next: its field takes the cursor.
// Only a drop: pins arriving from another tab's save take no cursor.
watch(
  () => props.droppedPin,
  async (id) => {
    if (id === null) return;
    // On a touch screen focus brings up a keyboard over the map.
    if (matches(TOUCH)) return;
    await nextTick();
    pinList.value?.querySelector<HTMLInputElement>("li:last-child input")?.focus();
  },
);

// From the list, a pin is selected while its name has focus, so a rename
// leaves no label behind on the map.
function focusPinName(event: MouseEvent): void {
  (event.currentTarget as HTMLElement).querySelector("input")?.focus();
}

function onPinNameBlur(id: number): void {
  if (selectedPin.value === id) selectedPin.value = null;
}

/** A pin dropped while pins are hidden would seem to vanish, so placing shows them. */
function togglePlacing(): void {
  // A model's value changes only once the parent passes it back down.
  const placing = !placingPins.value;
  placingPins.value = placing;
  if (placing) display.value.pins = true;
}
</script>

<template>
  <aside
    ref="panel"
    class="panel"
    :class="{ open: sheetOpen, readonly }"
    @click="onPanelClick"
  >
    <button
      type="button"
      class="sheet-handle"
      :aria-expanded="sheetOpen"
      @click="sheetOpen = !sheetOpen"
    >
      <span class="grip" aria-hidden="true"></span>
      <span class="visually-hidden">Settings.</span>
      <span v-if="tickedColors.length" class="swatches" aria-hidden="true">
        <span
          v-for="{ key, color, pin } in tickedColors"
          :key="key"
          class="swatch"
          :class="{ pin }"
          :style="{ background: color }"
        ></span>
      </span>
      <span class="summary-label">{{ sizeLabel }}</span>
      <span class="summary-value">{{ size }}</span>
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 15l6-6l6 6" />
      </svg>
    </button>
    <section>
      <!-- The undo takes no layout: it appears without moving anything. -->
      <div class="section-head">
        <h2>Categories</h2>
        <button
          v-if="resettable"
          type="button"
          class="text-action"
          :disabled="readonly"
          title="Back to the region's defaults. Your pins stay."
          @click="$emit('reset')"
        >
          Reset
        </button>
      </div>
      <CategoryRow
        v-for="[cat, info] in sortedCategories"
        :key="cat"
        v-model="states[cat]"
        :label="info.label"
        :local-name="info.local_name"
        :hint="`${info.count} places in ${regionLabel}`"
        :color="colors[cat]"
        :readonly="readonly"
      />
    </section>

    <section>
      <div class="section-head">
        <h2>Your pins</h2>
        <button
          v-if="pins.length > 1"
          type="button"
          class="text-action"
          :disabled="readonly"
          @click="$emit('clearPins')"
        >
          Clear all
        </button>
      </div>
      <ul
        v-if="pins.length"
        ref="pinList"
        class="pin-list"
        :style="{ '--pin': pinColor }"
      >
        <li
          v-for="(pin, index) in pins"
          :key="pin.id"
          :class="{ selected: pin.id === selectedPin }"
          @click="focusPinName"
        >
          <span class="pin-dot" aria-hidden="true"></span>
          <input
            v-model="pin.name"
            type="text"
            :placeholder="PIN_LABEL"
            :maxlength="PIN_NAME_MAX"
            :aria-label="`Name of pin ${index + 1}`"
            :disabled="readonly"
            @focus="selectedPin = pin.id"
            @blur="onPinNameBlur(pin.id)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
          <button
            type="button"
            class="remove"
            :disabled="readonly"
            :aria-label="`Remove ${pin.name.trim() || `pin ${index + 1}`}`"
            @click.stop="$emit('removePin', pin.id)"
          >
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </li>
      </ul>

      <div class="pin-actions">
        <button
          type="button"
          class="add"
          :class="{ armed: placingPins }"
          :disabled="readonly"
          :aria-pressed="placingPins"
          @click="togglePlacing"
        >
          <svg class="icon" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2.25" />
            <path d="M7 4v6M4 7h6" />
          </svg>
          Add pin
        </button>
      </div>

      <CategoryRow
        v-if="pins.length"
        v-model="pinControl"
        class="pin-row"
        label="Use as a category"
        :color="pinColor"
        :readonly="readonly"
      />
    </section>

    <section>
      <h2>Show</h2>
      <label class="inline" :class="{ inactive: !overlapDrawable }">
        <input
          v-model="display.overlap"
          type="checkbox"
          :disabled="readonly || !overlapDrawable"
        />
        <span>Overlap</span>
        <em v-if="!overlapDrawable">needs two categories</em>
        <span v-else class="size">{{ size }}</span>
      </label>
      <label class="inline">
        <input v-model="display.reaches" type="checkbox" :disabled="readonly" />
        <span>Reach per category</span>
      </label>
      <label class="inline">
        <input v-model="display.places" type="checkbox" :disabled="readonly" />
        <span>Places</span>
      </label>
      <label class="inline">
        <input v-model="display.pins" type="checkbox" :disabled="readonly" />
        <span>Pins</span>
      </label>
    </section>

    <footer class="footnote">
      <p>OpenStreetMap data from {{ formatMonth(osmAsOf) }}.</p>
      <details>
        <summary>
          Distances are approximate.
          <span class="how">
            More
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6l-6 6" />
            </svg>
          </span>
        </summary>
        <p>
          Average of <strong>{{ SPEED_KMH.walk }}&nbsp;km/h</strong> on foot and
          <strong>{{ SPEED_KMH.bike }}&nbsp;km/h</strong> by bike, scaled by
          <strong>{{ DETOUR_FACTOR }}</strong
          >. Does not account for actual roads or anything hard to cross.
        </p>
      </details>
    </footer>
  </aside>
</template>

<style scoped>
.panel {
  /* Where everything under a category's name starts: at its swatch, past
     the checkbox (13px plus 7px of margin) and a gap. */
  --body-x: calc(14px + 0.6rem);
  /* From a name field's edge to its text. */
  --field-inset: calc(0.3rem + 1px);
  width: 17rem;
  flex: none;
  overflow-y: auto;
  /* Two sizes: this for what is clicked or read as a label, 0.75rem for
     figures, notes and headings, which differ from figures by weight. */
  font-size: 0.875rem;
  padding: 0 1rem 2rem;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

section {
  margin-top: 1rem;
}

section + section {
  padding-top: 0.9rem;
  border-top: 1px solid var(--border);
}

h2 {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  margin: 0 0 0.35rem;
}

.inline {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.25rem 0;
  color: var(--text);
  cursor: pointer;
}

.inline em {
  font-size: 0.75rem;
  color: var(--text-dim);
  font-style: normal;
}

/* Ends where a ticked category's minutes do. */
.inline .size {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.inline.inactive {
  color: var(--text-disabled);
  cursor: default;
}

/* A section's undo, *Reset* or *Clear all*, on its heading's line and
   ending where the × does. Out of the flow, so it appears
   without moving anything and leaves no gap while absent. */
.section-head {
  position: relative;
}

.section-head .text-action {
  position: absolute;
  top: 50%;
  right: -0.3rem;
  translate: 0 -50%;
}

/*
 * The list's rows, the add button and the category row below share one
 * left column: a pin's dot, the +, and the checkbox sit where a category's
 * checkbox does, and every name starts at `--body-x`. Hover highlights
 * reach 0.3rem past both edges, so the × and Clear all end at the
 * panel's edge.
 */
.pin-list {
  list-style: none;
  margin: 0 -0.3rem;
  padding: 0;
}

.pin-list li {
  display: flex;
  align-items: center;
  padding-left: 0.3rem;
  border-radius: 4px;
}

.pin-list li:hover:not(:has(input:disabled)),
.pin-list li.selected {
  background: var(--surface-raised);
}

/* A quiet list mark, 6px and grey; the selected pin's is drawn as the map
   draws it, its colour ringed, so the row is found by the same mark. */
.pin-dot {
  flex: none;
  width: 14px;
  height: 14px;
  margin-right: calc(0.6rem - var(--field-inset));
  border-radius: 50%;
  background: var(--text-disabled);
  scale: 0.43;
  transition:
    scale 0.15s,
    background-color 0.15s;
}

.pin-list li.selected .pin-dot {
  background: var(--pin);
  box-shadow: inset 0 0 0 2px var(--surface);
  scale: 1;
}

/* Reads as a name until it has focus; empty shows the default as a placeholder. */
.pin-list input {
  flex: 1;
  align-self: stretch;
  min-width: 0;
  padding: 0.2rem 0.3rem;
  font: inherit;
  color: var(--text);
  text-overflow: ellipsis;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
}

.pin-list input::placeholder {
  color: var(--text-muted);
  opacity: 1;
}

/* An empty field while editing: the default is not text to type over. */
.pin-list input:focus::placeholder {
  color: transparent;
}

/* Says the name is a field: a click renames the pin. */
@media (hover: hover) {
  .pin-list li:hover input:not(:focus, :disabled) {
    border-color: var(--border-strong);
  }
}

.pin-list input:focus {
  outline: none;
  border-color: var(--text-dim);
  background: var(--page);
}

.pin-actions {
  display: flex;
  margin: 0.15rem -0.3rem 0;
}

.add {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.2rem 0.5rem 0.2rem 0.3rem;
  font: inherit;
  color: var(--text-muted);
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.add:hover,
.add:focus-visible {
  color: var(--text-bright);
}

.add.armed {
  color: var(--armed-text);
  background: var(--armed);
}

/* In the column the dots and checkboxes take, drawn as a checkbox's box
   is: 14px, a 1.5px border, 3px corners. */
.add svg {
  flex: none;
  width: 14px;
  height: 14px;
  stroke-width: 1.5;
}

.pin-row {
  margin-top: 0.35rem;
}

/* The padding is the hit area, as for the mode icons. */
.remove {
  display: flex;
  flex: none;
  padding: 0.3rem;
  color: var(--text-dim);
  background: none;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}

.remove:hover,
.remove:focus-visible {
  color: var(--text-bright);
}

.remove svg {
  width: 14px;
  height: 14px;
}

/* *Reset* and *Clear all*. */
.text-action {
  padding: 0.2rem 0.3rem;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-dim);
  background: none;
  border: none;
  cursor: pointer;
}

.text-action:hover,
.text-action:focus-visible {
  color: var(--text-bright);
}

/* A shared link before it is saved. */
.add:disabled,
.remove:disabled,
.text-action:disabled {
  color: var(--text-disabled);
  background: none;
  cursor: default;
}

.inline:has(input:disabled) {
  cursor: default;
}

/* A disabled control swallows its click; let it reach the row, which
   points at the notice that says why. */
.panel.readonly :deep(:is(input, button):disabled) {
  pointer-events: none;
}

/* Two lines under one rule: how old the data is, and how reach is estimated. */
.footnote {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 1rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--border);
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--text-dim);
}

/* One line; the speeds and the detour factor are a click away. */
.footnote summary {
  list-style: none;
  cursor: pointer;
}

.footnote summary::-webkit-details-marker {
  display: none;
}

.how {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  margin-left: 0.25rem;
  color: var(--text-muted);
}

.footnote summary:hover .how,
.footnote summary:focus-visible .how {
  color: var(--text-bright);
}

.footnote summary:focus-visible {
  outline: none;
}

.how svg {
  width: 11px;
  height: 11px;
  stroke-width: 2.5;
  transition: rotate 0.15s;
}

.footnote details[open] .how svg {
  rotate: 90deg;
}

.footnote p {
  margin: 0;
}

.footnote details p {
  margin-top: 0.4rem;
}

.footnote strong {
  color: var(--text-muted);
  font-weight: inherit;
}

.sheet-handle {
  display: none;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/*
 * A sheet over the foot of the map, so that the top half still shows what a
 * change does. Collapsed it is only its bar; the map stops above that.
 */
@media (max-width: 640px) {
  .panel {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1002;
    width: auto;
    height: calc(var(--sheet-bar) + env(safe-area-inset-bottom));
    overflow: hidden;
    padding-bottom: calc(2rem + env(safe-area-inset-bottom));
    border-right: none;
    border-top: 1px solid var(--border-strong);
    border-radius: 10px 10px 0 0;
    transition: height 0.2s;
  }

  .panel.open {
    height: var(--sheet-open);
    overflow-y: auto;
  }

  /* Closed, only the bar shows: nothing peeks through below it. */
  .panel:not(.open) > :not(.sheet-handle) {
    visibility: hidden;
  }

  /* Says what is ticked and how large the overlap is, open or closed: on a
     phone the header has no room for the figure's label. */
  .sheet-handle {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: calc(100% + 2rem);
    height: var(--sheet-bar);
    margin: 0 -1rem;
    padding: 0 1rem;
    font: inherit;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    background: var(--surface);
    border: none;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }

  .grip {
    position: absolute;
    top: 6px;
    left: calc(50% - 18px);
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--border-strong);
  }

  .swatches {
    display: flex;
    flex: none;
    gap: 3px;
  }

  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }

  /* As the pins' dot in the list. */
  .swatch.pin {
    border-radius: 50%;
  }

  .summary-label {
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  .summary-value {
    color: var(--text-bright);
    white-space: nowrap;
  }

  .sheet-handle svg {
    flex: none;
    margin-left: auto;
    width: 14px;
    height: 14px;
    stroke-width: 2.5;
    transition: transform 0.2s;
  }

  .panel.open .sheet-handle svg {
    transform: rotate(180deg);
  }

  /* A finger's height, as for the category rows; the × keeps its edge. */
  .inline,
  .pin-list li,
  .add {
    min-height: 44px;
  }

  /* The hit area reaches up over the space above the heading, not down
     into the first row's label. */
  .section-head .text-action {
    display: flex;
    align-items: flex-end;
    min-height: 44px;
    top: auto;
    bottom: -0.2rem;
    translate: none;
  }

  .remove {
    padding: 13px;
    margin-right: calc(0.3rem - 13px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .panel,
  .pin-dot,
  .sheet-handle svg,
  .how svg {
    transition: none;
  }
}
</style>
