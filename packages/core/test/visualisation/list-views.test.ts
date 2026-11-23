import { describe, expect, it } from "vitest";
import { listViews } from "../../src/index.js";
import { repositoryWith, VisualisationWorld, viewOf } from "./world.js";

describe("listViews", () => {
  it("never reads the structure when there are no views", () => {
    const world = new VisualisationWorld();

    expect(listViews(world.ports, { root: "/r" })).toEqual([]);
    expect(world.freshReads).toBe(0);
  });

  it("lists a valid view, an invalid one and a stale one together", () => {
    const world = new VisualisationWorld();

    world.structure = repositoryWith(["a.py"]);
    world.views.views.set("fine", viewOf([{ kind: "pick", module: "a.py" }]));
    world.views.invalid.set("broken", ["view broken is not valid JSON"]);
    world.views.views.set(
      "stale",
      viewOf([{ kind: "pick", module: "gone.py" }]),
    );

    const rows = listViews(world.ports, { root: "/r" });

    expect(rows.map((row) => row.name)).toEqual(["broken", "fine", "stale"]);
    expect(rows[0]).toEqual({
      name: "broken",
      error: "view broken is not valid JSON",
    });
    expect(rows[1]).toMatchObject({ name: "fine", stale: [] });
    expect(rows[2]).toMatchObject({
      name: "stale",
      stale: [{ kind: "pick-unresolved", step: 1, path: "gone.py" }],
    });
    expect(world.freshReads).toBe(1);
  });
});
