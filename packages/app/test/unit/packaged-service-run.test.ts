import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Repository, type RepositoryState } from "@recognizer/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";

const bridge = vi.hoisted(() => ({
  invoke: async (_command: string, _args?: Record<string, unknown>) =>
    undefined as unknown,
  listeners: new Set<(event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) =>
    bridge.invoke(command, args),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "w-1",
    listen: async (
      _event: string,
      handler: (event: { payload: unknown }) => void,
    ) => {
      bridge.listeners.add(handler);

      return () => bridge.listeners.delete(handler);
    },
  }),
}));

import { workScopes } from "../../src/planned-work";
import { createRepositoryStateHolder } from "../../src/repository-state-holder";
import { installedSensorsOf } from "../../src/repository-state-model";
import { createRepositoryStateSource } from "../../src/repository-state-source";
import { createRescanner } from "../../src/rescanner";
import { refreshOnChange } from "../../src/revision-refresh";
import { describerRegistered, rowSensors } from "../../src/scan-panel-model";
import { createScanSource } from "../../src/scan-source";
import { withSensors } from "../../src/sensor-run";
import { createSensorsSource } from "../../src/sensors-source";

const REPO = join(__dirname, "../../../..");
const BIN = join(REPO, "packages/cli/dist/bin.js");
const MANIFEST_EXAMPLE = join(
  REPO,
  "schema/manifest-examples/valid/sensor-crap.json",
);
const WAIT = scaledTimeout(60_000);
const TEST_TIMEOUT = WAIT * 5;

type Line = Record<string, unknown>;

class Service {
  readonly lines: Line[] = [];
  readonly started: Line[] = [];
  private readonly child: ChildProcess;
  private next = 1;
  private readonly pending = new Map<number, (line: Line) => void>();

  constructor(path: string) {
    this.child = spawn(process.execPath, [BIN, "serve"], {
      env: { ...process.env, PATH: path },
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
          for (const handler of bridge.listeners) {
            handler({ payload: line });
          }
        }
      },
    );
  }

  call(op: string, args: Record<string, unknown>): Promise<Line> {
    const id = this.next++;

    if (op === "scan.start") {
      this.started.push(args);
    }

    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.child.stdin?.write(`${JSON.stringify({ id, op, args })}\n`);
    });
  }

  stop(): void {
    this.child.stdin?.end();
    this.child.kill();
  }
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

function launcher(directory: string, name: string, body: string): void {
  const path = join(directory, name);

  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
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
  stamped = false,
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

function git(repository: string, ...args: string[]): void {
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

function fixture(stamped = false) {
  const plugins = makeTempDir("packaged-run-plugins-");
  const unreadable = makeTempDir("packaged-run-unreadable-");
  const repository = makeTempDir("packaged-run-repository-");

  launcher(
    plugins,
    "recognizer-scan-typescript",
    `exec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@"`,
  );
  fakeSensor(plugins, "crap", false, stamped);
  fakeSensor(plugins, "mutation", true, stamped);
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
    join(repository, ".recognizer", "config.yaml"),
    "sensors:\n  crap: {}\n  mutation: {}\n",
  );
  writeFileSync(
    join(repository, ".gitignore"),
    ".recognizer/cache/\nnode_modules/\n",
  );
  git(repository, "init", "-q");
  git(repository, "add", ".");
  git(repository, "commit", "-q", "-m", "initial");

  const path = [
    unreadable,
    plugins,
    ...["/usr/bin", "/bin"],
    join(process.execPath, ".."),
  ].join(":");

  return { repository, path, unreadable };
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }

  bridge.listeners.clear();
});

function wire(repository: string, service: Service) {
  bridge.invoke = async (command, args = {}) => {
    switch (command) {
      case "core_call":
        return service.call(String(args.op), {
          ...(args.args as Record<string, unknown>),
          repository,
        });
      case "read_sensor_inputs": {
        const read = (file: string) => {
          try {
            return readFileSync(join(repository, ".recognizer", file), "utf8");
          } catch {
            return null;
          }
        };

        return {
          policy: read("policy.yaml"),
          config: read("config.yaml"),
          baseline: read("baseline.json"),
          refused: [],
          analysis: false,
        };
      }
      case "read_run_records":
        return { files: [], refused: [] };
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
      case "write_scan_ticks":
        return undefined;
      default:
        return undefined;
    }
  };

  const invoke = bridge.invoke as <T>(
    command: string,
    args?: Record<string, unknown>,
  ) => Promise<T>;
  const listen = async <T>(
    _event: string,
    handler: (event: { payload: T }) => void,
  ) => {
    const forward = handler as (event: { payload: unknown }) => void;

    bridge.listeners.add(forward);

    return () => bridge.listeners.delete(forward);
  };
  const results = createRepositoryStateSource({
    invoke,
    listen,
    windowLabel: () => "w-1",
  });
  const holder = createRepositoryStateHolder(results);
  const sensors = createSensorsSource({ state: holder, results });
  const scan = createScanSource({
    invoke,
    listen,
    windowLabel: () => "w-1",
    repository: () => repository,
  });

  return { holder, sensors, scan };
}

async function untilState(
  holder: ReturnType<typeof createRepositoryStateHolder>,
  found: (state: RepositoryState) => boolean,
): Promise<RepositoryState> {
  const limit = Date.now() + WAIT;

  for (;;) {
    const state = holder.current();

    if (state !== null && found(state)) {
      return state;
    }

    if (Date.now() > limit) {
      throw new Error(
        `timed out waiting; revision ${state?.revision}, run ${state?.run?.state}, freshness ${JSON.stringify(state?.freshness)}, inputs ${JSON.stringify(state?.inputsDigest)}; last: ${JSON.stringify(state)}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("the app over the real service, on a path with an unreadable folder", () => {
  it("carries every registered sensor's manifest into the rows the panel renders", async () => {
    const { repository, path, unreadable } = fixture();
    const service = new Service(path);

    cleanups.push(() => {
      service.stop();
      chmodSync(unreadable, 0o755);
      rmSync(unreadable, { recursive: true, force: true });
    });

    const { holder, sensors } = wire(repository, service);

    await holder.start();

    const state = await untilState(
      holder,
      (one) => one.registry.entries.length === 2,
    );
    const rows = rowSensors(
      (await sensors.readInputs()).config,
      installedSensorsOf(state),
    );

    expect(rows.map(({ name, display }) => [name, display])).toEqual([
      ["crap", "C.R.A.P."],
      ["mutation", "Mutation"],
    ]);
    expect(rows.find(({ name }) => name === "mutation")?.runsTests).toBe(true);
    expect(state.registry.catalog.state).toBe("read");
    holder.stop();
  });

  it(
    "a_ticked_sensor_reaches_scan_start_and_runs",
    async () => {
      const { repository, path, unreadable } = fixture();
      const service = new Service(path);

      cleanups.push(() => {
        service.stop();
        chmodSync(unreadable, 0o755);
        rmSync(unreadable, { recursive: true, force: true });
      });

      const { holder, sensors, scan } = wire(repository, service);

      await holder.start();
      await untilState(holder, (one) => one.registry.entries.length === 2);

      const loaded = {
        modules: [],
        scans: [],
        repository: Repository.empty,
        policy: null,
        baseline: null,
        notices: [],
        blocking: null,
        findings: [],
        sensors: [],
      };
      const rescanner = createRescanner({
        port: scan,
        snapshot: {
          run: () => holder.current()?.run ?? null,
          onRun: (handler) => holder.onRevision((state) => handler(state.run)),
        },
        registered: async () => {
          const { config } = await sensors.readInputs();

          return {
            sensors: rowSensors(config, await sensors.sensorList()),
            describerRegistered: describerRegistered(config),
          };
        },
        load: () => loaded,
        sense: (one) => withSensors(one, sensors),
        resense: async () => withSensors(loaded, sensors),
        adopt: async () => ({ branch: "main", commit: "abc" }),
        carry: () => null,
        replace: () => {},
        update: () => false,
        adopted: () => {},
        describedLine: () => {},
        progress: () => {},
        settled: () => {},
        attached: () => {},
        hasExplorer: () => false,
        blocked: (text) => {
          throw new Error(text);
        },
        post: () => null,
        attach: () => {},
        openLog: () => {},
        show: () => {},
      });

      await rescanner.loadTicks();

      await rescanner.run();

      expect(service.started).toHaveLength(1);
      expect([...(service.started[0].sense as string[])].sort()).toEqual([
        "crap",
        "mutation",
      ]);

      const state = await untilState(
        holder,
        (one) =>
          one.run?.state === "finished" &&
          one.results.crap?.results.length === 1 &&
          one.results.mutation?.results.length === 1,
      );

      expect(state.registry.entries).toHaveLength(2);
      holder.stop();
    },
    TEST_TIMEOUT,
  );

  it(
    "a_registration_change_removes_the_row_and_refreshes_the_panel_within_10_s",
    async () => {
      const { repository, path, unreadable } = fixture();
      const service = new Service(path);

      cleanups.push(() => {
        service.stop();
        chmodSync(unreadable, 0o755);
        rmSync(unreadable, { recursive: true, force: true });
      });

      const { holder, sensors } = wire(repository, service);
      let refreshes = 0;

      refreshOnChange(holder, async () => {
        refreshes += 1;
      });
      await holder.start();

      const first = await untilState(
        holder,
        (one) => one.registry.entries.length === 2,
      );

      expect(
        first.registry.entries.filter(({ registered }) => registered),
      ).toHaveLength(2);

      const removed = spawnSync(
        process.execPath,
        [BIN, "config", "--remove-section", "sensors.mutation"],
        {
          cwd: repository,
          env: { ...process.env, PATH: path },
          encoding: "utf8",
        },
      );

      expect(removed.status).toBe(0);

      const after = await untilState(
        holder,
        (one) =>
          one.registry.entries.find(({ name }) => name === "mutation")
            ?.registered !== true,
      );
      const rows = rowSensors(
        (await sensors.readInputs()).config,
        installedSensorsOf(after),
      );

      expect(rows.find(({ name }) => name === "mutation")?.registered).not.toBe(
        true,
      );
      expect(rows.find(({ name }) => name === "crap")?.registered).toBe(true);
      expect(refreshes).toBeGreaterThan(0);
      holder.stop();
    },
    TEST_TIMEOUT,
  );

  it(
    "a_sensor_run_reads_current_an_edited_test_reads_out_of_date_within_10_s_and_the_revert_reads_current",
    async () => {
      const { repository, path, unreadable } = fixture(true);
      const service = new Service(path);

      cleanups.push(() => {
        service.stop();
        chmodSync(unreadable, 0o755);
        rmSync(unreadable, { recursive: true, force: true });
      });

      const { holder } = wire(repository, service);
      const testFile = join(repository, "api", "tests", "a.test.ts");
      const original = readFileSync(testFile, "utf8");
      const freshnessOf = (state: RepositoryState, name: string) =>
        state.freshness[name]?.state;

      await holder.start();
      await untilState(holder, (one) => one.registry.entries.length === 2);

      await service.call("scan.start", {
        repository,
        sense: ["crap", "mutation"],
        extract: false,
        describe: false,
      });

      await untilState(
        holder,
        (one) =>
          one.run?.state === "finished" &&
          freshnessOf(one, "crap") === "current" &&
          freshnessOf(one, "mutation") === "current",
      );

      writeFileSync(testFile, `${original}export const edited = 2;\n`);

      const stale = Date.now();

      await untilState(
        holder,
        (one) =>
          freshnessOf(one, "crap") === "stale" &&
          freshnessOf(one, "mutation") === "stale",
      );

      expect(Date.now() - stale).toBeLessThan(10_000);

      writeFileSync(testFile, original);

      await untilState(
        holder,
        (one) =>
          freshnessOf(one, "crap") === "current" &&
          freshnessOf(one, "mutation") === "current",
      );
      holder.stop();
    },
    TEST_TIMEOUT,
  );

  it(
    "a_planned_sensor_with_work_to_perform_reaches_the_estimate_through_the_snapshot_and_the_service",
    async () => {
      const { repository, path, unreadable } = fixture(true);
      const service = new Service(path);

      cleanups.push(() => {
        service.stop();
        chmodSync(unreadable, 0o755);
        rmSync(unreadable, { recursive: true, force: true });
      });

      const { holder, sensors } = wire(repository, service);

      await holder.start();

      const state = await untilState(
        holder,
        (one) => one.registry.entries.length === 2,
      );
      const installed = installedSensorsOf(state);
      const scopes = workScopes(
        { sense: ["crap", "mutation"], modules: null },
        installed,
        "stamp",
      );

      expect(scopes.map(({ sensor }) => sensor)).toEqual(["mutation"]);

      const { stamp: _stamp, ...request } =
        scopes[0] as (typeof scopes)[number];

      expect(await sensors.plannedWork(request)).toEqual({
        unit: "functions",
        to_perform: 3,
      });
      holder.stop();
    },
    TEST_TIMEOUT,
  );
});
