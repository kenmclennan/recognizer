import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_KEYS, parseKeySchema, publish } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  checkDescribing,
  checkSetup,
  createRepositoryModel,
  repositorySections,
  sectionSpecs,
} from "./settings-modal-model";
import { shippedSensors } from "./shipped-fake";

describe("checkDescribing", () => {
  it("accepts a model and a batch size and trims the model", () => {
    expect(checkDescribing("  opus ", "8", "2.50")).toEqual({
      ok: true,
      value: { model: "opus", batchSize: 8, confirmAboveUsd: 2.5 },
    });
  });

  it.each([
    ["", "4"],
    ["-x", "4"],
    ["a b", "4"],
  ])("rejects the model %j naming Model", (model, size) => {
    const checked = checkDescribing(model, size, "5");

    expect(checked.ok).toBe(false);
    expect(checked.ok ? "" : checked.error).toContain("Model");
  });

  it.each(["", "0", "17", "2.5", "abc"])(
    "rejects the batch size %j naming Batch size",
    (size) => {
      const checked = checkDescribing("sonnet", size, "5");

      expect(checked.ok).toBe(false);
      expect(checked.ok ? "" : checked.error).toContain("Batch size");
    },
  );

  it.each(["0", "10000", "0.5"])("accepts the threshold %j", (amount) => {
    expect(checkDescribing("haiku", "4", amount).ok).toBe(true);
  });

  it.each(["", "-1", "10001", "abc", "NaN"])(
    "rejects the threshold %j naming Ask above",
    (amount) => {
      const checked = checkDescribing("haiku", "4", amount);

      expect(checked.ok).toBe(false);
      expect(checked.ok ? "" : checked.error).toContain("Ask above");
    },
  );
});

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SENSOR_KEYS = parseKeySchema(
  readFileSync(join(REPO, "fixtures/sensors/config-keys.json"), "utf8"),
);

if (!("schema" in SENSOR_KEYS)) {
  throw new Error(SENSOR_KEYS.reason);
}

const PUBLISHED = publish([CORE_KEYS, SENSOR_KEYS.schema], "config");

describe("the pinned sensors key schema", () => {
  it("publishes beside the recognizer keys without a collision", () => {
    expect(() =>
      publish([CORE_KEYS, SENSOR_KEYS.schema], "config"),
    ).not.toThrow();
    expect(PUBLISHED.keys.some((key) => key.owner === "sensors")).toBe(true);
  });
});

const shipped = (...names: string[]) =>
  shippedSensors().filter((one) => names.includes(one.name));

describe("repositorySections", () => {
  const names = (list: ReturnType<typeof shipped>) =>
    repositorySections(list, PUBLISHED).map((section) => section.name);

  it("lists Structure, Duplication and the suites for a crap-only toolchain", () => {
    expect(names(shipped("crap"))).toEqual([
      "Structure",
      "Duplication",
      "C.R.A.P.",
      "Test suites",
    ]);
  });

  it("lists the three real sensors' panes in the approved order", () => {
    expect(names(shipped("crap", "mutation", "thresholds"))).toEqual([
      "Structure",
      "Duplication",
      "C.R.A.P.",
      "Complexity and coverage",
      "Mutation",
      "Test suites",
    ]);
  });

  it("builds the mutation rows in order and the thresholds rows with their units and severity keys", () => {
    const specs = sectionSpecs(
      shipped("crap", "mutation", "thresholds"),
      PUBLISHED,
    );
    const fields = (id: string) =>
      specs.find((spec) => spec.id === id)?.fields ?? [];

    expect(fields("mutation").map((field) => field.label)).toEqual([
      "Only what changed",
      "Timeout",
      "Stop a run after",
      "Workers",
    ]);
    expect(fields("thresholds")).toEqual([
      {
        label: "Complexity above",
        key: "sensors.thresholds.complexity.above",
        control: "number",
        severityKey: "sensors.thresholds.complexity.severity",
      },
      {
        label: "Coverage below",
        key: "sensors.thresholds.coverage.below",
        control: "number",
        unit: "0 to 1",
        severityKey: "sensors.thresholds.coverage.severity",
      },
    ]);
  });

  it("shows no pane for a sensor that declares no labels while a labelled sibling has one", () => {
    const bare = {
      ...shipped("mutation")[0],
      name: "bare",
      display: "Bare",
      settings: shipped("mutation")[0]?.settings.map(
        ({ label: _label, ...rest }) => rest,
      ),
    };

    const listed = names([...shipped("crap"), bare as never]);

    expect(listed).toContain("C.R.A.P.");
    expect(listed).not.toContain("Bare");
  });

  it("titles a pane with settings_title and otherwise display", () => {
    const [crap, thresholds] = [shipped("crap")[0], shipped("thresholds")[0]];

    expect(crap?.settings_title).toBeUndefined();
    expect(sectionSpecs([crap as never], PUBLISHED).at(-1)?.name).toBe(
      crap?.display,
    );
    expect(sectionSpecs([thresholds as never], PUBLISHED).at(-1)?.name).toBe(
      thresholds?.settings_title,
    );
  });

  it("lists the first two when the key schema publishes crap and mutation but not thresholds", () => {
    const keys = {
      ...PUBLISHED,
      keys: PUBLISHED.keys.filter(
        (entry) => !entry.key.startsWith("sensors.thresholds."),
      ),
    };

    expect(
      repositorySections(shipped("crap", "mutation", "thresholds"), keys).map(
        (section) => section.name,
      ),
    ).toEqual([
      "Structure",
      "Duplication",
      "C.R.A.P.",
      "Mutation",
      "Test suites",
    ]);
  });

  it("lists only Structure and Duplication when no sensor is shipped", () => {
    expect(names([])).toEqual(["Structure", "Duplication"]);
  });

  it("drops the section of a sensor the key schema stops publishing", () => {
    const core = publish([CORE_KEYS], "config");

    expect(
      repositorySections(shipped("crap", "mutation", "thresholds"), core).map(
        (section) => section.name,
      ),
    ).toEqual(["Structure", "Duplication"]);
  });
});

describe("the repository model", () => {
  const model = (config: string | null = null) =>
    createRepositoryModel(PUBLISHED, config);
  const LIMIT = "sensors.structure.warnings.long_function.limit";

  it("does not dot a value equal to its default and dots one that differs", () => {
    const equal = model(
      "sensors:\n  structure:\n    duplication:\n      min_lines: 4\n",
    );
    const differs = model(
      "sensors:\n  structure:\n    duplication:\n      min_lines: 6\n",
    );

    expect(equal.sectionChanged("duplication")).toBe(false);
    expect(differs.sectionChanged("duplication")).toBe(true);
    expect(
      differs.defaultShown("sensors.structure.duplication.min_lines"),
    ).toEqual({ kind: "figure", text: "4" });
  });

  it("stages a reset as an unset and a section reset as one unset per present key, never a set", () => {
    const changed = model(
      "sensors:\n  structure:\n    duplication:\n      min_lines: 6\n      min_nodes: 30\n",
    );

    changed.resetSection("duplication");

    expect(changed.edits()).toEqual([
      { op: "unset", key: "sensors.structure.duplication.min_lines" },
      { op: "unset", key: "sensors.structure.duplication.min_nodes" },
    ]);
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

    expect(suite.defaultShown("tests.unit.command")).toEqual({ kind: "none" });
    expect(suite.changed("tests.unit.command")).toBe(true);

    suite.reset(["tests.unit.command"]);

    expect(suite.edits()).toEqual([{ op: "unset", key: "tests.unit.command" }]);
  });

  it("shows the text of a blank max_minutes and offers Reset only once a value is set", () => {
    const key = "sensors.mutation.max_minutes";
    const blank = model();

    expect(blank.defaultShown(key)).toEqual({
      kind: "text",
      text: "no time budget: the run continues until it finishes",
    });
    expect(blank.changed(key)).toBe(false);

    const set = model("sensors:\n  mutation:\n    max_minutes: 10\n");

    expect(set.changed(key)).toBe(true);

    set.reset([key]);

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
    one.stageSuiteField("tests.unit.language", "python");

    expect(one.edits()).toEqual([
      { op: "add-section", key: "tests.unit" },
      { op: "set", key: "tests.unit.language", value: "python" },
    ]);
    expect(one.addSuite("unit")).toContain("exists");
    expect(one.addSuite("a b")).toContain("letters");
  });
});

describe("checkSetup", () => {
  it("trims a model and refuses the same names Describing's model refuses", () => {
    expect(checkSetup(" sonnet ")).toEqual({
      ok: true,
      value: { model: "sonnet" },
    });

    for (const bad of ["", "-x", "a b"]) {
      const setup = checkSetup(bad);
      const describing = checkDescribing(bad, "4", "5");

      expect(setup.ok).toBe(false);
      expect(describing.ok).toBe(false);
      expect(
        !setup.ok && !describing.ok && setup.error === describing.error,
      ).toBe(true);
    }
  });
});
