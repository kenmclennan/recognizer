import { describe, expect, it } from "vitest";
import { InvalidEntity, ResultSet, Run } from "../../src/index.js";
import {
  fakesWith,
  findingsOf,
  holderOver,
  ROOT,
  reportedResult,
} from "./support.js";

function run(): Run {
  return Run.begin({
    id: "run-1",
    startedBy: "cli",
    startedAt: "2026-11-24T10:00:00.000Z",
    scope: { kind: "working-tree" },
    choices: { sensors: ["tally"], describe: false, suites: {} },
  }).apply({ kind: "running" });
}

const AT = { commit: "c0ffee", modified: false };

describe("result set", () => {
  it("results_grow_as_they_are_reported", () => {
    const first = ResultSet.empty().reported("tally", AT, reportedResult());
    const second = first.reported(
      "tally",
      { commit: "c0ffee", modified: true },
      reportedResult(),
    );

    expect(first.of("tally")).toHaveLength(1);
    expect(second.of("tally")).toHaveLength(2);
    expect(first.of("tally")).toHaveLength(1);
  });

  it("a_stopped_run_keeps_the_results_reported_before_the_stop", () => {
    const held = ResultSet.empty().reported("tally", AT, reportedResult());
    const stopped = run()
      .apply({ kind: "plugin-started", name: "tally", progress: null })
      .stopped(null);

    expect(() => held.replaced("tally", stopped, [])).toThrow(InvalidEntity);
    expect(held.of("tally")).toHaveLength(1);
  });

  it("only_a_finished_run_replaces_the_set_whole", () => {
    const held = ResultSet.empty()
      .reported("tally", AT, reportedResult())
      .reported("tally", { commit: "old", modified: false }, reportedResult());
    const finished = run()
      .apply({ kind: "plugin-started", name: "tally", progress: null })
      .apply({ kind: "plugin-ended", name: "tally", state: "finished" });
    const [kept] = held.of("tally");

    expect(() => held.replaced("tally", run(), [])).toThrow(InvalidEntity);
    expect(
      held.replaced("tally", finished, kept ? [kept] : []).of("tally"),
    ).toHaveLength(1);
  });

  it("results_are_kept_per_commit", () => {
    const set = ResultSet.empty()
      .reported("tally", { commit: "aaa", modified: false }, reportedResult())
      .reported("tally", { commit: "bbb", modified: false }, reportedResult());

    expect(set.of("tally").map(({ at }) => at.commit)).toEqual(["aaa", "bbb"]);
  });

  it("an_invalid_document_keeps_the_previous_entry", () => {
    const fakes = fakesWith("tally", "margin");

    fakes.findings.save(ROOT, findingsOf("tally", { "a.py": "h1" }));
    fakes.findings.save(ROOT, findingsOf("margin", { "a.py": "h1" }));

    const holder = holderOver(fakes);

    holder.refresh();

    fakes.findings.invalidate("tally");
    fakes.findings.save(
      ROOT,
      findingsOf(
        "margin",
        { "a.py": "h2" },
        { reportedAt: "2026-11-24T11:00:00.000Z" },
      ),
    );
    holder.refresh();

    const { results } = holder.current();

    expect(results.tally?.results).toHaveLength(1);
    expect(results.tally?.results[0]?.unreadable).toBe(true);
    expect(results.tally?.unreadable).toBe(1);
    expect(results.margin?.unreadable).toBe(0);
    expect(
      results.margin?.results.map(({ reportedAt }) => reportedAt),
    ).toContain("2026-11-24T11:00:00.000Z");
  });
});
