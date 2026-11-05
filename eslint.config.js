import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import vue from "eslint-plugin-vue";
import globals from "globals";
import ts from "typescript-eslint";

export default ts.config(
  { ignores: ["dist/", "cache/", "public/data/", "eslint.config.js"] },
  js.configs.recommended,
  ts.configs.recommendedTypeChecked,
  vue.configs["flat/recommended"],
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".vue"],
      },
    },
  },
  { files: ["**/*.vue"], languageOptions: { parserOptions: { parser: ts.parser } } },

  // Each half gets the globals its tsconfig gives it, so a stray `window`
  // in the fetch step or a `process` in the app is a lint error as well as
  // a type error.
  {
    files: ["src/**/*.{ts,vue}"],
    ignores: ["src/fetch/**"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["src/fetch/**/*.ts", "vite.config.ts"],
    languageOptions: { globals: globals.node },
  },

  // typescript-eslint cannot see through a `.vue` import, so every value
  // from one is `any` to it. vue-tsc checks these properly.
  { files: ["src/main.ts"], rules: { "@typescript-eslint/no-unsafe-argument": "off" } },

  prettier,
);
