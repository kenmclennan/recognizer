import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["../scripts/vitest-remove-temp-dirs.mjs"],
  },
});
