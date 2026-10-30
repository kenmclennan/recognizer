import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { fullHelp } from "../src/help.js";
import { MEASURE_FLAGS } from "../src/measure-command.js";
import { capture, REPO } from "./helpers.js";
import {
  type Fake,
  type FakeOptions,
  fakeIo,
  type Program,
  ROOT,
} from "./scan-helpers.js";

const COMMIT = "c0ffee0000000000000000000000000000000000";
const METRIC = {
  name: "line_coverage",
  type: "ratio",
  granularity: "module",
  bad: "low",
};
const CONFIG = `${ROOT}/.recognizer/config.yaml`;

function outputOf(name: string): string {
  return `${ROOT}/.recognizer/cache/overlays/${name}.json`;
}

function overlay(changes: Record<string, unknown> = {}): string {
  return JSON.stringify({
    overlay_version: 1,
    commit: COMMIT,
    modified: false,
    producer: { name: "p", version: "1" },
    metrics: [METRIC],
    values: { line_coverage: { "a.py": 0.5 } },
    ...changes,
  });
}

function writer(content: string): Program {
  return (args, files) => {
    files.set(args[args.length - 1] as string, content);

    return undefined;
  };
}

function config(...names: string[]): string {
  const entries = names.map(
    (name) =>
      `  ${name}:\n    command: [${name}, "{repository}", "{commit}", "{output}"]\n    metrics:\n      - { name: line_coverage, type: ratio, granularity: module, bad: low }\n`,
  );

  return `overlays:\n${entries.join("")}`;
}

function setup(names: string[], options: FakeOptions = {}): Fake {
  return fakeIo({
    commit: COMMIT,
    ...options,
    files: { [CONFIG]: config(...names), ...options.files },
  });
}

function measure(fake: Fake, ...args: string[]) {
  const code = run(["measure", "--repository", ROOT, ...args], fake.io);

  return { code, out: fake.out(), err: fake.err() };
}

function programCalls(fake: Fake): string[] {
  return fake.calls
    .filter((call) => call.command !== "git")
    .map((call) => call.command);
}

describe("measure with a scripted fake", () => {
  it("measures every registered overlay", () => {
    const fake = setup(["alpha", "beta"], {
      programs: { alpha: writer(overlay()), beta: writer(overlay()) },
    });
    const result = measure(fake);

    expect(result).toEqual({
      code: 0,
      out: "measured alpha\nmeasured beta\nmeasured 2, failed 0\n",
      err: "",
    });
    expect(fake.files.has(outputOf("alpha"))).toBe(true);
    expect(fake.files.has(outputOf("beta"))).toBe(true);
  });

  it("keeps the good overlay and reports the failed one by name", () => {
    const fake = setup(["alpha", "beta"], {
      programs: {
        alpha: writer(overlay()),
        beta: () => ({ status: 3, stderr: "boom" }),
      },
    });
    const result = measure(fake);

    expect(result.code).toBe(1);
    expect(result.err).toBe("failed beta: boom\n");
    expect(result.out).toBe("measured alpha\nmeasured 1, failed 1\n");
    expect(fake.files.has(outputOf("alpha"))).toBe(true);
    expect(fake.files.has(outputOf("beta"))).toBe(false);
  });

  it("prints both lists in json after a mixed outcome", () => {
    const fake = setup(["alpha", "beta"], {
      programs: {
        alpha: writer(overlay()),
        beta: () => ({ status: 3, stderr: "boom" }),
      },
    });
    const result = measure(fake, "--json");

    expect(JSON.parse(result.out)).toEqual({
      commit: COMMIT,
      modified: false,
      measured: ["alpha"],
      failed: [{ overlay: "beta", reason: "boom" }],
    });
    expect(result.code).toBe(1);
  });

  it("runs only the named overlays, in the order named", () => {
    const fake = setup(["alpha", "beta", "gamma"], {
      programs: {
        alpha: writer(overlay()),
        beta: writer(overlay()),
        gamma: writer(overlay()),
      },
    });
    const result = measure(fake, "gamma", "alpha");

    expect(result.code).toBe(0);
    expect(programCalls(fake)).toEqual(["gamma", "alpha"]);
  });

  it("exits 2 on an unknown name and runs nothing", () => {
    const fake = setup(["alpha"], { programs: { alpha: writer(overlay()) } });
    const result = measure(fake, "alpha", "nope");

    expect(result.code).toBe(2);
    expect(result.err).toContain("no such overlay: nope");
    expect(programCalls(fake)).toEqual([]);
  });

  it("exits 2 when no overlays are registered", () => {
    const empty = fakeIo({ commit: COMMIT });
    const none = fakeIo({
      commit: COMMIT,
      files: { [CONFIG]: "describer:\n  command: [x]\n  version: a\n" },
    });

    for (const fake of [empty, none]) {
      const result = measure(fake);

      expect(result.code).toBe(2);
      expect(result.err).toContain("no overlays are registered");
    }
  });

  it("exits 2 without a commit and runs nothing", () => {
    const fake = fakeIo({
      files: { [CONFIG]: config("alpha") },
      programs: { alpha: writer(overlay()) },
    });
    const result = measure(fake);

    expect(result.code).toBe(2);
    expect(result.err).toContain("no commit");
    expect(programCalls(fake)).toEqual([]);
  });

  it.each([
    ["a non-zero exit", () => ({ status: 1 }), /status 1/],
    ["no file written", () => undefined, /wrote no overlay file/],
    [
      "a command that does not start",
      () => ({ started: false }),
      /did not start/,
    ],
    ["invalid JSON", writer("{nope"), /not valid JSON/],
    [
      "a schema-invalid file",
      writer(overlay({ overlay_version: 2 })),
      /overlay/,
    ],
    ["a commit mismatch", writer(overlay({ commit: "other" })), /commit/],
  ] as [string, Program, RegExp][])(
    "reports %s and leaves no file",
    (_, program, reason) => {
      const fake = setup(["alpha"], { programs: { alpha: program } });
      const result = measure(fake);

      expect(result.code).toBe(1);
      expect(result.err).toMatch(/^failed alpha: /);
      expect(result.err).toMatch(reason);
      expect(fake.files.has(outputOf("alpha"))).toBe(false);
    },
  );

  it("removes a previous good file when a later run fails", () => {
    const fake = setup(["alpha"], {
      programs: { alpha: () => ({ status: 1 }) },
      files: { [outputOf("alpha")]: overlay() },
    });

    expect(measure(fake).code).toBe(1);
    expect(fake.files.has(outputOf("alpha"))).toBe(false);
  });

  it("removes the old file before the command runs", () => {
    let seen: boolean | undefined;
    const fake = setup(["alpha"], {
      programs: {
        alpha: (args, files) => {
          seen = files.has(outputOf("alpha"));
          files.set(args[args.length - 1] as string, overlay());

          return undefined;
        },
      },
      files: { [outputOf("alpha")]: overlay() },
    });

    measure(fake);

    expect(seen).toBe(false);
  });

  it("fills the placeholders, runs from the root and uses no shell", () => {
    const fake = setup(["alpha"], { programs: { alpha: writer(overlay()) } });

    measure(fake);

    expect(fake.calls.find((call) => call.command === "alpha")).toEqual({
      command: "alpha",
      args: [ROOT, COMMIT, outputOf("alpha")],
      cwd: ROOT,
    });
  });

  it("computes modified before any command runs", () => {
    const options: FakeOptions = { status: "" };
    const fake = setup(["alpha"], {
      ...options,
      programs: {
        alpha: (args, files) => {
          options.status = " M a.py\n";
          files.set(args[args.length - 1] as string, overlay());

          return undefined;
        },
      },
    });
    const result = measure(fake, "--json");

    expect(JSON.parse(result.out).modified).toBe(false);
    expect(result.code).toBe(0);
  });

  it("records a dirty tree in the expected modified", () => {
    const fake = setup(["alpha"], {
      status: " M a.py\n",
      programs: { alpha: writer(overlay({ modified: true })) },
    });

    expect(measure(fake).code).toBe(0);
  });

  it("never reads a scan or runs a describer", () => {
    const fake = setup(["alpha"], { programs: { alpha: writer(overlay()) } });

    measure(fake);

    expect(fake.writes).toEqual([]);
    expect(programCalls(fake)).toEqual(["alpha"]);
  });
});

describe("measure help", () => {
  it("lists every flag in MEASURE_FLAGS", () => {
    const command = COMMANDS.find((entry) => entry.name === "measure");
    const help = fullHelp(command as (typeof COMMANDS)[number]);

    for (const flag of MEASURE_FLAGS) {
      expect(help).toContain(flag);
    }
  });
});

describe("measure with a real process", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes one valid overlay file", () => {
    const root = mkdtempSync(join(tmpdir(), "recognizer-measure-"));

    roots.push(root);
    cpSync(join(REPO, "fixtures/python/sample"), root, { recursive: true });

    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });

    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("add", ".");
    git("commit", "-q", "-m", "sample");

    const script = join(REPO, "check/test/fixtures/fake-overlay.mjs");

    mkdirSync(join(root, ".recognizer"), { recursive: true });
    writeFileSync(
      join(root, ".recognizer/config.yaml"),
      `overlays:\n  coverage:\n    command: ["node", ${JSON.stringify(script)}, "{repository}", "{commit}", "{output}"]\n    metrics:\n      - ${JSON.stringify(METRIC)}\n`,
    );

    const out = capture();
    const code = run(["measure", "--repository", root], out.io);
    const file = join(root, ".recognizer/cache/overlays/coverage.json");
    const validate = new Ajv2020({ allErrors: true }).compile(
      JSON.parse(
        readFileSync(join(REPO, "schema/overlay.schema.json"), "utf8"),
      ),
    );

    expect(out.err()).toBe("");
    expect(code).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect(validate(JSON.parse(readFileSync(file, "utf8")))).toBe(true);
  });
});
