import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CORE_KEYS,
  type KeyEntry,
  type KeySchema,
  type Manifest,
  type PaneSensor,
  placeholderPattern,
  publish,
  publishedModel,
  type SettingsPane,
  settingsPanes,
} from "@recognizer/core";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";
import { manifestOf, type RealTool, realTools } from "./plugin-tools.js";

function json(path: string): unknown {
  return JSON.parse(readFileSync(join(REPO, path), "utf8"));
}

const TOOLS = new Map<string, RealTool>(
  realTools().map((tool) => [tool.name, tool]),
);

function manifest(name: string) {
  return manifestOf(TOOLS.get(name) as RealTool);
}

describe("the installed manifests equal the sources they transcribe", () => {
  it("holds the language rules the scanner manifests declare", () => {
    const declared = [
      "recognizer-scan-python",
      "recognizer-scan-typescript",
    ].flatMap((name) => manifest(name).languages ?? []);

    expect(declared).toEqual(
      (json("fixtures/plugins/languages.json") as { name: string }[]).filter(
        (rule) => ["python", "typescript"].includes(rule.name),
      ),
    );
  });

  it.each([
    ["recognizer-scan-python", "python"],
    ["recognizer-scan-typescript", "typescript"],
  ])("gives %s the shared rules of %s", (command, language) => {
    const rules = (
      json("fixtures/plugins/languages.json") as { name: string }[]
    ).find((one) => one.name === language);

    expect(manifest(command).languages).toEqual([rules]);
  });

  it("publishes grammars whose names are the vendored grammars and whose function types are set", () => {
    const grammars = (
      json("fixtures/plugins/languages.json") as {
        grammars: { name: string; function_types: string[] }[];
      }[]
    ).flatMap((language) => language.grammars);
    const provenance = json("packages/cli/grammars/PROVENANCE.json") as {
      grammars: Record<string, unknown>;
    };

    expect(grammars.map((grammar) => grammar.name).sort()).toEqual(
      Object.keys(provenance.grammars).sort(),
    );
    expect(grammars).toHaveLength(6);

    for (const grammar of grammars) {
      expect(grammar.function_types.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ["crap", true, false],
    ["mutation", true, true],
  ])(
    "gives recognizer-sense-%s runs_tests %s and scoped %s",
    (name, runsTests, scoped) => {
      const made = manifest(`recognizer-sense-${name}`);

      expect(made.runs_tests).toBe(runsTests);
      expect(made.scoped).toBe(scoped);
    },
  );

  it("gives the sensors the time limits and unit words of today's code", () => {
    expect(manifest("recognizer-describe-claude")).toMatchObject({
      long_running: false,
      time_limit_seconds: 120,
      units: ["files"],
      check: true,
    });
    expect(manifest("recognizer-sense-crap")).toMatchObject({
      long_running: true,
      units: ["functions"],
      check: true,
    });
  });
});

const DISPLAY = [
  "label",
  "labels",
  "unit",
  "units",
  "order",
  "limit",
  "section",
  "scope",
  "switch",
];

function undisplayed(entry: unknown): KeyEntry {
  return Object.fromEntries(
    Object.entries(entry as Record<string, unknown>).filter(
      ([name]) => !DISPLAY.includes(name),
    ),
  ) as unknown as KeyEntry;
}

function realPanes(): SettingsPane[] {
  const sensors = ["crap", "mutation"].map((name) =>
    manifest(`recognizer-sense-${name}`),
  );
  const placeholders: Record<string, string> = {};
  const keys: KeyEntry[] = [];

  for (const one of sensors) {
    for (const [name, declaration] of Object.entries(one.placeholders ?? {})) {
      placeholders[name] = placeholderPattern(declaration);
    }

    for (const entry of one.settings) {
      keys.push({
        ...undisplayed(entry),
        key: `sensors.${one.name}.${(entry as KeyEntry).key}`,
      });
    }
  }

  const suite = sensors[0]?.suite_keys;
  const schema: KeySchema = {
    keys_version: 1,
    owner: "sensors",
    placeholders,
    sections: [],
    keys: [...keys, ...((suite?.keys ?? []) as unknown[]).map(undisplayed)],
  };

  return settingsPanes({
    sensors: sensors.map(
      (one: Manifest): PaneSensor => ({
        name: one.name,
        display: one.display,
        runs_tests: one.runs_tests === true,
        ...(one.suite_keys === undefined ? {} : { suite_keys: one.suite_keys }),
        settings: one.settings,
      }),
    ),
    describers: [
      (({ name, display, settings }: Manifest) => ({
        name,
        display,
        settings,
      }))(manifest("recognizer-describe-claude")),
    ],
    published: publish([CORE_KEYS, schema], "config"),
  });
}

describe("the settings panes of the real manifests", () => {
  it("lists the panes in the approved order with the real sensors and describer", () => {
    const panes = realPanes();
    const names = (group: string) =>
      panes.filter((pane) => pane.group === group).map((pane) => pane.name);

    expect(names("machine")).toEqual(["Editor", "Describing", "Setup"]);
    expect(names("repository")).toEqual([
      "Structural analysis",
      "C.R.A.P.",
      "Mutation",
      "Test suites",
    ]);
  });

  it("gives Structural analysis the sections Warnings, Limits and Duplication with 4, 2 and 4 fields", () => {
    const structure = realPanes().find((pane) => pane.id === "structure");

    expect(
      structure?.sections.map((section) => [
        section.title,
        section.settings.length,
      ]),
    ).toEqual([
      ["Warnings", 4],
      ["Limits", 2],
      ["Duplication", 4],
    ]);
  });

  it("puts the describer's model first in Describing as a machine field", () => {
    const describing = realPanes().find((pane) => pane.id === "describing");
    const fields = (describing?.sections ?? []).flatMap(
      (section) => section.settings,
    );

    expect(fields.map((field) => field.key)).toEqual([
      "describing.model",
      "describing.batch_size",
      "describing.confirm_above_usd",
    ]);
    expect(fields[0]).toMatchObject({
      default: "haiku",
      scope: "machine",
      label: "Model",
    });
  });

  it("publishes the claude describer's model default, held only in the describer", () => {
    expect(
      publishedModel(manifest("recognizer-describe-claude").settings),
    ).toBe("haiku");
  });

  it("validates prices for a describer and refuses them on a sensor", () => {
    const validate = new Ajv2020({ allErrors: true }).compile(
      json("schema/manifest.schema.json") as object,
    );
    const describer = json(
      "schema/manifest-examples/valid/describer.json",
    ) as object;
    const sensor = json(
      "schema/manifest-examples/valid/sensor-crap.json",
    ) as object;
    const prices = { haiku: { input: 0.1, output: 0.5 } };

    expect(validate({ ...describer, prices })).toBe(true);
    expect(validate({ ...sensor, prices })).toBe(false);
  });

  it("labels the suite keys of the sensors that run tests", () => {
    const suites = realPanes().find((pane) => pane.id === "suites");

    expect(suites?.suites?.keys.map((entry) => entry.label)).toEqual([
      "Language",
      "Directory",
      "Command",
      "Activate",
      "Runner",
      "Environment variable",
      "Coverage report",
      "Coverage format",
    ]);
  });
});
