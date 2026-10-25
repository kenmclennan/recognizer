import { describe, expect, it } from "vitest";
import { createCanvasState } from "./canvas-state";
import { createOpenModules } from "./open-modules";

function setup() {
  const modules = createOpenModules([
    "a/x.py",
    "a/b/y.py",
    "a/b/z.py",
    "c/w.py",
  ]);

  for (const id of modules.opened()) {
    modules.close(id);
  }

  for (const id of ["a/x.py", "a/b/y.py", "a/b/z.py", "c/w.py"]) {
    modules.open(id);
  }

  return { modules, state: createCanvasState(modules) };
}

describe("canvas state", () => {
  it("takes a module off and drops its selection", () => {
    const { modules, state } = setup();

    state.select({ kind: "module", id: "a/x.py" });
    state.takeOff(state.selection());

    expect(modules.isOpen("a/x.py")).toBe(false);
    expect(state.selection()).toBeNull();
  });

  it("takes a folder off with everything open under it", () => {
    const { modules, state } = setup();

    state.takeOff({ kind: "folder", id: "a" });

    expect(modules.opened()).toEqual(["c/w.py"]);
  });

  it("does nothing when an edge is taken off", () => {
    const { modules, state } = setup();

    state.takeOff({ kind: "edge", id: "e" });

    expect(modules.count()).toBe(4);
  });

  it("drops a selection whose target left the canvas", () => {
    const { state } = setup();
    const present = {
      module: (id: string) => id === "c/w.py",
      folder: () => false,
      edge: () => false,
    };

    state.select({ kind: "module", id: "a/x.py" });
    state.reconcile(present);

    expect(state.selection()).toBeNull();

    state.select({ kind: "module", id: "c/w.py" });
    state.reconcile(present);

    expect(state.selection()).toEqual({ kind: "module", id: "c/w.py" });

    state.select({ kind: "folder", id: "a" });
    state.reconcile(present);

    expect(state.selection()).toBeNull();

    state.select({ kind: "edge", id: "gone" });
    state.reconcile(present);

    expect(state.selection()).toBeNull();
  });

  it("clears everything but keeps the inferred switch", () => {
    const { modules, state } = setup();

    state.toggleFold("a");
    state.toggleFocus("a");
    state.setShowInferred(false);
    state.select({ kind: "folder", id: "a" });
    state.clear();

    expect(modules.count()).toBe(0);
    expect(state.folded().size).toBe(0);
    expect(state.focus()).toBeNull();
    expect(state.selection()).toBeNull();
    expect(state.showInferred()).toBe(false);
  });

  it("toggles fold and focus", () => {
    const { state } = setup();

    state.toggleFold("a");
    expect(state.folded().has("a")).toBe(true);
    state.toggleFold("a");
    expect(state.folded().has("a")).toBe(false);

    state.toggleFocus("a");
    expect(state.focus()).toBe("a");
    state.toggleFocus("a");
    expect(state.focus()).toBeNull();
  });
});
