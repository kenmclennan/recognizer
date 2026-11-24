import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expandShortForms,
  isScoped,
  receivesSuites,
  runsTests,
  selectSensors,
  withSuiteSettings,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import {
  parseConfig,
  registeredSensorSettings,
  registeredSensors,
} from "../src/config-parse.js";
import { InputError } from "../src/errors.js";
import { SCAN_SCHEMA_VERSION } from "../src/scan.js";
import { REPO } from "./helpers.js";
import {
  readExamples,
  readRegisteredExamples,
  selectedWithExamples,
} from "./installed-read.js";

const INSTALLED: readonly string[] = ["crap", "mutation"];

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

describe("expandShortForms for crap", () => {
  it("puts the settings JSON last", () => {
    const expanded = expandShortForms({
      crap: { threshold: 20 },
    }) as { crap: { command: string[] } };

    expect(expanded.crap.command[0]).toBe("recognizer-sense-crap");
    expect(expanded.crap.command[1]).toBe("run");
    expect(expanded.crap.command.at(-1)).toBe('{"threshold":20}');
  });
});

describe("expandShortForms for thresholds", () => {
  it("carries the mapping as the settings JSON", () => {
    const expanded = expandShortForms({ crap: { coverage_limit: 0.7 } }) as {
      crap: { command: string[] };
    };

    expect(expanded.crap.command[0]).toBe("recognizer-sense-crap");
    expect(expanded.crap.command[1]).toBe("run");
    expect(expanded.crap.command.at(-1)).toBe('{"coverage_limit":0.7}');
  });
});

describe("expandShortForms", () => {
  it("expands an empty mapping", () => {
    expect(expandShortForms({ crap: {} })).toEqual({
      crap: { command: command("{}") },
    });
  });

  it("carries the settings as JSON", () => {
    expect(expandShortForms({ crap: { threshold: 0.9 } })).toEqual({
      crap: { command: command('{"threshold":0.9}') },
    });
  });

  it("leaves an entry with a command untouched", () => {
    const entries = { crap: { command: ["mine"] } };

    expect(expandShortForms(entries)).toEqual(entries);
  });

  it("expands every name but structure", () => {
    expect(
      expandShortForms({ tally: {}, structure: {}, nonesuch: { limit: 3 } }),
    ).toEqual({
      tally: {
        command: command("{}").map((word) =>
          word === "recognizer-sense-crap" ? "recognizer-sense-tally" : word,
        ),
      },
      structure: {},
      nonesuch: {
        command: command('{"limit":3}').map((word) =>
          word === "recognizer-sense-crap" ? "recognizer-sense-nonesuch" : word,
        ),
      },
    });
  });

  it("needs no second argument", () => {
    expect(expandShortForms({ tally: {} })).toBeDefined();
  });

  it("passes undefined through", () => {
    expect(expandShortForms(undefined)).toBeUndefined();
  });

  it("emits a manifest key as the entry's manifest and keeps it out of the settings", () => {
    const expanded = expandShortForms({
      mine: {
        manifest: ["recognizer-sense-mine", "manifest"],
        max_minutes: 10,
      },
    }) as { mine: { command: string[]; manifest?: string[] } };

    expect(expanded.mine.manifest).toEqual([
      "recognizer-sense-mine",
      "manifest",
    ]);
    expect(JSON.parse(expanded.mine.command.at(-1) ?? "")).toEqual({
      max_minutes: 10,
    });
  });

  it("expands a mapping with no manifest without one", () => {
    const expanded = expandShortForms({ mine: { max_minutes: 10 } }) as {
      mine: Record<string, unknown>;
    };

    expect(Object.keys(expanded.mine)).toEqual(["command"]);
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
  const withManifest = (name: string) => ({
    name,
    command: [`recognizer-sense-${name}`, "run"],
    manifest: [`recognizer-sense-${name}`, "manifest"],
  });
  const installed = readRegisteredExamples([
    withManifest("crap"),
    withManifest("mutation"),
  ]);

  it("lists crap and mutation and hides the configuration-only sensors", () => {
    expect(
      installed.sensors.filter(({ listed }) => listed).map(({ name }) => name),
    ).toEqual(["crap", "mutation"]);
    expect(
      installed.sensors.filter(({ listed }) => !listed).map(({ name }) => name),
    ).toEqual([]);
  });

  it("marks only crap and mutation as running tests", () => {
    expect(
      installed.sensors
        .filter(({ runs_tests }) => runs_tests)
        .map(({ name }) => name),
    ).toEqual(["crap", "mutation"]);
  });

  it("marks only mutation as taking a module scope, read from the manifests", () => {
    expect(isScoped(["recognizer-sense-mutation", "run"], installed)).toBe(
      true,
    );

    for (const name of ["crap"]) {
      expect(isScoped([`recognizer-sense-${name}`, "run"], installed)).toBe(
        false,
      );
    }

    expect(isScoped(["my-mutation", "mutation"], installed)).toBe(false);
  });

  it("tests the run command, not the name alone, for runs_tests", () => {
    expect(runsTests(["recognizer-sense-crap", "run"], installed)).toBe(true);
    expect(runsTests(["recognizer-sense-mutation", "run"], installed)).toBe(
      true,
    );
    expect(runsTests(["my-crap", "crap"], installed)).toBe(false);
  });

  it("answers true for a custom command with a registered entry and false without one", () => {
    const custom = ["python3", "sense.py", "run", "--settings", "{}"];
    const registered = readRegisteredExamples([
      {
        name: "crap",
        command: custom,
        manifest: ["recognizer-sense-crap", "manifest"],
      },
    ]);

    expect(runsTests(custom, registered)).toBe(true);
    expect(runsTests(custom, readRegisteredExamples([]))).toBe(false);
    expect(isScoped(custom, readRegisteredExamples([]))).toBe(false);
  });

  it("adds the suites to the settings of a custom command whose entry runs tests", () => {
    const custom = ["python3", "sense.py", "run", "--settings", "{}"];
    const registered = readRegisteredExamples([
      {
        name: "crap",
        command: custom,
        manifest: ["recognizer-sense-crap", "manifest"],
      },
    ]);
    const suites = [{ name: "api" }];

    expect(withSuiteSettings(custom, registered, suites).at(-1)).toBe(
      JSON.stringify({ tests: suites }),
    );
    expect(withSuiteSettings(custom, readRegisteredExamples([]), suites)).toBe(
      custom,
    );
  });

  it("answers false for every sensor when no manifest was read", () => {
    const none = readRegisteredExamples(
      [withManifest("crap"), withManifest("mutation")],
      ["crap", "mutation"],
    );

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

  it("accepts a manifest beside a command and beside a short form", () => {
    const command = parseConfig(example("valid/sensors-manifest-command.yaml"));
    const short = parseConfig(example("valid/sensors-manifest-short.yaml"));

    expect(registeredSensors(command)[0]?.manifest).toEqual([
      "python3",
      "tools/sense.py",
      "manifest",
    ]);
    expect(
      registeredSensors(short).map((one) => [one.name, one.manifest]),
    ).toEqual([
      ["crap", ["recognizer-sense-crap", "manifest"]],
      ["mutation", ["recognizer-sense-mutation", "manifest"]],
    ]);
  });

  it("rejects an empty manifest, naming it", () => {
    expect(() =>
      parseConfig(example("invalid/sensors-manifest-empty.yaml")),
    ).toThrow(/manifest/);
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

describe("registeredSensorSettings", () => {
  it("returns the settings a short-form entry was expanded with", () => {
    const config = parseConfig(
      "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n    threshold: 25\n  mutation:\n    manifest: [recognizer-sense-mutation, manifest]\n    max_workers: 2\n",
    );

    expect(registeredSensorSettings(config, "crap")).toEqual({ threshold: 25 });
    expect(registeredSensorSettings(config, "mutation")).toEqual({
      max_workers: 2,
    });
  });

  it("returns null when the sensor is not registered or there is no config", () => {
    const config = parseConfig("sensors:\n  crap:\n    threshold: 25\n");

    expect(registeredSensorSettings(config, "mutation")).toBeNull();
    expect(registeredSensorSettings(null, "crap")).toBeNull();
  });

  it("returns null for a custom command and for settings that do not parse", () => {
    const custom = parseConfig(
      "sensors:\n  crap:\n    command: [my-tool, --settings, '{\"threshold\": 1}']\n",
    );
    const broken = parseConfig(
      "sensors:\n  crap:\n    command: [recognizer-sensors, crap, --settings, '{nope']\n",
    );

    expect(registeredSensorSettings(custom, "crap")).toBeNull();
    expect(registeredSensorSettings(broken, "crap")).toBeNull();
  });

  it("returns the settings of a custom command that carries a manifest", () => {
    const custom = parseConfig(
      "sensors:\n  mine:\n    command: [python3, sense.py, run, --settings, '{\"limit\": 3}']\n    manifest: [python3, sense.py, manifest]\n",
    );

    expect(registeredSensorSettings(custom, "mine")).toEqual({ limit: 3 });
  });

  it("returns null for a recognizer-sense program that names no manifest", () => {
    const bare = parseConfig("sensors:\n  crap:\n    threshold: 25\n");

    expect(registeredSensorSettings(bare, "crap")).toBeNull();
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
    "invalid/tests-missing-coverage.yaml",
    "invalid/tests-unknown-key.yaml",
    "invalid/tests-absolute-directory.yaml",
    "invalid/sensors-crap-test-command.yaml",
  ])("rejects %s", (path) => {
    expect(() => parseConfig(example(path))).toThrow(InputError);
  });

  it.each([
    "unpublished/tests-unknown-language.yaml",
    "unpublished/tests-bad-coverage-format.yaml",
  ])(
    "reads %s, leaving the published values to survey and the doctor",
    (path) => {
      expect(parseConfig(example(path)).tests?.length).toBeGreaterThan(0);
    },
  );

  it("accepts any non-empty language, runner and coverage format", () => {
    const text = `tests:\n  - name: odd\n    language: zig\n    directory: .\n    command: x\n    runner: mocha\n    coverage:\n      path: c\n      format: tap\n`;

    expect(parseConfig(text).tests?.[0]).toMatchObject({
      language: "zig",
      runner: "mocha",
      coverage: { format: "tap" },
    });
  });

  it.each([
    [
      "language",
      'tests:\n  - name: a\n    language: ""\n    directory: .\n    command: x\n    coverage:\n      path: c\n      format: lcov\n',
    ],
    [
      "runner",
      'tests:\n  - name: a\n    language: python\n    directory: .\n    command: x\n    runner: ""\n    coverage:\n      path: c\n      format: lcov\n',
    ],
    [
      "coverage format",
      'tests:\n  - name: a\n    language: python\n    directory: .\n    command: x\n    coverage:\n      path: c\n      format: ""\n',
    ],
  ])("refuses an empty %s", (_, text) => {
    expect(() => parseConfig(text)).toThrow(InputError);
  });

  it("rejects a duplicate suite name, naming it", () => {
    const text = `${example("valid/tests-python-activate.yaml")}${example("valid/tests-python-activate.yaml").split("\n").slice(1).join("\n")}`;

    expect(() => parseConfig(text)).toThrow(
      /test suite name api is used twice/,
    );
  });

  it("hands the list to the crap and mutation short forms and to no other sensor", () => {
    const config = parseConfig(
      `${example("valid/tests-python-activate.yaml")}sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n  mutation:\n    manifest: [recognizer-sense-mutation, manifest]\n  mine:\n    command: [mine, run]\n`,
    );
    const selected = selectedWithExamples(
      registeredSensors(config),
      "all",
      INSTALLED,
      config.tests,
    );

    expect(settingsOf(selected[0]).tests).toEqual(config.tests);
    expect(settingsOf(selected[1]).tests).toEqual(config.tests);
    expect((selected[2] as { command: string[] }).command).toEqual([
      "mine",
      "run",
    ]);
  });

  it("hands no list to a mutation short form when the config has none", () => {
    const config = parseConfig(
      "sensors:\n  mutation:\n    manifest: [recognizer-sense-mutation, manifest]\n",
    );
    const selected = selectedWithExamples(
      registeredSensors(config),
      "all",
      INSTALLED,
      config.tests,
    );

    expect(settingsOf(selected[0])).toEqual({});
  });

  it("hands the list to a requested crap and mutation that are not registered", () => {
    const suites = [{ name: "api" }];
    const selected = selectedWithExamples(
      [],
      ["crap", "mutation"],
      INSTALLED,
      suites,
    );

    expect(settingsOf(selected[0])).toEqual({ tests: suites });
    expect(settingsOf(selected[1])).toEqual({ tests: suites });
  });

  it("builds a requested mutation with no tests key when the config has none", () => {
    const selected = selectSensors([], ["mutation"], INSTALLED);

    expect(settingsOf(selected[0])).toEqual({});
  });

  it("builds a requested crap with no tests key when the config has none", () => {
    const selected = selectSensors([], ["crap"], INSTALLED);

    expect(settingsOf(selected[0])).toEqual({});
  });
});

describe("parseConfig short form for any sensor name", () => {
  const words = (name: string, settings: string) =>
    command(settings).map((word) =>
      word === "recognizer-sense-crap" ? `recognizer-sense-${name}` : word,
    );

  it("expands tally: {} and a mapping to the command with the settings JSON", () => {
    const config = parseConfig(
      "sensors:\n  tally: {}\n  margin:\n    threshold: 3\n",
    );

    expect(config.sensors?.tally).toEqual({ command: words("tally", "{}") });
    expect(config.sensors?.margin).toEqual({
      command: words("margin", '{"threshold":3}'),
    });
  });

  it("leaves a command-form entry as written", () => {
    const config = parseConfig(
      "sensors:\n  tally:\n    command: [mine, run]\n",
    );

    expect(config.sensors?.tally).toEqual({ command: ["mine", "run"] });
  });

  it("refuses a command-less unused-exports naming its config path", () => {
    expect(() => parseConfig("sensors:\n  unused-exports: {}\n")).toThrow(
      /config\/sensors\/unused-exports/,
    );
  });
});
