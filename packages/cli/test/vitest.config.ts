import { configDefaults, defineConfig } from "vitest/config";
import { poolTestOptions } from "../../../tools/scripts/pool-scale.mjs";

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
    setupFiles: [
      "../../tools/scripts/vitest-remove-temp-dirs.mjs",
      "./test/app-config-dir.setup.ts",
    ],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...endToEnd],
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: endToEnd,
        },
      },
    ],
  },
});
