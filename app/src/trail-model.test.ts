import { describe, expect, it } from "vitest";
import { compactFolders } from "./folder-compaction";
import {
  bringBack,
  close,
  crumbs,
  follow,
  layout,
  missingFromCanvas,
  moveFocus,
  panelCapacity,
  reconcile,
  startTrail,
  type Trail,
  trailKeyAction,
  trailModules,
  updatePanel,
  withCapacity,
} from "./trail-model";

const root = { kind: "module", id: "app/root.py" } as const;

function chain(ids: string[], cap = 3): Trail {
  let trail = { ...startTrail(root, "contents"), cap };

  ids.forEach((id, i) => {
    trail = follow(trail, i, i % 2 === 0 ? "uses" : "usedBy", id);
  });

  return trail;
}

const idsOf = (trail: Trail) =>
  trail.panels.map((panel) => (panel.selection as { id: string }).id);

describe("follow", () => {
  it("appends a panel for the followed module, active, on the dependencies tab", () => {
    const trail = follow(startTrail(root, "contents"), 0, "uses", "lib/a.py");

    expect(idsOf(trail)).toEqual(["app/root.py", "lib/a.py"]);
    expect(trail.active).toBe(1);
    expect(trail.panels[0].followed).toEqual({
      id: "lib/a.py",
      relation: "uses",
    });
    expect(trail.panels[1].followed).toBeNull();
    expect(trail.panels[1].tab).toBe("dependencies");
    expect(trail.panels[1].relation).toBe("uses");
  });

  it("replaces everything to the right when an earlier panel follows a different row", () => {
    const trail = chain(["lib/a.py", "lib/b.py", "lib/c.py"]);
    const replaced = follow(trail, 1, "usedBy", "lib/z.py");

    expect(idsOf(replaced)).toEqual(["app/root.py", "lib/a.py", "lib/z.py"]);
    expect(replaced.active).toBe(2);
  });

  it("treats the same module in the other section as a different row", () => {
    const trail = chain(["lib/a.py", "lib/b.py"]);
    const replaced = follow(trail, 0, "usedBy", "lib/a.py");

    expect(idsOf(replaced)).toEqual(["app/root.py", "lib/a.py"]);
    expect(replaced.panels[0].followed?.relation).toBe("usedBy");
  });

  it("changes nothing when the already-followed row is followed again", () => {
    const trail = chain(["lib/a.py", "lib/b.py", "lib/c.py"]);

    expect(follow(trail, 0, "uses", "lib/a.py")).toBe(trail);
  });

  it("slides the window to end at the new panel", () => {
    const trail = chain(["lib/a.py", "lib/b.py", "lib/c.py", "lib/d.py"]);

    expect(trail.start).toBe(2);
    expect(trail.active).toBe(4);
  });
});

describe("close", () => {
  it("drops the panel and everything to its right and clears the new last followed", () => {
    const trail = chain(["lib/a.py", "lib/b.py", "lib/c.py"]);
    const closed = close(trail, 2);

    expect(idsOf(closed)).toEqual(["app/root.py", "lib/a.py"]);
    expect(closed.panels[1].followed).toBeNull();
    expect(closed.active).toBe(1);
  });

  it("re-slides the window", () => {
    const trail = chain(["lib/a.py", "lib/b.py", "lib/c.py", "lib/d.py"]);

    expect(close(trail, 3).start).toBe(0);
  });

  it("never closes the first panel", () => {
    const trail = chain(["lib/a.py"]);

    expect(close(trail, 0)).toBe(trail);
  });
});

describe("layout", () => {
  it.each([
    [1, [], [0], []],
    [2, [], [0, 1], []],
    [3, [], [0, 1, 2], []],
    [4, [0], [1, 2, 3], []],
    [5, [0, 1], [2, 3, 4], []],
  ])("for %i panels shows at most three", (count, strips, shown, later) => {
    const ids = Array.from({ length: count - 1 }, (_, i) => `lib/${i}.py`);

    expect(layout(chain(ids))).toEqual({ strips, shown, later });
  });

  it("puts panels beyond the window in later after bringing back a left strip", () => {
    const trail = bringBack(
      chain(["a", "b", "c", "d"].map((x) => `lib/${x}.py`)),
      0,
    );

    expect(trail.active).toBe(0);
    expect(layout(trail)).toEqual({
      strips: [],
      shown: [0, 1, 2],
      later: [3, 4],
    });
  });

  it("lands exactly on three panels with no strip", () => {
    const trail = chain(["lib/a.py", "lib/b.py"]);

    expect(layout(trail).strips).toEqual([]);
    expect(layout(trail).shown).toHaveLength(3);
  });
});

describe("bringBack", () => {
  const long = () => chain(["a", "b", "c", "d", "e"].map((x) => `lib/${x}.py`));

  it("only activates a panel that is already shown", () => {
    const trail = long();
    const back = bringBack(trail, 4);

    expect(back.start).toBe(trail.start);
    expect(back.active).toBe(4);
  });

  it("starts the window at a left strip", () => {
    const back = bringBack(long(), 1);

    expect(back.start).toBe(1);
    expect(layout(back).later).toEqual([4, 5]);
  });

  it("ends the window at a later strip", () => {
    const back = bringBack(bringBack(long(), 0), 5);

    expect(back.start).toBe(3);
    expect(back.active).toBe(5);
    expect(layout(back).later).toEqual([]);
  });
});

describe("panelCapacity", () => {
  it("is three when everything fits", () => {
    expect(panelCapacity(2000, 340, 3)).toBe(3);
  });

  it("is two when two panels and one strip fit", () => {
    expect(panelCapacity(340 * 2 + 28, 340, 3)).toBe(2);
  });

  it("is one when only one fits", () => {
    expect(panelCapacity(340 + 28 * 3, 340, 4)).toBe(1);
  });

  it("is one when nothing fits", () => {
    expect(panelCapacity(10, 340, 4)).toBe(1);
  });

  it("gives the larger count exactly on the bound", () => {
    expect(panelCapacity(3 * 340 + 28, 340, 4)).toBe(3);
    expect(panelCapacity(3 * 340 + 27, 340, 4)).toBe(2);
  });
});

describe("withCapacity", () => {
  it("keeps the active panel shown and folds the rest left when narrowing", () => {
    const narrowed = withCapacity(chain(["lib/a.py", "lib/b.py"]), 1);

    expect(narrowed.cap).toBe(1);
    expect(layout(narrowed)).toEqual({ strips: [0, 1], shown: [2], later: [] });
  });

  it("restores up to three panels, earlier strips returning, when widening", () => {
    const narrow = withCapacity(
      chain(["lib/a.py", "lib/b.py", "lib/c.py", "lib/d.py"]),
      1,
    );
    const wide = withCapacity(narrow, 3);

    expect(layout(wide)).toEqual({
      strips: [0, 1],
      shown: [2, 3, 4],
      later: [],
    });
  });

  it("shows only the panels there are when widening past the trail", () => {
    const wide = withCapacity(withCapacity(chain(["lib/a.py"]), 1), 3);

    expect(layout(wide)).toEqual({ strips: [], shown: [0, 1], later: [] });
  });

  it("returns the same trail when nothing changes", () => {
    const trail = chain(["lib/a.py"]);

    expect(withCapacity(trail, 3)).toBe(trail);
  });
});

describe("crumbs", () => {
  const none = compactFolders([]);

  it("names each module and the relationship of each step", () => {
    const trail = chain(["lib/a.py", "lib/b.py"]);

    expect(crumbs(trail, none)).toEqual([
      { index: 0, label: "root.py", relation: null },
      { index: 1, label: "a.py", relation: "uses" },
      { index: 2, label: "b.py", relation: "used by" },
    ]);
  });

  it("labels a folder with a trailing slash", () => {
    const trail = startTrail({ kind: "folder", id: "app/core" }, "contents");

    expect(
      crumbs(trail, compactFolders(["app/core/x.py", "app/other/y.py"]))[0]
        .label,
    ).toBe("core/");
  });
});

describe("trailModules and missingFromCanvas", () => {
  it("lists modules in order without duplicates", () => {
    const trail = chain(["lib/a.py", "app/root.py", "lib/a.py"]);

    expect(trailModules(trail)).toEqual(["app/root.py", "lib/a.py"]);
  });

  it("contributes nothing for a folder or edge first panel", () => {
    expect(
      trailModules(startTrail({ kind: "folder", id: "app" }, "contents")),
    ).toEqual([]);
    expect(
      trailModules(startTrail({ kind: "edge", id: "a>b" }, "contents")),
    ).toEqual([]);
  });

  it("returns only the modules not on the canvas", () => {
    const trail = chain(["lib/a.py", "lib/b.py"]);
    const open = new Set(["lib/a.py"]);

    expect(missingFromCanvas(trail, (id) => open.has(id))).toEqual([
      "app/root.py",
      "lib/b.py",
    ]);
  });

  it("is empty when every module is on the canvas", () => {
    const trail = chain(["lib/a.py"]);

    expect(missingFromCanvas(trail, () => true)).toEqual([]);
  });
});

describe("reconcile", () => {
  it("cuts the trail at the first module no longer in the scan", () => {
    const trail = chain(["lib/a.py", "lib/b.py", "lib/c.py"]);
    const known = new Set(["app/root.py", "lib/a.py", "lib/c.py"]);
    const cut = reconcile(trail, known);

    expect(idsOf(cut)).toEqual(["app/root.py", "lib/a.py"]);
    expect(cut.panels[1].followed).toBeNull();
  });

  it("returns the same trail when every module is known", () => {
    const trail = chain(["lib/a.py"]);

    expect(reconcile(trail, new Set(["app/root.py", "lib/a.py"]))).toBe(trail);
  });
});

describe("updatePanel", () => {
  it("replaces fields of one panel and leaves the others", () => {
    const trail = chain(["lib/a.py"]);
    const next = updatePanel(trail, 1, { tab: "findings", filter: "x" });

    expect(next.panels[1].tab).toBe("findings");
    expect(next.panels[1].filter).toBe("x");
    expect(next.panels[0]).toBe(trail.panels[0]);
  });
});

describe("trailKeyAction", () => {
  const key = (name: string, extra = {}) => ({
    key: name,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...extra,
  });

  it.each([
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["ArrowRight", "follow"],
    ["ArrowLeft", "back"],
    [" ", "tick"],
    ["Escape", "close-last"],
    ["p", "put-on-canvas"],
    ["P", "put-on-canvas"],
  ])("maps %s", (name, action) => {
    expect(trailKeyAction(key(name), false)).toBe(action);
  });

  it("ignores other keys, modifiers and editable targets", () => {
    expect(trailKeyAction(key("x"), false)).toBeNull();
    expect(trailKeyAction(key("p", { metaKey: true }), false)).toBeNull();
    expect(trailKeyAction(key("p", { ctrlKey: true }), false)).toBeNull();
    expect(trailKeyAction(key("p", { altKey: true }), false)).toBeNull();
    expect(trailKeyAction(key("ArrowDown"), true)).toBeNull();
  });
});

describe("moveFocus", () => {
  const rows = ["a", "b", "c"];

  it("picks the first row going down and the last going up from nothing", () => {
    expect(moveFocus(rows, null, "down")).toBe("a");
    expect(moveFocus(rows, null, "up")).toBe("c");
  });

  it("moves one row and stops at both ends", () => {
    expect(moveFocus(rows, "a", "down")).toBe("b");
    expect(moveFocus(rows, "c", "down")).toBe("c");
    expect(moveFocus(rows, "a", "up")).toBe("a");
    expect(moveFocus(rows, "c", "up")).toBe("b");
  });

  it("starts over when the focused row is no longer listed", () => {
    expect(moveFocus(rows, "gone", "down")).toBe("a");
  });

  it("gives nothing for no rows", () => {
    expect(moveFocus([], null, "down")).toBeNull();
  });
});
