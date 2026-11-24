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
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import {
  type Io,
  nodeIo,
  type Running,
  type RunResult,
  run,
  stopEverything,
} from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { configurationFor } from "../src/configuration-composition.js";
import {
  type ApplyEvent,
  buildChanges,
  type PlannedChange,
  type SetupChoices,
  type Survey,
} from "../src/index.js";
import { validateRunRecord } from "../src/log-document.js";
import { runApply as applyChanges } from "../src/setup-command.js";
import { capture, REPO } from "./helpers.js";
import { shimDirectory, shimmedPath, withToolUndo } from "./setup-helpers.js";

const example = JSON.parse(
  readFileSync(
    join(REPO, "schema/setup-survey-examples/valid/loom.json"),
    "utf8",
  ),
) as Survey;

const CONFIG =
  "tests:\n  - name: old\n    language: python\n    directory: .\n    command: pytest\n    coverage:\n      path: coverage/lcov.info\n      format: lcov\n";

const choices: SetupChoices = {
  analysis: { on: true, limits: { long_function: 30, pair_min_lines: 12 } },
  plugins: ["crap"],
  runners: [{ name: "engine" }, { name: "tauri" }],
  tools: ["@vitest/coverage-v8", "cargo-llvm-cov"],
  policy: [{ kind: "ignore", globs: ["scripts/*"], why: "w", based_on: "b" }],
};

interface Fake {
  io: Io;
  calls: string[][];
  uninstalled: string[];
  snapshots: string[];
}

function hashTree(root: string, paths: string[]): string {
  const sum = createHash("sha256");

  const visit = (path: string) => {
    let kind: ReturnType<typeof statSync> | null = null;

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

const WATCHED = [
  ".recognizer",
  "package.json",
  "package-lock.json",
  "engine/package.json",
  "app/package.json",
];

function fakeIo(
  root: string,
  failAt: ((argv: string[], index: number) => RunResult | null) | null,
  extra: Partial<Io> = {},
): Fake {
  const real = nodeIo();
  const calls: string[][] = [];
  const uninstalled: string[] = [];
  const snapshots: string[] = [];

  const runAsync = (
    command: string,
    args: string[],
    options?: { cwd?: string },
  ): Running => {
    const argv = [command, ...args];
    const cwd = options?.cwd ?? root;
    const failure = failAt?.(argv, calls.length) ?? null;

    calls.push(argv);
    snapshots.push(hashTree(root, WATCHED));

    const result = (async (): Promise<RunResult> => {
      if (failure !== null) {
        return failure;
      }

      if (command === "npm") {
        const manifest = join(cwd, "engine/package.json");
        const text = readFileSync(manifest, "utf8");

        writeFileSync(
          manifest,
          text.replace(
            '"vitest"',
            '"@vitest/coverage-v8": "3.2.4",\n    "vitest"',
          ),
        );
        writeFileSync(
          join(cwd, "package-lock.json"),
          `${readFileSync(join(cwd, "package-lock.json"), "utf8")}\n`,
        );

        return {
          started: true,
          status: 0,
          stdout: "added 14 packages\n",
          stderr: "",
        };
      }

      if (command === "cargo") {
        if (args[0] === "uninstall") {
          uninstalled.push(args[1] ?? "");
        }

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
    run: (command, args, options) => {
      if (command === "cargo") {
        return { started: true, status: 0, stdout: "", stderr: "" };
      }

      return real.run(command, args, options);
    },
    ...extra,
  };

  return { io, calls, uninstalled, snapshots };
}

let root: string;
let savedPath: string | undefined;

function surveyOf(): Survey {
  return withToolUndo({ ...example, repository: root });
}

function build(selected: SetupChoices = choices): PlannedChange[] {
  return buildChanges(surveyOf(), selected).changes;
}

beforeEach(() => {
  savedPath = process.env.PATH;
  process.env.PATH = shimmedPath(shimDirectory(false));
  root = makeTempDir("recognizer-setup-apply-");

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

function states(events: ApplyEvent[]): string[] {
  return events
    .filter((event) => event.event === "change" && event.state !== "running")
    .map((event) => (event.event === "change" ? `${event.state}` : ""));
}

describe("setup apply", () => {
  it("a failing step undoes the earlier ones byte for byte", async () => {
    process.env.PATH = shimmedPath(shimDirectory(true));

    const changes = build();
    const failing = changes.findIndex((change) => change.id === "tests-engine");

    expect(failing).toBeGreaterThanOrEqual(3);

    const first = changes[failing]?.steps[0]?.argv.join(" ");
    const fake = fakeIo(root, (argv) =>
      argv.join(" ").startsWith(first ?? "?")
        ? { started: true, status: 1, stdout: "", stderr: "boom\n" }
        : null,
    );
    const before = hashTree(root, WATCHED);
    const events: ApplyEvent[] = [];
    const ok = await applyChanges(fake.io, root, changes, (event) =>
      events.push(event),
    );
    const atFailure =
      fake.snapshots[
        fake.calls.findIndex((argv) => argv.join(" ").startsWith(first ?? "?"))
      ] ?? "";

    expect(ok).toBe(false);
    expect(fake.calls.length).toBeGreaterThanOrEqual(3);
    expect(atFailure).not.toBe(before);
    expect(hashTree(root, WATCHED)).toBe(before);
    expect(states(events)).toEqual([
      ...Array(failing).fill("done"),
      "failed",
      ...Array(failing).fill("undone"),
    ]);
    expect(events[events.length - 1]).toEqual({
      event: "result",
      ok: false,
      doctor: null,
    });

    const npm = events.find(
      (event) =>
        event.event === "change" &&
        event.state === "undone" &&
        event.output.includes("node_modules"),
    );

    expect(npm).toBeDefined();
  });

  it("emits one command event pair per step and doctor events before the result", async () => {
    const changes = build().filter((change) =>
      ["analysis-long_function", "tool-cargo-llvm-cov"].includes(change.id),
    );
    const total = changes.reduce((sum, change) => sum + change.steps.length, 0);
    const fake = fakeIo(root, null);
    const events: ApplyEvent[] = [];

    expect(changes.length).toBe(2);

    await applyChanges(fake.io, root, changes, (event) => events.push(event));

    expect(events[0]).toEqual({ event: "start", total: 2, commands: total });

    const commands = events.filter((event) => event.event === "command");

    expect(commands.length).toBe(total * 2);

    for (const [index, change] of changes.entries()) {
      for (const [at, { argv }] of change.steps.entries()) {
        for (const state of ["running", "done"]) {
          expect(commands).toContainEqual({
            event: "command",
            index,
            step: at + 1,
            steps: change.steps.length,
            command: argv.join(" "),
            state,
          });
        }
      }
    }

    const names = events.map((event) =>
      event.event === "doctor" ? `doctor ${event.state}` : event.event,
    );

    expect(names.slice(-3)).toEqual([
      "doctor running",
      "doctor done",
      "result",
    ]);
  });

  it("a failing step emits command running and no done for it, then change failed", async () => {
    const changes = build().filter((change) =>
      ["analysis-long_function", "tool-cargo-llvm-cov"].includes(change.id),
    );
    const failing = changes[1]?.steps[0]?.argv.join(" ") ?? "?";
    const fake = fakeIo(root, (argv) =>
      argv.join(" ").startsWith(failing)
        ? { started: true, status: 1, stdout: "", stderr: "boom\n" }
        : null,
    );
    const events: ApplyEvent[] = [];

    await applyChanges(fake.io, root, changes, (event) => events.push(event));

    const mine = events.filter(
      (event) => event.event === "command" && event.index === 1,
    );

    expect(mine).toMatchObject([{ state: "running", step: 1 }]);
    expect(states(events)).toEqual(["done", "failed", "undone"]);
    expect(events.some((event) => event.event === "doctor")).toBe(false);
  });

  it("a step stopped by SIGTERM undoes the earlier ones", async () => {
    process.env.PATH = shimmedPath(shimDirectory(true));

    const changes = build();
    const fake = fakeIo(root, (_argv, index) =>
      index === 3
        ? { started: true, status: 143, stdout: "", stderr: "", stopped: true }
        : null,
    );
    const before = hashTree(root, WATCHED);
    const events: ApplyEvent[] = [];

    expect(
      await applyChanges(fake.io, root, changes, (event) => events.push(event)),
    ).toBe(false);
    expect(hashTree(root, WATCHED)).toBe(before);
    expect(states(events)).toContain("failed");
    expect(
      states(events).filter((state) => state === "undone").length,
    ).toBeGreaterThan(0);
  });

  it("uninstalls only a cargo tool this run installed", async () => {
    const changes = build();
    const cargoAt = changes.findIndex(
      (change) => change.id === "tool-cargo-llvm-cov",
    );
    const fake = fakeIo(root, (argv) =>
      argv
        .join(" ")
        .startsWith("recognizer config sensors.structure.duplication")
        ? { started: true, status: 1, stdout: "", stderr: "late\n" }
        : null,
    );
    const late = [
      ...changes.slice(cargoAt, cargoAt + 1),
      ...changes.filter((change) => change.id === "analysis-pair_min_lines"),
    ];

    expect(cargoAt).toBeGreaterThanOrEqual(0);

    await applyChanges(fake.io, root, late, () => {});

    expect(fake.uninstalled).toEqual(["cargo-llvm-cov"]);

    const installed: Survey = {
      ...surveyOf(),
      tools: surveyOf().tools.map((tool) =>
        tool.name === "cargo-llvm-cov" ? { ...tool, installed: true } : tool,
      ),
    };
    const withoutInstall = buildChanges(installed, choices).changes;
    const second = fakeIo(root, (argv) =>
      argv
        .join(" ")
        .startsWith("recognizer config sensors.structure.duplication")
        ? { started: true, status: 1, stdout: "", stderr: "late\n" }
        : null,
    );

    await applyChanges(second.io, root, withoutInstall, () => {});

    expect(second.calls.some((argv) => argv[0] === "cargo")).toBe(false);
    expect(second.uninstalled).toEqual([]);
  });

  it("choosing the installed describer registers it and doctor reports no unregistered plugin", async () => {
    process.env.PATH = shimmedPath(shimDirectory(false, true));

    const fresh = makeTempDir("recognizer-setup-describer-");
    const survey = await configurationFor(nodeIo()).surveySetup({
      root: fresh,
    });
    const changes = buildChanges(survey, { plugins: ["claude"] }).changes;

    expect(changes.map((change) => change.title)).toEqual(["Turn on Claude"]);
    expect(changes[0]?.steps.map((one) => one.argv)).toEqual([
      ["recognizer", "plugin", "add", "claude"],
    ]);

    const events: ApplyEvent[] = [];
    const ok = await applyChanges(
      fakeIo(fresh, null).io,
      fresh,
      changes,
      (event) => events.push(event),
    );
    const result = events[events.length - 1];
    const problems =
      result?.event === "result"
        ? (result.doctor?.areas.flatMap((area) => area.problems) ?? [])
        : [];

    expect(ok).toBe(true);
    expect(problems.map((problem) => problem.code)).not.toContain(
      "unregistered-plugin",
    );
  });

  it("declining every offered sensor leaves a clean doctor", async () => {
    process.env.PATH = shimmedPath(shimDirectory(true, true));

    const fresh = makeTempDir("recognizer-setup-decline-");
    const survey = await configurationFor(nodeIo()).surveySetup({
      root: fresh,
    });
    const offered = survey.checks.filter(
      (check) => check.kind === "sensor" || check.kind === "describer",
    );

    expect(offered.length).toBeGreaterThan(0);

    const changes = buildChanges(survey, {}).changes;

    expect(changes.filter((change) => change.group === "checks")).toEqual([]);

    const out = capture();

    await run(["doctor", fresh, "--json"], out.io);

    const report = JSON.parse(out.out());
    const problems = report.areas.flatMap(
      (area: { name: string; problems: { code: string }[] }) =>
        ["sensors", "describers"].includes(area.name) ? area.problems : [],
    );

    expect(problems).toEqual([]);
  });

  it("a success writes a setup run log", async () => {
    const quiet: SetupChoices = {
      analysis: { on: true, limits: { pair_min_lines: 12 } },
      policy: [
        { kind: "ignore", globs: ["scripts/*"], why: "w", based_on: "b" },
      ],
    };
    const changes = build(quiet);
    const fake = fakeIo(root, null);
    const events: ApplyEvent[] = [];

    expect(changes).toHaveLength(2);
    expect(
      await applyChanges(
        fake.io,
        root,
        changes,
        (event) => events.push(event),
        ["apply"],
      ),
    ).toBe(true);

    const result = events[events.length - 1];

    expect(states(events)).toEqual(["done", "done"]);
    expect(result?.event === "result" && result.ok).toBe(true);
    expect(result?.event === "result" && result.doctor?.ok).toBe(true);

    const directory = join(root, ".recognizer/cache/log");
    const files = readdirSync(directory).filter((name) =>
      name.endsWith(".json"),
    );

    expect(files).toHaveLength(1);

    const record = validateRunRecord(
      JSON.parse(readFileSync(join(directory, files[0] ?? ""), "utf8")),
    );

    expect(record.kind).toBe("setup");
    expect(record.outcome).toBe("ok");
    expect(record.entries?.map((entry) => entry.name)).toEqual([
      "analysis-pair_min_lines",
      "policy-1",
    ]);
    expect(
      readFileSync(join(root, ".recognizer/config.yaml"), "utf8"),
    ).toContain("pair_min_lines: 12");

    const listed = capture();
    const log = COMMANDS.find((command) => command.name === "log");

    expect(
      await log?.run(["--kind", "setup", "--repository", root], listed.io),
    ).toBe(0);
    expect(listed.out()).toMatch(/setup/);
  });

  it("a stop request waits for the undo before it finishes", async () => {
    const changes = build();
    let release: (result: RunResult) => void = () => {};
    const blocked = new Promise<RunResult>((resolve) => {
      release = resolve;
    });
    const fake = fakeIo(root, null);
    const run = fake.io.runAsync;
    let count = 0;

    fake.io.runAsync = (command, args, options) => {
      count += 1;

      return count === 3
        ? { result: blocked, kill: () => {} }
        : run(command, args, options);
    };

    const before = hashTree(root, WATCHED);
    const events: ApplyEvent[] = [];
    const applied = applyChanges(fake.io, root, changes, (event) =>
      events.push(event),
    );

    while (count < 3) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const stopping = stopEverything(143, 10);

    release({ started: true, status: 0, stdout: "", stderr: "" });
    await stopping;

    expect(await applied).toBe(false);
    expect(hashTree(root, WATCHED)).toBe(before);
    expect(states(events)).toContain("failed");
  });
});
