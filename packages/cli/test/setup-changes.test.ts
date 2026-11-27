import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Survey } from "@recognizer/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { COMMANDS } from "../src/commands.js";
import { buildChanges } from "../src/index.js";
import { capture, REPO } from "./helpers.js";
import { exampleManifest } from "./installed-read.js";
import { registerShim, useRegisteredShims } from "./plugin-registry-shim.js";
import { saveEnvironment } from "./setup-helpers.js";

const survey = JSON.parse(
  readFileSync(
    join(REPO, "schema/setup-survey-examples/valid/loom.json"),
    "utf8",
  ),
) as Survey;

describe("the removal commands against a real config", () => {
  let directory: string;
  let restoreEnvironment: () => void;

  beforeEach(() => {
    restoreEnvironment = saveEnvironment();
    directory = makeTempDir("recognizer-setup-remove-");
    mkdirSync(join(directory, ".recognizer"), { recursive: true });

    const bin = join(directory, "bin");
    const sensor = join(bin, "recognizer-sense-crap");

    mkdirSync(bin);
    writeFileSync(
      sensor,
      `#!/bin/sh\nif [ "$1" = "manifest" ]; then\ncat <<'EOF'\n${JSON.stringify(exampleManifest("crap"))}\nEOF\nfi\n`,
    );
    chmodSync(sensor, 0o755);
    registerShim(sensor);
    useRegisteredShims(bin);
  });

  afterEach(() => {
    restoreEnvironment();
  });

  async function run(argv: string[]): Promise<void> {
    const out = capture();
    const command = COMMANDS.find((one) => one.name === argv[1]);
    const status = await command?.run(
      [...argv.slice(2), "--repository", directory],
      out.io,
    );

    expect(status, `${argv.join(" ")}: ${out.err()}`).toBe(0);
  }

  function config(): string {
    return readFileSync(join(directory, ".recognizer/config.yaml"), "utf8");
  }

  function suite(name: string): string {
    return `  - name: ${name}\n    language: python\n    directory: .\n    command: pytest\n    coverage:\n      path: c.lcov\n      format: lcov\n`;
  }

  it(
    "removes one suite and then the tests key",
    async () => {
      writeFileSync(
        join(directory, ".recognizer/config.yaml"),
        `tests:\n${suite("one")}${suite("two")}`,
      );

      const from: Survey = {
        ...survey,
        repository: directory,
        suites: ["one", "two"].map((name) => ({
          name,
          language: "python",
          directory: ".",
          command: "pytest",
          mark: "gone" as const,
        })),
      };
      const built = buildChanges(from, { remove_suites: ["one", "two"] });

      expect(built.changes).toHaveLength(2);

      await run(built.changes[0]?.steps[0]?.argv ?? []);

      expect(config()).toContain("name: two");
      expect(config()).not.toContain("name: one");

      await run(built.changes[1]?.steps[0]?.argv ?? []);

      expect(config()).not.toContain("tests");
    },
    scaledTimeout(30_000),
  );

  it(
    "turns a describer off and leaves no describer key",
    async () => {
      writeFileSync(
        join(directory, ".recognizer/config.yaml"),
        "describer:\n  command: [recognizer-describe-claude, run]\n  version: v1\n",
      );

      const from: Survey = {
        ...survey,
        repository: directory,
        configured: true,
        checks: [
          ...survey.checks,
          {
            id: "claude",
            display: "Claude",
            description: "",
            always_on: false,
            enabled: true,
            runs_tests: false,
            kind: "describer" as const,
            limits: [],
            mark: "set-up",
          },
        ],
      };
      const built = buildChanges(from, { plugins_off: ["claude"] });

      expect(built.changes).toHaveLength(1);

      for (const one of built.changes[0]?.steps ?? []) {
        await run(one.argv);
      }

      expect(config()).not.toContain("describer");
    },
    scaledTimeout(30_000),
  );
});

describe("switching a plugin off", () => {
  const check = (id: string, kind: "sensor" | "describer") => ({
    id,
    display: id,
    description: "",
    always_on: false,
    enabled: true,
    runs_tests: false,
    kind,
    limits: [],
    mark: null,
  });
  const invented: Survey = {
    ...survey,
    checks: [
      ...survey.checks.filter(({ id }) => id === "structure"),
      check("quill", "describer"),
      check("tally", "sensor"),
    ],
  };

  it("switching a describer off unsets its keys by kind, not by name", () => {
    const built = buildChanges(invented, { plugins_off: ["quill"] });
    const steps = built.changes.flatMap((change) =>
      change.steps.map((one) => one.argv.join(" ")),
    );

    expect(steps).toEqual([
      expect.stringContaining("config --unset describer.command"),
      expect.stringContaining("config --unset describer.version"),
    ]);
  });

  it("switching a sensor off removes its section", () => {
    const built = buildChanges(invented, { plugins_off: ["tally"] });
    const steps = built.changes.flatMap((change) =>
      change.steps.map((one) => one.argv.join(" ")),
    );

    expect(steps).toEqual([
      expect.stringContaining("config --remove-section sensors.tally"),
    ]);
  });
});
