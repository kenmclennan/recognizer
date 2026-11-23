import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expandShortForms,
  isScoped,
  receivesSuites,
  runsTests,
  selectSensors,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { shippedSensorNames } from "../src/adapters/plugins/shipped-plugins-adapter.js";
import {
  parseConfig,
  registeredSensors,
  shippedSensorSettings,
} from "../src/config-parse.js";
import { InputError } from "../src/errors.js";
import { SCAN_SCHEMA_VERSION } from "../src/scan.js";
import { REPO } from "./helpers.js";
import { readExamples } from "./shipped-read.js";

const SHIPPED_SENSORS: readonly string[] = shippedSensorNames();

const command = (settings: string) => [
  "recognizer-sense-crap",
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
      { crap: { coverage_limit: 0.7 } },
      SHIPPED_SENSORS,
    ) as { crap: { command: string[] } };

    expect(expanded.crap.command[0]).toBe("recognizer-sense-crap");
    expect(expanded.crap.command[1]).toBe("run");
    expect(expanded.crap.command.at(-1)).toBe('{"coverage_limit":0.7}');
  });
});

describe("expandShortForms", () => {
  it("expands an empty mapping", () => {
    expect(expandShortForms({ crap: {} }, SHIPPED_SENSORS)).toEqual({
      crap: { command: command("{}") },
    });
  });

  it("carries the settings as JSON", () => {
    expect(
      expandShortForms({ crap: { threshold: 0.9 } }, SHIPPED_SENSORS),
    ).toEqual({ crap: { command: command('{"threshold":0.9}') } });
  });

  it("leaves an entry with a command untouched", () => {
    const entries = { crap: { command: ["mine"] } };

    expect(expandShortForms(entries, SHIPPED_SENSORS)).toEqual(entries);
  });

  it("leaves an unknown name untouched", () => {
    expect(expandShortForms({ nonesuch: {} }, SHIPPED_SENSORS)).toEqual({
      nonesuch: {},
    });
  });

  it("expands nothing for an empty shipped set", () => {
    expect(expandShortForms({ crap: {} }, [])).toEqual({
      crap: {},
    });
  });

  it("passes undefined through", () => {
    expect(expandShortForms(undefined, SHIPPED_SENSORS)).toBeUndefined();
  });
});

describe("the thresholds config examples", () => {
  it("expands the short form exactly", () => {
    const config = parseConfig(
      "sensors:\n  crap:\n    threshold: 15\n    coverage_limit: false\n",
    );

    expect(config.sensors?.crap).toEqual({
      command: command('{"threshold":15,"coverage_limit":false}'),
    });
  });

  it("rejects both lines on one metric", () => {
    expect(() =>
      parseConfig("sensors:\n  crap:\n    coverage_limit: 2\n"),
    ).toThrow(/config\/sensors\/crap/);
  });
});

describe("the registry", () => {
  const shipped = readExamples();

  it("lists crap and mutation and hides the configuration-only sensors", () => {
    expect(
      shipped.sensors.filter(({ listed }) => listed).map(({ name }) => name),
    ).toEqual(["crap", "mutation"]);
    expect(
      shipped.sensors.filter(({ listed }) => !listed).map(({ name }) => name),
    ).toEqual([]);
  });

  it("marks only crap and mutation as running tests", () => {
    expect(
      shipped.sensors
        .filter(({ runs_tests }) => runs_tests)
        .map(({ name }) => name),
    ).toEqual(["crap", "mutation"]);
  });

  it("names the shipped sensors", () => {
    expect(shippedSensorNames()).toEqual([...SHIPPED_SENSORS]);
  });

  it("marks only mutation as taking a module scope, read from the manifests", () => {
    expect(isScoped(["recognizer-sense-mutation", "run"], shipped)).toBe(true);

    for (const name of ["crap"]) {
      expect(isScoped([`recognizer-sense-${name}`, "run"], shipped)).toBe(
        false,
      );
    }

    expect(isScoped(["my-mutation", "mutation"], shipped)).toBe(false);
  });

  it("tests the run command, not the name alone, for runs_tests", () => {
    expect(runsTests(["recognizer-sense-crap", "run"], shipped)).toBe(true);
    expect(runsTests(["recognizer-sense-mutation", "run"], shipped)).toBe(true);
    expect(runsTests(["my-crap", "crap"], shipped)).toBe(false);
  });

  it("answers false for every sensor when no manifest was read", () => {
    const none = readExamples(["crap", "mutation"]);

    expect(runsTests(["recognizer-sense-crap", "run"], none)).toBe(false);
    expect(receivesSuites("crap", none)).toBe(false);
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
      "sensors:\n  crap:\n    threshold: 25\n  mutation:\n    max_workers: 2\n",
    );

    expect(shippedSensorSettings(config, "crap")).toEqual({ threshold: 25 });
    expect(shippedSensorSettings(config, "mutation")).toEqual({
      max_workers: 2,
    });
  });

  it("returns null when the sensor is not registered or there is no config", () => {
    const config = parseConfig("sensors:\n  crap:\n    threshold: 25\n");

    expect(shippedSensorSettings(config, "mutation")).toBeNull();
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
      `${example("valid/tests-python-activate.yaml")}sensors:\n  crap: {}\n  mutation: {}\n  mine:\n    command: [mine, run]\n`,
    );
    const selected = selectSensors(
      registeredSensors(config),
      "all",
      SHIPPED_SENSORS,
      config.tests,
      readExamples(),
    );

    expect(settingsOf(selected[0]).tests).toEqual(config.tests);
    expect(settingsOf(selected[1]).tests).toEqual(config.tests);
    expect((selected[2] as { command: string[] }).command).toEqual([
      "mine",
      "run",
    ]);
  });

  it("hands no list to a mutation short form when the config has none", () => {
    const config = parseConfig("sensors:\n  mutation: {}\n");
    const selected = selectSensors(
      registeredSensors(config),
      "all",
      SHIPPED_SENSORS,
      config.tests,
      readExamples(),
    );

    expect(settingsOf(selected[0])).toEqual({});
  });

  it("hands the list to a requested crap and mutation that are not registered", () => {
    const suites = [{ name: "api" }];
    const selected = selectSensors(
      [],
      ["crap", "mutation"],
      SHIPPED_SENSORS,
      suites,
      readExamples(),
    );

    expect(settingsOf(selected[0])).toEqual({ tests: suites });
    expect(settingsOf(selected[1])).toEqual({ tests: suites });
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
