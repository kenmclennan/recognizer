import { describe, expect, it } from "vitest";
import { type DriveFacts, type DriveRequest, planDrive } from "./window-drive";

const MODULES = [
  "app/a.py",
  "app/b.py",
  "app/c.py",
  "app/util/x.py",
  "lib/only/deep/y.py",
];

function facts(over: Partial<DriveFacts> = {}): DriveFacts {
  return {
    modules: new Set(MODULES),
    onCanvas: new Set(["app/a.py"]),
    folded: new Set(["app/util"]),
    focus: null,
    selection: null,
    canonical: (folder) => (folder === "lib" ? "lib/only/deep" : folder),
    views: ["overview"],
    trail: {
      selection: { kind: "module", id: "app/a.py" },
      uses: ["app/b.py"],
      usedBy: ["app/c.py"],
    },
    ...over,
  };
}

function ask(
  action: string,
  args: string[],
  over: Partial<DriveFacts> = {},
  options: DriveRequest["options"] = {},
) {
  return planDrive({ action, args, options, by: "Claude" }, facts(over));
}

describe("planDrive applies", () => {
  it("add opens only the modules not yet on the canvas", () => {
    expect(ask("add", ["app/a.py", "app/b.py", "app/c.py"])).toEqual({
      apply: [{ kind: "open", ids: ["app/b.py", "app/c.py"] }],
      summary: "added 2 modules",
    });
    expect(ask("add", ["app/b.py"])).toMatchObject({
      summary: "added 1 module",
    });
  });

  it("add of modules already on the canvas changes nothing", () => {
    expect(ask("add", ["app/a.py"])).toEqual({
      apply: [],
      summary: "nothing changed",
    });
  });

  it("remove closes the modules that are on the canvas", () => {
    expect(ask("remove", ["app/a.py", "app/b.py"])).toEqual({
      apply: [{ kind: "close", ids: ["app/a.py"] }],
      summary: "removed 1 module",
    });
  });

  it("fold folds and fold --off unfolds, counting the folders that change", () => {
    expect(ask("fold", ["app", "app/util"])).toEqual({
      apply: [{ kind: "fold", folders: ["app"], off: false }],
      summary: "folded 1 folder",
    });
    expect(ask("fold", ["app/util"], {}, { off: true })).toEqual({
      apply: [{ kind: "fold", folders: ["app/util"], off: true }],
      summary: "unfolded 1 folder",
    });
  });

  it("a compacted folder id is addressed by its joined path", () => {
    expect(ask("fold", ["lib"])).toEqual({
      apply: [{ kind: "fold", folders: ["lib/only/deep"], off: false }],
      summary: "folded 1 folder",
    });
  });

  it("focus names the canonical folder", () => {
    expect(ask("focus", ["app"])).toEqual({
      apply: [{ kind: "focus", folder: "app" }],
      summary: "focused app",
    });
    expect(ask("focus", ["app"], { focus: "app" })).toMatchObject({
      apply: [],
    });
  });

  it("select prefers a module over a folder", () => {
    expect(ask("select", ["app/a.py"])).toEqual({
      apply: [
        { kind: "select", selection: { kind: "module", id: "app/a.py" } },
      ],
      summary: "selected app/a.py",
    });
    expect(ask("select", ["app/util"])).toMatchObject({
      apply: [{ selection: { kind: "folder", id: "app/util" } }],
    });
  });

  it("trail follows a direct dependency or dependent", () => {
    expect(ask("trail", ["uses", "app/b.py"])).toEqual({
      apply: [{ kind: "follow", relation: "uses", id: "app/b.py" }],
      summary: "followed uses app/b.py",
    });
    expect(ask("trail", ["used-by", "app/c.py"])).toEqual({
      apply: [{ kind: "follow", relation: "usedBy", id: "app/c.py" }],
      summary: "followed used-by app/c.py",
    });
  });

  it("open-view opens a saved view", () => {
    expect(ask("open-view", ["overview"])).toEqual({
      apply: [{ kind: "open-view", name: "overview" }],
      summary: "opened view overview",
    });
  });

  it.each([
    ["all", "cleared the canvas"],
    ["modules", "cleared modules"],
    ["folds", "cleared folds"],
    ["focus", "cleared focus"],
    ["selection", "cleared selection"],
  ])("clear %s", (word, summary) => {
    expect(ask("clear", [word])).toEqual({
      apply: [{ kind: "clear", target: word }],
      summary,
    });
  });
});

describe("planDrive refuses", () => {
  it.each([
    ["add", ["app/zzz.py"], "no module app/zzz.py in the scan"],
    ["remove", ["app/zzz.py"], "no module app/zzz.py in the scan"],
    ["fold", ["nowhere"], "no folder nowhere holds a module in the scan"],
    ["focus", ["nowhere"], "no folder nowhere holds a module in the scan"],
    ["select", ["zzz"], "no module or folder zzz in the scan"],
    ["open-view", ["nope"], "no saved view named nope"],
    [
      "clear",
      ["everything"],
      "cannot clear everything: use modules, folds, focus, selection, all",
    ],
    ["dance", [], "unknown action dance"],
  ])("%s %j", (action, args, reason) => {
    expect(ask(action, args)).toEqual({ refuse: reason });
  });

  it("trail refuses when the trail is empty", () => {
    expect(ask("trail", ["uses", "app/b.py"], { trail: null })).toEqual({
      refuse: "the trail is empty",
    });
    expect(
      ask("trail", ["uses", "app/b.py"], {
        trail: { selection: null, uses: [], usedBy: [] },
      }),
    ).toEqual({ refuse: "the trail is empty" });
  });

  it("trail refuses a module that is not a direct neighbour", () => {
    expect(ask("trail", ["uses", "app/c.py"])).toEqual({
      refuse: "app/c.py is not a direct dependency of app/a.py",
    });
    expect(ask("trail", ["used-by", "app/b.py"])).toEqual({
      refuse: "app/b.py is not a direct dependent of app/a.py",
    });
  });

  it("a mixed request refuses as a whole, naming the bad argument", () => {
    const plan = ask("add", ["app/b.py", "app/zzz.py", "app/c.py"]);

    expect(plan).toEqual({ refuse: "no module app/zzz.py in the scan" });
    expect("apply" in plan).toBe(false);
  });

  it("names the missing argument", () => {
    expect(ask("add", [])).toEqual({
      refuse: "add needs at least one module path",
    });
  });
});
