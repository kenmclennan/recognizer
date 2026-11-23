import { describe, expect, it } from "vitest";
import { View } from "../../src/index.js";
import { repositoryWith, viewOf } from "./world.js";

describe("View", () => {
  it("sameContent ignores the key order of steps and notes", () => {
    const a = View.of({
      schema_version: 4,
      description: "d",
      commit: null,
      notes: [{ module: "a.py", text: "t", by: "x" }],
      steps: [{ kind: "pick", module: "a.py" }],
    });
    const b = View.of({
      schema_version: 4,
      commit: null,
      description: "d",
      steps: [{ module: "a.py", kind: "pick" }],
      notes: [{ by: "x", text: "t", module: "a.py" }],
    });

    expect(a.sameContent(b)).toBe(true);
  });

  it("sameContent tells one changed note text from a reorder", () => {
    const notes = (text: string) => [
      { module: "a.py", text, by: "x" },
      { module: "b.py", text: "u", by: "x" },
    ];

    expect(
      viewOf([], { notes: notes("t") }).sameContent(
        viewOf([], { notes: notes("t") }),
      ),
    ).toBe(true);
    expect(
      viewOf([], { notes: notes("t") }).sameContent(
        viewOf([], { notes: notes("changed") }),
      ),
    ).toBe(false);
    expect(
      viewOf([], { notes: notes("t") }).sameContent(
        viewOf([], { notes: [...notes("t")].reverse() }),
      ),
    ).toBe(false);
  });

  it("resolve reports exactly the missing pick among a resolved pick and an empty fold", () => {
    const view = viewOf([
      { kind: "pick", module: "a.py" },
      { kind: "pick", module: "gone.py" },
      { kind: "fold", folder: "empty" },
    ]);
    const resolved = view.resolve(repositoryWith(["a.py"]));

    expect(resolved.modules).toEqual(["a.py"]);
    expect(resolved.unresolved).toEqual([
      { step: 2, kind: "pick", path: "gone.py", what: "module" },
      { step: 3, kind: "fold", path: "empty", what: "folder" },
    ]);
  });

  it("with returns a new view and leaves the original unchanged", () => {
    const original = viewOf([{ kind: "pick", module: "a.py" }]);
    const changed = original.with({ description: "other" });

    expect(changed).not.toBe(original);
    expect(changed.description).toBe("other");
    expect(original.description).toBe("d");
  });

  it("with drops a field set to undefined", () => {
    const original = viewOf([], { title: "t" });

    expect("title" in original.with({ title: undefined })).toBe(false);
  });
});
