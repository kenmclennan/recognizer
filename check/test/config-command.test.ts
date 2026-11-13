import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { REPO } from "./helpers.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

const CONFIG = `${ROOT}/.recognizer/config.yaml`;

const SENSORS_DOCUMENT = {
  keys_version: 1,
  owner: "recognizer-sensors",
  placeholders: { name: "^.+$" },
  sections: [
    {
      key: "tests.<name>",
      shape: "list-entry",
      identity: "name",
      description: "one test suite",
      example: 'tests.unit.command "pytest"',
    },
  ],
  keys: [
    {
      key: "tests.<name>.command",
      type: "string",
      description: "the suite's command",
      example: 'tests.unit.command "pytest"',
    },
    {
      key: "tests.<name>.coverage.format",
      type: "enum",
      values: ["lcov", "jacoco"],
      description: "the format of the coverage report",
      example: "tests.unit.coverage.format jacoco",
    },
    {
      key: "sensors.mutation.max_minutes",
      type: "number",
      exclusiveMinimum: 0,
      description: "the time budget in minutes",
      example: "sensors.mutation.max_minutes 10",
    },
    {
      key: "sensors.mutation.carry",
      type: "string",
      multi: true,
      description: "paths Mutation carries into its copy",
      example: "--add sensors.mutation.carry .venv",
    },
  ],
};

function setup(
  answer: { stdout?: string; status?: number; started?: boolean } = {
    stdout: JSON.stringify(SENSORS_DOCUMENT),
  },
  files: Record<string, string> = {},
) {
  return fakeIo({
    files,
    programs: { "recognizer-sensors": () => answer },
  });
}

function config(fake: ReturnType<typeof fakeIo>, ...argv: string[]) {
  return run(["config", "--repository", ROOT, ...argv], fake.io);
}

describe("recognizer config", () => {
  it("sets a value, reads it back, and creates the file through a temp file and a rename", () => {
    const fake = setup();

    expect(config(fake, "sensors.mutation.max_minutes", "10")).toBe(0);
    expect(fake.out()).toBe("");
    expect(fake.files.get(CONFIG)).toBe(
      "sensors:\n  mutation:\n    max_minutes: 10\n",
    );
    expect(fake.renames).toHaveLength(1);
    expect(fake.renames[0]?.to).toBe(CONFIG);
    expect(fake.renames[0]?.from).not.toBe(CONFIG);
    expect(fake.renames[0]?.from.startsWith(`${ROOT}/.recognizer/`)).toBe(true);

    expect(config(fake, "--get", "sensors.mutation.max_minutes")).toBe(0);
    expect(fake.out()).toBe("10\n");
  });

  it("prints key=value lines in file order for --list", () => {
    const fake = setup(undefined, {
      [CONFIG]:
        'describer:\n  command: [a]\n  version: "1"\nsensors:\n  mutation:\n    carry: [.venv]\n',
    });

    expect(config(fake, "--list")).toBe(0);

    const lines = fake.out().trimEnd().split("\n");

    expect(lines.length).toBeGreaterThan(0);
    expect(lines).toEqual([
      "describer.command=a",
      "describer.version=1",
      "sensors.mutation.carry=.venv",
    ]);
  });

  it("exits 1 with no output for --get of an unset key and for --unset of one", () => {
    const fake = setup();

    expect(config(fake, "--get", "sensors.mutation.max_minutes")).toBe(1);
    expect(config(fake, "--unset", "sensors.mutation.max_minutes")).toBe(1);
    expect(fake.out()).toBe("");
    expect(fake.err()).toBe("");
  });

  it("adds, unsets an item, removes a section and adds a section", () => {
    const fake = setup();

    expect(config(fake, "--add", "sensors.mutation.carry", ".venv")).toBe(0);
    expect(
      config(fake, "--add", "sensors.mutation.carry", "node_modules"),
    ).toBe(0);
    expect(config(fake, "--unset", "sensors.mutation.carry", ".venv")).toBe(0);
    expect(fake.files.get(CONFIG)).toBe(
      "sensors:\n  mutation:\n    carry:\n      - node_modules\n",
    );
    expect(config(fake, "--add-section", "sensors.crap")).toBe(0);
    expect(config(fake, "--remove-section", "sensors.mutation")).toBe(0);
    expect(fake.files.get(CONFIG)).toBe("sensors:\n  crap: {}\n");
    expect(config(fake, "--remove-section", "sensors.mutation")).toBe(1);
  });

  it("writes nothing when an edit changes nothing", () => {
    const fake = setup(undefined, { [CONFIG]: "sensors:\n  crap: {}\n" });

    expect(config(fake, "--add-section", "sensors.crap")).toBe(0);
    expect(fake.renames).toHaveLength(0);
  });

  it("refuses with exit 2, the key and the reason, and leaves the file alone", () => {
    const fake = setup();

    expect(config(fake, "tests.unit.coverage.format", "foo")).toBe(2);
    expect(fake.err()).toBe(
      "recognizer config: tests.unit.coverage.format: foo is not allowed; allowed values: lcov, jacoco\n",
    );
    expect(fake.files.has(CONFIG)).toBe(false);
    expect(fake.renames).toHaveLength(0);
  });

  it("takes a value that starts with a hyphen after --", () => {
    const fake = setup();

    expect(config(fake, "--add", "describer.command", "--", "--fast")).toBe(0);
    expect(fake.files.get(CONFIG)).toContain("- --fast");
  });

  it.each([
    [[]],
    [["a"]],
    [["--list", "a"]],
    [["--get"]],
    [["--add", "a"]],
    [["--get", "--list"]],
    [["a", "b", "c"]],
    [["--unset", "a", "b", "c"]],
    [["--remove-section"]],
  ])("is a usage error, exit 2, for %j", (argv) => {
    const fake = setup();

    expect(config(fake, ...argv)).toBe(2);
    expect(fake.err()).toContain("usage: recognizer config");
  });
});

describe("recognizer help config", () => {
  for (const form of [
    ["help", "config"],
    ["config", "--help"],
  ]) {
    it(`lists the keys of both owners with owner, description and example (${form.join(" ")})`, () => {
      const fake = setup();

      expect(run(form, fake.io)).toBe(0);

      const out = fake.out();

      expect(out).toContain("Keys:");
      expect(out).toContain("sensors.<name>.command");
      expect(out).toContain("[recognizer]");
      expect(out).toContain("describer.version");
      expect(out).toContain("tests.<name>.coverage.format");
      expect(out).toContain("one of lcov, jacoco");
      expect(out).toContain("[recognizer-sensors]");
      expect(out).toContain(
        "example: recognizer config tests.unit.coverage.format jacoco",
      );
      expect(out).not.toContain("did not answer");
    });
  }

  it("lists the core's keys and says the sensors program did not answer when it exits 1", () => {
    const fake = setup({ status: 1 });

    expect(run(["help", "config"], fake.io)).toBe(0);
    expect(fake.out()).toContain("sensors.<name>.command");
    expect(fake.out()).not.toContain("tests.<name>.coverage.format");
    expect(fake.out()).toContain(
      "recognizer-sensors did not answer: recognizer-sensors exited 1",
    );
  });
});

describe("a sensors program that does not answer", () => {
  it.each([
    ["exits 1", { status: 1 }, "exited 1"],
    ["is missing", { started: false }, "is not installed"],
    ["prints junk", { stdout: "junk" }, "invalid JSON"],
    [
      "speaks another keys_version",
      { stdout: JSON.stringify({ ...SENSORS_DOCUMENT, keys_version: 2 }) },
      "keys_version is 2",
    ],
    [
      "prints an invalid document",
      { stdout: JSON.stringify({ keys_version: 1 }) },
      "key schema is invalid",
    ],
  ])(
    "refuses a key only it owns when it %s, with that reason, and still writes a core key",
    (_, answer, reason) => {
      const fake = setup(answer);

      expect(config(fake, "tests.unit.command", "x")).toBe(2);
      expect(fake.err()).toContain("tests.unit.command: no such key");
      expect(fake.err()).toContain(
        `recognizer-sensors did not answer: ${reason.includes("exited") ? "recognizer-sensors exited 1" : ""}`.trimEnd(),
      );
      expect(fake.err()).toContain(reason);
      expect(fake.files.has(CONFIG)).toBe(false);

      expect(config(fake, "describer.version", "2")).toBe(0);
      expect(fake.files.get(CONFIG)).toBe('describer:\n  version: "2"\n');
    },
  );

  it("lists what it can, reports the rest on stderr with the reason, and exits 1", () => {
    const fake = setup(
      { status: 1 },
      {
        [CONFIG]:
          'describer:\n  version: "1"\ntests:\n  - name: a\n    command: x\n',
      },
    );

    expect(config(fake, "--list")).toBe(1);
    expect(fake.out()).toBe("describer.version=1\n");
    expect(fake.err()).toContain("tests: cannot be addressed");
    expect(fake.err()).toContain("recognizer-sensors did not answer");
  });
});

describe("the core stays agnostic", () => {
  it("names no suite or coverage key in the three files this item added", () => {
    const words = /\b(tests|coverage|lcov|jacoco|activate|runner)\b/;
    const files = ["config-keys.ts", "config-edit.ts", "config-command.ts"];

    expect(files.length).toBe(3);

    for (const file of files) {
      const source = readFileSync(join(REPO, "check/src", file), "utf8");

      expect(source.length, file).toBeGreaterThan(0);

      const hits = source.split("\n").filter((line) => words.test(line));

      expect(hits, file).toEqual([]);
    }
  });
});
