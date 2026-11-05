import { defineConfig } from "vitest/config";
import { poolTestOptions } from "../scripts/pool-scale.mjs";

export default defineConfig({
  test: poolTestOptions({
    environment: "node",
    include: [
      "src/layout-worker-build.test.ts",
      "src/lightcycle-shaped-graph.test.ts",
    ],
    setupFiles: ["../scripts/vitest-remove-temp-dirs.mjs"],
  }),
});
