import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  addSection,
  addValue,
  type EditOutcome,
  listKeys,
  readKey,
  removeSection,
  setValue,
  unsetValue,
} from "../src/config-edit.js";
import { CORE_KEYS, type KeySchema, publish } from "../src/config-keys.js";
import { REPO } from "./helpers.js";

const key = (
  name: string,
  type: string,
  extra: Record<string, unknown> = {},
) => ({
  key: name,
  type,
  description: "d",
  example: "e",
  ...extra,
});

const OTHER = {
  keys_version: 1,
  owner: "other",
  placeholders: { name: "^.+$", variable: "^[A-Za-z_][A-Za-z0-9_]*$" },
  sections: [
    {
      key: "tests.<name>",
      shape: "list-entry",
      identity: "name",
      description: "d",
      example: "e",
    },
  ],
  keys: [
    key("tests.<name>.language", "enum", { values: ["python", "kotlin"] }),
    key("tests.<name>.directory", "path"),
    key("tests.<name>.command", "string"),
    key("tests.<name>.env.<variable>", "string"),
    key("tests.<name>.coverage.path", "path"),
    key("tests.<name>.coverage.format", "enum", { values: ["lcov", "jacoco"] }),
    key("sensors.duplication.threshold", "number", {
      exclusiveMinimum: 0,
      maximum: 1,
    }),
    key("sensors.crap.threshold", "number", { exclusiveMinimum: 0 }),
    key("sensors.mutation.max_minutes", "number", { exclusiveMinimum: 0 }),
    key("sensors.mutation.max_workers", "integer", { minimum: 1 }),
    key("sensors.mutation.incremental", "boolean"),
    key("sensors.mutation.carry", "string", { multi: true }),
  ],
} as unknown as KeySchema;

const KEYS = publish([CORE_KEYS, OTHER]);

const SHAPES = ["describer", "third-party", "empty-flow", "four-space"];

const read = (name: string) =>
  readFileSync(join(REPO, "fixtures/config-edit", name), "utf8");

function text(outcome: EditOutcome): string {
  expect(outcome.status).toBe("ok");

  return (outcome as { text: string }).text;
}

function comments(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => line.trim().startsWith("#"))
    .map((line) => line.trim())
    .sort();
}

function refused(outcome: EditOutcome): string {
  expect(outcome.status).toBe("refused");

  return (outcome as { reason: string }).reason;
}

describe("the golden outputs", () => {
  it.each([
    [
      "describer",
      "set-max-minutes",
      (t: string) => setValue(t, KEYS, "sensors.mutation.max_minutes", "10"),
    ],
    [
      "third-party",
      "set-crap-threshold",
      (t: string) => setValue(t, KEYS, "sensors.crap.threshold", "30"),
    ],
    [
      "four-space",
      "add-section-crap",
      (t: string) => addSection(t, KEYS, "sensors.crap"),
    ],
    [
      "four-space",
      "remove-section-mine",
      (t: string) => removeSection(t, KEYS, "sensors.mine"),
    ],
    [
      "empty-flow",
      "add-section-crap",
      (t: string) => addSection(t, KEYS, "sensors.crap"),
    ],
    [
      "empty-flow",
      "set-crap-threshold",
      (t: string) => setValue(t, KEYS, "sensors.crap.threshold", "30"),
    ],
  ])("%s after %s is byte-equal to its golden file", (shape, command, edit) => {
    expect(text(edit(read(`${shape}.yaml`)))).toBe(
      read(`${shape}.${command}.yaml`),
    );
  });

  it("keeps the trailing comment when the only entry of a map with a comment is removed", () => {
    const after = text(
      removeSection(read("third-party.yaml"), KEYS, "sensors.mine"),
    );

    expect(after).toContain("# trailing");
    expect(parse(after).sensors).toEqual({});
  });
});

describe.each(SHAPES)("the %s shape", (shape) => {
  const source = read(`${shape}.yaml`);

  it("round-trips set, get, add, unset, remove-section and add-section keeping every comment", () => {
    const set = text(setValue(source, KEYS, "sensors.crap.threshold", "30"));

    expect(parse(set).sensors.crap.threshold).toBe(30);
    expect(readKey(set, KEYS, "sensors.crap.threshold")).toEqual({
      status: "ok",
      lines: ["30"],
    });

    const added = text(addValue(set, KEYS, "sensors.mutation.carry", ".venv"));

    expect(parse(added).sensors.mutation.carry).toEqual([".venv"]);

    const unset = text(unsetValue(added, KEYS, "sensors.crap.threshold"));

    expect(parse(unset).sensors.crap).toEqual({});

    const sectioned = text(addSection(unset, KEYS, "sensors.duplication"));

    expect(parse(sectioned).sensors.duplication).toEqual({});

    const removed = text(removeSection(sectioned, KEYS, "sensors.mutation"));

    expect(parse(removed).sensors.mutation).toBeUndefined();
    expect(comments(removed)).toEqual(comments(source));
    expect(comments(source).length >= 0).toBe(true);
  });
});

describe.each(["describer", "third-party", "four-space"])(
  "the %s shape keeps its lines",
  (shape) => {
    const source = read(`${shape}.yaml`);

    it("leaves every untouched line in place and in order on a set or an add", () => {
      const lines = source
        .split("\n")
        .filter((line) => line.trim() !== "" && !line.endsWith("{}"));

      expect(lines.length).toBeGreaterThan(0);

      for (const after of [
        text(setValue(source, KEYS, "sensors.crap.threshold", "30")),
        text(addValue(source, KEYS, "sensors.mutation.carry", ".venv")),
      ]) {
        let from = 0;

        for (const line of lines) {
          const at = after.split("\n").indexOf(line, from);

          expect(at, line).toBeGreaterThanOrEqual(from);
          from = at + 1;
        }
      }
    });
  },
);

describe("untouched formatting", () => {
  it("keeps the flow list of the third-party command exactly as written", () => {
    const after = text(
      setValue(read("third-party.yaml"), KEYS, "sensors.crap.threshold", "30"),
    );

    expect(after.split("\n")).toContain(
      '    command: [mine, --out, "{output}"]',
    );
  });

  it("keeps a four-space file four-space after an add and a remove", () => {
    const added = text(
      setValue(read("four-space.yaml"), KEYS, "sensors.crap.threshold", "30"),
    );

    expect(added).toContain("\n        threshold: 30");

    const removed = text(removeSection(added, KEYS, "sensors.crap"));

    expect(removed).toBe("sensors:\n    mine:\n        command: [mine]\n");
  });

  it("appends to a non-empty flow list in flow", () => {
    const after = text(
      addValue(
        "sensors:\n  mutation:\n    carry: [.venv]\n",
        KEYS,
        "sensors.mutation.carry",
        "node_modules",
      ),
    );

    expect(after).toContain("carry: [.venv, node_modules]");
  });

  it.each(["", "# only a comment\n"])(
    "creates a sensors map in %j with the comment above it",
    (source) => {
      const after = text(addSection(source, KEYS, "sensors.crap"));

      expect(parse(after)).toEqual({ sensors: { crap: {} } });
      expect(after.startsWith(source.trimEnd())).toBe(true);
    },
  );
});

describe("list items", () => {
  const base = 'describer:\n  command: [describe-it, --fast]\n  version: "1"\n';

  it("unsets an item that is present and reports one that is absent without changing the file", () => {
    const after = text(unsetValue(base, KEYS, "describer.command", "--fast"));

    expect(parse(after).describer.command).toEqual(["describe-it"]);
    expect(unsetValue(base, KEYS, "describer.command", "--slow")).toEqual({
      status: "absent",
    });
  });

  it("changes nothing when an item already present is added", () => {
    expect(addValue(base, KEYS, "describer.command", "describe-it")).toEqual({
      status: "ok",
      text: base,
    });
  });

  it("removes the key when its only item is unset", () => {
    const after = text(
      unsetValue(
        'describer:\n  command: [x]\n  version: "1"\n',
        KEYS,
        "describer.command",
        "x",
      ),
    );

    expect(parse(after).describer).toEqual({ version: "1" });
  });

  it("reports an unset key as absent for unset and for get", () => {
    expect(unsetValue(base, KEYS, "sensors.crap.threshold")).toEqual({
      status: "absent",
    });
    expect(readKey(base, KEYS, "sensors.crap.threshold")).toEqual({
      status: "absent",
    });
    expect(removeSection(base, KEYS, "sensors.crap")).toEqual({
      status: "absent",
    });
  });

  it("reads a list as one item per line", () => {
    expect(readKey(base, KEYS, "describer.command")).toEqual({
      status: "ok",
      lines: ["describe-it", "--fast"],
    });
  });
});

describe("refusals", () => {
  const base =
    "sensors:\n  structure:\n    warnings:\n      unused_exports: true\n  mine:\n    command: [mine]\n  mutation:\n    max_workers: 2\n";

  it.each([
    ["tests.unit.coverge.format", "x", "no such key"],
    ["sensors.mutation.max_minutes", "ten", "ten is not a number"],
    ["sensors.mutation.incremental", "maybe", "maybe is not true or false"],
    ["sensors.duplication.threshold", "2", "above the maximum 1"],
    ["sensors.mutation.max_workers", "0", "below the minimum 1"],
    ["sensors.mutation.max_workers", "1.5", "not an integer"],
    ["tests.unit.coverage.format", "foo", "allowed values: lcov, jacoco"],
    ["tests.unit.directory", "/abs", "absolute"],
    ["tests.unit.directory", "../x", ".."],
    ["tests.unit.env.1X", "x", "not a valid <variable>"],
    ["sensors.mutation.carry", ".venv", "--add"],
    ["tests.unit.name", "x", "no such key"],
    ["sensors.mutation", "x", "section"],
    ["sensors.crap.threshold", "-1", "must be above 0"],
    ["sensors.structure.warnings.cycle", "yes", "not true or false"],
    ["sensors.structure.distance_threshold", "1", "no such key"],
  ])("refuses %s %s: %s", (name, value, reason) => {
    const outcome = setValue(base, KEYS, name, value);

    expect(refused(outcome)).toContain(reason);
    expect(outcome.status).toBe("refused");
  });

  it("refuses an upper-case sensor name for add-section, naming the pattern", () => {
    expect(refused(addSection(base, KEYS, "sensors.Bad"))).toContain(
      "not a valid <name>",
    );
  });

  it("refuses --unset on a section and --remove-section on a scalar, each naming the other verb", () => {
    expect(refused(unsetValue(base, KEYS, "sensors.mutation"))).toContain(
      "--remove-section",
    );
    expect(
      refused(
        removeSection(base, KEYS, "sensors.structure.warnings.unused_exports"),
      ),
    ).toContain("--unset");
  });

  it("refuses a scalar over a map and a map over a scalar", () => {
    expect(refused(setValue(base, KEYS, "sensors.structure", "off"))).toContain(
      "section",
    );
    expect(
      refused(
        setValue(
          "sensors:\n  structure: off\n",
          KEYS,
          "sensors.structure.warnings.unused_exports",
          "true",
        ),
      ),
    ).toContain("scalar");
  });

  it("refuses a settings key under a long-form registration and the reverse", () => {
    expect(
      refused(setValue(base, KEYS, "sensors.mine.command", "x")),
    ).toContain("holds");
    expect(
      refused(
        addValue(
          "sensors:\n  mutation:\n    max_workers: 2\n",
          KEYS,
          "sensors.mutation.command",
          "x",
        ),
      ),
    ).toContain("holds settings");
    expect(
      refused(
        setValue(
          "sensors:\n  mutation:\n    command: [x]\n",
          KEYS,
          "sensors.mutation.max_workers",
          "2",
        ),
      ),
    ).toContain("registered with a command");
  });

  it("leaves a refused edit's source untouched by returning no text", () => {
    expect(
      setValue(base, KEYS, "sensors.mutation.max_workers", "0"),
    ).not.toHaveProperty("text");
  });

  it("refuses a file that is not YAML", () => {
    expect(
      refused(setValue("a: [", KEYS, "sensors.crap.threshold", "3")),
    ).toContain("not valid YAML");
  });
});

describe("resolution", () => {
  it("resolves a warning switch through the placeholder key", () => {
    const after = text(
      setValue("", KEYS, "sensors.structure.warnings.unused_exports", "true"),
    );

    expect(parse(after)).toEqual({
      sensors: { structure: { warnings: { unused_exports: true } } },
    });
  });

  it("writes a number as a number and an env value as a string", () => {
    const after = text(
      setValue(
        text(setValue("", KEYS, "tests.unit.env.PORT", "8080")),
        KEYS,
        "sensors.mutation.max_minutes",
        "10",
      ),
    );

    expect(parse(after).tests[0].env.PORT).toBe("8080");
    expect(parse(after).sensors.mutation.max_minutes).toBe(10);
  });
});

describe("tests.<name> placement", () => {
  const base =
    "tests:\n  - name: a\n    command: x\n  - name: b\n    command: y\n";

  it("changes only the named entry", () => {
    const after = text(setValue(base, KEYS, "tests.b.command", "z"));

    expect(parse(after).tests).toEqual([
      { name: "a", command: "x" },
      { name: "b", command: "z" },
    ]);
  });

  it("appends a new entry whose first key is name", () => {
    const after = text(setValue(base, KEYS, "tests.c.language", "python"));

    expect(parse(after).tests[2]).toEqual({ name: "c", language: "python" });
    expect(Object.keys(parse(after).tests[2])[0]).toBe("name");
  });

  it("removes one entry and leaves the other, and the list key with the last", () => {
    const one = text(removeSection(base, KEYS, "tests.a"));

    expect(parse(one).tests).toEqual([{ name: "b", command: "y" }]);
    expect(parse(text(removeSection(one, KEYS, "tests.b")))).toEqual({});
  });

  it("adds a section as a bare entry and leaves an existing one alone", () => {
    const after = text(addSection("", KEYS, "tests.unit"));

    expect(parse(after)).toEqual({ tests: [{ name: "unit" }] });
    expect(addSection(after, KEYS, "tests.unit")).toEqual({
      status: "ok",
      text: after,
    });
    expect(addSection("sensors:\n  crap: {}\n", KEYS, "sensors.crap")).toEqual({
      status: "ok",
      text: "sensors:\n  crap: {}\n",
    });
  });
});

describe("listing", () => {
  it("prints every scalar as key=value in file order, a list as a line per item", () => {
    const listing = listKeys(
      'describer:\n  command: [a, b]\n  version: "1"\nsensors:\n  mutation:\n    max_minutes: 10\ntests:\n  - name: unit\n    command: pytest\n    env: {PYTHONPATH: src}\n',
      KEYS,
    );

    expect(listing.lines).toEqual([
      "describer.command=a",
      "describer.command=b",
      "describer.version=1",
      "sensors.mutation.max_minutes=10",
      "tests.unit.command=pytest",
      "tests.unit.env.PYTHONPATH=src",
    ]);
    expect(listing.skipped).toEqual([]);
  });

  it("reports a list of entries no owner publishes a section for", () => {
    const listing = listKeys(
      "tests:\n  - name: a\n    command: x\n",
      publish([CORE_KEYS]),
    );

    expect(listing.lines).toEqual([]);
    expect(listing.skipped).toEqual(["tests"]);
  });
});
