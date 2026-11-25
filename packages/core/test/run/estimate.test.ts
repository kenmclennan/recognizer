import { describe, expect, it } from "vitest";
import {
  describeRateMs,
  estimateParts,
  type NamedRunRecord,
  type PartSpec,
  type PlannedIntent,
  scanHistory,
} from "../../src/index.js";

function named(files: { name: string; text: string }[]): NamedRunRecord[] {
  return [...files]
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
    .flatMap(({ name, text }) => {
      try {
        return [{ name, record: JSON.parse(text) as NamedRunRecord["record"] }];
      } catch {
        return [];
      }
    });
}

type PlannedRun = { plan: PlannedIntent; work: Record<string, number> };

const historyOf = (files: { name: string; text: string }[]) =>
  scanHistory(named(files));
const partsOf = (
  history: ReturnType<typeof scanHistory>,
  run: PlannedRun,
  rows: PartSpec[],
  work?: Parameters<typeof estimateParts>[3],
) => estimateParts(history, { intent: run.plan, work: run.work }, rows, work);

type SenseEntry = {
  name: string;
  duration_ms: number;
  modules?: number;
  fixed_ms?: number;
  incomplete?: boolean;
  outcome?: "ok" | "failed" | "stopped";
  work?: { unit: string; performed: number };
  suites?: { name: string; duration_ms: number }[];
};

function entry(one: {
  name: string;
  duration_ms: number;
  outcome?: "ok" | "failed" | "stopped";
  modules?: number;
  fixed_ms?: number;
  incomplete?: boolean;
  work?: { unit: string; performed: number };
  suites?: { name: string; duration_ms: number }[];
}) {
  const { outcome = "ok", ...rest } = one;

  return {
    command: ["x"],
    status: outcome === "ok" ? 0 : 1,
    outcome,
    stderr: "",
    ...(outcome === "failed" ? { reason: "boom" } : {}),
    ...rest,
  };
}

function scanFile(
  stamp: string,
  over: {
    structure_ms?: number;
    extract?: number;
    describe?: { ms: number; entries: number[] };
    sense?: SenseEntry[];
    outcome?: "ok" | "failed" | "running" | "stopped";
    kind?: "scan" | "sense";
  } = {},
): { name: string; text: string } {
  const kind = over.kind ?? "scan";
  const outcome = over.outcome ?? "ok";
  const phases = [
    ...(over.extract === undefined
      ? []
      : [
          {
            phase: "extract",
            entries: [entry({ name: "python", duration_ms: over.extract })],
          },
        ]),
    ...(over.describe === undefined
      ? []
      : [
          {
            phase: "describe",
            duration_ms: over.describe.ms,
            entries: over.describe.entries.map((ms, at) =>
              entry({ name: `m${at}`, duration_ms: ms }),
            ),
          },
        ]),
    ...(over.sense === undefined
      ? []
      : [{ phase: "sense", entries: over.sense.map(entry) }]),
  ];
  const body =
    kind === "scan"
      ? { phases: outcome === "running" ? [] : phases }
      : { entries: phases.flatMap((one) => one.entries) };
  const record = {
    log_version: 1,
    kind,
    started: "2026-11-02T09:00:00.000Z",
    finished: outcome === "running" ? null : "2026-11-02T09:10:00.000Z",
    by: "ken",
    arguments: [],
    outcome,
    exit: outcome === "failed" || outcome === "stopped" ? 1 : 0,
    ...(over.structure_ms === undefined
      ? {}
      : { structure_ms: over.structure_ms }),
    ...body,
  };

  return { name: `${stamp}-${kind}.json`, text: JSON.stringify(record) };
}

const MUTATION: PartSpec = {
  key: "mutation",
  name: "Mutation",
  runsTests: true,
  scoped: true,
  workVerb: "mutate",
};
const CRAP: PartSpec = {
  key: "crap",
  name: "C.R.A.P.",
  runsTests: true,
  scoped: false,
  workVerb: null,
};
const STRUCTURE: PartSpec = {
  key: "structure",
  name: "Structure",
  runsTests: false,
  scoped: false,
  workVerb: null,
};
const DESCRIBE: PartSpec = {
  key: "describe",
  name: "Descriptions",
  runsTests: false,
  scoped: false,
  workVerb: null,
};

function planned(
  work: Record<string, number>,
  sense: string[],
  describe = false,
): PlannedRun {
  return { plan: { describe, analysis: true, sense }, work };
}

describe("per-suite durations in the history", () => {
  const run = (name: string, suites: { name: string; duration_ms: number }[]) =>
    scanFile(name, {
      structure_ms: 0,
      sense: [
        {
          name: "crap",
          duration_ms: 50000,
          fixed_ms: 50000,
          modules: 30,
          suites,
        },
      ],
    });

  it("reads each suite's duration from the run log and lists them newest first", () => {
    const history = historyOf([
      run("20261101T090000000Z", [
        { name: "engine", duration_ms: 3200 },
        { name: "app", duration_ms: 8400 },
      ]),
      run("20261102T090000000Z", [
        { name: "engine", duration_ms: 1400 },
        { name: "app", duration_ms: 4500 },
      ]),
    ]);

    expect(history.sense.crap?.[0]?.suites).toEqual([
      { name: "engine", durationMs: 1400 },
      { name: "app", durationMs: 4500 },
    ]);
  });
});

describe("the estimate line", () => {
  const files = [
    scanFile("20261103T090000000Z", {
      structure_ms: 6000,
      extract: 4000,
      describe: { ms: 40000, entries: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
      sense: [
        { name: "crap", duration_ms: 130000, fixed_ms: 130000, modules: 40 },
      ],
    }),
  ];
  const rows = [STRUCTURE, DESCRIBE, CRAP, MUTATION];
  it("derives the describe rate from wall time over ok entries", () => {
    expect(describeRateMs(historyOf(files))).toBe(4000);
  });
});
