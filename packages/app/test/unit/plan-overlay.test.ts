import { resolveView, type View } from "recognizer";
import { describe, expect, it } from "vitest";
import { PROPOSED_WORDS, planOverlay } from "../../src/plan-overlay";
import { type DocScan, repositoryFrom } from "./repository-from";

const scan = {
  schema_version: 1,
  commit: "cur",
  modules: ["app/a.py", "app/b.py"].map((id) => ({ id, kind: "module" })),
  edges: [],
  foreign: [],
} as unknown as DocScan;

const plan = (proposed: View["proposed"]): View => ({
  schema_version: 4,
  description: "d",
  commit: "cur",
  plan: true,
  proposed,
  steps: [{ kind: "pick", module: "app/a.py" }],
});

describe("planOverlay", () => {
  it("is null for a view that is not a plan and for no view", () => {
    const plain: View = {
      schema_version: 4,
      description: "d",
      commit: "cur",
      steps: [],
    };

    expect(
      planOverlay(plain, resolveView(plain, repositoryFrom([scan]))),
    ).toBeNull();
    expect(
      planOverlay(null, resolveView(plain, repositoryFrom([scan]))),
    ).toBeNull();
  });

  it("maps proposed changes, planned ids and ghosts", () => {
    const view = plan([
      { module: "app/a.py", kind: "changes" },
      { module: "app/new.py", kind: "new" },
      { module: "lib/m.py", kind: "moves", from: "app/b.py" },
    ]);
    const overlay = planOverlay(
      view,
      resolveView(view, repositoryFrom([scan])),
    );

    expect([...(overlay?.proposed.keys() ?? [])]).toEqual([
      "app/a.py",
      "app/new.py",
      "lib/m.py",
    ]);
    expect(overlay?.proposed.get("lib/m.py")).toEqual({
      module: "lib/m.py",
      kind: "moves",
      from: "app/b.py",
    });
    expect(overlay?.planned).toEqual(["app/new.py", "lib/m.py"]);
    expect(overlay?.ghosts).toEqual([{ from: "app/b.py", to: "lib/m.py" }]);
  });

  it("leaves out a proposed change on a module that is not drawn", () => {
    const view = plan([{ module: "app/b.py", kind: "changes" }]);

    expect(
      planOverlay(view, resolveView(view, repositoryFrom([scan])))?.proposed
        .size,
    ).toBe(0);
  });

  it("words every kind", () => {
    expect(Object.keys(PROPOSED_WORDS).sort()).toEqual([
      "changes",
      "moves",
      "moves-and-changes",
      "new",
      "removed",
    ]);
  });
});
