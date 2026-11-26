import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import {
  checkWiring,
  type Exception,
  readBaseline,
  sourceStems,
} from "./behaviour-wiring-check";

const REPO = join(__dirname, "../../../..");
const TEST_DIRECTORY = "packages/app/test";
const BASELINE = join(
  REPO,
  TEST_DIRECTORY,
  "unit/behaviour-wiring-baseline.txt",
);

const EXCEPTIONS: Exception[] = [];

const LOOK = ["../look-", "support"].join("");
const WIRED = `import { showIt } from "${LOOK}";\nexport const g = showIt;\n`;
const CLEAN = `import { pure } from "../../src/pure";\nexport const r = pure;\n`;

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
    stems: new Set<string>(),
  });
}

describe("behaviour tests go through the app's root", () => {
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

  it("a pure-domain file passes", () => {
    const root = tree({
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
    expect(report.excepted).toEqual(["test/pure.test.ts"]);
  });

  it("a file that renders a model the root recorded is not wired by hand", () => {
    const root = tree({
      "test/rendered.test.ts": `import { appRoot } from "../roots";\n${WIRED}`,
      "test/hand.test.ts": `import { appRoot } from "../roots";\ncreateRescanner({});\n`,
    });
    const report = check(root, []);

    expect(report.unlisted).toEqual(["test/hand.test.ts"]);
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
      "test/baselined.test.ts": WIRED,
      "test/pure.test.ts": WIRED,
      "test/unlisted.test.ts": WIRED,
    });
    const report = check(
      root,
      ["test/baselined.test.ts", "test/gone.test.ts"],
      [
        {
          path: "test/pure.test.ts",
          category: "pure-domain",
          reason: "tests a pure module over plain values",
        },
      ],
    );

    expect(report.unlisted).toEqual(["test/unlisted.test.ts"]);
    expect(report.stale).toEqual(["test/gone.test.ts"]);
    expect(report.excepted).toEqual(["test/pure.test.ts"]);
  });

  it("a bridge source's own test passes by its stem", () => {
    const root = tree({
      "src/scan-source.ts": "export const scanSource = {};\n",
      "test/scan-source.test.ts": WIRED,
      "test/scan-source-refresh.test.ts": WIRED,
      "test/other.test.ts": WIRED,
    });
    const report = checkWiring({
      repositoryRoot: root,
      testDirectory: "test",
      baseline: [],
      exceptions: [],
      stems: sourceStems(join(root, "src")),
    });

    expect(report.excepted).toEqual([
      "test/scan-source-refresh.test.ts",
      "test/scan-source.test.ts",
    ]);
    expect(report.unlisted).toEqual(["test/other.test.ts"]);
  });

  it("the real tree matches its baseline", () => {
    const baseline = readBaseline(BASELINE);
    const real = checkWiring({
      repositoryRoot: REPO,
      testDirectory: TEST_DIRECTORY,
      baseline,
      exceptions: EXCEPTIONS,
      stems: sourceStems(join(REPO, "packages/app/src")),
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
