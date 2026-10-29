import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const agents = Number(process.env.LC_MAX_AGENTS);
const sized = Number.isFinite(agents) && agents > 0;
const maxWorkers = sized
  ? Math.max(1, Math.floor(availableParallelism() / agents))
  : undefined;

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
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    ...(maxWorkers ? { maxWorkers } : {}),
  },
});
