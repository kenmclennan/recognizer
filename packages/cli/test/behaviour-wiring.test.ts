import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import {
  adapterStems,
  checkWiring,
  type Exception,
  readBaseline,
} from "./behaviour-wiring-check.js";
import { REPO } from "./helpers.js";

const TEST_DIRECTORY = "packages/cli/test";
const BASELINE = join(REPO, TEST_DIRECTORY, "behaviour-wiring-baseline.txt");

const EXCEPTIONS: Exception[] = [];

const ADAPTERS = ["../src/adapt", "ers/git/git-adapter.js"].join("");
const KIND = "Git";
const WIRED = `import { ${KIND}Adapter } from "${ADAPTERS}";\nexport const g = new ${KIND}Adapter();\n`;
const CLEAN = `import { run } from "../src/cli.js";\nexport const r = run;\n`;

function tree(files: Record<string, string>): string {
  const root = makeTempDir("behaviour-wiring-");

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
}

function check(root: string, baseline: string[], exceptions: Exception[] = []) {
  return checkWiring({
    repositoryRoot: root,
    testDirectory: "test",
    baseline,
    exceptions,
    stems: adapterStems(join(root, "src/adapters")),
  });
}

describe("behaviour tests go through the CLI's root", () => {
  it("an unlisted wired file fails", () => {
    const root = tree({ "test/new.test.ts": WIRED, "test/ok.test.ts": CLEAN });
    const report = check(root, []);

    expect(report.unlisted).toEqual(["test/new.test.ts"]);
  });

  it("a stale baseline line fails", () => {
    const root = tree({ "test/ok.test.ts": CLEAN });
    const report = check(root, ["test/ok.test.ts", "test/gone.test.ts"]);

    expect(report.stale).toEqual(["test/ok.test.ts", "test/gone.test.ts"]);
  });

  it("an adapter-contract file and a pure-domain file pass", () => {
    const root = tree({
      "src/adapters/git/git-adapter.ts": "export class GitAdapter {}\n",
      "test/git-adapter-refs.test.ts": WIRED,
      "test/pure.test.ts": WIRED,
    });
    const report = check(
      root,
      [],
      [
        {
          path: "test/pure.test.ts",
          category: "pure-domain",
          reason: "tests a pure module over plain values",
        },
      ],
    );

    expect(report.unlisted).toEqual([]);
    expect(report.excepted).toEqual([
      "test/git-adapter-refs.test.ts",
      "test/pure.test.ts",
    ]);
  });

  it("a file that calls the timing helper and wires by hand fails", () => {
    const root = tree({
      "test/timed.test.ts": `${WIRED}await timeEndToEnd({});\n`,
    });
    const report = check(root, ["test/timed.test.ts"]);

    expect(report.timedAndWired).toEqual(["test/timed.test.ts"]);
  });

  it("a mixed tree reports the unlisted file and the stale line and passes the rest", () => {
    const root = tree({
      "src/adapters/git/git-adapter.ts": "export class GitAdapter {}\n",
      "test/baselined.test.ts": WIRED,
      "test/git-adapter.test.ts": WIRED,
      "test/unlisted.test.ts": WIRED,
    });
    const report = check(root, ["test/baselined.test.ts", "test/gone.test.ts"]);

    expect(report.unlisted).toEqual(["test/unlisted.test.ts"]);
    expect(report.stale).toEqual(["test/gone.test.ts"]);
    expect(report.excepted).toEqual(["test/git-adapter.test.ts"]);
  });

  it("the real tree matches its baseline", () => {
    const baseline = readBaseline(BASELINE);
    const real = checkWiring({
      repositoryRoot: REPO,
      testDirectory: TEST_DIRECTORY,
      baseline,
      exceptions: EXCEPTIONS,
      stems: adapterStems(join(REPO, "packages/cli/src/adapters")),
    });

    expect(real.unlisted).toEqual([]);
    expect(real.stale).toEqual([]);
    expect(real.timedAndWired).toEqual([]);
    expect(real.flagged.length).toBe(baseline.length + real.excepted.length);
    expect(
      EXCEPTIONS.every(
        ({ category, reason }) =>
          ["pure-domain", "adapter-contract"].includes(category) &&
          reason !== "",
      ),
    ).toBe(true);
  });
});
