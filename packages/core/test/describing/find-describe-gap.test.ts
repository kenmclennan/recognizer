import { describe, expect, it } from "vitest";
import { findDescribeGap } from "../../src/index.js";
import { createFakes } from "../fakes/container.js";
import { DescribingWorld, ROOT } from "./describing-world.js";

function setup() {
  const world = new DescribingWorld();
  const { structure } = createFakes();

  structure.save(ROOT, "python", world.repository("a.py", "b.py", "c.py"));

  const gap = () =>
    findDescribeGap(
      {
        structure,
        describer: world.describer,
        responsibilities: world.responsibilities,
      },
      ROOT,
      ["a.py", "b.py", "c.py"],
    );

  return { world, gap };
}

describe("findDescribeGap", () => {
  it("is not registered for a describer that is only the shipped one", () => {
    const { world, gap } = setup();

    world.describer.shipped = true;

    expect(gap()).toBeNull();
  });

  it("is not registered when there is no describer", () => {
    const { world, gap } = setup();

    world.describer.registered = false;

    expect(gap()).toBeNull();
  });

  it("names the out-of-date and missing files from the lines and the scanned hashes", () => {
    const { world, gap } = setup();

    world.line("a.py", { sourceHash: "scan-a.py" });
    world.line("b.py", { sourceHash: "old" });

    expect(gap()).toEqual(["b.py", "c.py"]);
  });

  it("reads a line against an older describer version as out of date", () => {
    const { world, gap } = setup();

    world.line("a.py", { sourceHash: "scan-a.py", version: "v0" });
    world.line("b.py", { sourceHash: "scan-b.py" });
    world.line("c.py", { sourceHash: "scan-c.py" });

    expect(gap()).toEqual(["a.py"]);
  });

  it("is unknown for every file on an unreadable responsibilities file", () => {
    const { world, gap } = setup();

    world.responsibilities.invalid.set(ROOT, "responsibilities is not valid");

    expect(gap()).toEqual([]);
  });
});
