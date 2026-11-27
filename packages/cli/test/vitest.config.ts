import { configDefaults, defineConfig } from "vitest/config";
import { poolTestOptions } from "../../../tools/scripts/pool-scale.mjs";

const endToEndService = [
  "test/end-to-end/serve-process.test.ts",
  "test/end-to-end/shared-serve.test.ts",
];

const endToEnd = [
  "test/adapter-contract/**/*.test.ts",
  "test/end-to-end/**/*.test.ts",
  "test/**/*-real.test.ts",
  "test/**/*.integration.test.ts",
  "test/plugin-manifests.test.ts",
  "test/plugin-templates.test.ts",
  "test/serve-soak.test.ts",
];

export default defineConfig({
  test: {
    ...poolTestOptions({ testTimeout: 30000 }),
    globalSetup: ["./test/ensure-built.setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          setupFiles: [
            "./test/app-config-dir.setup.ts",
            "../../tools/scripts/vitest-remove-temp-dirs.mjs",
          ],
          include: ["test/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...endToEnd, ...endToEndService],
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          setupFiles: [
            "./test/app-config-dir.setup.ts",
            "../../tools/scripts/vitest-remove-temp-dirs.mjs",
          ],
          include: endToEnd,
          exclude: [...configDefaults.exclude, ...endToEndService],
        },
      },
      {
        extends: true,
        test: {
          name: "e2e-service",
          sequence: { groupOrder: 2 },
          isolate: false,
          maxWorkers: 1,
          globalSetup: ["../../tools/scripts/service-scratch-setup.mjs"],
          setupFiles: [
            "../../tools/scripts/service-scratch-worker.mjs",
            "./test/app-config-dir.setup.ts",
            "./test/end-to-end/shared-service-close.setup.ts",
          ],
          include: endToEndService,
        },
      },
    ],
  },
});
