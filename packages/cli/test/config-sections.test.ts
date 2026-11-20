import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { fakeIo, PYTHON, ROOT, scanJson } from "./scan-helpers.js";

const COMMIT = "abc123";
const CONFIG = `${ROOT}/.recognizer/config.yaml`;
const RETIRED = "sensors:\n  structure:\n    distance_threshold: 0.5\n";
const BAD_DESCRIBER = "describer:\n  command: []\n";

function fresh(config: string) {
  return fakeIo({
    sensorManifests: true,
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

const GOOD_DESCRIBER =
  "describer:\n  command: [describer-bin]\n  version: v1\n";
const INVALID_TESTS = "tests: []\n";

function freshWith(config: string, extra: Record<string, string> = {}) {
  return fakeIo({
    commit: COMMIT,
    files: { [`${ROOT}/a.py`]: "", [CONFIG]: config, ...extra },
    scanners: { [PYTHON]: { output: scanJson(2, 1, { commit: COMMIT }) } },
  });
}

describe("each command refuses only the sections it reads", () => {
  it("lets describe run past a retired sensors key", () => {
    const fake = freshWith(`${GOOD_DESCRIBER}${RETIRED}`);

    expect(
      run(["describe", "--check", "--repository", ROOT], fake.io),
    ).not.toBe(2);
    expect(fake.err()).not.toContain("distance_threshold");
    expect(runs(fake)).toBe(1);
  });

  it("refuses sensors check on a sensors error and ignores a describer error", () => {
    const refused = fresh(RETIRED);
    const ignored = fresh(BAD_DESCRIBER);

    expect(run(["sensors", "check", "--repository", ROOT], refused.io)).toBe(2);
    expect(refused.err()).toContain("distance_threshold was removed");
    expect(run(["sensors", "check", "--repository", ROOT], ignored.io)).toBe(2);
    expect(ignored.err()).toContain("no sensors are registered");
    expect(ignored.err()).not.toContain("config/describer");
  });

  it("names the section each command reads when both are bad", () => {
    const both = `${RETIRED}${BAD_DESCRIBER}`;
    const sensors = fresh(both);
    const report = fresh(both);
    const describe = fresh(both);

    expect(run(["sensors", "check", "--repository", ROOT], sensors.io)).toBe(2);
    expect(sensors.err()).toContain("distance_threshold was removed");
    expect(run(["report", "--as", "x", "--repository", ROOT], report.io)).toBe(
      2,
    );
    expect(report.err()).toContain("distance_threshold was removed");
    expect(run(["describe", "--repository", ROOT], describe.io)).toBe(2);
    expect(describe.err()).not.toContain("distance_threshold");
    expect(runs(describe)).toBe(0);
  });

  it("lets report, check and modules ignore a describer error", () => {
    const report = freshWith(BAD_DESCRIBER);
    const modules = freshWith(BAD_DESCRIBER);
    const check = freshWith(BAD_DESCRIBER);

    run(["report", "--as", "x", "--repository", ROOT], report.io);

    expect(report.err()).not.toContain("config/describer");
    expect(run(["modules", "--repository", ROOT], modules.io)).toBe(0);
    expect(run(["check", "--repository", ROOT], check.io)).not.toBe(2);
  });

  it("refuses show on a describer error before extraction", () => {
    const fake = fresh(BAD_DESCRIBER);

    expect(run(["show", "m0.py", "--repository", ROOT], fake.io)).toBe(2);
    expect(runs(fake)).toBe(0);
  });

  it.each([
    [["modules"]],
    [["report", "--as", "x"]],
    [["sensors", "check"]],
    [["show", "m0.py"]],
  ])("refuses %j on an invalid tests section", (argv) => {
    const fake = fresh(INVALID_TESTS);

    expect(run([...argv, "--repository", ROOT], fake.io)).toBe(2);
    expect(runs(fake)).toBe(0);
  });

  it("lets describe and find ignore an invalid tests section", () => {
    const describe = freshWith(`${GOOD_DESCRIBER}${INVALID_TESTS}`);
    const find = fresh(INVALID_TESTS);

    expect(
      run(["describe", "--check", "--repository", ROOT], describe.io),
    ).not.toBe(2);
    expect(runs(describe)).toBe(1);
    expect(run(["find", "m0", "--repository", ROOT], find.io)).toBe(0);
  });

  it("leaves no structure findings when describe extracts", () => {
    const fake = freshWith(
      "sensors:\n  structure:\n    warnings:\n      cycle: true\n",
    );
    run(["describe", "--repository", ROOT], fake.io);

    expect(fake.files.has(`${ROOT}/.recognizer/cache/scan.python.json`)).toBe(
      true,
    );
    expect(
      [...fake.files.keys()].filter((file) => file.endsWith("structure.json")),
    ).toEqual([]);
  });
});
