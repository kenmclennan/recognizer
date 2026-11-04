import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { poolTestOptions } from "../scripts/pool-scale.mjs";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        settings: fileURLToPath(new URL("settings.html", import.meta.url)),
      },
    },
  },
  test: poolTestOptions({
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "scripts/**/*.test.mjs",
      "../scripts/**/*.test.mjs",
    ],
    setupFiles: ["../scripts/vitest-remove-temp-dirs.mjs"],
  }),
});
