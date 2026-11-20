import { defineConfig } from "vitest/config";
import { poolTestOptions } from "../../../tools/scripts/pool-scale.mjs";

export default defineConfig({
  test: poolTestOptions({
    testTimeout: 30000,
    setupFiles: [
      "../../tools/scripts/vitest-remove-temp-dirs.mjs",
      "./test/app-config-dir.setup.ts",
    ],
  }),
});
