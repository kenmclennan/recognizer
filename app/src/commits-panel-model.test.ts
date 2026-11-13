import { describe, expect, it } from "vitest";
import {
  ageOf,
  branchRow,
  classify,
  commitRow,
  createCommitsModel,
  impactText,
  impactTip,
  openLabel,
  orderBranches,
  type PickRow,
  pullRequestRow,
  titleTip,
  visibleRows,
} from "./commits-panel-model";
import type { RefFacts } from "./commits-port";

const row = (
  kind: PickRow["kind"],
  ref: string,
  defaultFrom: string | null = null,
): PickRow => ({ kind, ref, label: ref, sub: "", defaultFrom });

const a = row("commit", "a".repeat(40), "p".repeat(40));
const b = row("commit", "b".repeat(40), "q".repeat(40));
const c = row("commit", "c".repeat(40), "r".repeat(40));

describe("slots", () => {
  it("starts with To highlighted and both slots empty", () => {
    const model = createCommitsModel();

    expect(model.active()).toBe("to");
    expect(model.slot("to")).toBeNull();
    expect(model.slot("from")).toBeNull();
  });

  it("fills To on the first pick and moves the highlight to From", () => {
    const model = createCommitsModel();

    expect(model.pick(a)).toBe(true);
    expect(model.slot("to")).toBe(a);
    expect(model.slot("from")).toBeNull();
    expect(model.active()).toBe("from");
  });

  it("fills From on the second pick and leaves the highlight on From", () => {
    const model = createCommitsModel();

    model.pick(a);
    model.pick(b);

    expect(model.slot("to")).toBe(a);
    expect(model.slot("from")).toBe(b);
    expect(model.active()).toBe("from");
  });

  it("refuses a row already held in the other slot and changes nothing", () => {
    const model = createCommitsModel();

    model.pick(a);

    expect(model.pick(a)).toBe(false);
    expect(model.slot("to")).toBe(a);
    expect(model.slot("from")).toBeNull();
    expect(model.active()).toBe("from");
  });

  it("highlights a slot on click and replaces its row on the next pick", () => {
    const model = createCommitsModel();

    model.pick(a);
    model.pick(b);
    model.select("to");

    expect(model.active()).toBe("to");

    model.pick(c);

    expect(model.slot("to")).toBe(c);
    expect(model.slot("from")).toBe(b);
    expect(model.active()).toBe("to");
  });

  it("clears a slot, empties it and highlights it", () => {
    const model = createCommitsModel();

    model.pick(a);
    model.pick(b);
    model.clear("to");

    expect(model.slot("to")).toBeNull();
    expect(model.slot("from")).toBe(b);
    expect(model.active()).toBe("to");
  });

  it("refuses swap with an empty slot and reverses the slots otherwise", () => {
    const model = createCommitsModel();

    model.pick(a);

    expect(model.canSwap()).toBe(false);
    expect(model.swap()).toBe(false);
    expect(model.slot("to")).toBe(a);

    model.pick(b);

    expect(model.canSwap()).toBe(true);
    expect(model.swap()).toBe(true);
    expect(model.slot("to")).toBe(b);
    expect(model.slot("from")).toBe(a);
  });
});

describe("range", () => {
  it("is null while To is empty", () => {
    expect(createCommitsModel().range()).toBeNull();
  });

  it("defaults a commit's From to its first parent", () => {
    const model = createCommitsModel();

    model.pick(a);

    expect(model.range()).toEqual({
      base: "p".repeat(40),
      head: a.ref,
      defaulted: true,
    });
  });

  it("defaults a branch and a pull request to the merge base", () => {
    const branch = createCommitsModel();
    const pull = createCommitsModel();

    branch.pick(row("branch", "feature/x", "m".repeat(40)));
    pull.pick(row("pr", "d".repeat(40), "n".repeat(40)));

    expect(branch.range()).toEqual({
      base: "m".repeat(40),
      head: "feature/x",
      defaulted: true,
    });
    expect(pull.range()?.base).toBe("n".repeat(40));
  });

  it("uses From's ref verbatim for a branch against a branch, a pull request against a commit and a commit against a tag-like name", () => {
    const pairs: [PickRow, PickRow][] = [
      [row("branch", "feature/x", "m"), row("branch", "spike")],
      [row("pr", "d".repeat(40), "n"), row("commit", "e".repeat(40))],
      [row("commit", "f".repeat(40), "o"), row("branch", "v0.4.0")],
    ];

    for (const [to, from] of pairs) {
      const model = createCommitsModel();

      model.pick(to);
      model.pick(from);

      expect(model.range()).toEqual({
        base: from.ref,
        head: to.ref,
        defaulted: false,
      });
    }
  });

  it("is null and says no parent commit for a root commit", () => {
    const model = createCommitsModel();

    model.pick(row("commit", "a".repeat(40), null));

    expect(model.range()).toBeNull();
    expect(model.rangeNote()).toBe("no parent commit");
  });

  it("is null and says no merge base for a branch with none", () => {
    const model = createCommitsModel();

    model.pick(row("branch", "orphan", null));

    expect(model.range()).toBeNull();
    expect(model.rangeNote()).toBe("no merge base with the default branch");
  });

  it("has no note when From is set or a default exists", () => {
    const model = createCommitsModel();

    model.pick(a);

    expect(model.rangeNote()).toBeNull();
  });
});

describe("shading", () => {
  const list = ["1", "2", "3", "4", "5"].map((one) => one.repeat(40));
  const at = (i: number) => row("commit", list[i] as string, "x");

  it("shades exactly the rows strictly between To and From in the history", () => {
    const model = createCommitsModel();

    model.pick(at(1));
    model.pick(at(4));

    expect([...model.shaded(list)].sort()).toEqual([list[2], list[3]].sort());
  });

  it("shades none for an adjacent pair", () => {
    const model = createCommitsModel();

    model.pick(at(1));
    model.pick(at(2));

    expect(model.shaded(list).size).toBe(0);
  });

  it("shades nothing when an end is not a commit of the list", () => {
    const model = createCommitsModel();

    model.pick(at(1));
    model.pick(row("branch", "spike"));

    expect(model.shaded(list).size).toBe(0);
  });
});

describe("row builders and ordering", () => {
  const facts = (mergeBase: string | null): RefFacts => ({
    ref: "x",
    mergeBase,
    behind: 1,
    ahead: 2,
    changes: [{ status: "A", path: "a.py" }],
  });

  it("builds a commit row whose default From is its first parent", () => {
    expect(
      commitRow({
        sha: "a".repeat(40),
        short: "aaaaaaa",
        parents: ["b".repeat(40), "c".repeat(40)],
        author: "Ken",
        time: 1,
        subject: "s",
        chips: [],
        changes: [],
      }),
    ).toEqual({
      kind: "commit",
      ref: "a".repeat(40),
      label: "aaaaaaa",
      sub: "s",
      defaultFrom: "b".repeat(40),
    });
  });

  it("builds branch and pull request rows from the facts, null when unknown", () => {
    const entry = {
      row: { name: "feature/x", short: "s", author: "a", time: 1 },
      facts: facts("m".repeat(40)),
      isDefault: false,
    };
    const pull = {
      number: 4,
      title: "T",
      branch: "feature/x",
      sha: "d".repeat(40),
      author: "a",
      time: 1,
      draft: false,
      checks: "none" as const,
    };

    expect(branchRow(entry).defaultFrom).toBe("m".repeat(40));
    expect(branchRow({ ...entry, facts: null }).defaultFrom).toBeNull();
    expect(pullRequestRow(pull, facts("n".repeat(40)))).toEqual({
      kind: "pr",
      ref: "d".repeat(40),
      label: "#4",
      sub: "T",
      defaultFrom: "n".repeat(40),
    });
    expect(pullRequestRow(pull, null).defaultFrom).toBeNull();
  });

  it("puts the default branch first and marks it, naming the local branch of the default ref", () => {
    const rows = ["spike", "main", "feature/x"].map((name) => ({
      name,
      short: "s",
      author: "a",
      time: 1,
    }));
    const ordered = orderBranches(rows, "origin/main", new Map());

    expect(ordered.map((one) => one.row.name)).toEqual([
      "main",
      "spike",
      "feature/x",
    ]);
    expect(ordered.map((one) => one.isDefault)).toEqual([true, false, false]);
    expect(
      orderBranches(rows, null, new Map()).some((one) => one.isDefault),
    ).toBe(false);
  });

  it("shows a dash for an unknown change list and the bold count with its status split when known", () => {
    expect(impactText(null)).toEqual({
      count: "-",
      squares: [],
      elsewhere: null,
    });
    expect(
      impactText({
        added: ["a"],
        modified: ["b", "c"],
        removed: ["d"],
        elsewhere: ["e", "f"],
      }),
    ).toEqual({
      count: "4 files",
      squares: [
        { tone: "added", count: 1 },
        { tone: "modified", count: 2 },
        { tone: "removed", count: 1 },
      ],
      elsewhere: "+2 not on the canvas",
    });
    expect(
      impactText({ added: ["a"], modified: [], removed: [], elsewhere: [] }),
    ).toEqual({
      count: "1 file",
      squares: [{ tone: "added", count: 1 }],
      elsewhere: null,
    });
    expect(
      impactText({ added: [], modified: [], removed: [], elsewhere: ["x"] }),
    ).toEqual({
      count: "no files",
      squares: [],
      elsewhere: "+1 not on the canvas",
    });
  });

  it("classifies as unknown without a change list or without a scan", () => {
    const scan = [{ modules: [{ id: "a.py" }], selection: null }] as never;

    expect(classify(null, scan)).toBeNull();
    expect(classify([{ status: "M", path: "a.py" }], null)).toBeNull();
    expect(classify([{ status: "M", path: "a.py" }], [])).toBeNull();
    expect(classify([{ status: "M", path: "a.py" }], scan)?.modified).toEqual([
      "a.py",
    ]);
  });

  it("lists every file under its status in the tip and none for unknown", () => {
    expect(impactTip(null)).toBeNull();
    expect(
      impactTip({
        added: ["a"],
        modified: [],
        removed: ["d"],
        elsewhere: ["e"],
      }),
    ).toEqual([
      { kind: "heading", text: "2 files on the canvas" },
      { kind: "group", text: "1 added", tone: "added" },
      { kind: "file", text: "a", tone: "added" },
      { kind: "group", text: "1 removed", tone: "removed" },
      { kind: "file", text: "d", tone: "removed" },
      { kind: "group", text: "1 file not on the canvas" },
      { kind: "file", text: "e" },
    ]);
    expect(
      impactTip({ added: [], modified: [], removed: [], elsewhere: [] })?.[0],
    ).toEqual({ kind: "heading", text: "Nothing on the canvas" });
  });

  it("builds the title card from title, sha, author and age", () => {
    expect(titleTip("Fix it", "f".repeat(40), "Ken", 0, 3_600_000)).toEqual([
      "Fix it",
      "f".repeat(40),
      "Ken · 1h",
    ]);
  });

  it("hides rows with no files on the canvas but keeps From, To and unknown rows", () => {
    const none = { added: [], modified: [], removed: [], elsewhere: ["x"] };
    const some = { ...none, modified: ["m"] };
    const rows = [
      { id: 1, classification: none, slot: null },
      { id: 2, classification: some, slot: null },
      { id: 3, classification: none, slot: "from" as const },
      { id: 4, classification: none, slot: "to" as const },
      { id: 5, classification: null, slot: null },
    ];

    expect(visibleRows(rows, true).rows.map((one) => one.id)).toEqual([
      2, 3, 4, 5,
    ]);
    expect(visibleRows(rows, true).hidden).toBe(1);
    expect(visibleRows(rows, false)).toEqual({ rows, hidden: 0 });
  });

  it("labels Open with the range and its count, naming the missing end when disabled", () => {
    const short = (ref: string) => ref.slice(0, 3);
    const range = { base: "abcdef", head: "123456", defaulted: false };
    const three = {
      added: ["a"],
      modified: ["b", "c"],
      removed: [],
      elsewhere: [],
    };
    const none = { added: [], modified: [], removed: [], elsewhere: [] };

    expect(openLabel(null, null, false, short, false)).toBe("pick To below");
    expect(openLabel(null, null, false, short, true)).toBe("pick From below");
    expect(openLabel(range, three, false, short, true)).toBe(
      "Open abc..123 · 3 files",
    );
    expect(openLabel(range, none, false, short, true)).toBe(
      "Open abc..123 · no files",
    );
    expect(openLabel(range, null, true, short, true)).toBe("Open abc..123");
    expect(openLabel(range, null, false, short, true)).toBe(
      "Open abc..123 · -",
    );
  });

  it("keeps shading computed from the full list when rows between are hidden", () => {
    const list = ["1", "2", "3", "4"].map((one) => one.repeat(40));
    const model = createCommitsModel();

    model.pick(row("commit", list[0] as string, "x"));
    model.pick(row("commit", list[3] as string, "x"));

    expect(model.shaded(list).size).toBe(2);
  });

  it("writes an age in minutes, hours, days and years", () => {
    const now = 1_000_000_000_000;
    const ago = (seconds: number) => now / 1000 - seconds;

    expect(ageOf(ago(10), now)).toBe("now");
    expect(ageOf(ago(300), now)).toBe("5m");
    expect(ageOf(ago(7200), now)).toBe("2h");
    expect(ageOf(ago(3 * 86400), now)).toBe("3d");
    expect(ageOf(ago(400 * 86400), now)).toBe("1y");
  });
});
