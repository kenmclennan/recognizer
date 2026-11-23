import { describe, expect, it } from "vitest";
import { diffView, RequestRefused } from "../../src/index.js";
import { repositoryWith, VisualisationWorld, viewOf } from "./world.js";

function worldWith(commit: string | null): VisualisationWorld {
  const world = new VisualisationWorld();

  world.git.refs.set("main", "base1");
  world.git.refs.set("topic", "head1");
  world.structure = repositoryWith(["a.py"], [], { commit });
  world.views.views.set("plain", viewOf([]));
  world.views.views.set(
    "ranged",
    viewOf([], { change: { base: "main", head: "topic" } }),
  );

  return world;
}

describe("diffView", () => {
  it("refuses a view with no change range", () => {
    expect(() =>
      diffView(worldWith("base1").ports, { root: "/r", name: "plain" }),
    ).toThrow(new RequestRefused(["view plain is not a change view"]));
  });

  it("refuses a head the repository cannot resolve", () => {
    const world = worldWith("base1");

    world.git.refs.delete("topic");

    expect(() => diffView(world.ports, { root: "/r", name: "ranged" })).toThrow(
      "head topic is not in the repository",
    );
  });

  it("uses the base scan when the one extraction is at the base commit", () => {
    const world = worldWith("base1");

    diffView(world.ports, { root: "/r", name: "ranged" });

    expect(world.changes.lastBase).toBe(world.structure);
  });

  it("does not use a scan one commit off the base", () => {
    const world = worldWith("other");

    diffView(world.ports, { root: "/r", name: "ranged" });

    expect(world.changes.lastBase).toBeNull();
  });

  it("does not use a repository with no extractions as a base", () => {
    const world = worldWith(null);

    world.structure = repositoryWith(["a.py"]);
    diffView(world.ports, { root: "/r", name: "ranged" });

    expect(world.changes.lastBase).toBeNull();
  });
});
