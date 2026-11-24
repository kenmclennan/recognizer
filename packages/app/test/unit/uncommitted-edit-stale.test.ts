import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Repository, testsHashOf } from "@recognizer/core";
import { describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { inputsRefresh } from "../../src/inputs-refresh";
import type { PlanRequest } from "../../src/plan-reads";
import { planFromFacts } from "../../src/scan-fake";
import { withSensors } from "../../src/sensor-run";
import { fakeSensors } from "../../src/sensors-fake";
import { type DocScan, repositoryFrom } from "./repository-from";

const SCAN = repositoryFrom([
  {
    modules: [{ id: "a.ts", members: [{ kind: "function" }] }],
    edges: [],
    files: [{ path: "a.ts", hash: "ha" }],
  } as unknown as DocScan,
]);

const sha = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");

function git(folder: string, args: string[]) {
  return execFileSync(
    "git",
    ["-C", folder, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
    { encoding: "utf8" },
  );
}

function repositoryWithTest() {
  const folder = makeTempDir("rec-815-stale-");

  mkdirSync(join(folder, "test"));
  writeFileSync(
    join(folder, "test", "math.test.ts"),
    "it('adds', () => {});\n",
  );
  writeFileSync(join(folder, "a.ts"), "export const a = 1;\n");
  git(folder, ["init", "-q"]);
  git(folder, ["add", "."]);
  git(folder, ["commit", "-q", "-m", "first"]);

  return folder;
}

function hashFromDisk(folder: string) {
  return testsHashOf(
    {
      source: {
        readBytes: (root, path) => readFileSync(join(root, path)),
        hashOf: (root, path) => sha(readFileSync(join(root, path))),
        listFiles: (root) =>
          git(root, [
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
          ])
            .split("\0")
            .filter((path) => path !== ""),
        readText: (root, path) => readFileSync(join(root, path), "utf8"),
      },
      digest: { sha1Prefix: (text) => sha(text).slice(0, 7), sha256: sha },
      testReports: { entries: () => new Map() },
    },
    folder,
    new Map(),
  );
}

const REQUEST: PlanRequest = {
  repository: "/repo",
  mode: "bring",
  ticks: {
    describe: false,
    analysis: false,
    ticked: ["crap"],
    armed: [],
    onlyView: false,
    suites: {},
    folds: [],
  },
  scope: null,
  changed: [],
};

const SENSORS = [
  {
    name: "crap",
    display: "C.R.A.P.",
    runsTests: false,
    scoped: false,
    registered: true,
  },
];

async function gapAfter(loadedTests: string | null, recorded: string | null) {
  const view = await planFromFacts(REQUEST, {
    scans: SCAN,
    measured: {
      crap: { inputs: { "a.ts": "ha" }, tests: recorded ?? undefined },
    },
    tests: loadedTests,
    describerRegistered: false,
    lineKinds: () => "current",
    sensors: SENSORS,
  });

  return view.gaps.crap ?? [];
}

describe("an uncommitted test edit reaches the sensor's out-of-date state", () => {
  const empty = {
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

  it("reads current before the edit and out of date after an uncommitted append, with no commit between", async () => {
    const folder = repositoryWithTest();
    const port = fakeSensors();

    port.readTestsHash = async () => hashFromDisk(folder);

    const before = await withSensors(empty, port);

    expect(before.tests).not.toBeNull();
    expect(await gapAfter(before.tests ?? null, before.tests ?? null)).toEqual(
      [],
    );

    appendFileSync(join(folder, "test", "math.test.ts"), "// a comment\n");

    const after = await withSensors(empty, port);

    expect(after.tests).not.toBe(before.tests);
    expect(
      (await gapAfter(after.tests ?? null, before.tests ?? null)).length,
    ).toBeGreaterThan(0);
  });

  it("carries a dirty working-tree edit through the inputs-changed event to the sensor's stale gap", async () => {
    const folder = repositoryWithTest();
    const port = fakeSensors();

    port.readTestsHash = async () => hashFromDisk(folder);

    const recorded = (await withSensors(empty, port)).tests ?? null;
    let latest: string | null = recorded;
    let refreshed = 0;

    const onChanged = inputsRefresh({
      refresh: async () => {
        latest = (await withSensors(empty, port)).tests ?? null;
        refreshed += 1;
      },
      doctor: async () => {},
      flight: () => {},
    });

    port.onInputsChanged(() => void onChanged());

    expect(await gapAfter(latest, recorded)).toEqual([]);

    appendFileSync(join(folder, "test", "math.test.ts"), "// a comment\n");
    port.editInputs({});

    await vi.waitFor(() => expect(refreshed).toBe(1));

    expect((await gapAfter(latest, recorded)).length).toBeGreaterThan(0);
  });

  it("notices a second uncommitted edit after a run recorded the first, as fast as the first", async () => {
    const folder = repositoryWithTest();
    const port = fakeSensors();

    port.readTestsHash = async () => hashFromDisk(folder);

    let recorded = (await withSensors(empty, port)).tests ?? null;
    let latest: string | null = recorded;
    let refreshed = 0;

    const onChanged = inputsRefresh({
      refresh: async () => {
        latest = (await withSensors(empty, port)).tests ?? null;
        refreshed += 1;
      },
      doctor: async () => {},
      flight: () => {},
    });

    port.onInputsChanged(() => void onChanged());

    appendFileSync(join(folder, "test", "math.test.ts"), "// first\n");
    port.editInputs({});
    await vi.waitFor(() => expect(refreshed).toBe(1));
    expect((await gapAfter(latest, recorded)).length).toBeGreaterThan(0);

    recorded = latest;
    expect(await gapAfter(latest, recorded)).toEqual([]);

    appendFileSync(join(folder, "test", "math.test.ts"), "// second edit\n");
    port.editInputs({});
    await vi.waitFor(() => expect(refreshed).toBe(2));

    expect((await gapAfter(latest, recorded)).length).toBeGreaterThan(0);
  });

  it("starts watching the inputs from main.ts's start, after the repository is set", () => {
    const main = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../src/main.ts"),
      "utf8",
    );

    const start = main.slice(main.indexOf("async function start()"));
    const setRepo = start.indexOf("setScanRepository(folder);");
    const watch = start.indexOf("sensorsSource.watchInputs()");

    expect(setRepo).toBeGreaterThan(-1);
    expect(watch).toBeGreaterThan(setRepo);
    expect(start.slice(watch - 10, watch)).toContain("void ");
  });

  it("does not start watching on subscribing to the event", () => {
    const port = fakeSensors();

    port.onInputsChanged(() => {});

    expect(port.watched).toBe(0);
  });
});
