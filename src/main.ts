import { createApp } from "vue";

// Bundled rather than fetched from a font host: no third party sees a visit.
// Each weight loads only the scripts a page uses, ~25 kB a weight for Latin.
import "@fontsource/fira-sans/400.css";
import "@fontsource/fira-sans/500.css";
import "@fontsource/fira-sans/600.css";

import App from "./App.vue";
import "./assets/main.css";

createApp(App).mount("#app");
