import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    setupFiles: ["../scripts/vitest-remove-temp-dirs.mjs"],
  },
});
