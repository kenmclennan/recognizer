import type { Scan, View } from "recognizer";
import { describe, expect, it } from "vitest";
import { viewModified } from "./view-modified";

const scan: Scan = {
  schema_version: 1,
  commit: "cur",
  modules: ["app/a.py", "app/b.py", "lib/c.py"].map((id) => ({
    id,
    kind: "module",
  })),
  edges: [],
  foreign: [],
} as unknown as Scan;

const view = (steps: View["steps"]): View =>
  ({ schema_version: 1, description: "d", commit: "cur", steps }) as View;

const content = (
  modules: string[],
  folded: string[] = [],
  focus: string | null = null,
) => ({ modules, folded, focus });

describe("viewModified", () => {
  it("is false for a canvas equal to the saved resolution", () => {
    const saved = view([
      { kind: "pick", module: "app/a.py" },
      { kind: "pick", module: "app/b.py" },
    ]);

    expect(viewModified(saved, content(["app/a.py", "app/b.py"]), [scan])).toBe(
      false,
    );
  });

  it("is false when the steps list a fold before the picks", () => {
    const saved = view([
      { kind: "fold", folder: "app" },
      { kind: "pick", module: "app/a.py" },
    ]);

    expect(viewModified(saved, content(["app/a.py"], ["app"]), [scan])).toBe(
      false,
    );
  });

  it("is true after adding or removing a module", () => {
    const saved = view([{ kind: "pick", module: "app/a.py" }]);

    expect(viewModified(saved, content(["app/a.py", "lib/c.py"]), [scan])).toBe(
      true,
    );
    expect(viewModified(saved, content([]), [scan])).toBe(true);
  });

  it("is true after folding or changing focus, and false again when undone", () => {
    const saved = view([{ kind: "pick", module: "app/a.py" }]);

    expect(viewModified(saved, content(["app/a.py"], ["app"]), [scan])).toBe(
      true,
    );
    expect(viewModified(saved, content(["app/a.py"], [], "app"), [scan])).toBe(
      true,
    );
    expect(viewModified(saved, content(["app/a.py"]), [scan])).toBe(false);
  });

  it("is true for a pick the scan does not know", () => {
    const saved = view([{ kind: "pick", module: "app/a.py" }]);

    expect(
      viewModified(saved, content(["app/a.py", "lib/gone.py"]), [scan]),
    ).toBe(true);
  });

  it("is false for a canvas equal to the resolution of a view with one unresolved pick", () => {
    const saved = view([
      { kind: "pick", module: "app/a.py" },
      { kind: "pick", module: "lib/gone.py" },
    ]);

    expect(viewModified(saved, content(["app/a.py"]), [scan])).toBe(false);
  });

  it("takes no camera input, so a camera-only change cannot count", () => {
    const saved = view([{ kind: "pick", module: "app/a.py" }]);
    const same = { ...content(["app/a.py"]) };

    expect(viewModified.length).toBe(3);
    expect(viewModified(saved, same, [scan])).toBe(
      viewModified(saved, content(["app/a.py"]), [scan]),
    );
  });

  it("is false for a freshly opened plan holding a planned module and a ghost", () => {
    const saved = {
      ...view([{ kind: "pick", module: "app/a.py" }]),
      schema_version: 4,
      plan: true,
      proposed: [
        { module: "app/new.py", kind: "new" },
        { module: "lib/m.py", kind: "moves", from: "app/b.py" },
      ],
    } as View;

    expect(viewModified(saved, content(["app/a.py"]), [scan])).toBe(false);
  });
});
