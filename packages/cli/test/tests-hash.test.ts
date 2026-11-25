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

  it("is null when the folder cannot be listed at all", () => {
    expect(
      currentTestsHash(
        stubbed().ports,
        join(makeTempDir("recognizer-tests-hash-"), "missing"),
        Repository.empty,
      ),
    ).toBeNull();
  });
});
