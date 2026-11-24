import { describe, expect, it } from "vitest";
import { checkDescriptions, InvalidRequest } from "../../src/index.js";
import { DescribingWorld, ROOT } from "./describing-world.js";

function run(world: DescribingWorld, names: string[], ...ids: string[]) {
  return checkDescriptions(world.ports, {
    root: ROOT,
    repository: world.repository(...ids),
    describer: {
      describerRef: true,
      command: world.describer.command,
      version: world.describer.version,
    },
    names,
  });
}

describe("checkDescriptions", () => {
  it("gives the rows and counts for current, out-of-date, missing and unreadable files", () => {
    const world = new DescribingWorld();

    world.line("a.py");
    world.line("b.py", { sourceHash: "old" });
    world.describer.unreadable.add("d.py");

    const check = run(world, [], "a.py", "b.py", "c.py", "d.py");

    expect(check.ok).toBe(false);
    expect(check.counts).toEqual({
      current: 1,
      outOfDate: 1,
      missing: 1,
      unreadable: 1,
    });
    expect(check.modules).toEqual([
      { module: "a.py", status: "current", line: "line of a.py", reasons: [] },
      {
        module: "b.py",
        status: "out-of-date",
        line: "line of b.py",
        reasons: ["source"],
      },
      { module: "c.py", status: "missing", line: null, reasons: [] },
      { module: "d.py", status: "unreadable", line: null, reasons: [] },
    ]);
  });

  it("is ok when every file is current", () => {
    const world = new DescribingWorld();

    world.line("a.py");

    expect(run(world, [], "a.py").ok).toBe(true);
  });

  it("lists lines for files no longer scanned only when no names are given", () => {
    const world = new DescribingWorld();

    world.line("a.py");
    world.line("gone.py");

    expect(run(world, [], "a.py").gone).toEqual(["gone.py"]);
    expect(run(world, ["a.py"], "a.py").gone).toEqual([]);
  });

  it("refuses an unknown name", () => {
    const world = new DescribingWorld();

    expect(() => run(world, ["x.py"], "a.py")).toThrow(InvalidRequest);
  });

  it("starts no session and writes nothing", () => {
    const world = new DescribingWorld();

    run(world, [], "a.py");

    expect(world.describer.opened).toBe(0);
    expect(world.responsibilities.writes).toBe(0);
  });
});
