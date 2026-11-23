import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { currentTestsHash, freshnessFor, Repository } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { type Io, nodeIo } from "../src/cli.js";
import { testsHashPortsOf } from "./analysis-ports.js";
import { writeStubScanner } from "./stub-test-reporter.js";

const EXPECTED = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      "../../../fixtures/sensors/tests-digest/expected.json",
    ),
    "utf8",
  ),
) as { digest: string; entries: Record<string, string> };

const FIXTURE = join(
  import.meta.dirname,
  "../../../fixtures/sensors/tests-digest/rust-in-file",
);

function stubbed(entries: Record<string, string> = {}) {
  const directory = makeTempDir("recognizer-tests-hash-stub-");
  const log = join(directory, "runs.log");

  writeFileSync(log, "");
  writeStubScanner(directory, log, {
    name: "stub",
    stdout: JSON.stringify({ entries }),
  });

  const base = nodeIo();
  const io: Io = {
    ...base,
    env: (name) => (name === "PATH" ? directory : base.env(name)),
  };

  return { io, log, ports: testsHashPortsOf(io) };
}

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
    expect(
      currentTestsHash(stubbed().ports, repository(), Repository.empty),
    ).toBe(WORKED);
  });

  it("reproduces the shared digest from the fixture's Rust entries", () => {
    const root = makeTempDir("recognizer-tests-hash-");
    const rust = Object.fromEntries(
      Object.entries(EXPECTED.entries).filter(([key]) => key.includes("#")),
    );

    cpSync(FIXTURE, root, { recursive: true });
    execFileSync("git", ["-C", root, "init", "-q"]);

    expect(currentTestsHash(stubbed(rust).ports, root, Repository.empty)).toBe(
      EXPECTED.digest,
    );
  });

  it("changes when a test file is edited", () => {
    const root = repository();

    writeFileSync(join(root, "tests/a.py"), "changed");

    expect(currentTestsHash(stubbed().ports, root, Repository.empty)).not.toBe(
      WORKED,
    );
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

    expect(currentTestsHash(stubbed().ports, root, Repository.empty)).toBe(
      "9ca05192c8d29e058594e8b9e90288c94ad179315ab6b649529d9d09c4623d06",
    );
  });

  it("is null when git fails", () => {
    expect(
      currentTestsHash(
        stubbed().ports,
        makeTempDir("recognizer-tests-hash-"),
        Repository.empty,
      ),
    ).toBeNull();
  });
});

describe("freshnessFor", () => {
  it("does not spawn git unless a document carries tests", () => {
    let spawned = 0;
    const world = stubbed();
    const io: Io = {
      ...world.io,
      run: () => {
        spawned += 1;

        return { started: true, status: 1, stdout: "", stderr: "" };
      },
    };
    const judge = freshnessFor(testsHashPortsOf(io), "/r", Repository.empty);

    judge({ inputs: {} });

    expect(spawned).toBe(0);

    judge({ inputs: {}, tests: "t" });
    judge({ inputs: {}, tests: "t" });

    expect(spawned).toBe(1);
    expect(readFileSync(world.log, "utf8")).toBe("");
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
    const current = currentTestsHash(
      stubbed({ "src/lib.rs#0": "c".repeat(64) }).ports,
      root,
      Repository.empty,
    );

    expect(current).not.toBeNull();
    expect(current).not.toBe(old);
  });
});
