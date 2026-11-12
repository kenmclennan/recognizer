import { describe, expect, it } from "vitest";
import {
  ageOf,
  branchRow,
  commitRow,
  countsText,
  createCommitsModel,
  orderBranches,
  type PickRow,
  pullRequestRow,
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
    added: 3,
    modified: 4,
    removed: 5,
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
        counts: { added: 0, modified: 0, removed: 0 },
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

  it("shows a dash for unknown counts and the three counts when known", () => {
    expect(countsText(null)).toBe("-");
    expect(countsText({ added: 1, modified: 2, removed: 3 })).toBe("+1 ~2 -3");
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
