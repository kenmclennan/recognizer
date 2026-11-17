import type { ViewChange } from "recognizer";
import { describe, expect, it } from "vitest";
import type { PullDetail } from "./change-detail-parse";
import {
  firstParagraph,
  formatDate,
  formatDay,
  kindOfChange,
  viewNameFrom,
} from "./change-summary";
import { VIEW_NAME } from "./views-port";

const sha = (letter: string) => letter.repeat(40);
const EPOCH = 1794933540;

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
  name: "ccccccc to aaaaaaa",
};

const pull: PullDetail = {
  number: 1026,
  title: "feat(app): show length",
  body: "<!-- lc:item=REC-651 -->\n<!-- lc:body -->\n\nfeat(app): show length\n\nThe card now measures with the shared length.\nIt agrees.\n\nMore.",
  state: "open",
  author: "kenmclennan",
  checks: "pending",
};

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
