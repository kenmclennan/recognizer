import { describe, expect, it } from "vitest";
import { checkViews } from "../../src/index.js";
import { repositoryWith, VisualisationWorld, viewOf } from "./world.js";

function renamedWorld(): VisualisationWorld {
  const world = new VisualisationWorld();

  world.structure = repositoryWith(["new.py"]);
  world.git.renames.set("c1", new Map([["old.py", "new.py"]]));
  world.views.views.set(
    "v",
    viewOf([{ kind: "pick", module: "old.py" }], { commit: "c1" }),
  );

  return world;
}

describe("checkViews", () => {
  it("runs no scan with no views", () => {
    const world = new VisualisationWorld();

    expect(
      checkViews(world.ports, { root: "/r", name: undefined, fix: false }),
    ).toEqual([]);
    expect(world.freshReads).toBe(0);
  });

  it("reports a renamed pick and writes nothing without fix", () => {
    const world = renamedWorld();
    const [result] = checkViews(world.ports, {
      root: "/r",
      name: undefined,
      fix: false,
    });

    expect(result?.unresolved[0]?.renamedTo).toBe("new.py");
    expect(world.views.written).toHaveLength(0);
  });

  it("rewrites a renamed pick once with fix", () => {
    const world = renamedWorld();
    const [result] = checkViews(world.ports, {
      root: "/r",
      name: undefined,
      fix: true,
    });

    expect(result?.fixed).toEqual([{ step: 1, from: "old.py", to: "new.py" }]);
    expect(result?.ok).toBe(true);
    expect(world.views.written).toEqual(["v"]);
  });

  it("leaves a rename target the scan lacks unresolved", () => {
    const world = renamedWorld();

    world.structure = repositoryWith(["other.py"]);

    const [result] = checkViews(world.ports, {
      root: "/r",
      name: undefined,
      fix: true,
    });

    expect(result?.unresolved[0]?.renamedTo).toBeNull();
    expect(world.views.written).toHaveLength(0);
  });

  it("reports an unreadable view without stopping the others", () => {
    const world = renamedWorld();

    world.views.invalid.set("a-bad", ["view a-bad is invalid"]);

    const results = checkViews(world.ports, {
      root: "/r",
      name: undefined,
      fix: false,
    });

    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ["a-bad", false],
      ["v", false],
    ]);
    expect(results[0]?.error).toBe("view a-bad is invalid");
  });
});
