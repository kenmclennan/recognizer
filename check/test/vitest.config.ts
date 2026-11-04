import { defineConfig } from "vitest/config";
import { poolTestOptions } from "../../scripts/pool-scale.mjs";

export default defineConfig({
  test: poolTestOptions({
    testTimeout: 30000,
    setupFiles: ["../scripts/vitest-remove-temp-dirs.mjs"],
  }),
});
