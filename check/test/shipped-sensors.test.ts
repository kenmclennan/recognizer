import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config-parse.js";
import {
  expandShortForms,
  runsTests,
  SHIPPED_SENSOR_LIST,
  SHIPPED_SENSORS,
  shippedSensorNames,
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

describe("the registry", () => {
  const list = JSON.parse(
    readFileSync(join(REPO, "fixtures/sensors/list.json"), "utf8"),
  );

  it("equals fixtures/sensors/list.json", () => {
    expect(JSON.parse(JSON.stringify(SHIPPED_SENSOR_LIST))).toEqual(list);
  });

  it("gives every entry exactly the registry keys", () => {
    for (const entry of SHIPPED_SENSOR_LIST) {
      expect(Object.keys(entry).sort()).toEqual([
        "defaults",
        "display",
        "line",
        "listed",
        "metrics",
        "name",
        "runs_tests",
      ]);
    }
  });

  it("lists crap, duplication and mutation and hides the configuration-only sensors", () => {
    expect(
      SHIPPED_SENSOR_LIST.filter(({ listed }) => listed)
        .map(({ name }) => name)
        .sort(),
    ).toEqual(["crap", "duplication", "mutation"]);
    expect(
      SHIPPED_SENSOR_LIST.filter(({ listed }) => !listed).map(
        ({ name }) => name,
      ),
    ).toEqual(["unused-exports", "thresholds"]);
  });

  it("marks only crap and mutation as running tests", () => {
    expect(
      SHIPPED_SENSOR_LIST.filter(({ runs_tests }) => runs_tests).map(
        ({ name }) => name,
      ),
    ).toEqual(["crap", "mutation"]);
  });

  it("names the shipped sensors", () => {
    expect(shippedSensorNames()).toEqual([...SHIPPED_SENSORS]);
  });

  it("tests the run command, not the name alone, for runs_tests", () => {
    expect(runsTests(["recognizer-sensors", "crap"])).toBe(true);
    expect(runsTests(["recognizer-sensors", "mutation"])).toBe(true);
    expect(runsTests(["recognizer-sensors", "duplication"])).toBe(false);
    expect(runsTests(["my-crap", "crap"])).toBe(false);
  });
});

describe("the sensor config examples", () => {
  const example = (path: string) =>
    readFileSync(join(REPO, "schema/config-examples", path), "utf8");

  it("reads runs_tests from the committed overlays example and rejects a string", () => {
    const config = parseConfig(example("valid/overlays.yaml"));

    expect(Object.keys(config.overlays ?? {})).toEqual(["coverage"]);
    expect(config.overlays?.coverage?.runs_tests).toBe(true);
    expect(() =>
      parseConfig(example("invalid/overlays-runs-tests-not-boolean.yaml")),
    ).toThrow();
  });

  it("accepts test_command and max_minutes under sensors.mutation", () => {
    const config = parseConfig(
      example("valid/sensors-mutation-test-command.yaml"),
    );
    const entry = config.sensors?.mutation as { command: string[] };
    const command = entry.command;

    expect(command[1]).toBe("mutation");
    expect(JSON.parse(command.at(-1) ?? "")).toEqual({
      test_command: ["npm", "test"],
      max_minutes: 5,
    });
  });

  it("accepts the new mutation and crap keys", () => {
    expect(() =>
      parseConfig(example("valid/sensors-mutation-short.yaml")),
    ).not.toThrow();
    expect(() =>
      parseConfig(example("valid/sensors-crap-short.yaml")),
    ).not.toThrow();
  });

  it("rejects the retired crap overlay setting under sensors.mutation", () => {
    const retired = ["crap", "overlay"].join("_");

    expect(() =>
      parseConfig(`sensors:\n  mutation:\n    ${retired}: x.json\n`),
    ).toThrow(/config\/sensors\/mutation/);
  });

  it("gives crap no default coverage", () => {
    const config = parseConfig("sensors:\n  crap: {}\n");
    const entry = config.sensors?.crap as { command: string[] };
    const command = entry.command;

    expect(command.at(-1)).toBe("{}");
  });

  it("retires overlays.mutate when it has no command", () => {
    expect(() =>
      parseConfig(example("invalid/overlays-mutate-retired.yaml")),
    ).toThrow(
      "config/overlays/mutate is retired: move test_command and max_minutes to sensors.mutation",
    );
  });

  it("keeps mutate an ordinary overlay name when it has a command", () => {
    const config = parseConfig(
      "overlays:\n  mutate:\n    command: [run]\n    metrics:\n      - {name: m, type: count, granularity: member, bad: high}\n",
    );

    expect(config.overlays?.mutate?.command).toEqual(["run"]);
  });
});
