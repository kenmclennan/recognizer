import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";
import { currentTestsHash, freshnessFor } from "../src/tests-hash.js";

const WORKED =
  "9a49fc96a1cf8fd7663d83897d346b14a4f4de85c8114981854191414ab6df5a";

function repository(): string {
  const root = makeTempDir("recognizer-tests-hash-");

  for (const [path, text] of [
    ["tests/a.py", "a"],
    ["tests/b.py", "b"],
    ["src/app.py", "x"],
  ] as const) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  execFileSync("git", ["-C", root, "init", "-q"]);

  return root;
}

describe("currentTestsHash", () => {
  it("reproduces the worked example digest", () => {
    expect(currentTestsHash(nodeIo(), repository(), [])).toBe(WORKED);
  });

  it("changes when a test file is edited", () => {
    const root = repository();

    writeFileSync(join(root, "tests/a.py"), "changed");

    expect(currentTestsHash(nodeIo(), root, [])).not.toBe(WORKED);
  });

  it("is null when git fails", () => {
    expect(
      currentTestsHash(nodeIo(), makeTempDir("recognizer-tests-hash-"), []),
    ).toBeNull();
  });
});

describe("freshnessFor", () => {
  it("does not spawn git unless a document carries tests", () => {
    let spawned = 0;
    const io = {
      run: () => {
        spawned += 1;

        return { started: true, status: 1, stdout: "", stderr: "" };
      },
    } as unknown as Parameters<typeof freshnessFor>[0];
    const judge = freshnessFor(io, "/r", []);

    judge({ inputs: {} });

    expect(spawned).toBe(0);

    judge({ inputs: {}, tests: "t" });
    judge({ inputs: {}, tests: "t" });

    expect(spawned).toBe(1);
  });
});
