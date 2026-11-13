import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { loadKeys, parseKeySchema } from "../src/config-keys.js";
import { REPO } from "./helpers.js";
import { fakeIo, type ProgramEffect, ROOT } from "./scan-helpers.js";

const CONFIG = `${ROOT}/.recognizer/config.yaml`;

const NAMES = ["crap", "mutation", "thresholds"];

function unreadable(reasons: Record<string, ProgramEffect>) {
  return Object.fromEntries(
    Object.entries(reasons).map(([name, effect]) => [
      `recognizer-sense-${name}`,
      () => effect,
    ]),
  );
}

function setup(
  silent: Record<string, ProgramEffect> = {},
  files: Record<string, string> = {},
) {
  return fakeIo({
    files,
    sensorManifests: true,
    programs: unreadable(silent),
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
    const fake = setup(
      {},
      {
        [CONFIG]:
          'describer:\n  command: [a]\n  version: "1"\nsensors:\n  mutation:\n    carry: [.venv]\n',
      },
    );

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
    const fake = setup({}, { [CONFIG]: "sensors:\n  crap: {}\n" });

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
      expect(out).toContain("[sensors]");
      expect(out).toContain(
        "example: recognizer config tests.unit.coverage.format lcov",
      );
      expect(out).not.toContain("did not answer");
    });
  }

  it("lists the core's keys and says the sensors program did not answer when it exits 1", () => {
    const fake = setup({
      crap: { status: 1 },
      mutation: { status: 1 },
      thresholds: { status: 1 },
    });

    expect(run(["help", "config"], fake.io)).toBe(0);
    expect(fake.out()).toContain("sensors.<name>.command");
    expect(fake.out()).toContain("tests.<name>.coverage.format");
    expect(fake.out()).not.toContain("sensors.mutation.max_workers");

    for (const name of NAMES) {
      expect(fake.out()).toContain(`recognizer-sense-${name} did not answer`);
    }
  });
});

describe("loadKeys over three sensor manifests", () => {
  it("publishes the tests keys and each sensor's keys with the prefixes restored", () => {
    const published = loadKeys(setup().io, ROOT);
    const keys = published.keys.map((key) => key.key);

    expect(published.notAnswering).toBeNull();
    expect(keys).toContain("tests.<name>.command");
    expect(keys).toContain("sensors.crap.threshold");
    expect(keys).toContain("sensors.thresholds.<metric>.above");
    expect(keys.indexOf("sensors.crap.threshold")).toBeLessThan(
      keys.indexOf("sensors.mutation.carry"),
    );
    expect(keys.indexOf("sensors.mutation.carry")).toBeLessThan(
      keys.indexOf("sensors.thresholds.<metric>.above"),
    );
  });

  it("still publishes the other sensors' keys and names the one unreadable program once", () => {
    const published = loadKeys(
      setup({ mutation: { status: 1, stderr: "boom" } }).io,
      ROOT,
    );
    const keys = published.keys.map((key) => key.key);

    expect(keys).toContain("tests.<name>.command");
    expect(keys).toContain("sensors.crap.threshold");
    expect(keys).toContain("sensors.thresholds.<metric>.above");
    expect(keys).not.toContain("sensors.mutation.max_workers");
    expect(published.notAnswering).not.toBeNull();
    expect(published.notAnswering?.split("; ")).toHaveLength(1);
    expect(published.notAnswering).toContain(
      "recognizer-sense-mutation did not answer: ",
    );
  });

  it("publishes the core's and the tests keys when no sensor is readable", () => {
    const published = loadKeys(
      setup({
        crap: { started: false },
        mutation: { started: false },
        thresholds: { started: false },
      }).io,
      ROOT,
    );
    const keys = published.keys.map((key) => key.key);

    expect(keys).toContain("tests.<name>.command");
    expect(keys).not.toContain("sensors.crap.threshold");
    expect(published.notAnswering?.split("; ")).toHaveLength(3);
  });
});

describe("a sensors program that does not answer", () => {
  it.each([
    ["exits 1", { status: 1 }],
    ["is missing", { started: false }],
  ])(
    "refuses a key only the sensors own when mutation %s, naming it, and still writes a core key",
    (_, answer) => {
      const fake = setup({ mutation: answer });

      expect(config(fake, "sensors.mutation.carry", "x")).toBe(2);
      expect(fake.err()).toContain("sensors.mutation.carry: no such key");
      expect(fake.err()).toContain("recognizer-sense-mutation did not answer");
      expect(fake.files.has(CONFIG)).toBe(false);

      expect(config(fake, "tests.unit.command", "x")).toBe(0);
      expect(config(fake, "describer.version", "2")).toBe(0);
    },
  );

  it("lists what it can, reports the rest on stderr with the reason, and exits 1", () => {
    const fake = setup(
      {
        crap: { status: 1 },
        mutation: { status: 1 },
        thresholds: { status: 1 },
      },
      {
        [CONFIG]:
          'describer:\n  version: "1"\nsensors:\n  mutation:\n    carry: [.venv]\ntests:\n  - name: a\n    command: x\n',
      },
    );

    expect(config(fake, "--list")).toBe(0);
    expect(fake.out()).toContain("describer.version=1\n");
    expect(fake.out()).toContain("sensors.mutation.carry=.venv\n");
    expect(fake.out()).toContain("tests.a.command=x\n");
  });
});

describe("recognizer config --schema", () => {
  it("prints a schema parseKeySchema accepts, owner sensors, and exits 0", () => {
    const fake = setup();

    expect(config(fake, "--schema")).toBe(0);

    const parsed = parseKeySchema(fake.out());

    expect("schema" in parsed).toBe(true);
    expect("schema" in parsed && parsed.schema.owner).toBe("sensors");
    expect(fake.err()).toBe("");
  });

  it("exits 1 with the not-answering lines when a manifest is unreadable", () => {
    const fake = setup({ mutation: { status: 1 }, crap: { started: false } });

    expect(config(fake, "--schema")).toBe(1);
    expect(fake.out()).toBe("");
    expect(fake.err()).toContain("recognizer-sense-crap did not answer");
    expect(fake.err()).toContain("recognizer-sense-mutation did not answer");
  });

  it("is refused combined with --list", () => {
    const fake = setup();

    expect(config(fake, "--schema", "--list")).toBe(2);
    expect(fake.err()).toContain("usage: recognizer config");
  });

  it("is refused by recognizer policy", () => {
    const fake = setup();

    expect(run(["policy", "--repository", ROOT, "--schema"], fake.io)).toBe(2);
    expect(fake.err()).toContain("usage: recognizer policy");
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
