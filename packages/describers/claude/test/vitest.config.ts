import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    setupFiles: ["../../../tools/scripts/vitest-remove-temp-dirs.mjs"],
  },
});
