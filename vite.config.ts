import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so a build works from a subpath (project pages, a
  // file server, a subdirectory) without being rebuilt for each.
  base: "./",
  plugins: [vue()],
});
