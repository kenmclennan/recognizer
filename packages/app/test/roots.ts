import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { vi } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { registerShim } from "../../cli/test/plugin-registry-shim";
import { bridge, cleanups, type Line, recordingView } from "./app-harness";

export * from "./app-harness";

export const REPO = join(__dirname, "../../..");
export const BIN = join(REPO, "packages/cli/dist/bin.js");

const MANIFEST_EXAMPLE = join(
  REPO,
  "schema/manifest-examples/valid/sensor-crap.json",
);
const SYSTEM_DIRECTORIES = ["/usr/bin", "/bin"];
const TOOLS = ["uv", "git", "cargo", "rustc"];

let toolDirectory: string | undefined;

function located(name: string): string {
  const result = spawnSync("which", [name], { encoding: "utf8" });

  return result.status === 0 ? result.stdout.trim() : "";
}

function tools(): string {
  if (toolDirectory !== undefined) {
    return toolDirectory;
  }

  const directory = makeTempDir("recognizer-isolated-tools-");
  const wanted: [string, string][] = [
    ["node", process.execPath],
    ...TOOLS.map((name): [string, string] => [name, located(name)]),
  ];

  for (const [name, target] of wanted) {
    if (target !== "" && !existsSync(join(directory, name))) {
      symlinkSync(target, join(directory, name));
    }
  }

  toolDirectory = directory;

  return directory;
}

export function isolatedPath(...directories: string[]): string {
  return [...directories, tools(), ...SYSTEM_DIRECTORIES].join(":");
}

export class Serve {
  readonly lines: Line[] = [];
  readonly started: Line[] = [];
  readonly child: ChildProcess;
  private nextId = 1;
  private stopped = false;
  private readonly pending = new Map<number, (line: Line) => void>();
  private readonly waiters: (() => void)[] = [];

  private readonly scratch = makeTempDir("recognizer-serve-tmp-");

  constructor(path: string) {
    this.child = spawn(process.execPath, [BIN, "serve"], {
      env: { ...process.env, PATH: isolatedPath(path), TMPDIR: this.scratch },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr?.resume();
    this.child.stdin?.on("error", () => {});
    createInterface({ input: this.child.stdout as NodeJS.ReadableStream }).on(
      "line",
      (text) => {
        const line = JSON.parse(text) as Line;

        this.lines.push(line);

        if (typeof line.id === "number") {
          this.pending.get(line.id)?.(line);
          this.pending.delete(line.id);
        } else {
          for (const handler of bridge.listeners.get("core-event") ?? []) {
            handler({ payload: line });
          }
        }

        for (const wake of this.waiters.splice(0)) {
          wake();
        }
      },
    );
  }

  call(op: string, args: Record<string, unknown>): Promise<Line> {
    if (this.stopped) {
      return Promise.reject(new Error(`service stopped: ${op} refused`));
    }

    const id = this.nextId++;

    if (op === "scan.start") {
      this.started.push(args);
    }

    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.child.stdin?.write(`${JSON.stringify({ id, op, args })}\n`);
    });
  }

  signal(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      setTimeout(resolve, ms);
    });
  }

  stop(): void {
    this.stopped = true;
    this.child.stdin?.end();
    this.child.kill();

    const remove = () =>
      rmSync(this.scratch, { recursive: true, force: true, maxRetries: 5 });

    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.once("exit", remove);
    } else {
      remove();
    }
  }
}

export function launcher(directory: string, name: string, body: string): void {
  const path = join(directory, name);

  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  registerShim(path);
}

function manifestOf(name: string, runsTests: boolean): string {
  const base = JSON.parse(readFileSync(MANIFEST_EXAMPLE, "utf8"));

  delete base.suite_keys;
  delete base.placeholders;
  delete base.log_path;

  return JSON.stringify({
    ...base,
    name,
    display: name === "crap" ? "C.R.A.P." : "Mutation",
    runs_tests: runsTests,
    ...(runsTests ? { planned_work: { verb: "mutate" } } : {}),
    install: `brew install ${name}`,
    settings: [],
  });
}

const STAMP = [
  `const { createHash } = require("node:crypto");`,
  `const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");`,
  `const { dirname, join } = require("node:path");`,
  `const [repository, commit, output, name] = process.argv.slice(2);`,
  `const hash = (path) => createHash("sha256").update(readFileSync(join(repository, path))).digest("hex");`,
  `const tests = ["api/tests/a.test.ts"];`,
  `const lines = tests.map((path) => path + "\\t" + hash(path) + "\\n").join("");`,
  `const document = {`,
  `  findings_version: 2,`,
  `  sensor: { name, version: "1" },`,
  `  commit,`,
  `  modified: false,`,
  `  settings: {},`,
  `  findings: [],`,
  `  inputs: { "api/src/a.ts": hash("api/src/a.ts") },`,
  `  tests: createHash("sha256").update(lines).digest("hex"),`,
  `};`,
  `mkdirSync(dirname(output), { recursive: true });`,
  `writeFileSync(output, JSON.stringify(document));`,
].join("\n");

function fakeSensor(
  directory: string,
  name: string,
  runsTests: boolean,
  stamped: boolean,
): void {
  const manifest = join(directory, `${name}.manifest.json`);
  const stamp = join(directory, "stamp.cjs");

  if (stamped) {
    writeFileSync(stamp, STAMP);
  }

  writeFileSync(manifest, manifestOf(name, runsTests));
  launcher(
    directory,
    `recognizer-sense-${name}`,
    [
      `case "$1" in`,
      `manifest) cat ${manifest};;`,
      `check)`,
      `  case "$*" in`,
      `    *--work*) echo '{"gaps":[],"work":{"unit":"functions","to_perform":3,"reusable":0}}';;`,
      `    *) echo '{"gaps":[]}';;`,
      `  esac;;`,
      `run)`,
      `  shift`,
      `  commit=""; out=""; repo=""`,
      `  while [ $# -gt 0 ]; do`,
      `    case "$1" in --commit) commit="$2";; --output) out="$2";; --repository) repo="$2";; esac`,
      `    shift`,
      `  done`,
      `  mkdir -p "$(dirname "$out")"`,
      ...(stamped
        ? [`  node ${stamp} "$repo" "$commit" "$out" ${name};;`]
        : [
            `  printf '{"findings_version":1,"sensor":{"name":"${name}","version":"1"},"commit":"%s","modified":false,"settings":{},"findings":[]}' "$commit" > "$out";;`,
          ]),
      `esac`,
    ].join("\n"),
  );
}

export function git(repository: string, ...args: string[]): void {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: repository, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }
}

export type AppRootOptions = {
  stamped?: boolean;
  config?: string;
  launchers?: Record<string, string>;
  folderKnown?: boolean;
};

export async function appRoot(options: AppRootOptions = {}) {
  const plugins = makeTempDir("app-root-plugins-");
  const unreadable = makeTempDir("app-root-unreadable-");
  const repository = makeTempDir("app-root-repository-");
  const stamped = options.stamped ?? false;

  launcher(
    plugins,
    "recognizer-scan-typescript",
    `exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@"`,
  );
  fakeSensor(plugins, "crap", false, stamped);
  fakeSensor(plugins, "mutation", true, stamped);

  for (const [name, body] of Object.entries(options.launchers ?? {})) {
    launcher(plugins, name, body);
  }

  chmodSync(unreadable, 0o000);
  mkdirSync(join(repository, ".recognizer"), { recursive: true });
  mkdirSync(join(repository, "api", "src"), { recursive: true });
  writeFileSync(
    join(repository, "api", "src", "a.ts"),
    "export const a = 1;\n",
  );
  mkdirSync(join(repository, "api", "tests"), { recursive: true });
  writeFileSync(
    join(repository, "api", "tests", "a.test.ts"),
    "export const t = 1;\n",
  );
  writeFileSync(
    join(repository, "package.json"),
    JSON.stringify({ private: true, workspaces: ["api"] }),
  );
  writeFileSync(
    join(repository, "api", "package.json"),
    JSON.stringify({ name: "@sample/api", type: "module" }),
  );
  writeFileSync(
    join(repository, "api", "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { module: "Node16", moduleResolution: "Node16" },
      include: ["src"],
    }),
  );
  writeFileSync(
    join(repository, ".recognizer", "config.yaml"),
    options.config ??
      "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n  mutation:\n    manifest: [recognizer-sense-mutation, manifest]\n",
  );
  writeFileSync(
    join(repository, ".gitignore"),
    ".recognizer/cache/\nnode_modules/\n",
  );
  git(repository, "init", "-q");
  git(repository, "add", ".");
  git(repository, "commit", "-q", "-m", "initial");

  const path = isolatedPath(unreadable, plugins);
  const service = new Serve(plugins);

  cleanups.push(() => {
    service.stop();
    chmodSync(unreadable, 0o755);
    rmSync(unreadable, { recursive: true, force: true });
  });

  const folder = { known: options.folderKnown ?? true };

  bridge.invoke = async (command, args = {}) => {
    switch (command) {
      case "core_call": {
        const request = { ...(args.args as Record<string, unknown>) };

        delete request.repository;

        return service.call(
          String(args.op),
          folder.known ? { ...request, repository } : request,
        );
      }
      case "window_folder":
        return folder.known ? repository : null;
      case "adopt_scan":
        return { branch: "main", commit: "abc" };
      case "read_scan_ticks":
        return {
          describe: false,
          analysis: false,
          sensors: false,
          ticked: ["crap", "mutation"],
          remembered: true,
          suites: {},
          folds: [],
        };
      default:
        return undefined;
    }
  };

  vi.resetModules();

  const { composeApp } = await import("../src/app-root");
  const view = recordingView();
  const app = composeApp(view);

  const assignFolder = () => {
    folder.known = true;

    for (const handler of bridge.listeners.get("folder-assigned") ?? []) {
      handler({ payload: null });
    }
  };

  return {
    app,
    view,
    assignFolder,
    service,
    repository,
    path,
    plugins,
    testFile: join(repository, "api", "tests", "a.test.ts"),
  };
}
