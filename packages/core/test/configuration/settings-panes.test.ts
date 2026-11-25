import { describe, expect, it } from "vitest";
import {
  CORE_KEYS,
  type KeyEntry,
  type PaneDescriber,
  type PaneSensor,
  publish,
  type Setting,
  settingsPanes,
} from "../../src/index.js";

const SUITE_KEYS: KeyEntry[] = [
  {
    key: "tests.<name>.directory",
    type: "path",
    description: "the folder",
    example: "tests.unit.directory .",
  },
];

const sensorKeys = (...keys: string[]) => ({
  keys_version: 1 as const,
  owner: "sensors",
  placeholders: {
    name: "^[a-z0-9]+$",
    language: "^[a-z]+$",
  },
  sections: [],
  keys: [
    ...keys.map(
      (key): KeyEntry => ({
        key,
        type: "number",
        description: key,
        example: `${key} 1`,
      }),
    ),
    ...SUITE_KEYS,
  ],
});

const published = (...keys: string[]) =>
  publish([CORE_KEYS, sensorKeys(...keys)], "config");

const setting = (key: string, over: Partial<Setting> = {}): Setting => ({
  key,
  type: "number",
  description: key,
  example: `${key} 1`,
  ...over,
});

const sensor = (
  name: string,
  display: string,
  settings: Setting[],
  over: Partial<PaneSensor> = {},
): PaneSensor => ({
  name,
  display,
  runs_tests: false,
  settings,
  ...over,
});

const describer = (settings: Setting[] = []): PaneDescriber => ({
  name: "claude",
  display: "Claude",
  settings,
});

const names = (panes: ReturnType<typeof settingsPanes>, group?: string) =>
  panes
    .filter((pane) => group === undefined || pane.group === group)
    .map((pane) => pane.name);

const fieldsOf = (pane: ReturnType<typeof settingsPanes>[number] | undefined) =>
  (pane?.sections ?? []).flatMap((section) => section.settings);

describe("settingsPanes", () => {
  const zed = sensor("zed", "Zed", [
    setting("limit", { label: "Zed limit", order: 2 }),
    setting("first", { label: "Zed first", order: 1 }),
    setting("unordered", { label: "Zed unordered" }),
  ]);
  const alpha = sensor("alpha", "alpha", [setting("a", { label: "Alpha a" })]);
  const keys = published(
    "sensors.zed.limit",
    "sensors.zed.first",
    "sensors.zed.unordered",
    "sensors.alpha.a",
  );

  it("comes out core machine panes, plugin machine panes, core repository panes, plugin repository panes by display", () => {
    const panes = settingsPanes({
      sensors: [zed, alpha],
      describers: [describer()],
      published: keys,
    });

    expect(names(panes)).toEqual([
      "Editor",
      "Describing",
      "Setup",
      "Structural analysis",
      "alpha",
      "Zed",
    ]);
    expect(names(panes, "machine")).toEqual(["Editor", "Describing", "Setup"]);
    expect(panes.filter((pane) => pane.core).map((pane) => pane.id)).toEqual([
      "editor",
      "describing",
      "setup",
      "structure",
    ]);
  });

  it("orders the fields by order and then by manifest position", () => {
    const panes = settingsPanes({
      sensors: [zed],
      describers: [],
      published: keys,
    });

    expect(
      fieldsOf(panes.find((pane) => pane.id === "zed")).map(
        (field) => field.label,
      ),
    ).toEqual(["Zed first", "Zed limit", "Zed unordered"]);
  });

  it("places sections in the order of their first field, the unlabelled ones first", () => {
    const sectioned = sensor("zed", "Zed", [
      setting("b", { label: "B", section: "Second", order: 1 }),
      setting("a", { label: "A", section: "First", order: 2 }),
      setting("c", { label: "C", section: "Second", order: 3 }),
      setting("d", { label: "D", order: 4 }),
    ]);
    const panes = settingsPanes({
      sensors: [sectioned],
      describers: [],
      published: published(
        "sensors.zed.a",
        "sensors.zed.b",
        "sensors.zed.c",
        "sensors.zed.d",
      ),
    });
    const pane = panes.find((one) => one.id === "zed");

    expect(pane?.sections.map((section) => section.title)).toEqual([
      null,
      "Second",
      "First",
    ]);
    expect(pane?.sections[1]?.settings.map((one) => one.label)).toEqual([
      "B",
      "C",
    ]);
  });

  it("yields no pane for a plugin whose settings have no label", () => {
    const bare = sensor("zed", "Zed", [setting("limit")]);
    const panes = settingsPanes({
      sensors: [bare, alpha],
      describers: [],
      published: keys,
    });

    expect(names(panes, "repository")).toEqual([
      "Structural analysis",
      "alpha",
    ]);
  });

  it("drops a setting whose key is not published and keeps the pane for the known one", () => {
    const mixed = sensor("zed", "Zed", [
      setting("limit", { label: "Known" }),
      setting("missing", { label: "Unknown" }),
    ]);
    const panes = settingsPanes({
      sensors: [mixed],
      describers: [],
      published: published("sensors.zed.limit"),
    });
    const pane = panes.find((one) => one.id === "zed");

    expect(fieldsOf(pane).map((field) => field.label)).toEqual(["Known"]);
    expect(fieldsOf(pane).map((field) => field.key)).toEqual([
      "sensors.zed.limit",
    ]);
  });

  it("expands a setting with labels to one field per value with its unit and default", () => {
    const labelled = sensor("zed", "Zed", [
      setting("cap.<language>", {
        labels: { python: "Python cap", rust: "Rust cap" },
        units: { python: "lines", rust: "nodes" },
        defaults: { python: 10, rust: 20 },
      }),
    ]);
    const panes = settingsPanes({
      sensors: [labelled],
      describers: [],
      published: published("sensors.zed.cap.<language>"),
    });
    const fields = fieldsOf(panes.find((one) => one.id === "zed"));

    expect(
      fields.map((field) => [
        field.key,
        field.label,
        field.unit,
        field.default,
      ]),
    ).toEqual([
      ["sensors.zed.cap.python", "Python cap", "lines", 10],
      ["sensors.zed.cap.rust", "Rust cap", "nodes", 20],
    ]);
  });

  it("puts a describer's machine model into the describing pane by its order", () => {
    const model = setting("model", {
      type: "string",
      scope: "machine",
      label: "Model",
      default: "haiku",
      order: 1,
    });
    const first = settingsPanes({
      sensors: [],
      describers: [describer([model])],
      published: keys,
    }).find((pane) => pane.id === "describing");

    expect(fieldsOf(first).map((field) => field.key)).toEqual([
      "describing.model",
      "describing.batch_size",
      "describing.confirm_above_usd",
    ]);

    const last = settingsPanes({
      sensors: [],
      describers: [describer([{ ...model, order: 9 }])],
      published: keys,
    }).find((pane) => pane.id === "describing");

    expect(fieldsOf(last).map((field) => field.key)).toEqual([
      "describing.batch_size",
      "describing.confirm_above_usd",
      "describing.model",
    ]);
  });

  it("shows the suites only when a sensor runs tests and the suite keys are published", () => {
    const runner = sensor("zed", "Zed", [setting("limit", { label: "Zed" })], {
      runs_tests: true,
      suite_keys: {
        section: {},
        keys: [setting("tests.<name>.directory", { label: "Directory" })],
      },
    });
    const withSuites = settingsPanes({
      sensors: [runner],
      describers: [],
      published: published("sensors.zed.limit"),
    });
    const without = settingsPanes({
      sensors: [zed],
      describers: [],
      published: keys,
    });

    expect(names(withSuites, "repository")).toEqual([
      "Structural analysis",
      "Zed",
      "Test suites",
    ]);
    expect(
      withSuites.find((pane) => pane.id === "suites")?.suites?.keys[0]?.label,
    ).toBe("Directory");
    expect(names(without)).not.toContain("Test suites");
  });

  it("shows the core panes with every plugin missing", () => {
    const panes = settingsPanes({
      sensors: [],
      describers: [],
      published: publish([CORE_KEYS], "config"),
    });

    expect(names(panes)).toEqual([
      "Editor",
      "Describing",
      "Setup",
      "Structural analysis",
    ]);
  });

  it("gives Structural analysis the sections Warnings, Limits and Duplication with 4, 2 and 4 fields", () => {
    const structure = settingsPanes({
      sensors: [],
      describers: [],
      published: publish([CORE_KEYS], "config"),
    }).find((pane) => pane.id === "structure");

    expect(
      structure?.sections.map((one) => [one.title, one.settings.length]),
    ).toEqual([
      ["Warnings", 4],
      ["Limits", 2],
      ["Duplication", 4],
    ]);
  });

  it("agrees with the published key on every core structure default and bound", () => {
    const core = publish([CORE_KEYS], "config");
    const structure = settingsPanes({
      sensors: [],
      describers: [],
      published: core,
    }).find((pane) => pane.id === "structure");

    for (const field of fieldsOf(structure)) {
      const entry = core.keys.find(
        (one) =>
          one.key === field.key ||
          (one.key === "sensors.structure.warnings.<warning>" &&
            field.key.startsWith("sensors.structure.warnings.") &&
            one.defaults?.[field.key.split(".").pop() as string] !== undefined),
      );

      expect(entry, field.key).toBeDefined();

      const expected =
        entry?.default ??
        entry?.defaults?.[field.key.split(".").pop() as string];

      expect(field.default, field.key).toBe(expected);
      expect(field.minimum, field.key).toBe(entry?.minimum);
      expect(field.maximum, field.key).toBe(entry?.maximum);
    }
  });
});
