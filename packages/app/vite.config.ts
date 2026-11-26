import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { poolTestOptions } from "../../tools/scripts/pool-scale.mjs";

const layout = [
  "test/unit/layout-worker-build.test.ts",
  "test/unit/lightcycle-shaped-graph.test.ts",
];

const endToEnd = ["test/end-to-end/**/*.test.ts", "test/unit/*-look.test.ts"];

const unitInclude = [
  "test/**/*.test.ts",
  "scripts/**/*.test.mjs",
  "../../tools/scripts/**/*.test.mjs",
  "../../tools/validation/corpus/*.test.mjs",
];

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
      },
    },
  },
  test: {
    ...poolTestOptions({}),
    environment: "node",
    globalSetup: ["test/look-browser-setup.mjs"],
    setupFiles: ["../../tools/scripts/vitest-remove-temp-dirs.mjs"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: unitInclude,
          exclude: [...configDefaults.exclude, ...layout, ...endToEnd],
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: endToEnd,
          exclude: [...configDefaults.exclude, ...layout],
        },
      },
    ],
  },
});
