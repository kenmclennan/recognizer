import { defineConfig } from "vitest/config";
import { poolTestOptions } from "../../../../tools/scripts/pool-scale.mjs";

export default defineConfig({
  test: poolTestOptions({
    setupFiles: ["../../../tools/scripts/vitest-remove-temp-dirs.mjs"],
  }),
});
