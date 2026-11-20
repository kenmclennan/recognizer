import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { poolTestOptions } from "../../tools/scripts/pool-scale.mjs";

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
  test: poolTestOptions({
    environment: "node",
    include: [
      "test/**/*.test.ts",
      "scripts/**/*.test.mjs",
      "../../tools/scripts/**/*.test.mjs",
      "../../tools/validation/corpus/*.test.mjs",
    ],
    exclude: [
      ...configDefaults.exclude,
      "test/unit/layout-worker-build.test.ts",
      "test/unit/lightcycle-shaped-graph.test.ts",
    ],
    setupFiles: ["../../tools/scripts/vitest-remove-temp-dirs.mjs"],
  }),
});
