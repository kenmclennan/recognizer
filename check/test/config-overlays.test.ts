import { describe, expect, it } from "vitest";
import { configFile, readConfig } from "../src/config.js";
import { InputError } from "../src/errors.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

const METRIC =
  "{ name: line_coverage, type: ratio, granularity: module, bad: low }";

function read(yaml: string) {
  const fake = fakeIo({ files: { [configFile(ROOT)]: yaml } });

  return readConfig(fake.io, ROOT);
}

function registration(
  name = "coverage",
  body = `command: [node]\n    metrics:\n      - ${METRIC}`,
) {
  return `overlays:\n  ${name}:\n    ${body}\n`;
}

describe("config overlays", () => {
  it("registers an overlay", () => {
    expect(read(registration())?.overlays).toEqual({
      coverage: {
        command: ["node"],
        metrics: [
          {
            name: "line_coverage",
            type: "ratio",
            granularity: "module",
            bad: "low",
          },
        ],
      },
    });
  });

  it("keeps the describer key", () => {
    const config = read(
      `describer:\n  command: [node]\n  version: a\n${registration()}`,
    );

    expect(config?.describer).toEqual({ command: ["node"], version: "a" });
  });

  it.each([
    [
      "a repeated metric name",
      registration(
        "coverage",
        `command: [node]\n    metrics:\n      - ${METRIC}\n      - ${METRIC}`,
      ),
    ],
    [
      "an empty command",
      registration("coverage", `command: []\n    metrics:\n      - ${METRIC}`),
    ],
    ["a bad overlay name", registration("Bad_Name")],
    ["an overlay name over 64 characters", registration("a".repeat(65))],
    [
      "an unknown key in a registration",
      registration(
        "coverage",
        `command: [node]\n    extra: 1\n    metrics:\n      - ${METRIC}`,
      ),
    ],
    [
      "no metrics",
      registration("coverage", "command: [node]\n    metrics: []"),
    ],
  ])("rejects %s", (_, yaml) => {
    expect(() => read(yaml)).toThrow(InputError);
  });
});
