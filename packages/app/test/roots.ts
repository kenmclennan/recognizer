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
import { afterEach, vi } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import type { AppView, ExplorerRequest } from "../src/app-root";
import type { Explorer, ScanHost } from "../src/explorer";
import type { FooterView } from "../src/footer-view";
import { isStale } from "../src/freshness-facts";
import type { HoldingView } from "../src/holding-view";
import type { Loaded } from "../src/scan-loading";
import type { OpenActions, OpenView } from "../src/scan-open-view";
import { rowSensors } from "../src/scan-panel-model";

type Listener = (event: { payload: unknown }) => void;

const bridge = vi.hoisted(() => ({
  invoke: async (_command: string, _args?: Record<string, unknown>) =>
    undefined as unknown,
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) =>
    bridge.invoke(command, args),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "w-1",
    listen: async (event: string, handler: Listener) => {
      const set = bridge.listeners.get(event) ?? new Set();

      set.add(handler);
      bridge.listeners.set(event, set);

      return () => set.delete(handler);
    },
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: Listener) => {
    const set = bridge.listeners.get(event) ?? new Set();

    set.add(handler);
    bridge.listeners.set(event, set);

    return () => set.delete(handler);
  },
}));

export const REPO = join(__dirname, "../../..");
export const BIN = join(REPO, "packages/cli/dist/bin.js");

const MANIFEST_EXAMPLE = join(
  REPO,
  "schema/manifest-examples/valid/sensor-crap.json",
);
const SYSTEM_DIRECTORIES = ["/usr/bin", "/bin"];
const TOOLS = ["uv", "git", "cargo", "rustc"];

export type Line = Record<string, unknown>;

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
  private readonly pending = new Map<number, (line: Line) => void>();
  private readonly waiters: (() => void)[] = [];

  constructor(path: string) {
    this.child = spawn(process.execPath, [BIN, "serve"], {
      env: { ...process.env, PATH: isolatedPath(path) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr?.resume();
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
    this.child.stdin?.end();
    this.child.kill();
  }
}

export function launcher(directory: string, name: string, body: string): void {
  const path = join(directory, name);

  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
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

export type RecordedExplorer = Explorer & {
  loads: Loaded[];
  reloads: number;
  host: ScanHost;
};

export type RecordingView = AppView & {
  readonly explorers: RecordedExplorer[];
  readonly counts: string[];
  readonly scanLines: (string | null)[];
  readonly messages: { text: string; isError: boolean }[];
  readonly shown: string[];
  explorer(): RecordedExplorer | null;
  loaded(): Loaded | null;
  freshnessOf(name: string): string | undefined;
  rows(): Promise<ReturnType<typeof rowSensors>>;
};

export function recordingView(): RecordingView {
  const counts: string[] = [];
  const scanLines: (string | null)[] = [];
  const messages: { text: string; isError: boolean }[] = [];
  const shown: string[] = [];
  const explorers: RecordedExplorer[] = [];

  const footer: FooterView = {
    post: () => null,
    attach: () => {},
    withdraw: () => {},
    relabel: () => {},
    reconcile: () => {},
    setCount: (text) => counts.push(text),
    setScan: (text) => scanLines.push(text),
  };

  const explorer = () => explorers[explorers.length - 1] ?? null;
  const loaded = () => {
    const last = explorer();

    return last === null ? null : (last.loads[last.loads.length - 1] ?? null);
  };

  return {
    footer,
    explorers,
    counts,
    scanLines,
    messages,
    shown,
    explorer,
    loaded,
    freshnessOf: (name) => {
      const facts = loaded()?.freshness?.[name];

      if (facts === undefined) {
        return undefined;
      }

      return isStale(facts) ? "stale" : "current";
    },
    rows: async () => {
      const host = explorer()?.host;

      if (host === undefined) {
        throw new Error("the panel was never handed a model");
      }

      return rowSensors(
        (await host.port.inputs()).config,
        await host.port.sensorList(),
      );
    },
    clear: () => {
      shown.push("clear");
    },
    showEmpty: () => {
      shown.push("empty");
    },
    showMessage: (text, isError = false) => {
      messages.push({ text, isError });
    },
    showHolding: (): HoldingView => {
      shown.push("holding");

      return { update: () => {}, remove: () => {} };
    },
    showOpen: (_actions: OpenActions): OpenView => {
      shown.push("open");

      return { render: () => {}, remove: () => {} };
    },
    showExplorer: (request: ExplorerRequest) => {
      const recorded: RecordedExplorer = {
        loads: [request.loaded],
        reloads: 0,
        host: request.scanHost,
        toggleTree: () => {},
        carry: () => null as never,
        update: (next) => {
          recorded.loads.push(next);
        },
        reloadSensors: async () => {
          recorded.reloads += 1;
        },
        openSelectedInEditor: () => {},
        openLinkedView: () => {},
        refreshResponsibilities: () => {},
        refreshPanel: () => {},
        setSetupProblems: () => {},
        show: () => {},
        dispose: () => {},
      };

      explorers.push(recorded);
      shown.push("explorer");
      request.onKeys([]);

      return recorded;
    },
    openSettings: () => ({ close: () => {} }) as never,
    openSetup: () => ({ close: () => {} }) as never,
  };
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }

  bridge.listeners.clear();
});

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

export type TimedResult<T> = { value: T; elapsedMs: number; limitMs: number };

export async function timeEndToEnd<T>(
  serve: Serve,
  options: {
    limitMs: number;
    action: () => void | Promise<void>;
    until: () => T | undefined;
  },
): Promise<TimedResult<T>> {
  const limitMs = scaledTimeout(options.limitMs);
  const start = performance.now();

  await options.action();

  for (;;) {
    const value = options.until();
    const elapsedMs = performance.now() - start;

    if (value !== undefined) {
      if (elapsedMs > limitMs) {
        throw new Error(
          `held after ${Math.round(elapsedMs)} ms, over the ${limitMs} ms limit`,
        );
      }

      return { value, elapsedMs, limitMs };
    }

    if (elapsedMs > limitMs) {
      throw new Error(
        `did not hold within ${limitMs} ms (elapsed ${Math.round(elapsedMs)} ms)`,
      );
    }

    await serve.signal(50);
  }
}

export async function untilHolds<T>(
  serve: Serve,
  until: () => T | undefined,
  limitMs = 60_000,
): Promise<T> {
  return (await timeEndToEnd(serve, { limitMs, action: () => {}, until }))
    .value;
}
