import { describe, expect, it } from "vitest";
import { follow, startTrail, trailModules } from "../../src/trail-model";
import {
  type MemoryFacts,
  pruneMemory,
  type ViewMemory,
} from "../../src/view-memory";

const hub = { kind: "module", id: "app/hub.py" } as const;

function memoryOf(over: Partial<ViewMemory> = {}): ViewMemory {
  return {
    expanded: [],
    filter: { text: "", onCanvas: false, needsAttention: false },
    inspector: {
      open: true,
      tab: "contents",
      trail: startTrail(hub, "contents"),
      folds: [],
      pickerFilter: "",
    },
    note: { focus: null, draft: "" },
    findings: { openGroups: [], onlyThisView: false, oriented: null },
    resultsMode: "bring",
    commits: { tab: "history", hide: true },
    ...over,
  };
}

function factsOf(over: Partial<MemoryFacts> = {}): MemoryFacts {
  return {
    modules: ["app/hub.py", "lib/a.py", "lib/b.py"],
    selection: hub,
    dependenciesShown: true,
    findingIds: new Set(["f1"]),
    findingKept: () => true,
    noteKept: () => true,
    groupKeys: new Set(["g1"]),
    capacity: 3,
    ...over,
  };
}

describe("pruneMemory", () => {
  it("keeps only the expanded folders a loaded module still sits under", () => {
    const pruned = pruneMemory(
      memoryOf({ expanded: ["lib", "gone", "app"] }),
      factsOf(),
    );

    expect(pruned.expanded).toEqual(["lib", "app"]);
    expect(pruned.expanded).not.toContain("gone");
  });

  it("keeps an empty expanded list empty", () => {
    expect(pruneMemory(memoryOf(), factsOf()).expanded).toEqual([]);
  });

  it("keeps an oriented finding the scan still has and drops one it lacks", () => {
    const present = pruneMemory(
      memoryOf({
        findings: { openGroups: [], onlyThisView: false, oriented: "f1" },
      }),
      factsOf(),
    );
    const absent = pruneMemory(
      memoryOf({
        findings: { openGroups: [], onlyThisView: false, oriented: "f2" },
      }),
      factsOf(),
    );

    expect(present.findings.oriented).toBe("f1");
    expect(absent.findings.oriented).toBeNull();
  });

  it("drops an oriented finding the restored selection no longer keeps", () => {
    const pruned = pruneMemory(
      memoryOf({
        findings: { openGroups: [], onlyThisView: false, oriented: "f1" },
      }),
      factsOf({ findingKept: () => false }),
    );

    expect(pruned.findings.oriented).toBeNull();
  });

  it("reconciles a trail naming a removed file", () => {
    const trail = follow(startTrail(hub, "contents"), 0, "uses", "lib/a.py");
    const pruned = pruneMemory(
      memoryOf({
        inspector: {
          open: true,
          tab: "contents",
          trail,
          folds: [],
          pickerFilter: "",
        },
      }),
      factsOf({ modules: ["app/hub.py", "lib/b.py"] }),
    );

    expect(trailModules(trail)).toContain("lib/a.py");
    expect(trailModules(pruned.inspector.trail)).toEqual(["app/hub.py"]);
  });

  it("keeps a note draft only while the focus is kept and editing", () => {
    const focus = { path: "app/hub.py", editing: true };
    const kept = pruneMemory(
      memoryOf({ note: { focus, draft: "half a thought" } }),
      factsOf(),
    );
    const dropped = pruneMemory(
      memoryOf({ note: { focus, draft: "half a thought" } }),
      factsOf({ noteKept: () => false }),
    );
    const reading = pruneMemory(
      memoryOf({
        note: { focus: { path: "app/hub.py", editing: false }, draft: "x" },
      }),
      factsOf(),
    );

    expect(kept.note).toEqual({ focus, draft: "half a thought" });
    expect(dropped.note).toEqual({ focus: null, draft: "" });
    expect(reading.note.draft).toBe("");
  });

  it("falls back from Dependencies to Contents when nothing is used", () => {
    const memory = memoryOf({
      inspector: {
        open: true,
        tab: "dependencies",
        trail: startTrail(hub, "dependencies"),
        folds: [],
        pickerFilter: "",
      },
    });

    expect(pruneMemory(memory, factsOf()).inspector.tab).toBe("dependencies");
    expect(
      pruneMemory(memory, factsOf({ dependenciesShown: false })).inspector.tab,
    ).toBe("contents");
  });

  it("keeps only the open groups the panel still lists", () => {
    const pruned = pruneMemory(
      memoryOf({
        findings: {
          openGroups: ["g1", "g2"],
          onlyThisView: true,
          oriented: null,
        },
      }),
      factsOf(),
    );

    expect(pruned.findings.openGroups).toEqual(["g1"]);
    expect(pruned.findings.onlyThisView).toBe(true);
  });

  it("returns exactly the survivors of a mixed memory", () => {
    const pruned = pruneMemory(
      memoryOf({
        expanded: ["lib", "gone"],
        findings: {
          openGroups: ["g1", "g2"],
          onlyThisView: false,
          oriented: "f2",
        },
        filter: { text: "hub", onCanvas: true, needsAttention: false },
        resultsMode: "rescan",
        commits: { tab: "prs", hide: false },
      }),
      factsOf(),
    );

    expect(pruned.expanded).toEqual(["lib"]);
    expect(pruned.findings.openGroups).toEqual(["g1"]);
    expect(pruned.findings.oriented).toBeNull();
    expect(pruned.filter).toEqual({
      text: "hub",
      onCanvas: true,
      needsAttention: false,
    });
    expect(pruned.resultsMode).toBe("rescan");
    expect(pruned.commits).toEqual({ tab: "prs", hide: false });
  });
});
