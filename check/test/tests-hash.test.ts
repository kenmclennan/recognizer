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

  it("orders paths by UTF-8 bytes, as the sensors and the app do", () => {
    const root = makeTempDir("recognizer-tests-hash-");

    for (const [path, text] of [
      ["tests/.py", "a"],
      ["tests/\u{10000}.py", "b"],
    ] as const) {
      mkdirSync(join(root, "tests"), { recursive: true });
      writeFileSync(join(root, path), text);
    }

    execFileSync("git", ["-C", root, "init", "-q"]);

    expect(currentTestsHash(nodeIo(), root, [])).toBe(
      "9ca05192c8d29e058594e8b9e90288c94ad179315ab6b649529d9d09c4623d06",
    );
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

describe("a result recorded before in-file tests were hashed", () => {
  it("reads as out of date for a repository holding a Rust in-file test", () => {
    const root = makeTempDir("recognizer-tests-hash-");

    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/lib.rs"), "#[test]\nfn t() {}\n");
    execFileSync("git", ["-C", root, "init", "-q"]);

    const old =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const current = currentTestsHash(nodeIo(), root, []);

    expect(current).not.toBeNull();
    expect(current).not.toBe(old);
  });
});
