import { describe, expect, it } from "vitest";
import { probeDescriberCheck } from "../src/application/plugins/probe-describer-check.js";
import { splitAtRun } from "../src/domain/plugins/sensor-check.js";

type Result = { started: boolean; status: number | null };

function recorder(result: Result) {
  const calls: { program: string; args: string[]; cwd: string }[] = [];

  return {
    calls,
    run: (program: string, args: string[], cwd: string): Result => {
      calls.push({ program, args, cwd });

      return result;
    },
  };
}

describe("probeDescriberCheck", () => {
  it("a command with no run element is no-run and never probed", () => {
    const probe = recorder({ started: true, status: 0 });

    expect(
      probeDescriberCheck(probe.run, "/r", ["program-d", "--model", "m"]),
    ).toEqual({ kind: "no-run" });
    expect(probe.calls).toEqual([]);
  });

  it("probes the words before run with check, in the repository", () => {
    const probe = recorder({ started: true, status: 0 });

    expect(
      probeDescriberCheck(probe.run, "/r", [
        "d",
        "--flag",
        "{repository}",
        "run",
        "--model",
        "m",
      ]),
    ).toEqual({ kind: "passed" });
    expect(probe.calls).toEqual([
      { program: "d", args: ["--flag", "/r", "check"], cwd: "/r" },
    ]);
  });

  it("a non-zero exit and a program that does not start are both failed", () => {
    const command = ["d", "run"];

    expect(
      probeDescriberCheck(
        recorder({ started: true, status: 3 }).run,
        "/r",
        command,
      ),
    ).toEqual({
      kind: "failed",
      program: "d",
      words: ["d"],
      started: true,
      status: 3,
    });
    expect(
      probeDescriberCheck(
        recorder({ started: false, status: null }).run,
        "/r",
        command,
      ),
    ).toMatchObject({ kind: "failed", started: false });
  });
});

describe("splitAtRun", () => {
  it("splits at the first run when there are two", () => {
    expect(splitAtRun(["a", "run", "b", "run"])).toEqual({
      prefix: ["a"],
      rest: ["b", "run"],
    });
  });

  it("a lone run gives an empty prefix and rest", () => {
    expect(splitAtRun(["run"])).toEqual({ prefix: [], rest: [] });
  });

  it("run as the last element gives an empty rest", () => {
    expect(splitAtRun(["a", "run"])).toEqual({ prefix: ["a"], rest: [] });
  });

  it("no run gives null", () => {
    expect(splitAtRun(["a", "b"])).toBeNull();
  });
});
