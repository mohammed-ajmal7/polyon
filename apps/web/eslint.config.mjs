import eslint from "@eslint/js";
import eslintReact from "@eslint-react/eslint-plugin";
import nextPlugin from "@next/eslint-plugin-next";
import { defineConfig, globalIgnores } from "eslint/config";
import prettierConfig from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),

  {
    files: ["**/*.{js,jsx,ts,tsx}"],

    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      eslintReact.configs["recommended-type-checked"],
      nextPlugin.configs["core-web-vitals"],
    ],

    languageOptions: {
      parser: tseslint.parser,

      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    settings: {
      next: {
        rootDir: import.meta.dirname,
      },
    },
  },

  prettierConfig,
);
