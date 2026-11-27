import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { TestReportsAdapter } from "../src/adapters/plugins/test-reports-adapter.js";
import { ioWithRegistry, tempDirectory } from "./plugin-path.js";
import { type StubScanner, writeStubScanner } from "./stub-test-reporter.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function answer(entries: Record<string, string>): string {
  return JSON.stringify({ entries });
}

function setup(stubs: StubScanner[], timeoutMs = scaledTimeout(60_000)) {
  const directory = tempDirectory("recognizer-test-reports-");
  const log = join(directory, "runs.log");

  writeFileSync(log, "");

  for (const stub of stubs) {
    writeStubScanner(directory, log, stub);
  }

  const adapter = new TestReportsAdapter(
    ioWithRegistry([directory]),
    timeoutMs,
  );

  return {
    entries: () => adapter.entries("/repository"),
    runs: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
  };
}

describe("TestReportsAdapter", () => {
  it("never runs a scanner that does not declare reports_tests", () => {
    const world = setup([
      { name: "quiet", reportsTests: false, stdout: answer({ "a#0": HASH_A }) },
    ]);

    expect(world.entries()).toEqual(new Map());
    expect(world.runs()).toEqual([]);
  });

  it("merges the entries of two asked scanners", () => {
    const world = setup([
      { name: "one", stdout: answer({ "src/a.rs#0": HASH_A }) },
      { name: "two", stdout: answer({ "src/b.py#case": HASH_B }) },
    ]);

    expect(world.entries()).toEqual(
      new Map([
        ["src/a.rs#0", HASH_A],
        ["src/b.py#case", HASH_B],
      ]),
    );
    expect(world.runs().sort()).toEqual(["one /repository", "two /repository"]);
  });

  it("is null when one asked scanner answers and another exits 1", () => {
    const world = setup([
      { name: "good", stdout: answer({ "src/a.rs#0": HASH_A }) },
      { name: "bad", status: 1, stdout: answer({ "src/b.rs#0": HASH_B }) },
    ]);

    expect(world.entries()).toBeNull();
  });

  it.each([
    ["a key with no #", answer({ "src/a.rs": HASH_A })],
    ["a value that is not 64 lowercase hex", answer({ "src/a.rs#0": "XYZ" })],
    ["an uppercase value", answer({ "src/a.rs#0": "A".repeat(64) })],
    ["invalid JSON", "{"],
  ])("is null for %s", (_name, stdout) => {
    expect(setup([{ name: "odd", stdout }]).entries()).toBeNull();
  });

  it("is null when a scanner exceeds the timeout", () => {
    const world = setup(
      [{ name: "slow", holdSeconds: 30 }],
      scaledTimeout(400),
    );

    expect(world.entries()).toBeNull();
  });

  it("gives an empty map when installed scanners are none of them asked", () => {
    const world = setup([{ name: "quiet", reportsTests: false }]);

    expect(world.entries()).toEqual(new Map());
  });
});
