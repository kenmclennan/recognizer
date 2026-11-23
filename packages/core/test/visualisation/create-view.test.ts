import { describe, expect, it } from "vitest";
import { createView, InvalidRequest } from "../../src/index.js";
import { repositoryWith, VisualisationWorld, viewOf } from "./world.js";

const request = {
  root: "/r",
  name: "v",
  description: "d",
  change: undefined,
  plan: false,
  fromWindow: undefined,
};

describe("createView", () => {
  it("refuses an existing name", () => {
    const world = new VisualisationWorld();

    world.views.views.set("v", viewOf([]));

    expect(() => createView(world.ports, request)).toThrow(
      new InvalidRequest(["view already exists: v"]),
    );
  });

  it("refuses a blank description", () => {
    expect(() =>
      createView(new VisualisationWorld().ports, {
        ...request,
        description: "  ",
      }),
    ).toThrow("--description is required and must not be blank");
  });

  it("refuses a plan with a change range", () => {
    expect(() =>
      createView(new VisualisationWorld().ports, {
        ...request,
        plan: true,
        change: "a..b",
      }),
    ).toThrow("a plan has no change range");
  });

  it("refuses an unknown ref", () => {
    expect(() =>
      createView(new VisualisationWorld().ports, {
        ...request,
        change: "a..b",
      }),
    ).toThrow("unknown ref: a");
  });

  it("refuses a window showing a different folder", () => {
    const world = new VisualisationWorld();

    world.windows.states.set("w-1", {
      id: "w-1",
      folder: "/elsewhere",
      modules: [],
      folded: [],
      focus: null,
    });

    expect(() =>
      createView(world.ports, { ...request, fromWindow: "w-1" }),
    ).toThrow("w-1 shows /elsewhere, not /r");
  });

  it("creates from a window's picks and reports what resolves", () => {
    const world = new VisualisationWorld();

    world.structure = repositoryWith(["a.py", "b.py"]);
    world.windows.states.set("w-1", {
      id: "w-1",
      folder: "/r/",
      modules: ["b.py", "a.py"],
      folded: [],
      focus: null,
    });

    const made = createView(world.ports, { ...request, fromWindow: "w-1" });

    expect(made).toMatchObject({
      view: "v",
      changed: true,
      steps: 2,
      modules: 2,
    });
    expect(world.views.views.get("v")?.steps[0]).toEqual({
      kind: "pick",
      module: "a.py",
    });
  });
});
