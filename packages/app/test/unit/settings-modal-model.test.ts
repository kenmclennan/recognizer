import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORE_KEYS,
  parseKeySchema,
  publish,
  type Setting,
  type SettingsPane,
  settingsPanes,
} from "recognizer";
import { describe, expect, it } from "vitest";
import { createSettingsModel } from "../../src/settings-modal-model";
import { paneSources } from "../fixtures";

const srcUrl = new URL("../../src/index.ts", import.meta.url).href;
const REPO = resolve(dirname(fileURLToPath(srcUrl)), "../../..");

const SENSOR_KEYS = parseKeySchema(
  readFileSync(join(REPO, "fixtures/sensors/config-keys.json"), "utf8"),
);

if (!("schema" in SENSOR_KEYS)) {
  throw new Error(SENSOR_KEYS.reason);
}

const PUBLISHED = publish([CORE_KEYS, SENSOR_KEYS.schema], "config");

const MACHINE = {
  "describing.model": "haiku",
  "describing.batch_size": "4",
  "describing.confirm_above_usd": "5",
  "setup.model": "sonnet",
};

describe("the pinned sensors key schema", () => {
  it("publishes beside the recognizer keys without a collision", () => {
    expect(() =>
      publish([CORE_KEYS, SENSOR_KEYS.schema], "config"),
    ).not.toThrow();
    expect(PUBLISHED.keys.some((key) => key.owner === "sensors")).toBe(true);
  });
});

const panesFor = (
  names: string[],
  published = PUBLISHED,
  mutate: (
    sensor: ReturnType<typeof paneSources>["sensors"],
  ) => void = () => {},
): SettingsPane[] => {
  const sources = paneSources();
  const sensors = sources.sensors.filter((one) => names.includes(one.name));

  mutate(sensors);

  return settingsPanes({
    sensors,
    describers: sources.describers,
    published,
  });
};

const names = (list: SettingsPane[], group = "repository") =>
  list.filter((pane) => pane.group === group).map((pane) => pane.name);

const fieldsOf = (pane: SettingsPane | undefined): Setting[] =>
  (pane?.sections ?? []).flatMap((section) => section.settings);

const model = (
  config: string | null = null,
  options: { machine?: Record<string, string>; sensors?: string[] } = {},
) =>
  createSettingsModel({
    panes: panesFor(options.sensors ?? ["crap", "mutation"]),
    published: PUBLISHED,
    configText: config,
    machine: options.machine ?? MACHINE,
    repository: true,
  });

const fieldOf = (one: ReturnType<typeof model>, key: string): Setting => {
  const found = one
    .panes()
    .flatMap((pane) => fieldsOf(pane))
    .find((field) => field.key === key);

  if (found === undefined) {
    throw new Error(`no field ${key}`);
  }

  return found;
};

describe("the panes the model lists", () => {
  it("lists Structural analysis and the suites for a crap-only toolchain", () => {
    expect(names(panesFor(["crap"]))).toEqual([
      "Structural analysis",
      "C.R.A.P.",
      "Test suites",
    ]);
  });

  it("lists the three real sensors' panes in the approved order", () => {
    expect(names(panesFor(["crap", "mutation"]))).toEqual([
      "Structural analysis",
      "C.R.A.P.",
      "Mutation",
      "Test suites",
    ]);
  });

  it("builds the mutation rows in order and the crap rows with their labels and keys", () => {
    const list = panesFor(["crap", "mutation"]);
    const fields = (id: string) =>
      fieldsOf(list.find((pane) => pane.id === id));

    expect(fields("mutation").map((field) => field.label)).toEqual([
      "Only what changed",
      "Timeout",
      "Stop a run after",
      "Workers",
    ]);
    expect(fields("crap").map((field) => [field.label, field.key])).toEqual([
      ["Report above", "sensors.crap.threshold"],
      ["Report coverage below", "sensors.crap.coverage_limit"],
    ]);
  });

  it("shows no pane for a sensor that declares no labels while a labelled sibling has one", () => {
    const listed = names(
      panesFor(["crap", "mutation"], PUBLISHED, (sensors) => {
        const mutation = sensors.find((one) => one.name === "mutation");

        if (mutation !== undefined) {
          mutation.settings = (mutation.settings as Setting[]).map(
            ({ label: _label, ...rest }) => rest,
          );
        }
      }),
    );

    expect(listed).toContain("C.R.A.P.");
    expect(listed).not.toContain("Mutation");
  });

  it("titles a pane with settings_title and otherwise display", () => {
    const titled = names(
      panesFor(["crap", "mutation"], PUBLISHED, (sensors) => {
        const mutation = sensors.find((one) => one.name === "mutation");

        if (mutation !== undefined) {
          mutation.settings_title = "Titled pane";
        }
      }),
    );

    expect(titled).toContain("C.R.A.P.");
    expect(titled).toContain("Titled pane");
    expect(titled).not.toContain("Mutation");
  });

  it("lists no mutation pane when the key schema publishes crap and mutation sensors but no mutation keys", () => {
    const keys = {
      ...PUBLISHED,
      keys: PUBLISHED.keys.filter(
        (entry) => !entry.key.startsWith("sensors.mutation."),
      ),
    };

    expect(names(panesFor(["crap", "mutation"], keys))).toEqual([
      "Structural analysis",
      "C.R.A.P.",
      "Test suites",
    ]);
  });

  it("lists only Structural analysis when no sensor is installed", () => {
    expect(names(panesFor([]))).toEqual(["Structural analysis"]);
  });

  it("drops the pane of a sensor the key schema stops publishing", () => {
    const core = publish([CORE_KEYS], "config");

    expect(names(panesFor(["crap", "mutation"], core))).toEqual([
      "Structural analysis",
    ]);
  });

  it("shows only the This Mac panes when no repository is open", () => {
    const one = createSettingsModel({
      panes: panesFor(["crap"]),
      published: PUBLISHED,
      configText: null,
      machine: MACHINE,
      repository: false,
    });

    expect(names(one.panes(), "repository")).toEqual([]);
    expect(names(one.panes(), "machine")).toEqual([
      "Editor",
      "Describing",
      "Setup",
    ]);
  });
});

describe("the repository model", () => {
  it("groups the duplication and complexity limits under Structural analysis", () => {
    const list = panesFor([]);
    const analysis = list.filter((pane) => pane.name === "Structural analysis");

    expect(analysis).toHaveLength(1);
    expect(list.map((pane) => pane.id)).not.toContain("duplication");

    const labels = fieldsOf(analysis[0]).map((field) => field.label);

    expect(labels).toContain("Complexity");
    expect(labels).toEqual(
      expect.arrayContaining([
        "Similarity",
        "Fewest lines compared",
        "Shorter of a pair",
        "Fewest syntax nodes",
      ]),
    );
    expect(labels.some((label) => label?.startsWith("Duplication -"))).toBe(
      false,
    );
  });

  const LIMIT = "sensors.structure.warnings.long_function.limit";

  it("does not dot a value equal to its default and dots one that differs", () => {
    const equal = model(
      "sensors:\n  structure:\n    duplication:\n      min_lines: 4\n",
    );
    const differs = model(
      "sensors:\n  structure:\n    duplication:\n      min_lines: 6\n",
    );
    const lines = "sensors.structure.duplication.min_lines";

    expect(equal.changed(fieldOf(equal, lines))).toBe(false);
    expect(differs.changed(fieldOf(differs, lines))).toBe(true);
    expect(differs.defaultShown(lines)).toEqual({
      kind: "figure",
      text: "4",
    });
  });

  it("stages a field reset as an unset of a present key, never a set, and has no section reset", () => {
    const changed = model(
      "sensors:\n  structure:\n    duplication:\n      min_lines: 6\n      min_nodes: 30\n",
    );

    changed.resetField(
      fieldOf(changed, "sensors.structure.duplication.min_lines"),
    );

    expect(changed.edits()).toEqual([
      { op: "unset", key: "sensors.structure.duplication.min_lines" },
    ]);
    expect("resetSection" in changed).toBe(false);
  });

  it("stages a value that equals its default as an unset of a present key and nothing for an absent one", () => {
    const present = model(
      "sensors:\n  structure:\n    duplication:\n      min_lines: 6\n",
    );

    present.stage("sensors.structure.duplication.min_lines", "4");

    expect(present.edits()).toEqual([
      { op: "unset", key: "sensors.structure.duplication.min_lines" },
    ]);

    const absent = model();

    absent.stage("sensors.structure.duplication.min_lines", "4");

    expect(absent.edits()).toEqual([]);
    expect(absent.dirty()).toBe(false);
  });

  it("shows no default for a key without one and still resets it", () => {
    const suite = model("tests:\n  - name: unit\n    command: pytest\n");
    const row = suite
      .suiteRows("unit")
      .find((one) => one.key === "tests.unit.command");
    const field = { ...(row?.setting as Setting), key: "tests.unit.command" };

    expect(suite.defaultShown("tests.unit.command")).toEqual({ kind: "none" });
    expect(suite.changed(field)).toBe(true);

    suite.resetField(field);

    expect(suite.edits()).toEqual([{ op: "unset", key: "tests.unit.command" }]);
  });

  it("shows the text of a blank max_minutes and offers Reset only once a value is set", () => {
    const key = "sensors.mutation.max_minutes";
    const blank = model();

    expect(blank.defaultShown(key)).toEqual({
      kind: "text",
      text: "no time budget: the run continues until it finishes",
    });
    expect(blank.changed(fieldOf(blank, key))).toBe(false);

    const set = model("sensors:\n  mutation:\n    max_minutes: 10\n");

    expect(set.changed(fieldOf(set, key))).toBe(true);

    set.resetField(fieldOf(set, key));

    expect(set.edits()).toEqual([{ op: "unset", key }]);
  });

  it("shows the text of a blank max_workers and offers Reset only once a value is set", () => {
    const key = "sensors.mutation.max_workers";
    const blank = model();

    expect(blank.defaultShown(key)).toEqual({
      kind: "text",
      text: "half the machine's cores, fewer if free memory is short",
    });
    expect(blank.changed(fieldOf(blank, key))).toBe(false);

    const set = model("sensors:\n  mutation:\n    max_workers: 2\n");

    expect(set.changed(fieldOf(set, key))).toBe(true);
    expect(set.value(key)).toBe("2");

    set.resetField(fieldOf(set, key));

    expect(set.edits()).toEqual([{ op: "unset", key }]);
  });

  it("refuses an out-of-bound value with the library's own reason and clears it on a change", () => {
    const one = model();
    const key = "sensors.structure.duplication.threshold";

    one.stage(key, "1.5");

    expect(one.error(key)).toContain("above the maximum 1");
    expect(one.hasErrors()).toBe(true);

    one.stage(key, "0.9");

    expect(one.hasErrors()).toBe(false);
    expect(one.edits()).toEqual([{ op: "set", key, value: "0.9" }]);
  });

  it("reports the refused key of a mixed save and keeps Save blocked", () => {
    const one = model();

    one.stage("sensors.crap.threshold", "25");
    one.stage("sensors.structure.duplication.min_lines", "8");
    one.stage(LIMIT, "30");
    one.refuse("sensors.structure.duplication.min_lines", "must be at least 2");

    expect(one.error("sensors.structure.duplication.min_lines")).toBe(
      "must be at least 2",
    );
    expect(one.hasErrors()).toBe(true);
    expect(one.error("sensors.crap.threshold")).toBeNull();
    expect(one.error(LIMIT)).toBeNull();
  });

  it("writes false alone when the long-function switch goes off with a limit set", () => {
    const one = model(
      "sensors:\n  structure:\n    warnings:\n      long_function:\n        limit: 30\n",
    );

    one.stage("sensors.structure.warnings.long_function", "false");
    one.stage(LIMIT, "40");

    expect(one.edits()).toEqual([
      {
        op: "set",
        key: "sensors.structure.warnings.long_function",
        value: "false",
      },
    ]);
  });

  it("adds a suite with its section first and then its keys", () => {
    const one = model();

    expect(one.addSuite("unit")).toBeNull();
    one.stage("tests.unit.language", "python");

    expect(one.edits()).toEqual([
      { op: "add-section", key: "tests.unit" },
      { op: "set", key: "tests.unit.language", value: "python" },
    ]);
    expect(one.addSuite("unit")).toContain("exists");
    expect(one.addSuite("a b")).toContain("letters");
  });

  it("labels each suite row by the published label in the order the sensor publishes", () => {
    const one = model("tests:\n  - name: unit\n    language: python\n");

    expect(one.suiteRows("unit").map((row) => row.label)).toEqual([
      "Language",
      "Directory",
      "Command",
      "Activate",
      "Runner",
      "Coverage report",
      "Coverage format",
    ]);
  });
});

describe("the Structural analysis pane's complexity limit toggles through its switch key", () => {
  it("has the Complexity limit with its switch after Long function", () => {
    const structure = panesFor(["crap", "mutation"]).find(
      (pane) => pane.id === "structure",
    );
    const fields = fieldsOf(structure);
    const limits = fields.filter((field) => field.section === "Limits");

    expect(limits.map((field) => field.label)).toEqual([
      "Long function",
      "Complexity",
    ]);
    expect(limits[1]).toMatchObject({
      key: "sensors.structure.warnings.complexity.limit",
      unit: "paths",
      switch: { key: "sensors.structure.warnings.complexity" },
    });
  });

  it("stages the switch key and the number, and a toggle never reports changed", () => {
    const one = model();
    const complexity = fieldOf(
      one,
      "sensors.structure.warnings.complexity.limit",
    );

    expect(one.isOn(complexity)).toBe(true);

    one.toggle(complexity);

    expect(one.isOn(complexity)).toBe(false);
    expect(one.edits()).toEqual([
      {
        op: "set",
        key: "sensors.structure.warnings.complexity",
        value: "false",
      },
    ]);
    expect(one.changed(complexity)).toBe(true);
    expect(one.changed(fieldOf(one, "sensors.structure.warnings.cycle"))).toBe(
      false,
    );

    one.stage("sensors.structure.warnings.cycle", "false");

    expect(one.changed(fieldOf(one, "sensors.structure.warnings.cycle"))).toBe(
      false,
    );
  });
});

describe("a limit with an off state", () => {
  it("writes false for off with switch.value and restores the number on", () => {
    const key = "sensors.crap.coverage_limit";
    const one = model("sensors:\n  crap:\n    coverage_limit: 0.7\n");
    const field = fieldOf(one, key);

    expect(field.switch).toEqual({ value: true });
    expect(one.isOn(field)).toBe(true);

    one.toggle(field);

    expect(one.isOn(field)).toBe(false);
    expect(one.edits()).toEqual([{ op: "set", key, value: "false" }]);

    one.toggle(field);

    expect(one.isOn(field)).toBe(true);
    expect(one.edits()).toEqual([]);
    expect(one.shown(field)).toBe("0.7");
  });

  it("removes the key for off with switch.unset and restores the number on", () => {
    const key = "sensors.mutation.max_minutes";
    const one = model("sensors:\n  mutation:\n    max_minutes: 90\n");
    const field = fieldOf(one, key);

    expect(field.switch).toEqual({ unset: true });
    expect(one.isOn(field)).toBe(true);

    one.toggle(field);

    expect(one.isOn(field)).toBe(false);
    expect(one.edits()).toEqual([{ op: "unset", key }]);

    one.toggle(field);

    expect(one.isOn(field)).toBe(true);
    expect(one.shown(field)).toBe("90");
    expect(one.edits()).toEqual([]);
  });

  it("is off with switch.unset when the key is absent", () => {
    const one = model();

    expect(one.isOn(fieldOf(one, "sensors.mutation.max_minutes"))).toBe(false);
  });
});

describe("a changed field", () => {
  it("reports changed for a text, number or select field and counts one per field", () => {
    const one = model("tests:\n  - name: unit\n    language: python\n");
    const lines = fieldOf(one, "sensors.structure.duplication.min_lines");
    const workers = fieldOf(one, "sensors.mutation.max_workers");

    expect(one.changed(lines)).toBe(false);
    expect(one.count()).toBe(0);

    one.stage(lines.key, "9");
    one.stage(workers.key, "3");

    expect(one.changed(lines)).toBe(true);
    expect(one.changed(workers)).toBe(true);
    expect(one.count()).toBe(2);
  });

  it("counts a limit's switch and number together as one", () => {
    const one = model();
    const limit = fieldOf(
      one,
      "sensors.structure.warnings.long_function.limit",
    );

    one.stage(limit.key, "50");
    one.stage("sensors.structure.warnings.long_function", "false");

    expect(one.count()).toBe(1);
  });

  it("blocks Save on a refused value and reports it, the refused key being present first", () => {
    const one = model();
    const key = "sensors.structure.duplication.min_lines";

    one.stage(key, "0");

    expect(one.error(key)).not.toBeNull();
    expect(one.hasErrors()).toBe(true);
    expect(one.firstError()).toEqual({
      key,
      reason: one.error(key),
    });
  });
});

describe("the machine values", () => {
  it("stages a machine reset as the default set, never a removal", () => {
    const one = model(null, {
      machine: { ...MACHINE, "describing.batch_size": "8" },
    });
    const batch = fieldOf(one, "describing.batch_size");

    expect(one.changed(batch)).toBe(true);
    expect(one.resetTitle(batch)).toBe("Reset to 4 files at a time");

    one.resetField(batch);

    expect(one.machineEdits()).toEqual([
      { key: "describing.batch_size", value: 4 },
    ]);
    expect(one.changed(batch)).toBe(false);
  });

  it("types a machine edit and checks it against the published bounds", () => {
    const one = model();

    one.stage("describing.batch_size", "99");

    expect(one.error("describing.batch_size")).toContain("above the maximum");
    expect(one.machineDirty()).toBe(true);

    one.stage("describing.batch_size", "12");

    expect(one.hasErrors()).toBe(false);
    expect(one.machineEdits()).toEqual([
      { key: "describing.batch_size", value: 12 },
    ]);
  });

  it("puts the describer's model first in Describing and a blank editor equals its default", () => {
    const describing = panesFor([]).find((pane) => pane.id === "describing");

    expect(fieldsOf(describing).map((field) => field.label)).toEqual([
      "Model",
      "Batch size",
      "Ask before spending over",
    ]);

    const one = model();
    const editor = fieldOf(one, "editor");

    expect(one.changed(editor)).toBe(false);
    expect(one.resetTitle(editor)).toBe("Reset to System default");

    one.stage("editor", "code -g {file}:{line}");

    expect(one.changed(editor)).toBe(true);
    expect(one.machineEdits()).toEqual([
      { key: "editor", value: "code -g {file}:{line}" },
    ]);
  });
});
