import { staleReasonText, View } from "@recognizer/core";
import { describe, expect, it } from "vitest";

const change = View.of({
  schema_version: 4,
  description: "p",
  commit: null,
  change: { base: "main", head: "feat" },
  steps: [],
});

const pick = {
  step: 2,
  kind: "pick" as const,
  path: "a.py",
  what: "module" as const,
};

describe("staleReasons", () => {
  it("reports a head git does not know", () => {
    expect(
      change.staleReasons([], {
        headCommit: null,
        baseCommit: "b",
        merged: false,
      }),
    ).toEqual([{ kind: "head-missing", head: "feat" }]);
  });

  it("reports a merged head", () => {
    expect(
      change.staleReasons([], {
        headCommit: "h",
        baseCommit: "b",
        merged: true,
      }),
    ).toEqual([{ kind: "merged", head: "feat", base: "main" }]);
  });

  it("keeps a head ahead of or equal to its base live", () => {
    expect(
      change.staleReasons([], {
        headCommit: "h",
        baseCommit: "b",
        merged: false,
      }),
    ).toEqual([]);
  });

  it("reports an unresolved pick alone", () => {
    expect(change.staleReasons([pick], null)).toEqual([
      { kind: "pick-unresolved", step: 2, path: "a.py" },
    ]);
  });

  it("reports a missing pick and a merged head together", () => {
    expect(
      change.staleReasons([pick], {
        headCommit: "h",
        baseCommit: "b",
        merged: true,
      }),
    ).toHaveLength(2);
  });

  it("adds no git reason with no answer from git or no range", () => {
    expect(change.staleReasons([], null)).toEqual([]);
    expect(
      change.with({ change: undefined }).staleReasons([], {
        headCommit: null,
        baseCommit: null,
        merged: false,
      }),
    ).toEqual([]);
  });

  it("adds no reason for an unknown base", () => {
    expect(
      change.staleReasons([], {
        headCommit: "h",
        baseCommit: null,
        merged: false,
      }),
    ).toEqual([]);
  });

  it("words each reason", () => {
    expect(staleReasonText({ kind: "merged", head: "f", base: "m" })).toBe(
      "head f is merged into m",
    );
    expect(staleReasonText({ kind: "head-missing", head: "f" })).toBe(
      "head f is not in the repository",
    );
    expect(
      staleReasonText({ kind: "pick-unresolved", step: 3, path: "a.py" }),
    ).toBe("step 3 a.py no longer resolves");
  });
});
