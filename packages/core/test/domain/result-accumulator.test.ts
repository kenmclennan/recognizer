import { describe, expect, it } from "vitest";
import {
  type DeclaredMetric,
  InvalidEntity,
  type PluginEvent,
  ResultAccumulator,
  type RunScope,
} from "../../src/index.js";

const METRICS: DeclaredMetric[] = [
  { name: "crap", type: "number", granularity: "member", bad: "high" },
  { name: "coverage", type: "ratio", granularity: "member", bad: "low" },
];

const COMMIT = "a".repeat(40);

function finding(id: string, summary = "risky"): Record<string, unknown> {
  return {
    id,
    kind: "crap",
    severity: "warning",
    principle: "change-risk-anti-patterns",
    summary,
    evidence: { modules: ["a.py"] },
  };
}

function accumulator(
  scope: RunScope = { kind: "working-tree" },
): ResultAccumulator {
  return new ResultAccumulator({
    name: "crap",
    version: "1",
    metrics: METRICS,
    commit: COMMIT,
    scope,
  });
}

const START: PluginEvent = { event: "start", total: 5, unit: "functions" };

const SETTLED: PluginEvent = {
  event: "settled",
  modified: false,
  settings: { threshold: 30 },
  counts: { measured: 2, total: 2 },
};

function refused(run: () => void): InvalidEntity {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidEntity);

    return error as InvalidEntity;
  }

  throw new Error("expected the accumulator to refuse");
}

describe("result accumulator", () => {
  it("a_result_replaces_a_finding_with_the_same_id", () => {
    const held = accumulator();

    held.take(START);
    held.take({ event: "result", findings: [finding("crap:a", "first")] });
    held.take({ event: "result", findings: [finding("crap:a", "second")] });
    held.take(SETTLED);

    const { findings } = held.complete({ modified: true }).document;

    expect(findings).toHaveLength(1);
    expect(findings[0]?.summary).toBe("second");
  });

  it("an_overlay_value_replaces_the_same_metric_and_id", () => {
    const held = accumulator();

    held.take(START);
    held.take({ event: "result", overlay: { crap: { "a::f": 1, "a::g": 2 } } });
    held.take({ event: "result", overlay: { crap: { "a::f": 9 } } });
    held.take(SETTLED);

    expect(held.complete({ modified: true }).overlay?.values).toEqual({
      crap: { "a::f": 9, "a::g": 2 },
    });
  });

  it("a_settled_document_carries_the_facts_it_reported", () => {
    const held = accumulator();

    held.take(START);
    held.take({ event: "result", findings: [finding("crap:a")] });
    held.take(SETTLED);

    const { document } = held.complete({ modified: true });

    expect(document.modified).toBe(false);
    expect(document.settings).toEqual({ threshold: 30 });
    expect(document.counts).toEqual({ measured: 2, total: 2 });
    expect(document.commit).toBe(COMMIT);
    expect(document.sensor).toEqual({ name: "crap", version: "1" });
    expect(document.partial).toBeUndefined();
  });

  it("an_undeclared_metric_is_refused", () => {
    const held = accumulator();

    held.take(START);

    const error = refused(() =>
      held.take({ event: "result", overlay: { churn: { "a::f": 1 } } }),
    );

    expect(error.rule).toContain("undeclared metric");
    expect(held.refused()).toBe(1);
  });

  it("a_value_out_of_its_metrics_range_is_refused", () => {
    const held = accumulator();

    held.take(START);
    refused(() =>
      held.take({ event: "result", overlay: { coverage: { "a::f": 1.5 } } }),
    );

    expect(held.hasResults()).toBe(false);
  });

  it("a_commit_document_with_modified_true_is_refused", () => {
    const held = accumulator({ kind: "commit", commit: COMMIT });

    held.take(START);
    refused(() => held.take({ ...SETTLED, modified: true } as PluginEvent));

    expect(held.hasSettled()).toBe(false);
  });

  it("findings_are_ordered_by_id", () => {
    const held = accumulator();

    held.take(START);
    held.take({
      event: "result",
      findings: [
        finding("crap:app/risk.py::classify"),
        finding("coverage:app/risk.py::classify"),
      ],
    });
    held.take(SETTLED);

    expect(
      held.complete({ modified: true }).document.findings.map(({ id }) => id),
    ).toEqual(["coverage:app/risk.py::classify", "crap:app/risk.py::classify"]);
  });

  it("an_unsettled_tail_is_closed_as_partial_from_the_last_progress", () => {
    const held = accumulator();

    held.take(START);
    held.take({ event: "progress", done: 3, total: 7, unit: "functions" });
    held.take({ event: "result", findings: [finding("crap:a")] });

    expect(held.hasUnsettledTail()).toBe(true);
    expect(held.demoted({ modified: true }).document.partial).toEqual({
      measured: 3,
      total: 7,
    });
  });

  it("an_unsettled_tail_with_no_progress_uses_the_start_total_and_zero", () => {
    const held = accumulator();

    held.take(START);
    held.take({ event: "result", findings: [finding("crap:a")] });

    expect(held.demoted({ modified: true }).document.partial).toEqual({
      measured: 0,
      total: 5,
    });
  });

  it("a_result_after_settled_joins_the_next_document", () => {
    const held = accumulator();

    held.take(START);
    held.take({ event: "result", findings: [finding("crap:a")] });
    held.take(SETTLED);

    expect(held.hasUnsettledTail()).toBe(false);

    held.take({ event: "result", findings: [finding("crap:b")] });

    expect(held.hasUnsettledTail()).toBe(true);
    expect(
      held.demoted({ modified: true }).document.findings.map(({ id }) => id),
    ).toEqual(["crap:a", "crap:b"]);

    held.take(SETTLED);

    expect(held.hasUnsettledTail()).toBe(false);
  });

  it("a_refused_result_leaves_the_accepted_ones", () => {
    const held = accumulator();

    held.take(START);
    held.take({ event: "result", findings: [finding("crap:a")] });
    refused(() =>
      held.take({
        event: "result",
        findings: [finding("crap:bad")],
        overlay: { churn: { x: 1 } },
      }),
    );
    held.take({ event: "result", findings: [finding("crap:c")] });
    held.take(SETTLED);

    expect(
      held.complete({ modified: true }).document.findings.map(({ id }) => id),
    ).toEqual(["crap:a", "crap:c"]);
    expect(held.refused()).toBe(1);
  });

  it("a_finding_with_an_empty_id_is_refused", () => {
    const held = accumulator();

    held.take(START);
    refused(() => held.take({ event: "result", findings: [finding("")] }));
  });
});
