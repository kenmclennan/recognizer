import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { fakeIo, PYTHON, ROOT, scanJson } from "./scan-helpers.js";

const COMMIT = "abc123";
const CONFIG = `${ROOT}/.recognizer/config.yaml`;
const RETIRED = "sensors:\n  structure:\n    distance_threshold: 0.5\n";
const BAD_DESCRIBER = "describer:\n  command: []\n";

function fresh(config: string) {
  return fakeIo({
    commit: COMMIT,
    files: { [`${ROOT}/a.py`]: "", [CONFIG]: config },
    scanners: { [PYTHON]: { output: scanJson(2, 1, { commit: COMMIT }) } },
  });
}

const runs = (fake: ReturnType<typeof fresh>) =>
  fake.calls.filter((call) => call.command === PYTHON).length;

describe("a retired sensors key in a fresh repository", () => {
  it.each([
    ["find", "m0"],
    ["uses", "m0.py"],
    ["used-by", "m0.py"],
    ["path", "m0.py", "m1.py"],
  ])("does not refuse %s", (...argv) => {
    const fake = fresh(RETIRED);
    const code = run([...argv, "--repository", ROOT], fake.io);

    expect(fake.err()).not.toContain("was removed");
    expect(code).toBe(0);
    expect(runs(fake)).toBe(1);
  });

  it("does not refuse callers on the config, only on the unknown member", () => {
    const fake = fresh(RETIRED);

    run(["callers", "m0.py", "run", "--repository", ROOT], fake.io);

    expect(fake.err()).not.toContain("was removed");
    expect(runs(fake)).toBe(1);
  });

  it("does not refuse views list", () => {
    const fake = fresh(RETIRED);

    expect(run(["views", "list", "--repository", ROOT], fake.io)).toBe(0);
  });

  it("does not refuse views new, which reaches the implicit scan", () => {
    const fake = fresh(RETIRED);
    const code = run(
      ["views", "new", "a", "--description", "Why", "--repository", ROOT],
      fake.io,
    );

    expect(fake.err()).not.toContain("was removed");
    expect(code).toBe(0);
  });

  it.each([
    [["modules"]],
    [["show", "m0.py"]],
    [["check"]],
    [["sensors", "check"]],
  ])("still refuses %j before extraction", (argv) => {
    const fake = fresh(RETIRED);

    expect(run([...argv, "--repository", ROOT], fake.io)).toBe(2);
    expect(fake.err()).toContain("distance_threshold was removed");
    expect(runs(fake)).toBe(0);
  });

  it("still refuses scan before extraction", async () => {
    const fake = fresh(RETIRED);

    expect(await run(["scan", ROOT], fake.io)).toBe(2);
    expect(fake.err()).toContain("distance_threshold was removed");
    expect(runs(fake)).toBe(0);
  });

  it("leaves sensors without a verb alone", () => {
    expect(run(["sensors"], fresh(RETIRED).io)).toBe(0);
  });
});

describe("a bad describer section beside a valid sensors section", () => {
  it("does not refuse find and refuses describe", () => {
    const find = fresh(BAD_DESCRIBER);
    const describe = fresh(BAD_DESCRIBER);

    expect(run(["find", "m0", "--repository", ROOT], find.io)).toBe(0);
    expect(run(["describe", "--repository", ROOT], describe.io)).toBe(2);
    expect(runs(describe)).toBe(0);
  });
});
