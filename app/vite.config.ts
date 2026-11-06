import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { poolTestOptions } from "../scripts/pool-scale.mjs";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        settings: fileURLToPath(new URL("settings.html", import.meta.url)),
      },
    },
  },
  test: poolTestOptions({
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "scripts/**/*.test.mjs",
      "../scripts/**/*.test.mjs",
      "../validation/corpus/*.test.mjs",
    ],
    exclude: [
      ...configDefaults.exclude,
      "src/layout-worker-build.test.ts",
      "src/lightcycle-shaped-graph.test.ts",
    ],
    setupFiles: ["../scripts/vitest-remove-temp-dirs.mjs"],
  }),
});
