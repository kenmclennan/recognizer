import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config-parse.js";
import {
  expandMeasurerShortForms,
  expandShortForms,
  SHIPPED_MEASURERS,
  SHIPPED_SENSORS,
} from "../src/shipped-sensors.js";
import { REPO } from "./helpers.js";

const command = (settings: string) => [
  "recognizer-sensors",
  "duplication",
  "--repository",
  "{repository}",
  "--commit",
  "{commit}",
  "--output",
  "{output}",
  "--settings",
  settings,
];

describe("SHIPPED_SENSORS", () => {
  it("equals the names in fixtures/sensors/list.json", () => {
    const list: { name: string }[] = JSON.parse(
      readFileSync(join(REPO, "fixtures/sensors/list.json"), "utf8"),
    );

    expect(SHIPPED_SENSORS).toEqual(list.map(({ name }) => name));
  });

  it("equals fixtures/sensors/shipped.json", () => {
    expect(SHIPPED_SENSORS).toEqual(
      JSON.parse(
        readFileSync(join(REPO, "fixtures/sensors/shipped.json"), "utf8"),
      ),
    );
  });
});

describe("expandShortForms for crap", () => {
  it("puts the settings JSON last", () => {
    const expanded = expandShortForms(
      { crap: { threshold: 20 } },
      SHIPPED_SENSORS,
    ) as { crap: { command: string[] } };

    expect(expanded.crap.command[1]).toBe("crap");
    expect(expanded.crap.command.at(-1)).toBe('{"threshold":20}');
  });
});

describe("expandShortForms for thresholds", () => {
  it("carries the mapping as the settings JSON", () => {
    const expanded = expandShortForms(
      { thresholds: { complexity: { above: 15 } } },
      SHIPPED_SENSORS,
    ) as { thresholds: { command: string[] } };

    expect(expanded.thresholds.command[1]).toBe("thresholds");
    expect(expanded.thresholds.command.at(-1)).toBe(
      '{"complexity":{"above":15}}',
    );
  });
});

describe("expandShortForms", () => {
  it("expands an empty mapping", () => {
    expect(expandShortForms({ duplication: {} }, SHIPPED_SENSORS)).toEqual({
      duplication: { command: command("{}") },
    });
  });

  it("carries the settings as JSON", () => {
    expect(
      expandShortForms({ duplication: { threshold: 0.9 } }, SHIPPED_SENSORS),
    ).toEqual({ duplication: { command: command('{"threshold":0.9}') } });
  });

  it("leaves an entry with a command untouched", () => {
    const entries = { duplication: { command: ["mine"] } };

    expect(expandShortForms(entries, SHIPPED_SENSORS)).toEqual(entries);
  });

  it("leaves an unknown name untouched", () => {
    expect(expandShortForms({ nonesuch: {} }, SHIPPED_SENSORS)).toEqual({
      nonesuch: {},
    });
  });

  it("expands nothing for an empty shipped set", () => {
    expect(expandShortForms({ duplication: {} }, [])).toEqual({
      duplication: {},
    });
  });

  it("passes undefined through", () => {
    expect(expandShortForms(undefined, SHIPPED_SENSORS)).toBeUndefined();
  });
});

const measurers = JSON.parse(
  readFileSync(join(REPO, "fixtures/sensors/measurers.json"), "utf8"),
);

describe("expandMeasurerShortForms", () => {
  it("equals fixtures/sensors/measurers.json", () => {
    expect(SHIPPED_MEASURERS).toEqual(measurers);
  });

  it("expands mutate to a command and its metrics", () => {
    const expanded = expandMeasurerShortForms({
      mutate: { test_command: ["npm", "test"] },
    }) as { mutate: { command: string[]; metrics: unknown } };

    expect(expanded.mutate.command).toEqual([
      "recognizer-sensors",
      "mutate",
      "--repository",
      "{repository}",
      "--commit",
      "{commit}",
      "--output",
      "{output}",
      "--settings",
      '{"test_command":["npm","test"]}',
    ]);
    expect(expanded.mutate.metrics).toEqual(measurers.mutate);
  });

  it("leaves an entry with a command untouched", () => {
    const entries = { mutate: { command: ["mine"], metrics: [] } };

    expect(expandMeasurerShortForms(entries)).toEqual(entries);
  });

  it("leaves another name untouched", () => {
    expect(expandMeasurerShortForms({ other: {} })).toEqual({ other: {} });
  });

  it("passes undefined through", () => {
    expect(expandMeasurerShortForms(undefined)).toBeUndefined();
  });
});

describe("the thresholds config examples", () => {
  const example = (path: string) =>
    readFileSync(join(REPO, "schema/config-examples", path), "utf8");

  it("expands the short form exactly", () => {
    const config = parseConfig(example("valid/sensors-thresholds-short.yaml"));

    expect(config.sensors?.thresholds).toEqual({
      command: [
        "recognizer-sensors",
        "thresholds",
        "--repository",
        "{repository}",
        "--commit",
        "{commit}",
        "--output",
        "{output}",
        "--settings",
        '{"complexity":{"above":15},"coverage":"off","churn":{"above":20,"severity":"violation"}}',
      ],
    });
  });

  it("rejects both lines on one metric", () => {
    expect(() =>
      parseConfig(example("invalid/sensors-thresholds-both-lines.yaml")),
    ).toThrow(/config\/sensors\/thresholds/);
  });
});

describe("the mutation config examples", () => {
  const example = (path: string) =>
    readFileSync(join(REPO, "schema/config-examples", path), "utf8");

  it("parses the mutate short form to an ordinary registration", () => {
    const config = parseConfig(example("valid/overlays-mutate-short.yaml"));

    expect(config.overlays?.mutate?.metrics).toEqual(measurers.mutate);
    expect(config.overlays?.mutate?.command[1]).toBe("mutate");
    expect(config.overlays?.mutate?.runs_tests).toBe(true);
  });

  it("reads runs_tests from the committed overlays example and rejects a string", () => {
    const config = parseConfig(example("valid/overlays.yaml"));

    expect(Object.keys(config.overlays ?? {})).toEqual(["coverage"]);
    expect(config.overlays?.coverage?.runs_tests).toBe(true);
    expect(() =>
      parseConfig(example("invalid/overlays-runs-tests-not-boolean.yaml")),
    ).toThrow();
  });

  it("parses the mutation sensor short form", () => {
    const config = parseConfig(example("valid/sensors-mutation-short.yaml"));

    expect(config.sensors?.mutation).toEqual({
      command: expect.arrayContaining(["recognizer-sensors", "mutation"]),
    });
  });

  it("rejects mutate without a test command", () => {
    expect(() =>
      parseConfig(example("invalid/overlays-mutate-no-test-command.yaml")),
    ).toThrow();
  });
});
