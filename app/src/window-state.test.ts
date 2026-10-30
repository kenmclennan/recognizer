import { describe, expect, it } from "vitest";
import { latestWins, windowStateOf } from "./window-state";

const panel = (
  selection: { kind: "module" | "folder" | "edge"; id: string } | null,
  relation: "uses" | "usedBy" | null,
  tab: "contents" | "findings" | "dependencies",
) => ({
  selection,
  relation,
  followed: null,
  tab,
  filter: "",
  folds: new Set<string>(),
  groupFlips: new Set<string>(),
  focusedRow: null,
});

describe("windowStateOf", () => {
  it("sorts the modules and carries the rest, the trail and the inspector tab", () => {
    const trail = {
      panels: [
        panel({ kind: "module", id: "a.py" }, null, "dependencies"),
        panel({ kind: "module", id: "b.py" }, "usedBy", "dependencies"),
        panel({ kind: "module", id: "c.py" }, "uses", "contents"),
      ],
      start: 0,
      active: 1,
      cap: 3,
    };

    expect(
      windowStateOf(
        {
          view: "overview",
          modules: ["b.py", "a.py"],
          folded: ["z", "y"],
          focus: null,
          selection: { kind: "module", id: "a.py" },
        },
        trail,
        { open: true, tab: "dependencies" },
      ),
    ).toEqual({
      view: "overview",
      modules: ["a.py", "b.py"],
      folded: ["y", "z"],
      focus: null,
      selection: { kind: "module", id: "a.py" },
      trail: [
        {
          selection: { kind: "module", id: "a.py" },
          relation: null,
          tab: "dependencies",
          active: false,
        },
        {
          selection: { kind: "module", id: "b.py" },
          relation: "used-by",
          tab: "dependencies",
          active: true,
        },
        {
          selection: { kind: "module", id: "c.py" },
          relation: "uses",
          tab: "contents",
          active: false,
        },
      ],
      inspector: { open: true, tab: "dependencies" },
    });
  });

  it("holds no schema_version and no id or folder", () => {
    const state = windowStateOf(
      { view: null, modules: [], folded: [], focus: null, selection: null },
      { panels: [panel(null, null, "contents")], start: 0, active: 0, cap: 3 },
      { open: false, tab: "contents" },
    );

    expect(Object.keys(state).sort()).toEqual([
      "focus",
      "folded",
      "inspector",
      "modules",
      "selection",
      "trail",
      "view",
    ]);
  });
});

describe("latestWins", () => {
  it("keeps one write in flight and only the newest pending text", async () => {
    const written: string[] = [];
    const release: (() => void)[] = [];
    const enqueue = latestWins(
      (text) =>
        new Promise<void>((resolve) => {
          written.push(text);
          release.push(resolve);
        }),
    );

    enqueue("one");
    enqueue("two");
    enqueue("three");

    expect(written).toEqual(["one"]);

    release[0]();
    await Promise.resolve();
    await Promise.resolve();

    expect(written).toEqual(["one", "three"]);

    release[1]();
    await Promise.resolve();
    await Promise.resolve();

    expect(written).toHaveLength(2);
  });

  it("goes on writing after a failed write", async () => {
    const written: string[] = [];
    const enqueue = latestWins(async (text) => {
      written.push(text);

      if (text === "bad") {
        throw new Error("no");
      }
    });

    enqueue("bad");
    await new Promise((resolve) => setTimeout(resolve, 0));
    enqueue("good");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(written).toEqual(["bad", "good"]);
  });
});
