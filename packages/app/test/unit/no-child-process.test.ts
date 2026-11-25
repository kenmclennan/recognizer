import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import {
  checkSpawning,
  type Exception,
  readBaseline,
} from "./no-child-process-check";

const REPO = join(__dirname, "../../../..");
const TEST_DIRECTORY = "packages/app/test";
const BASELINE = join(
  REPO,
  TEST_DIRECTORY,
  "unit/no-child-process-baseline.txt",
);

const EXCEPTIONS: Exception[] = [
  {
    path: "packages/app/test/unit/behaviour-wiring-check.ts",
    reason: "runs git ls-files",
  },
  {
    path: "packages/app/test/unit/no-child-process-check.ts",
    reason: "runs git ls-files",
  },
  {
    path: "packages/app/test/unit/behaviour-wiring.test.ts",
    reason: "its fixtures name ../roots as text, never importing it",
  },
];

const SPAWN_MODULE = ["node", "child_process"].join(":");
const SPAWNS = `import { run } from "${SPAWN_MODULE}";\nexport const go = run;\n`;
const CLEAN = `export const fine = 1;\n`;

function tree(files: Record<string, string>): string {
  const root = makeTempDir("no-child-process-");

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
}

function check(root: string, baseline: string[], exceptions: Exception[] = []) {
  return checkSpawning({
    repositoryRoot: root,
    testDirectory: "test",
    baseline,
    exceptions,
  });
}

describe("a test outside the adapter-contract and end-to-end folders starts no child process", () => {
  it("a spawning file outside the folders fails", () => {
    const root = tree({ "test/new.test.ts": SPAWNS, "test/ok.test.ts": CLEAN });
    const report = check(root, []);

    expect(report.flagged).toEqual(["test/new.test.ts"]);
    expect(report.unlisted).toEqual(["test/new.test.ts"]);
  });

  it("the same file inside end-to-end passes", () => {
    const root = tree({ "test/end-to-end/new.test.ts": SPAWNS });
    const report = check(root, []);

    expect(report.flagged).toEqual([]);
    expect(report.unlisted).toEqual([]);
  });

  it("the same file inside adapter-contract passes", () => {
    const root = tree({ "test/adapter-contract/new.test.ts": SPAWNS });

    expect(check(root, []).unlisted).toEqual([]);
  });

  it("a file that reaches the spawn only through a local helper fails", () => {
    const root = tree({
      "test/helper.ts": SPAWNS,
      "test/middle.ts": `import { go } from "./helper.js";\nexport const m = go;\n`,
      "test/uses.test.ts": `import { m } from "./middle.js";\nexport const u = m;\n`,
    });
    const report = check(root, []);

    expect(report.unlisted).toEqual([
      "test/helper.ts",
      "test/middle.ts",
      "test/uses.test.ts",
    ]);
  });

  it("a file importing the support barrel passes", () => {
    const root = tree({
      "test/support/index.ts": `export const fake = 1;\n`,
      "test/uses.test.ts": `import { fake } from "./support/index.js";\nexport const u = fake;\n`,
    });

    expect(check(root, []).flagged).toEqual([]);
  });

  it("a stale baseline line fails", () => {
    const root = tree({ "test/ok.test.ts": CLEAN });
    const report = check(root, ["test/ok.test.ts", "test/gone.test.ts"]);

    expect(report.stale).toEqual(["test/ok.test.ts", "test/gone.test.ts"]);
  });

  it("the mixed case reports the unlisted file and the stale line and passes the baselined and the excepted file", () => {
    const root = tree({
      "test/baselined.test.ts": SPAWNS,
      "test/excepted.ts": SPAWNS,
      "test/unlisted.test.ts": SPAWNS,
    });
    const report = check(
      root,
      ["test/baselined.test.ts", "test/gone.test.ts"],
      [{ path: "test/excepted.ts", reason: "runs git ls-files" }],
    );

    expect(report.unlisted).toEqual(["test/unlisted.test.ts"]);
    expect(report.stale).toEqual(["test/gone.test.ts"]);
    expect(report.excepted).toEqual(["test/excepted.ts"]);
  });

  it("the real tree matches its baseline", () => {
    const baseline = readBaseline(BASELINE);
    const report = checkSpawning({
      repositoryRoot: REPO,
      testDirectory: TEST_DIRECTORY,
      baseline,
      exceptions: EXCEPTIONS,
    });

    expect(report.unlisted).toEqual([]);
    expect(report.stale).toEqual([]);
    expect(report.excepted.length).toBe(EXCEPTIONS.length);
    expect(report.flagged.length).toBe(baseline.length);
  });
});
