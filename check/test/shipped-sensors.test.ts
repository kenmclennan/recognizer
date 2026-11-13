import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig, shippedSensorSettings } from "../src/config-parse.js";
import { InputError } from "../src/errors.js";
import { SCAN_SCHEMA_VERSION } from "../src/scan.js";
import { selectSensors } from "../src/scan-phases.js";
import {
  expandShortForms,
  isScoped,
  runsTests,
  SHIPPED_SENSOR_LIST,
  SHIPPED_SENSORS,
  shippedSensorNames,
} from "../src/shipped-sensors.js";
import { REPO } from "./helpers.js";

const command = (settings: string) => [
  "recognizer-sense-thresholds",
  "run",
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

    expect(expanded.crap.command[0]).toBe("recognizer-sense-crap");
    expect(expanded.crap.command[1]).toBe("run");
    expect(expanded.crap.command.at(-1)).toBe('{"threshold":20}');
  });
});

describe("expandShortForms for thresholds", () => {
  it("carries the mapping as the settings JSON", () => {
    const expanded = expandShortForms(
      { thresholds: { complexity: { above: 15 } } },
      SHIPPED_SENSORS,
    ) as { thresholds: { command: string[] } };

    expect(expanded.thresholds.command[0]).toBe("recognizer-sense-thresholds");
    expect(expanded.thresholds.command[1]).toBe("run");
    expect(expanded.thresholds.command.at(-1)).toBe(
      '{"complexity":{"above":15}}',
    );
  });
});

describe("expandShortForms", () => {
  it("expands an empty mapping", () => {
    expect(expandShortForms({ thresholds: {} }, SHIPPED_SENSORS)).toEqual({
      thresholds: { command: command("{}") },
    });
  });

  it("carries the settings as JSON", () => {
    expect(
      expandShortForms({ thresholds: { threshold: 0.9 } }, SHIPPED_SENSORS),
    ).toEqual({ thresholds: { command: command('{"threshold":0.9}') } });
  });

  it("leaves an entry with a command untouched", () => {
    const entries = { thresholds: { command: ["mine"] } };

    expect(expandShortForms(entries, SHIPPED_SENSORS)).toEqual(entries);
  });

  it("leaves an unknown name untouched", () => {
    expect(expandShortForms({ nonesuch: {} }, SHIPPED_SENSORS)).toEqual({
      nonesuch: {},
    });
  });

  it("expands nothing for an empty shipped set", () => {
    expect(expandShortForms({ thresholds: {} }, [])).toEqual({
      thresholds: {},
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
        "recognizer-sense-thresholds",
        "run",
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
        "scoped",
      ]);
    }
  });

  it("lists crap and mutation and hides the configuration-only sensors", () => {
    expect(
      SHIPPED_SENSOR_LIST.filter(({ listed }) => listed)
        .map(({ name }) => name)
        .sort(),
    ).toEqual(["crap", "mutation"]);
    expect(
      SHIPPED_SENSOR_LIST.filter(({ listed }) => !listed).map(
        ({ name }) => name,
      ),
    ).toEqual(["thresholds"]);
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

  it("marks only mutation as taking a module scope, read from the committed list", () => {
    expect(
      list
        .filter((entry: { scoped: boolean }) => entry.scoped)
        .map((entry: { name: string }) => entry.name),
    ).toEqual(["mutation"]);
    expect(isScoped(["recognizer-sense-mutation", "run"])).toBe(true);

    for (const name of ["crap", "thresholds"]) {
      expect(isScoped(["recognizer-sensors", name])).toBe(false);
    }

    expect(isScoped(["my-mutation", "mutation"])).toBe(false);
  });

  it("tests the run command, not the name alone, for runs_tests", () => {
    expect(runsTests(["recognizer-sense-crap", "run"])).toBe(true);
    expect(runsTests(["recognizer-sense-mutation", "run"])).toBe(true);
    expect(runsTests(["recognizer-sense-thresholds", "run"])).toBe(false);
    expect(runsTests(["my-crap", "crap"])).toBe(false);
  });
});

describe("the sensor config examples", () => {
  const example = (path: string) =>
    readFileSync(join(REPO, "schema/config-examples", path), "utf8");

  it("retires the overlays key with a committed old registration", () => {
    expect(() => parseConfig(example("invalid/overlays-retired.yaml"))).toThrow(
      /config\/overlays is retired.*measurers are gone/,
    );
  });

  it("accepts carry and max_minutes under sensors.mutation", () => {
    const config = parseConfig(example("valid/sensors-mutation-carry.yaml"));
    const entry = config.sensors?.mutation as { command: string[] };
    const command = entry.command;

    expect(command[0]).toBe("recognizer-sense-mutation");
    expect(command[1]).toBe("run");
    expect(JSON.parse(command.at(-1) ?? "")).toEqual({
      carry: ["frontend/node_modules"],
      max_minutes: 5,
    });
  });

  it.each([
    "invalid/sensors-mutation-test-command.yaml",
    "invalid/sensors-mutation-coverage.yaml",
  ])("refuses the retired mutation setting in %s", (path) => {
    expect(() => parseConfig(example(path))).toThrow(
      /config\/sensors\/mutation/,
    );
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

  it("retires the old mutate form with the same message", () => {
    expect(() =>
      parseConfig("overlays:\n  mutate:\n    test_command: [npm, test]\n"),
    ).toThrow(/config\/overlays is retired.*measurers are gone/);
  });

  it("retires an overlays key that holds a mutate command", () => {
    expect(() =>
      parseConfig(
        "overlays:\n  mutate:\n    command: [run]\n    metrics:\n      - {name: m, type: count, granularity: member, bad: high}\n",
      ),
    ).toThrow(/config\/overlays is retired.*measurers are gone/);
  });

  it("still parses a config without overlays", () => {
    expect(parseConfig("sensors:\n  crap: {}\n").sensors).toBeDefined();
  });
});

describe("shippedSensorSettings", () => {
  it("returns the settings a short-form entry was expanded with", () => {
    const config = parseConfig(
      "sensors:\n  crap:\n    threshold: 25\n  thresholds:\n    complexity:\n      above: 12\n",
    );

    expect(shippedSensorSettings(config, "crap")).toEqual({ threshold: 25 });
    expect(shippedSensorSettings(config, "thresholds")).toEqual({
      complexity: { above: 12 },
    });
  });

  it("returns null when the sensor is not registered or there is no config", () => {
    const config = parseConfig("sensors:\n  crap:\n    threshold: 25\n");

    expect(shippedSensorSettings(config, "thresholds")).toBeNull();
    expect(shippedSensorSettings(null, "crap")).toBeNull();
  });

  it("returns null for a custom command and for settings that do not parse", () => {
    const custom = parseConfig(
      "sensors:\n  crap:\n    command: [my-tool, --settings, '{\"threshold\": 1}']\n",
    );
    const broken = parseConfig(
      "sensors:\n  crap:\n    command: [recognizer-sensors, crap, --settings, '{nope']\n",
    );

    expect(shippedSensorSettings(custom, "crap")).toBeNull();
    expect(shippedSensorSettings(broken, "crap")).toBeNull();
  });

  it("reads scan schema version 7", () => {
    expect(SCAN_SCHEMA_VERSION).toBe(7);
  });
});

describe("the tests list", () => {
  const example = (path: string) =>
    readFileSync(join(REPO, "schema/config-examples", path), "utf8");
  const settingsOf = (entry: unknown): Record<string, unknown> => {
    const command = (entry as { command: string[] }).command;

    return JSON.parse(command.at(-1) ?? "{}");
  };

  it.each([
    "valid/tests-python-activate.yaml",
    "valid/tests-typescript-vitest.yaml",
    "valid/tests-typescript-jest.yaml",
    "valid/tests-five-languages.yaml",
  ])("accepts %s", (path) => {
    expect(parseConfig(example(path)).tests?.length).toBeGreaterThan(0);
  });

  it.each([
    "invalid/tests-empty.yaml",
    "invalid/tests-unknown-language.yaml",
    "invalid/tests-typescript-without-runner.yaml",
    "invalid/tests-runner-on-python.yaml",
    "invalid/tests-bad-coverage-format.yaml",
    "invalid/tests-missing-coverage.yaml",
    "invalid/tests-unknown-key.yaml",
    "invalid/tests-absolute-directory.yaml",
    "invalid/sensors-crap-test-command.yaml",
  ])("rejects %s", (path) => {
    expect(() => parseConfig(example(path))).toThrow(InputError);
  });

  it("rejects a duplicate suite name, naming it", () => {
    const text = `${example("valid/tests-python-activate.yaml")}${example("valid/tests-python-activate.yaml").split("\n").slice(1).join("\n")}`;

    expect(() => parseConfig(text)).toThrow(
      /test suite name api is used twice/,
    );
  });

  it("hands the list to the crap and mutation short forms and to no other sensor", () => {
    const config = parseConfig(
      `${example("valid/tests-python-activate.yaml")}sensors:\n  crap: {}\n  mutation: {}\n  thresholds: {}\n`,
    );

    expect(settingsOf(config.sensors?.crap).tests).toEqual(config.tests);
    expect(settingsOf(config.sensors?.mutation).tests).toEqual(config.tests);
    expect(settingsOf(config.sensors?.thresholds)).toEqual({});
  });

  it("hands no list to a mutation short form when the config has none", () => {
    const config = parseConfig("sensors:\n  mutation: {}\n");

    expect(settingsOf(config.sensors?.mutation)).toEqual({});
  });

  it("hands the list to a requested crap and mutation that are not registered", () => {
    const suites = [{ name: "api" }];
    const selected = selectSensors(
      [],
      ["crap", "mutation", "thresholds"],
      SHIPPED_SENSORS,
      suites,
    );

    expect(settingsOf(selected[0])).toEqual({ tests: suites });
    expect(settingsOf(selected[1])).toEqual({ tests: suites });
    expect(settingsOf(selected[2])).toEqual({});
  });

  it("builds a requested mutation with no tests key when the config has none", () => {
    const selected = selectSensors([], ["mutation"], SHIPPED_SENSORS);

    expect(settingsOf(selected[0])).toEqual({});
  });

  it("builds a requested crap with no tests key when the config has none", () => {
    const selected = selectSensors([], ["crap"], SHIPPED_SENSORS);

    expect(settingsOf(selected[0])).toEqual({});
  });
});
