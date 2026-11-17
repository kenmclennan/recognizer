import type { ViewChange } from "recognizer";
import { describe, expect, it } from "vitest";
import type { CommitDetail, PullDetail } from "./change-detail-parse";
import {
  type ChangeSummaryFacts,
  firstParagraph,
  formatDate,
  formatDay,
  kindOfChange,
  summariseChange,
  viewNameFrom,
} from "./change-summary";
import type { HistoryRow } from "./commits-parse";
import { VIEW_NAME } from "./views-port";

const sha = (letter: string) => letter.repeat(40);
const EPOCH = 1794933540;
const nothing: ChangeSummaryFacts = {
  commit: null,
  tip: null,
  pull: null,
  defaultBranch: null,
  ahead: null,
  behind: null,
  rows: null,
  counts: null,
};
const counts = { onCanvas: 3, elsewhere: 2 };

const commitChange: ViewChange = {
  base: sha("b"),
  head: sha("a"),
  name: "commit aaaaaaa",
};
const branchChange: ViewChange = {
  base: sha("b"),
  head: "feat/x",
  name: "branch feat/x",
};
const pullChange: ViewChange = {
  base: sha("b"),
  head: sha("a"),
  name: "pull request #1026",
};
const rangeChange: ViewChange = {
  base: sha("1"),
  head: sha("4"),
  name: "2222222 to 4444444",
};

const commit: CommitDetail = {
  author: "Ken McLennan",
  time: EPOCH,
  subject: "feat(app): one filter",
  body: "First paragraph\nwraps here.\n\nSecond.",
};

const pull: PullDetail = {
  number: 1026,
  title: "feat(app): show length",
  body: "<!-- lc:item=REC-651 -->\n<!-- lc:body -->\n\nfeat(app): show length\n\nThe card now measures with the shared length.\nIt agrees.\n\nMore.",
  state: "open",
  author: "kenmclennan",
  checks: "pending",
};

function row(
  letter: string,
  parent: string,
  author: string,
  time: number,
  subject: string,
): HistoryRow {
  return {
    sha: sha(letter),
    short: letter.repeat(7),
    parents: [sha(parent)],
    author,
    time,
    subject,
    chips: [],
    changes: [],
  };
}

const rows = [
  row("4", "3", "Ken", EPOCH, "newest subject"),
  row("3", "2", "Ken", EPOCH - 60, "middle"),
  row("2", "1", "Ken", EPOCH - 120, "older"),
  row("1", "0", "Ana", EPOCH - 180, "before the range"),
];

describe("kindOfChange", () => {
  it("reads each kind from the name", () => {
    expect(kindOfChange(commitChange)).toEqual({
      kind: "commit",
      sha: sha("a"),
    });
    expect(kindOfChange(branchChange)).toEqual({
      kind: "branch",
      name: "feat/x",
    });
    expect(kindOfChange(pullChange)).toEqual({ kind: "pr", number: 1026 });
    expect(kindOfChange(rangeChange)).toEqual({ kind: "range" });
    expect(kindOfChange({ ...commitChange, name: "odd name" })).toEqual({
      kind: "other",
    });
  });

  it("treats a branch whose name and head disagree as other", () => {
    expect(kindOfChange({ ...branchChange, head: "feat/y" })).toEqual({
      kind: "other",
    });
  });

  it("treats a view with no name as other", () => {
    expect(kindOfChange({ base: "a", head: "b" })).toEqual({ kind: "other" });
  });
});

describe("firstParagraph", () => {
  it("skips comments and a title repeat", () => {
    expect(firstParagraph(pull.body, pull.title)).toBe(
      "The card now measures with the shared length. It agrees.",
    );
  });

  it("drops a heading-marked title repeat, ignoring case", () => {
    expect(firstParagraph("# Feat(App): Show Length\n\nBody", pull.title)).toBe(
      "Body",
    );
  });

  it("returns null for a body that is only comments", () => {
    expect(firstParagraph("<!-- a -->\n\n<!-- b\nc -->", null)).toBeNull();
  });
});

describe("viewNameFrom", () => {
  it("slugs the worked examples", () => {
    expect(
      viewNameFrom(
        "feat(app): one commits filter hides rows with nothing to show on every tab",
      ),
    ).toBe("feat-app-one-commits-filter-hides-rows-with-nothing-to-show-on");
    expect(
      viewNameFrom(
        "#1026 feat(app): show a function's body length on the inspector card",
      ),
    ).toBe("1026-feat-app-show-a-function-s-body-length-on-the-inspector");
    expect(viewNameFrom("4 commits, f8b2b6e to 3b3380c")).toBe(
      "4-commits-f8b2b6e-to-3b3380c",
    );
  });

  it("keeps 64 exactly when the next character is a dash", () => {
    expect(viewNameFrom(`${"a".repeat(64)} b`)).toBe("a".repeat(64));
  });

  it("cuts back to the last dash when the next character is not one", () => {
    expect(viewNameFrom(`${"a".repeat(63)} b`)).toBe("a".repeat(63));
    expect(viewNameFrom("a".repeat(70))).toBe("a".repeat(64));
  });

  it("gives an empty name for only symbols", () => {
    expect(viewNameFrom("!!!")).toBe("");
  });

  it("always passes VIEW_NAME or is empty", () => {
    for (const title of [
      "x ".repeat(80),
      "Ünïcode título longer than sixty four characters, surely, yes it is",
      "-- leading",
    ]) {
      const name = viewNameFrom(title);

      expect(name === "" || VIEW_NAME.test(name)).toBe(true);
    }
  });
});

describe("formatDate and formatDay", () => {
  it("formats in the zone handed in", () => {
    expect(formatDate(EPOCH, "UTC")).toBe("17 Nov 2026 16:39");
    expect(formatDay(EPOCH, "UTC")).toBe("17 Nov");
  });
});

describe("summariseChange", () => {
  it("summarises a commit with a body", () => {
    const summary = summariseChange(
      commitChange,
      { ...nothing, commit, counts },
      "UTC",
    );

    expect(summary.title).toBe("feat(app): one filter");
    expect(summary.chip).toBe("commit aaaaaaa · 17 Nov");
    expect(summary.lead).toBe("First paragraph wraps here.");
    expect(summary.facts).toEqual([
      "Ken McLennan · 17 Nov 2026 16:39 · 3 files on the canvas, 2 not on the canvas",
    ]);
    expect(summary.saveDescription).toBe("First paragraph wraps here.");
  });

  it("falls back to the facts line for a commit with no body", () => {
    const summary = summariseChange(
      commitChange,
      { ...nothing, commit: { ...commit, body: "" }, counts },
      "UTC",
    );

    expect(summary.lead).toBeNull();
    expect(summary.facts).toHaveLength(1);
    expect(summary.saveDescription).toBe(summary.facts[0]);
  });

  it("leaves a commit's parts out when nothing is known, never showing Change", () => {
    const summary = summariseChange(commitChange, nothing, "UTC");

    expect(summary.title).toBe("commit aaaaaaa");
    expect(summary.chip).toBe("commit aaaaaaa");
    expect(summary.facts).toEqual([]);
    expect(summary.saveDescription).toBe("");
  });

  it("keeps the counts alone when only they are known", () => {
    const summary = summariseChange(
      commitChange,
      { ...nothing, counts },
      "UTC",
    );

    expect(summary.facts).toEqual([
      "3 files on the canvas, 2 not on the canvas",
    ]);
  });

  it("drops the second counts clause at zero and names no files at none", () => {
    const text = (onCanvas: number, elsewhere: number) =>
      summariseChange(
        commitChange,
        { ...nothing, counts: { onCanvas, elsewhere } },
        "UTC",
      ).facts[0];

    expect(text(1, 0)).toBe("1 file on the canvas");
    expect(text(0, 0)).toBe("no files on the canvas");
    expect(text(0, 4)).toBe("no files on the canvas, 4 not on the canvas");
    expect(text(5, 1)).toBe("5 files on the canvas, 1 not on the canvas");
  });

  it("summarises a pull request, skipping lc markers and the title repeat", () => {
    const summary = summariseChange(
      pullChange,
      {
        ...nothing,
        pull,
        defaultBranch: "main",
        ahead: 1,
        behind: 0,
        counts,
      },
      "UTC",
    );

    expect(summary.title).toBe("#1026 feat(app): show length");
    expect(summary.chip).toBe("pull request #1026");
    expect(summary.lead).toBe(
      "The card now measures with the shared length. It agrees.",
    );
    expect(summary.facts).toEqual([
      "kenmclennan · open · checks pending · 1 ahead, 0 behind main · 3 files on the canvas, 2 not on the canvas",
    ]);
  });

  it("gives a pull request whose body is only comments no lead and a facts description", () => {
    const summary = summariseChange(
      pullChange,
      {
        ...nothing,
        pull: { ...pull, body: "<!-- a -->\n<!-- b -->", checks: "none" },
      },
      "UTC",
    );

    expect(summary.lead).toBeNull();
    expect(summary.facts).toEqual(["kenmclennan · open"]);
    expect(summary.saveDescription).toBe("kenmclennan · open");
  });

  it("titles a branch from its open pull request", () => {
    const summary = summariseChange(
      branchChange,
      {
        ...nothing,
        pull,
        tip: { author: "Ken", time: EPOCH, subject: "tip subject" },
        defaultBranch: "main",
        ahead: 1,
        behind: 0,
        counts,
      },
      "UTC",
    );

    expect(summary.title).toBe("#1026 feat(app): show length");
    expect(summary.chip).toBe("branch feat/x");
    expect(summary.lead).toBeNull();
    expect(summary.facts).toEqual([
      "1 ahead, 0 behind main · Ken · pull request #1026, open",
      "3 files on the canvas, 2 not on the canvas",
    ]);
    expect(summary.saveDescription).toBe(summary.facts[0]);
  });

  it("titles a branch with no pull request from its newest commit", () => {
    const summary = summariseChange(
      branchChange,
      {
        ...nothing,
        tip: { author: "Ken", time: EPOCH, subject: "tip subject" },
        defaultBranch: "main",
        ahead: 2,
        behind: 3,
      },
      "UTC",
    );

    expect(summary.title).toBe("tip subject");
    expect(summary.facts).toEqual(["2 ahead, 3 behind main · Ken"]);
  });

  it("summarises a range by one author", () => {
    const summary = summariseChange(
      rangeChange,
      { ...nothing, rows, counts },
      "UTC",
    );

    expect(summary.title).toBe("3 commits, 2222222 to 4444444");
    expect(summary.chip).toBe("2222222 to 4444444");
    expect(summary.lead).toBe("newest subject and 2 earlier commits");
    expect(summary.facts).toEqual([
      "Ken · 17 Nov 2026 16:39 · 3 files on the canvas, 2 not on the canvas",
    ]);
    expect(summary.saveDescription).toBe(summary.lead);
  });

  it("counts down to the first commit when a merge whose first parent is the base sits before it", () => {
    const merged = [
      row("4", "3", "Ken", EPOCH, "newest subject"),
      {
        ...row("3", "6", "Ken", EPOCH - 60, "merge"),
        parents: [sha("6"), sha("5")],
      },
      row("5", "6", "Ken", EPOCH - 120, "first on the branch"),
      row("6", "0", "Ken", EPOCH - 180, "base"),
    ];
    const summary = summariseChange(
      { base: sha("6"), head: sha("4"), name: "5555555 to 4444444" },
      { ...nothing, rows: merged },
      "UTC",
    );

    expect(summary.title).toBe("3 commits, 5555555 to 4444444");
    expect(summary.lead).toBe("newest subject and 2 earlier commits");
  });

  it("names several authors when the span has more than one", () => {
    const mixed = [
      rows[0] as HistoryRow,
      { ...(rows[1] as HistoryRow), author: "Ana" },
      rows[2] as HistoryRow,
      rows[3] as HistoryRow,
    ];
    const summary = summariseChange(
      rangeChange,
      { ...nothing, rows: mixed },
      "UTC",
    );

    expect(summary.facts[0]?.startsWith("several authors · ")).toBe(true);
  });

  it("falls back to the chip text when the rows do not contain head", () => {
    const summary = summariseChange(
      rangeChange,
      { ...nothing, rows: rows.slice(1), counts },
      "UTC",
    );

    expect(summary.title).toBe("2222222 to 4444444");
    expect(summary.lead).toBeNull();
    expect(summary.facts).toEqual([
      "3 files on the canvas, 2 not on the canvas",
    ]);
  });

  it("reports unknown facts, not a partial count, when head is found and base's child is not", () => {
    const summary = summariseChange(
      rangeChange,
      { ...nothing, rows: rows.slice(0, 2) },
      "UTC",
    );

    expect(summary.title).toBe("2222222 to 4444444");
    expect(summary.lead).toBeNull();
    expect(summary.facts).toEqual([]);
  });

  it("gives an unnamed change its chip text and the counts line alone", () => {
    const summary = summariseChange(
      { base: sha("b"), head: sha("a") },
      { ...nothing, counts },
      "UTC",
    );

    expect(summary.title).toBe("bbbbbbbb..aaaaaaaa");
    expect(summary.lead).toBeNull();
    expect(summary.facts).toEqual([
      "3 files on the canvas, 2 not on the canvas",
    ]);
  });

  it("never titles a change Change", () => {
    for (const change of [
      commitChange,
      branchChange,
      pullChange,
      rangeChange,
    ]) {
      expect(summariseChange(change, nothing, "UTC").title).not.toBe("Change");
    }
  });
});
