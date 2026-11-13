import { describe, expect, it } from "vitest";
import {
  describeRateMs,
  estimateLine,
  estimateParts,
  NO_ESTIMATE_TEXT,
  type PartSpec,
  roundedTime,
  scanHistory,
} from "./scan-estimate";
import { OPEN_RUN, type PlannedRun } from "./scan-freshness";

type SenseEntry = {
  name: string;
  duration_ms: number;
  modules?: number;
  fixed_ms?: number;
  incomplete?: boolean;
  outcome?: "ok" | "failed";
};

function entry(one: {
  name: string;
  duration_ms: number;
  outcome?: "ok" | "failed";
  modules?: number;
  fixed_ms?: number;
  incomplete?: boolean;
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
    outcome?: "ok" | "failed" | "running";
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
    exit: outcome === "failed" ? 1 : 0,
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
};
const CRAP: PartSpec = { key: "crap", name: "C.R.A.P.", runsTests: true };
const STRUCTURE: PartSpec = {
  key: "structure",
  name: "Structure",
  runsTests: false,
};
const DESCRIBE: PartSpec = {
  key: "describe",
  name: "Descriptions",
  runsTests: false,
};

function planned(
  work: Record<string, number>,
  sense: string[],
  describe = false,
): PlannedRun {
  return {
    ...OPEN_RUN,
    idle: false,
    plan: { describe, describeAll: false, sense, modules: null },
    work,
  };
}

describe("roundedTime", () => {
  it("reads under a minute below 60000 ms and about 1 min at 60000 ms", () => {
    expect(roundedTime(59999)).toBe("under a minute");
    expect(roundedTime(60000)).toBe("about 1 min");
  });

  it("reads about 1 h at 3570 s, where the minutes round to 60", () => {
    expect(roundedTime(3_570_000)).toBe("about 1 h");
  });

  it("adds the minutes past the hour", () => {
    expect(roundedTime(3_900_000)).toBe("about 1 h 5 min");
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
  const lineFor = (sense: string[], describe: boolean, history = files) => {
    const parts = estimateParts(
      scanHistory(history),
      planned({ describe: 12, crap: 40, mutation: 40 }, sense, describe),
      rows,
    );

    return estimateLine(parts);
  };

  it("reads No estimate until this repository has been scanned with no history", () => {
    expect(lineFor(["crap", "mutation"], true, []).text).toBe(NO_ESTIMATE_TEXT);
  });

  it("adds the extract time to the structure figure", () => {
    const parts = estimateParts(scanHistory(files), planned({}, []), [
      STRUCTURE,
    ]);

    expect(parts[0]?.ms).toBe(10000);
  });

  it("does not name a ticked part with nothing to do", () => {
    const parts = estimateParts(
      scanHistory([]),
      planned({ crap: 0 }, ["crap"]),
      [STRUCTURE, CRAP],
    );

    expect(parts.map((one) => one.key)).toEqual(["structure"]);
  });

  it("derives the describe rate from wall time over ok entries", () => {
    expect(describeRateMs(scanHistory(files))).toBe(4000);
  });
});
