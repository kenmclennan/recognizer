import { describe, expect, it } from "vitest";
import {
  ageOf,
  branchRow,
  classify,
  commitRow,
  createSelection,
  defaultBranchName,
  impactText,
  impactTip,
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

const history = ["1", "2", "3", "4", "5"].map((one) => one.repeat(40));
const at = (i: number) => row("commit", history[i] as string, `p${i}`);

const rangeSelection = () => {
  const selection = createSelection();

  selection.setMode("range");

  return selection;
};

describe("selection", () => {
  it("starts in One commit mode with First and Last empty and First next", () => {
    const selection = createSelection();

    expect(selection.mode()).toBe("one");
    expect(selection.first()).toBeNull();
    expect(selection.last()).toBeNull();
    expect(selection.next()).toBe("first");
  });

  it("in Range mode fills First on the first pick and names Last next", () => {
    const selection = rangeSelection();

    expect(selection.pick(at(1), "history", history)).toBeNull();
    expect(selection.first()).toEqual(at(1));
    expect(selection.last()).toBeNull();
    expect(selection.next()).toBe("last");
  });

  it("completes a range on the second pick with the older commit as First, whichever order the picks came in", () => {
    const forward = rangeSelection();
    const backward = rangeSelection();

    forward.pick(at(1), "history", history);

    const one = forward.pick(at(3), "history", history);

    backward.pick(at(3), "history", history);

    const other = backward.pick(at(1), "history", history);

    expect(one).toEqual(other);
    expect(one?.base).toBe("p3");
    expect(one?.head).toBe(history[1]);
    expect(one?.name).toBe(`${at(3).label} to ${at(1).label}`);
    expect(other?.name).toBe(one?.name);
    expect(forward.first()).toEqual(at(3));
    expect(forward.last()).toEqual(at(1));
    expect(backward.first()).toEqual(at(3));
    expect(backward.last()).toEqual(at(1));
  });

  it("clears First when the held First is clicked again before Last is picked", () => {
    const selection = rangeSelection();

    selection.pick(at(1), "history", history);

    expect(selection.pick(at(1), "history", history)).toBeNull();
    expect(selection.first()).toBeNull();
    expect(selection.next()).toBe("first");
  });

  it("starts a new range from the clicked commit when a complete range is held", () => {
    const selection = rangeSelection();

    selection.pick(at(1), "history", history);
    selection.pick(at(3), "history", history);

    expect(selection.pick(at(2), "history", history)).toBeNull();
    expect(selection.first()).toEqual(at(2));
    expect(selection.last()).toBeNull();
  });

  it("clearing First makes the remaining commit First and clearing Last empties Last", () => {
    const selection = rangeSelection();

    selection.pick(at(1), "history", history);
    selection.pick(at(3), "history", history);
    selection.clear("first");

    expect(selection.first()).toEqual(at(1));
    expect(selection.last()).toBeNull();

    selection.pick(at(3), "history", history);
    selection.clear("last");

    expect(selection.first()).toEqual(at(3));
    expect(selection.last()).toBeNull();
  });

  it("pick returns nothing while a range has one end", () => {
    const selection = rangeSelection();

    expect(selection.pick(at(0), "history", history)).toBeNull();
    expect(selection.count(history)).toBeNull();
  });

  it("in One commit mode opens the commit's parent to the commit", () => {
    const selection = createSelection();

    expect(selection.pick(a, "history", history)).toEqual({
      base: "p".repeat(40),
      head: a.ref,
      what: `commit ${a.label}`,
      name: `commit ${a.label}`,
    });
    expect(selection.picked()).toEqual(a);
  });

  it("on Branches and Pull requests opens the merge base to the head", () => {
    const selection = createSelection();
    const branch = row("branch", "feature/x", "m".repeat(40));
    const pull = { ...row("pr", "d".repeat(40), "n".repeat(40)), label: "#9" };

    expect(selection.pick(branch, "branches", history)).toEqual({
      base: "m".repeat(40),
      head: "feature/x",
      what: "branch feature/x",
      name: "branch feature/x",
    });
    expect(selection.pick(pull, "prs", history)).toEqual({
      base: "n".repeat(40),
      head: "d".repeat(40),
      what: "pull request #9",
      name: "pull request #9",
    });
  });

  it("opens a branch even when the mode is Range", () => {
    const selection = rangeSelection();
    const branch = row("branch", "feature/x", "m".repeat(40));

    expect(selection.pick(branch, "branches", history)?.base).toBe(
      "m".repeat(40),
    );
    expect(selection.first()).toBeNull();
  });

  it("refuses a root commit with the note no parent commit and holds nothing", () => {
    const selection = createSelection();
    const root = row("commit", "e".repeat(40));

    expect(selection.pick(root, "history", history)).toBeNull();
    expect(selection.note()).toBe("no parent commit");
    expect(selection.picked()).toBeNull();
  });

  it("refuses a branch with no merge base with the note no merge base with the default branch", () => {
    const selection = createSelection();

    expect(
      selection.pick(row("branch", "spike"), "branches", history),
    ).toBeNull();
    expect(selection.note()).toBe("no merge base with the default branch");
    expect(selection.picked()).toBeNull();
  });

  it("has no refusal note after an accepted pick", () => {
    const selection = createSelection();

    selection.pick(row("commit", "e".repeat(40)), "history", history);
    selection.pick(a, "history", history);

    expect(selection.note()).toBeNull();
  });

  it("refuses a range whose older end is a root commit and leaves Last unset", () => {
    const selection = rangeSelection();
    const root = row("commit", history[4] as string);

    selection.pick(at(1), "history", history);

    expect(selection.pick(root, "history", history)).toBeNull();
    expect(selection.note()).toBe("no parent commit");
    expect(selection.last()).toBeNull();
    expect(selection.first()).toEqual(at(1));
  });

  it("shades exactly the rows strictly between First and Last in the full history", () => {
    const selection = rangeSelection();

    selection.pick(at(1), "history", history);
    selection.pick(at(4), "history", history);

    expect([...selection.between(history)].sort()).toEqual(
      [history[2], history[3]].sort(),
    );
  });

  it("shades none for an adjacent pair", () => {
    const selection = rangeSelection();

    selection.pick(at(1), "history", history);
    selection.pick(at(2), "history", history);

    expect(selection.between(history).size).toBe(0);
    expect(selection.count(history)).toBe(2);
  });

  it("shades nothing when an end is not in the history list", () => {
    const selection = rangeSelection();

    selection.pick(at(1), "history", history);
    selection.pick(row("commit", "z".repeat(40), "x"), "history", history);

    expect(selection.between(history).size).toBe(0);
  });

  it("counts both ends from the full list, at the boundary of the whole list", () => {
    const selection = rangeSelection();

    selection.pick(at(0), "history", history);
    selection.pick(at(4), "history", history);

    expect(selection.count(history)).toBe(5);
    expect(selection.between(history).size).toBe(3);
  });

  it("says one line per state of the guide, naming the default branch", () => {
    const selection = createSelection();

    expect(selection.guideLine("branches", "trunk", history)).toBe(
      "Each branch shows what it changes against trunk.",
    );
    expect(selection.guideLine("prs", "feature/x", history)).toBe(
      "Each pull request shows what it changes against feature/x.",
    );
    expect(selection.guideLine("branches", null, history)).toBe(
      "Each branch shows what it changes against the default branch.",
    );
    expect(selection.guideLine("history", null, history)).toBe(
      "Click a commit to see what it changed.",
    );

    selection.setMode("range");

    expect(selection.guideLine("history", null, history)).toBe(
      "Click the first commit of the range.",
    );

    selection.pick(at(1), "history", history);

    expect(selection.guideLine("history", null, history)).toBe(
      "Now click the last commit.",
    );

    selection.pick(at(3), "history", history);

    expect(selection.guideLine("history", null, history)).toBe(
      "3 commits, both ends included.",
    );
  });

  it("shows the refusal note as the guide line until the next click", () => {
    const selection = createSelection();

    selection.pick(row("commit", "e".repeat(40)), "history", history);

    expect(selection.guideLine("history", null, history)).toBe(
      "no parent commit",
    );

    selection.pick(a, "history", history);

    expect(selection.guideLine("history", null, history)).toBe(
      "Click a commit to see what it changed.",
    );
  });

  it("names the local default branch from the default ref", () => {
    expect(defaultBranchName("origin/trunk")).toBe("trunk");
    expect(defaultBranchName("origin/feature/x")).toBe("feature/x");
    expect(defaultBranchName(null)).toBeNull();
  });

  it("setMode clears the held ends and the picked row", () => {
    const selection = rangeSelection();

    selection.pick(at(1), "history", history);
    selection.setMode("one");
    selection.pick(at(2), "history", history);

    expect(selection.picked()).toEqual(at(2));

    selection.setMode("range");

    expect(selection.picked()).toBeNull();
    expect(selection.first()).toBeNull();
    expect(selection.pick(at(2), "history", history)).toBeNull();
    expect(selection.first()).toEqual(at(2));
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

  it("hides rows with no files on the canvas but keeps held rows and unknown rows", () => {
    const none = { added: [], modified: [], removed: [], elsewhere: ["x"] };
    const some = { ...none, modified: ["m"] };
    const rows = [
      { id: 1, classification: none, held: false },
      { id: 2, classification: some, held: false },
      { id: 3, classification: none, held: true },
      { id: 4, classification: none, held: true },
      { id: 5, classification: null, held: false },
    ];

    expect(visibleRows(rows, true).rows.map((one) => one.id)).toEqual([
      2, 3, 4, 5,
    ]);
    expect(visibleRows(rows, true).hidden).toBe(1);
    expect(visibleRows(rows, false)).toEqual({ rows, hidden: 0 });
  });

  it("keeps shading computed from the full list when rows between are hidden", () => {
    const list = ["1", "2", "3", "4"].map((one) => one.repeat(40));
    const selection = rangeSelection();

    selection.pick(row("commit", list[0] as string, "x"), "history", list);
    selection.pick(row("commit", list[3] as string, "x"), "history", list);

    expect(selection.between(list).size).toBe(2);
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

describe("keepOnly", () => {
  it("keeps a pick whose ref is still listed", () => {
    const selection = createSelection();

    selection.pick(at(1), "history", history);
    expect(selection.picked()).toEqual(at(1));

    selection.keepOnly("commit", history);

    expect(selection.picked()).toEqual(at(1));
  });

  it("clears a pick whose ref is missing", () => {
    const selection = createSelection();

    selection.pick(at(1), "history", history);
    expect(selection.picked()).toEqual(at(1));

    selection.keepOnly("commit", [history[0] as string]);

    expect(selection.picked()).toBeNull();
  });

  it("leaves a pick of another kind untouched", () => {
    const selection = createSelection();
    const pr = row("pr", "f".repeat(40), "p");

    selection.pick(pr, "prs", history);
    expect(selection.picked()).toEqual(pr);

    selection.keepOnly("commit", []);

    expect(selection.picked()).toEqual(pr);
  });

  it("clears only the end that is missing in a range", () => {
    const selection = rangeSelection();

    selection.pick(at(3), "history", history);
    selection.pick(at(1), "history", history);
    expect(selection.first()).toEqual(at(3));
    expect(selection.last()).toEqual(at(1));

    selection.keepOnly("commit", [history[3] as string]);

    expect(selection.first()).toEqual(at(3));
    expect(selection.last()).toBeNull();
  });
});
