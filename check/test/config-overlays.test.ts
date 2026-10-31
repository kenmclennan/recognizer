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

describe("config sensors", () => {
  it("accepts a registration, structure settings and the off string", () => {
    expect(
      read(
        "sensors:\n  structure:\n    hub_threshold: 4\n    warnings: { cycle: false }\n  unused:\n    command: [node, '{output}']\n",
      )?.sensors,
    ).toEqual({
      structure: { hub_threshold: 4, warnings: { cycle: false } },
      unused: { command: ["node", "{output}"] },
    });
    expect(read("sensors:\n  structure: off\n")?.sensors).toEqual({
      structure: "off",
    });
  });

  it.each([
    [
      "structure with a command",
      "sensors:\n  structure:\n    command: [node]\n",
    ],
    ["another name set off", "sensors:\n  unused: off\n"],
    [
      "another name with settings",
      "sensors:\n  unused:\n    hub_threshold: 3\n",
    ],
    [
      "a registration with metrics",
      "sensors:\n  unused:\n    command: [node]\n    metrics: []\n",
    ],
    ["an empty command", "sensors:\n  unused:\n    command: []\n"],
    ["a threshold below 1", "sensors:\n  structure:\n    hub_threshold: 0\n"],
    [
      "a fractional threshold",
      "sensors:\n  structure:\n    hub_threshold: 2.5\n",
    ],
    ["a bad sensor name", "sensors:\n  Bad_Name:\n    command: [node]\n"],
  ])("rejects %s", (_, yaml) => {
    expect(() => read(yaml)).toThrow(InputError);
  });

  it("names the path of a rejected sensor", () => {
    expect(() => read("sensors:\n  structure:\n    command: [node]\n")).toThrow(
      /config\/sensors\/structure/,
    );
  });
});
