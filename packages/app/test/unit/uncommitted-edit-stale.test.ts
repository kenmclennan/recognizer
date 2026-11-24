import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Repository, testsHashOf } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import type { PlanRequest } from "../../src/plan-reads";
import { planFromFacts } from "../../src/scan-fake";
import { withSensors } from "../../src/sensor-run";
import { fakeSensors } from "../../src/sensors-fake";
import { FIXTURE_LANGUAGES } from "../language-behaviour";
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
      languages: { rules: () => FIXTURE_LANGUAGES },
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
});
