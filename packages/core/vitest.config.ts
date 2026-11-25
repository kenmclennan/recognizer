import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["../../tools/scripts/vitest-remove-temp-dirs.mjs"],
  },
});
