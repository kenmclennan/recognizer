import { describe, expect, it } from "vitest";
import {
  type Candidate,
  InvalidRequest,
  identityKey,
  settleBaseline,
  Violation,
} from "../../src/index.js";
import { FakeBaselineRepository } from "../fakes/fake-baseline-repository.js";

const PATH = "/r/baselines/violations.json";
const FLAGS = { baseline: undefined, update: false, init: false };

function candidate(to: string): Candidate {
  const entry = { from: "a/x.py", to, kind: "depends" };

  return {
    entries: [entry],
    keys: [identityKey(entry)],
    value: {
      type: "violation",
      value: {
        violation: new Violation({
          file: "a/x.py",
          rule: { type: "forbid", pattern: "a/** -> b/**" },
          dependencies: [{ to, kind: "depends", lines: [1] }],
        }),
        grown: false,
      },
    },
  };
}

function baselineOf(...targets: string[]): FakeBaselineRepository {
  const baselines = new FakeBaselineRepository();

  baselines.write(
    PATH,
    targets.map((to) => ({ from: "a/x.py", to, kind: "depends" })),
  );

  return baselines;
}

describe("settleBaseline", () => {
  it("--update-baseline removes only the fixed entry", () => {
    const baselines = baselineOf("b/fixed.py", "b/kept.py");
    const settled = settleBaseline(
      baselines,
      { ...FLAGS, update: true },
      PATH,
      [candidate("b/kept.py")],
    );

    expect(settled.report.action).toBe("shrunk");
    expect(baselines.read(PATH)).toEqual([
      { from: "a/x.py", to: "b/kept.py", kind: "depends" },
    ]);
  });

  it("--update-baseline never shrinks while a new violation stands", () => {
    const baselines = baselineOf("b/fixed.py", "b/kept.py");
    const settled = settleBaseline(
      baselines,
      { ...FLAGS, update: true },
      PATH,
      [candidate("b/kept.py"), candidate("b/new.py")],
    );

    expect(settled.result.new).toHaveLength(1);
    expect(settled.report.action).toBe("none");
    expect(baselines.read(PATH)).toHaveLength(2);
  });

  it("--init-baseline on an existing file is refused", () => {
    const baselines = baselineOf("b/kept.py");

    expect(() =>
      settleBaseline(baselines, { ...FLAGS, init: true }, PATH, []),
    ).toThrow(new InvalidRequest([`baseline already exists: ${PATH}`]));
  });

  it("--init-baseline writes every candidate", () => {
    const baselines = new FakeBaselineRepository();
    const settled = settleBaseline(baselines, { ...FLAGS, init: true }, PATH, [
      candidate("b/one.py"),
      candidate("b/two.py"),
    ]);

    expect(settled.report.action).toBe("initialised");
    expect(baselines.read(PATH)).toHaveLength(2);
    expect(settled.result.new).toHaveLength(0);
  });
});
