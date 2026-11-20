import { defineConfig } from "vitest/config";
import { poolTestOptions } from "../../tools/scripts/pool-scale.mjs";

export default defineConfig({
  test: poolTestOptions({
    environment: "node",
    include: [
      "test/unit/layout-worker-build.test.ts",
      "test/unit/lightcycle-shaped-graph.test.ts",
    ],
    setupFiles: ["../../tools/scripts/vitest-remove-temp-dirs.mjs"],
  }),
});
