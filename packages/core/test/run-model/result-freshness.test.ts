import { describe, expect, it } from "vitest";
import {
  ResultFreshness,
  ResultSet,
  workOutFreshness,
} from "../../src/index.js";
import { reportedResult, structureOf } from "./support.js";

const AT = { commit: "c0ffee", modified: false };

function entriesFor(inputs: Record<string, string> | null) {
  return ResultSet.empty()
    .reported("tally", AT, reportedResult({ inputs }))
    .of("tally");
}

describe("result freshness", () => {
  it("current_stale_never_run_and_checking", () => {
    const structure = structureOf({ "a.py": "h1", "b.py": "h2" });

    expect(
      workOutFreshness(
        entriesFor({ "a.py": "h1", "b.py": "h2" }),
        structure,
        false,
      ).view(),
    ).toEqual({ state: "current", outOfDate: [] });
    expect(
      workOutFreshness(
        entriesFor({ "a.py": "h1", "b.py": "old" }),
        structure,
        false,
      ).view(),
    ).toEqual({ state: "stale", outOfDate: ["b.py"] });
    expect(workOutFreshness([], structure, false).view().state).toBe(
      "never-run",
    );
    expect(ResultFreshness.checking().view().state).toBe("checking");
  });

  it("an_unreadable_structure_never_reads_as_current", () => {
    expect(
      workOutFreshness(
        entriesFor({ "a.py": "h1", "b.py": "h2" }),
        null,
        false,
      ).view(),
    ).toEqual({ state: "stale", outOfDate: ["a.py", "b.py"] });
    expect(workOutFreshness([], null, false).view()).toEqual({
      state: "never-run",
      outOfDate: [],
    });
  });

  it("a_result_whose_tests_digest_equals_the_current_digest_exactly_is_current", () => {
    const structure = structureOf({ "a.py": "h1" });
    const entries = ResultSet.empty()
      .reported(
        "tally",
        AT,
        reportedResult({ inputs: { "a.py": "h1" }, testsDigest: "t1" }),
      )
      .of("tally");

    expect(workOutFreshness(entries, structure, false, "t1").view()).toEqual({
      state: "current",
      outOfDate: [],
    });
  });

  it("one_changed_test_file_makes_it_stale_naming_the_inputs_it_cannot_confirm", () => {
    const structure = structureOf({ "a.py": "h1", "b.py": "h2" });
    const entries = ResultSet.empty()
      .reported(
        "tally",
        AT,
        reportedResult({
          inputs: { "a.py": "h1", "b.py": "h2" },
          testsDigest: "t1",
        }),
      )
      .of("tally");

    expect(workOutFreshness(entries, structure, false, "t2").view()).toEqual({
      state: "stale",
      outOfDate: ["a.py", "b.py"],
    });
  });
});
