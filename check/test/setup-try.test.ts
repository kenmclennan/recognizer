import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import {
  type Io,
  nodeIo,
  type Running,
  type RunResult,
  stopEverything,
} from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { buildChanges, type SetupChoices } from "../src/setup-changes.js";
import type { Survey } from "../src/setup-survey.js";
import {
  rehearsalChanges,
  type TryEvent,
  tryChanges,
} from "../src/setup-try.js";
import { capture, REPO } from "./helpers.js";
import { shimDirectory, shimmedPath } from "./setup-helpers.js";

const example = JSON.parse(
  readFileSync(
    join(REPO, "schema/setup-survey-examples/valid/loom.json"),
    "utf8",
  ),
) as Survey;

const CONFIG =
  "tests:\n  - name: old\n    language: python\n    directory: .\n    command: pytest\n    coverage:\n      path: coverage/lcov.info\n      format: lcov\n";

const choices: SetupChoices = {
  analysis: { on: true, limits: { pair_min_lines: 12 } },
  plugins: ["crap"],
  runners: [{ name: "tauri" }, { name: "engine" }],
  tools: ["@vitest/coverage-v8", "cargo-llvm-cov"],
  policy: [{ kind: "ignore", globs: ["scripts/*"], why: "w", based_on: "b" }],
};

const WATCHED = [
  ".recognizer",
  "package.json",
  "package-lock.json",
  "engine/package.json",
  "app/package.json",
];

function hashTree(root: string, paths: string[]): string {
  const sum = createHash("sha256");

  const visit = (path: string) => {
    let kind: ReturnType<typeof statSync>;

    try {
      kind = statSync(path);
    } catch {
      sum.update(`absent ${path}\n`);

      return;
    }

    if (kind.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (name !== "cache") {
          visit(join(path, name));
        }
      }
    } else {
      sum.update(`${path}\n`).update(readFileSync(path));
    }
  };

  for (const path of paths) {
    visit(join(root, path));
  }

  return sum.digest("hex");
}

interface Fake {
  io: Io;
  calls: string[][];
  insideCheck: string[];
  configAtCheck: string[];
}

function fakeIo(
  root: string,
  report: unknown,
  failAt: ((argv: string[], index: number) => RunResult | null) | null = null,
  checkGate: Promise<RunResult> | null = null,
): Fake {
  const real = nodeIo();
  const calls: string[][] = [];
  const insideCheck: string[] = [];
  const configAtCheck: string[] = [];

  const runAsync = (
    command: string,
    args: string[],
    options?: { cwd?: string },
  ): Running => {
    const argv = [command, ...args];
    const cwd = options?.cwd ?? root;
    const failure = failAt?.(argv, calls.length) ?? null;

    calls.push(argv);

    const result = (async (): Promise<RunResult> => {
      if (argv.join(" ") === "recognizer sensors check --run --json") {
        insideCheck.push(hashTree(root, WATCHED));
        configAtCheck.push(
          readFileSync(join(root, ".recognizer/config.yaml"), "utf8"),
        );

        if (checkGate !== null) {
          return checkGate;
        }

        return {
          started: true,
          status: 0,
          stdout: JSON.stringify(report),
          stderr: "",
        };
      }

      if (failure !== null) {
        return failure;
      }

      if (command === "npm") {
        const manifest = join(cwd, "engine/package.json");

        writeFileSync(
          manifest,
          readFileSync(manifest, "utf8").replace(
            '"vitest"',
            '"@vitest/coverage-v8": "3.2.4",\n    "vitest"',
          ),
        );

        return { started: true, status: 0, stdout: "added\n", stderr: "" };
      }

      if (command === "cargo") {
        return { started: true, status: 0, stdout: "installed\n", stderr: "" };
      }

      const target = COMMANDS.find((one) => one.name === args[0]);
      const out = capture();
      const status = await target?.run(
        [...args.slice(1), "--repository", cwd],
        out.io,
      );

      return {
        started: true,
        status: status ?? 2,
        stdout: out.out(),
        stderr: out.err(),
      };
    })();

    return { result, kill: () => {} };
  };

  const io: Io = {
    ...real,
    runAsync,
    run: (command, args, options) =>
      command === "cargo"
        ? { started: true, status: 0, stdout: "", stderr: "" }
        : real.run(command, args, options),
  };

  return { io, calls, insideCheck, configAtCheck };
}

let root: string;
let savedPath: string | undefined;

function survey(): Survey {
  return { ...example, repository: root };
}

function kept() {
  return rehearsalChanges(survey(), buildChanges(survey(), choices).changes);
}

const READY = {
  ready: true,
  sensors: [{ name: "crap", ready: true, gaps: [] }],
};

beforeEach(() => {
  savedPath = process.env.PATH;
  process.env.PATH = shimmedPath(shimDirectory(true));
  root = makeTempDir("recognizer-setup-try-");

  for (const name of ["engine", "app"]) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(
      join(root, name, "package.json"),
      `{\n  "name": "${name}",\n  "devDependencies": {\n    "vitest": "^3.2.4"\n  }\n}\n`,
    );
  }

  writeFileSync(
    join(root, "package.json"),
    '{"name":"loom","workspaces":["engine","app"]}\n',
  );
  writeFileSync(
    join(root, "package-lock.json"),
    '{"lockfileVersion":3,"packages":{}}\n',
  );
  mkdirSync(join(root, ".recognizer"), { recursive: true });
  writeFileSync(join(root, ".recognizer/config.yaml"), CONFIG);
});

afterEach(() => {
  process.env.PATH = savedPath;
});

function runners(events: TryEvent[]) {
  return events.filter((event) => event.event === "runner");
}

function states(events: TryEvent[]): string[] {
  return events.flatMap((event) =>
    event.event === "change" && event.state !== "running" ? [event.state] : [],
  );
}

describe("setup try", () => {
  it("a passing try leaves the repository byte-identical", async () => {
    const changes = kept();
    const fake = fakeIo(root, READY);
    const before = hashTree(root, WATCHED);
    const events: TryEvent[] = [];

    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect(changes.every((change) => !change.id.startsWith("policy"))).toBe(
      true,
    );

    const ok = await tryChanges(fake.io, root, changes, (event) =>
      events.push(event),
    );

    expect(ok).toBe(true);
    expect(fake.insideCheck).toHaveLength(1);
    expect(fake.insideCheck[0]).not.toBe(before);
    expect(hashTree(root, WATCHED)).toBe(before);
    expect(events[events.length - 1]).toEqual({ event: "result", ok: true });
  });

  it("a failing try leaves the repository byte-identical", async () => {
    const changes = kept();
    const fake = fakeIo(root, {
      ready: false,
      sensors: [
        {
          name: "crap",
          ready: false,
          gaps: [{ code: "x", suite: "tauri", line: "tauri has no coverage" }],
        },
      ],
    });
    const before = hashTree(root, WATCHED);
    const events: TryEvent[] = [];
    const ok = await tryChanges(fake.io, root, changes, (event) =>
      events.push(event),
    );

    expect(ok).toBe(false);
    expect(fake.insideCheck[0]).not.toBe(before);
    expect(hashTree(root, WATCHED)).toBe(before);
    expect(events[events.length - 1]).toEqual({ event: "result", ok: false });
  });

  it("a failing step undoes the earlier ones and emits no runner events", async () => {
    const changes = kept();
    const second = changes[1]?.steps[0]?.argv.join(" ") ?? "?";
    const fake = fakeIo(root, READY, (argv) =>
      argv.join(" ").startsWith(second)
        ? { started: true, status: 1, stdout: "", stderr: "boom\n" }
        : null,
    );
    const before = hashTree(root, WATCHED);
    const events: TryEvent[] = [];
    const ok = await tryChanges(fake.io, root, changes, (event) =>
      events.push(event),
    );

    expect(ok).toBe(false);
    expect(states(events)).toEqual(["done", "failed", "undone"]);
    expect(runners(events)).toEqual([]);
    expect(fake.insideCheck).toEqual([]);
    expect(hashTree(root, WATCHED)).toBe(before);
  });

  it("a mixed result names each runner with its readiness", async () => {
    const changes = kept();
    const fake = fakeIo(root, {
      ready: false,
      sensors: [
        {
          name: "crap",
          ready: false,
          gaps: [{ code: "x", suite: "tauri", line: "tauri has no coverage" }],
        },
      ],
    });
    const events: TryEvent[] = [];

    await tryChanges(fake.io, root, changes, (event) => events.push(event));

    expect(runners(events)).toEqual([
      { event: "runner", name: "engine", ready: true, detail: "" },
      {
        event: "runner",
        name: "tauri",
        ready: false,
        detail: "tauri has no coverage",
      },
    ]);
  });

  it("a gap line two sensors report for one suite shows once", async () => {
    const changes = kept();
    const shared = "tauri exited 1 and left no coverage report";
    const fake = fakeIo(root, {
      ready: false,
      sensors: [
        {
          name: "crap",
          ready: false,
          gaps: [{ code: "x", suite: "tauri", line: shared }],
        },
        {
          name: "mutation",
          ready: false,
          gaps: [
            { code: "x", suite: "tauri", line: shared },
            { code: "y", suite: "tauri", line: "tauri has no mutation run" },
          ],
        },
      ],
    });
    const events: TryEvent[] = [];

    await tryChanges(fake.io, root, changes, (event) => events.push(event));

    expect(runners(events)[1]).toEqual({
      event: "runner",
      name: "tauri",
      ready: false,
      detail: `${shared} tauri has no mutation run`,
    });
  });

  it("a stopped try restores the repository", async () => {
    const changes = kept();
    let release: (result: RunResult) => void = () => {};
    const blocked = new Promise<RunResult>((resolve) => {
      release = resolve;
    });
    const fake = fakeIo(root, READY, null, blocked);
    const before = hashTree(root, WATCHED);
    const events: TryEvent[] = [];
    const run = tryChanges(fake.io, root, changes, (event) =>
      events.push(event),
    );

    while (fake.insideCheck.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const stopping = stopEverything(143, 10);

    release({
      started: true,
      status: 143,
      stdout: "",
      stderr: "",
      stopped: true,
    });
    await stopping;

    expect(await run).toBe(false);
    expect(hashTree(root, WATCHED)).toBe(before);
    expect(runners(events)).toEqual([]);
    expect(events[events.length - 1]).toEqual({ event: "result", ok: false });
  });

  it("a try writes no setup run log", async () => {
    const fake = fakeIo(root, READY);

    await tryChanges(fake.io, root, kept(), () => {});

    expect(
      readdirSync(join(root, ".recognizer")).includes("cache")
        ? readdirSync(join(root, ".recognizer/cache")).includes("log")
        : false,
    ).toBe(false);
  });

  it("a try registers the chosen check for the check and restores the config", async () => {
    const before = readFileSync(join(root, ".recognizer/config.yaml"), "utf8");
    const fake = fakeIo(root, READY);

    expect(before).not.toContain("crap");

    await tryChanges(fake.io, root, kept(), () => {});

    expect(fake.configAtCheck[0]).toContain("crap");
    expect(readFileSync(join(root, ".recognizer/config.yaml"), "utf8")).toBe(
      before,
    );
  });

  it("the setup help entry names the try verb", async () => {
    const out = capture();
    const help = COMMANDS.find((command) => command.name === "help");

    await help?.run(["setup"], out.io);

    expect(out.out()).toContain("recognizer setup try");
  });
});
