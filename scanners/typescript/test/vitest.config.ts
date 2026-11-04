import { defineConfig } from "vitest/config";
import { poolTestOptions } from "../../../scripts/pool-scale.mjs";

export default defineConfig({
  test: poolTestOptions({
    setupFiles: ["../../scripts/vitest-remove-temp-dirs.mjs"],
  }),
});
