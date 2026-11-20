import { describe, expect, it } from "vitest";
import { staleReasons, staleReasonText } from "../src/view-staleness.js";
import type { View } from "../src/views.js";

const change: View = {
  schema_version: 4,
  description: "p",
  commit: null,
  change: { base: "main", head: "feat" },
  steps: [],
};

const pick = {
  step: 2,
  kind: "pick" as const,
  path: "a.py",
  what: "module" as const,
};

describe("staleReasons", () => {
  it("reports a head git does not know", () => {
    expect(
      staleReasons(change, [], {
        headCommit: null,
        baseCommit: "b",
        merged: false,
      }),
    ).toEqual([{ kind: "head-missing", head: "feat" }]);
  });

  it("reports a merged head", () => {
    expect(
      staleReasons(change, [], {
        headCommit: "h",
        baseCommit: "b",
        merged: true,
      }),
    ).toEqual([{ kind: "merged", head: "feat", base: "main" }]);
  });

  it("keeps a head ahead of or equal to its base live", () => {
    expect(
      staleReasons(change, [], {
        headCommit: "h",
        baseCommit: "b",
        merged: false,
      }),
    ).toEqual([]);
  });

  it("reports an unresolved pick alone", () => {
    expect(staleReasons(change, [pick], null)).toEqual([
      { kind: "pick-unresolved", step: 2, path: "a.py" },
    ]);
  });

  it("reports a missing pick and a merged head together", () => {
    expect(
      staleReasons(change, [pick], {
        headCommit: "h",
        baseCommit: "b",
        merged: true,
      }),
    ).toHaveLength(2);
  });

  it("adds no git reason with no answer from git or no range", () => {
    expect(staleReasons(change, [], null)).toEqual([]);
    expect(
      staleReasons({ ...change, change: undefined }, [], {
        headCommit: null,
        baseCommit: null,
        merged: false,
      }),
    ).toEqual([]);
  });

  it("adds no reason for an unknown base", () => {
    expect(
      staleReasons(change, [], {
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
