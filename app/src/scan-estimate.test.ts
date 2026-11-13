import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  describeRateMs,
  estimateLine,
  estimateParts,
  frozenFigures,
  NO_ESTIMATE_TEXT,
  type PartSpec,
  remaining,
  roundedTime,
  scanHistory,
} from "./scan-estimate";
import { OPEN_RUN, type PlannedRun } from "./scan-freshness";
import { NO_PROGRESS, type ScanProgress } from "./scan-progress";
import { foldRunLine } from "./scan-run-model";

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

const MUTATION_RUNS = [
  scanFile("20261103T090000000Z", {
    structure_ms: 0,
    sense: [
      { name: "mutation", duration_ms: 900000, fixed_ms: 130000, modules: 40 },
    ],
  }),
  scanFile("20261102T090000000Z", {
    structure_ms: 0,
    sense: [
      { name: "mutation", duration_ms: 1000000, fixed_ms: 140000, modules: 50 },
    ],
  }),
  scanFile("20261101T090000000Z", {
    structure_ms: 0,
    sense: [
      { name: "mutation", duration_ms: 500000, fixed_ms: 120000, modules: 20 },
    ],
  }),
];

const CUT_SHORT = scanFile("20261104T090000000Z", {
  structure_ms: 0,
  sense: [
    {
      name: "mutation",
      duration_ms: 200000,
      fixed_ms: 20000,
      modules: 40,
      incomplete: true,
    },
  ],
});

function mutationLine(files: { name: string; text: string }[], n = 40) {
  const parts = estimateParts(
    scanHistory(files),
    planned({ mutation: n }, ["mutation"]),
    [MUTATION],
  );

  return { parts, line: estimateLine(parts) };
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

describe("scanHistory with a part that runs tests", () => {
  it("reads the Mutation worked example as About 15 min", () => {
    const { parts, line } = mutationLine(MUTATION_RUNS);

    expect(parts[0]?.ms).toBe(890000);
    expect(line.text).toBe("About 15 min");
  });

  it("skips a cut-short run that would change the figure", () => {
    const history = scanHistory([...MUTATION_RUNS, CUT_SHORT]);

    expect(history.sense.mutation).toHaveLength(3);
    expect(JSON.parse(CUT_SHORT.text).phases[0].entries[0].incomplete).toBe(
      true,
    );

    const kept = scanHistory([
      ...MUTATION_RUNS,
      {
        name: CUT_SHORT.name,
        text: CUT_SHORT.text.replace(',"incomplete":true', ""),
      },
    ]);
    const keptParts = estimateParts(
      kept,
      planned({ mutation: 40 }, ["mutation"]),
      [MUTATION],
    );

    expect(keptParts[0]?.ms).toBe(744000);
    expect(mutationLine([...MUTATION_RUNS, CUT_SHORT]).parts[0]?.ms).toBe(
      890000,
    );
  });

  it("is exactly 60000 ms and 59999 ms at the bounds", () => {
    const at = (duration: number) =>
      mutationLine(
        [
          scanFile("20261101T090000000Z", {
            structure_ms: 0,
            sense: [
              {
                name: "mutation",
                duration_ms: duration,
                fixed_ms: duration,
                modules: 1,
              },
            ],
          }),
        ],
        1,
      ).line.text;

    expect(at(60000)).toBe("About 1 min");
    expect(at(59999)).toBe("Under a minute");
  });

  it("gives C.R.A.P. its last duration whatever the module count", () => {
    const files = [
      scanFile("20261101T090000000Z", {
        structure_ms: 0,
        sense: [
          { name: "crap", duration_ms: 120000, fixed_ms: 120000, modules: 30 },
        ],
      }),
    ];
    const at = (n: number) =>
      estimateParts(scanHistory(files), planned({ crap: n }, ["crap"]), [
        CRAP,
      ])[0];

    expect(at(5)?.ms).toBe(120000);
    expect(at(500)?.ms).toBe(120000);
    expect(at(5)?.basis).toBe("5 modules, last run's pace");
  });
});

describe("scanHistory exclusions", () => {
  const good = scanFile("20261103T090000000Z", {
    structure_ms: 0,
    sense: [
      { name: "mutation", duration_ms: 900000, fixed_ms: 130000, modules: 40 },
    ],
  });
  const wrong = (over: Parameters<typeof scanFile>[1]) =>
    scanFile("20261104T090000000Z", {
      structure_ms: 0,
      sense: [
        {
          name: "mutation",
          duration_ms: 100000,
          fixed_ms: 10000,
          modules: 40,
        },
      ],
      ...over,
    });

  function figure(files: { name: string; text: string }[]) {
    return mutationLine(files).parts[0]?.ms;
  }

  it("keeps the good record and gives the figure computed from it", () => {
    expect(scanHistory([good]).sense.mutation).toHaveLength(1);
    expect(figure([good])).toBe(130000 + 40 * 19250);
  });

  it("ignores a running record", () => {
    const running = wrong({ outcome: "running" });

    expect(scanHistory([good, running]).sense.mutation).toHaveLength(1);
    expect(figure([good, running])).toBe(figure([good]));
  });

  it("ignores a failed entry", () => {
    const failed = wrong({
      sense: [
        {
          name: "mutation",
          duration_ms: 100000,
          fixed_ms: 10000,
          modules: 40,
          outcome: "failed",
        },
      ],
    });

    expect(figure([good, failed])).toBe(figure([good]));
  });

  it("ignores an entry with no modules", () => {
    const empty = wrong({
      sense: [
        { name: "mutation", duration_ms: 100000, fixed_ms: 10000, modules: 0 },
      ],
    });

    expect(figure([good, empty])).toBe(figure([good]));
  });

  it("ignores a sense record", () => {
    const sense = wrong({ kind: "sense" });

    expect(JSON.parse(sense.text).kind).toBe("sense");
    expect(figure([good, sense])).toBe(figure([good]));
  });

  it("ignores a record that fails validation", () => {
    const broken = {
      name: "20261104T090000000Z-scan.json",
      text: wrong({}).text.replace('"modules":40', '"modules":-4'),
    };

    expect(figure([good, broken])).toBe(figure([good]));
  });

  it("keeps only the five newest entries", () => {
    const many = Array.from({ length: 8 }, (_, at) =>
      scanFile(`2026110${at + 1}T090000000Z`, {
        structure_ms: 0,
        sense: [
          {
            name: "mutation",
            duration_ms: at < 3 ? 10 : 200000,
            fixed_ms: 0,
            modules: 10,
          },
        ],
      }),
    );

    expect(mutationLine(many).parts[0]?.ms).toBe(40 * 20000);
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

  it("names a part with no history and gives the rest a figure", () => {
    const line = lineFor(["crap", "mutation"], true);

    expect(line.text).toBe("About 3 min, plus Mutation: no estimate yet");
    expect(line.title.split("\n")).toEqual([
      "Structure: <1 min (last run)",
      "Descriptions: <1 min (12 modules × 4 s)",
      "C.R.A.P.: 2 min (40 modules, last run's pace)",
      "Mutation: no estimate yet",
    ]);
  });

  it("has no plus when every part has history", () => {
    const line = lineFor(["crap"], true);

    expect(line.text).toBe("About 3 min");
    expect(line.title).not.toContain("no estimate yet");
  });

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

  it("freezes only the parts that have a figure", () => {
    const parts = estimateParts(
      scanHistory(files),
      planned({ crap: 40, mutation: 40 }, ["crap", "mutation"]),
      rows,
    );

    expect(Object.keys(frozenFigures(parts))).toEqual(["structure", "crap"]);
  });

  it("derives the describe rate from wall time over ok entries", () => {
    expect(describeRateMs(scanHistory(files))).toBe(4000);
  });
});

describe("old records", () => {
  it("gives no history from the committed scan-phases-ok example", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const text = readFileSync(
      join(here, "../../schema/log-examples/valid/scan-phases-ok.json"),
      "utf8",
    );
    const history = scanHistory([
      { name: "20261101T090000000Z-scan.json", text },
    ]);
    const parts = estimateParts(
      history,
      planned({ describe: 4, "coverage-gaps": 4 }, ["coverage-gaps"], true),
      [
        STRUCTURE,
        DESCRIBE,
        { key: "coverage-gaps", name: "coverage-gaps", runsTests: false },
      ],
    );

    expect(parts.every((one) => one.ms === null)).toBe(true);
    expect(estimateLine(parts).text).toBe(NO_ESTIMATE_TEXT);
  });
});

const T = 1_000_000;

function fold(
  state: ScanProgress,
  events: [number, Parameters<typeof foldRunLine>[1]][],
) {
  return events.reduce(
    (next, [at, event]) => foldRunLine(next, event, at),
    state,
  );
}

function frozen(figures: Record<string, number>): ScanProgress {
  return { ...NO_PROGRESS, timing: { ...NO_PROGRESS.timing, frozen: figures } };
}

const PARTS = [
  { key: "structure", name: "Structure" },
  { key: "describe", name: "Descriptions" },
  { key: "mutation", name: "Mutation" },
];

describe("remaining time while running", () => {
  const describing = (done: number) =>
    fold(frozen({ structure: 0, describe: 90_000 }), [
      [T, { event: "phase", phase: "describe", total: 12 }],
      ...Array.from(
        { length: done },
        (_, at): [number, Parameters<typeof foldRunLine>[1]] => [
          T + (at + 1) * 10_000,
          {
            event: "entry",
            phase: "describe",
            name: `m${at}`,
            outcome: "ok",
          },
        ],
      ),
    ]);
  const left = (
    progress: ScanProgress,
    now: number,
    parts = PARTS.slice(0, 2),
  ) => remaining({ parts, suites: {}, progress, startedAt: T, now });

  it("is the frozen figure minus time spent while fewer than 3 modules are done", () => {
    expect(left(describing(2), T + 20_000)?.text).toBe("about 1 min left");
  });

  it("reads about 2 min left at exactly 3 done, from the pace", () => {
    expect(left(describing(3), T + 30_000)?.text).toBe("about 2 min left");
  });

  it("keeps the whole figure while waiting for the describe answer", () => {
    const asked = foldRunLine(
      describing(0),
      {
        event: "confirm",
        phase: "describe",
        modules: 12,
        model: "m",
        inputTokens: 1,
        costUsd: 1,
      },
      T + 5_000,
    );

    expect(left(asked, T + 50_000)?.text).toBe("about 2 min left");
  });

  const mutating = (done: number) =>
    fold(frozen({ structure: 0, mutation: 600_000 }), [
      [T, { event: "phase", phase: "sense", total: 1 }],
      [T, { event: "start", phase: "sense", name: "mutation" }],
      [
        T,
        {
          event: "progress",
          phase: "sense",
          name: "mutation",
          step: "mutants",
          done: 14,
          total: 38,
        },
      ],
      [
        T + 60_000,
        {
          event: "progress",
          phase: "sense",
          name: "mutation",
          step: "mutants",
          done,
          total: 38,
        },
      ],
    ]);
  const mutationLeft = (progress: ScanProgress, suites: string[]) =>
    remaining({
      parts: [PARTS[0], PARTS[2]] as typeof PARTS,
      suites: { mutation: suites },
      progress,
      startedAt: T,
      now: T + 60_000,
    });

  it("paces Mutation from the functions done since its first mutants line", () => {
    expect(mutationLeft(mutating(17), ["unit"])?.text).toBe("about 7 min left");
  });

  it("falls back to the frozen figure with two suites", () => {
    expect(mutationLeft(mutating(17), ["a", "b"])?.text).toBe(
      "about 9 min left",
    );
  });

  it("falls back to the frozen figure below 3 functions since the first line", () => {
    expect(mutationLeft(mutating(16), ["unit"])?.text).toBe("about 9 min left");
  });

  it("names a part with no frozen figure and does not count it", () => {
    const result = remaining({
      parts: PARTS,
      suites: {},
      progress: frozen({ structure: 0, describe: 60_000 }),
      startedAt: T,
      now: T,
    });

    expect(result?.title).toBe("not counting Mutation: no estimate yet");
  });

  it("keeps the clock when no part has a figure", () => {
    expect(
      remaining({
        parts: PARTS,
        suites: {},
        progress: NO_PROGRESS,
        startedAt: T,
        now: T,
      }),
    ).toBeNull();
    expect(left(frozen({}), T)).toBeNull();
  });
});
