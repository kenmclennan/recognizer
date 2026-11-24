import { describe, expect, it } from "vitest";
import { readResponsibility } from "../../src/index.js";
import { DescribingWorld, ROOT } from "./describing-world.js";

function read(
  world: DescribingWorld,
  options: { describer?: boolean; files?: string[] } = {},
) {
  return readResponsibility(world.ports, {
    root: ROOT,
    repository: world.repository(...(options.files ?? ["a.py"])),
    id: "a.py",
    describer:
      options.describer === false
        ? null
        : {
            describerRef: true,
            command: world.describer.command,
            version: world.describer.version,
          },
  });
}

describe("readResponsibility", () => {
  it("is current when the line matches the source and the describer", () => {
    const world = new DescribingWorld();

    world.line("a.py");

    expect(read(world)).toEqual({ status: "current", line: "line of a.py" });
  });

  it("is out of date when the source hash differs", () => {
    const world = new DescribingWorld();

    world.line("a.py", { sourceHash: "old" });

    expect(read(world)).toEqual({
      status: "out-of-date",
      line: "line of a.py",
    });
  });

  it("is missing with no line, even with no describer", () => {
    expect(read(new DescribingWorld(), { describer: false })).toEqual({
      status: "missing",
      line: null,
    });
  });

  it("is unchecked with the line when no describer is given", () => {
    const world = new DescribingWorld();

    world.line("a.py");

    expect(read(world, { describer: false })).toEqual({
      status: "unchecked",
      line: "line of a.py",
    });
  });

  it("is unchecked with the line when the source cannot be read", () => {
    const world = new DescribingWorld();

    world.line("a.py");
    world.describer.unreadable.add("a.py");

    expect(read(world)).toEqual({ status: "unchecked", line: "line of a.py" });
  });

  it("is unchecked with the line when the id names no scanned file", () => {
    const world = new DescribingWorld();

    world.line("a.py");

    expect(read(world, { files: ["b.py"] })).toEqual({
      status: "unchecked",
      line: "line of a.py",
    });
  });

  it("is unchecked with no line when the responsibilities file is invalid", () => {
    const world = new DescribingWorld();

    world.responsibilities.invalid.set(ROOT, "bad");

    expect(read(world)).toEqual({ status: "unchecked", line: null });
  });
});
