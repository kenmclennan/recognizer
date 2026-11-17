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
  suiteHistoryOf,
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
  work?: { unit: string; performed: number };
  suites?: { name: string; duration_ms: number }[];
};

function entry(one: {
  name: string;
  duration_ms: number;
  outcome?: "ok" | "failed";
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

const fns = (performed: number) => ({ unit: "functions", performed });

const MUTATION: PartSpec = {
  key: "mutation",
  name: "Mutation",
  runsTests: true,
  scoped: true,
};
const CRAP: PartSpec = {
  key: "crap",
  name: "C.R.A.P.",
  runsTests: true,
  scoped: false,
};
const STRUCTURE: PartSpec = {
  key: "structure",
  name: "Structure",
  runsTests: false,
  scoped: false,
};
const DESCRIBE: PartSpec = {
  key: "describe",
  name: "Descriptions",
  runsTests: false,
  scoped: false,
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
      {
        name: "mutation",
        duration_ms: 900000,
        fixed_ms: 130000,
        modules: 40,
        work: fns(40),
      },
    ],
  }),
  scanFile("20261102T090000000Z", {
    structure_ms: 0,
    sense: [
      {
        name: "mutation",
        duration_ms: 1000000,
        fixed_ms: 140000,
        modules: 50,
        work: fns(50),
      },
    ],
  }),
  scanFile("20261101T090000000Z", {
    structure_ms: 0,
    sense: [
      {
        name: "mutation",
        duration_ms: 500000,
        fixed_ms: 120000,
        modules: 20,
        work: fns(20),
      },
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
      work: fns(40),
      incomplete: true,
    },
  ],
});

function mutationLine(
  files: { name: string; text: string }[],
  toPerform = 40,
  modules = 40,
) {
  const parts = estimateParts(
    scanHistory(files),
    planned({ mutation: modules }, ["mutation"]),
    [MUTATION],
    { mutation: { unit: "functions", to_perform: toPerform } },
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
    const history = scanHistory([
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
    expect(suiteHistoryOf(history, ["crap", "mutation"])).toEqual({
      crap: { engine: [1400, 3200], app: [4500, 8400] },
    });
  });

  it("lists no suite history for a sensor whose runs recorded none", () => {
    expect(suiteHistoryOf(scanHistory([]), ["crap"])).toEqual({});
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
      { mutation: { unit: "functions", to_perform: 40 } },
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
                work: fns(1),
              },
            ],
          }),
        ],
        0,
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

  it("words the basis by scoped and runsTests, not by a sensor's name", () => {
    const files = [
      scanFile("20261101T090000000Z", {
        structure_ms: 0,
        sense: [
          { name: "a", duration_ms: 120000, fixed_ms: 60000, modules: 30 },
          { name: "b", duration_ms: 120000, fixed_ms: 60000, modules: 30 },
          { name: "c", duration_ms: 120000, modules: 30 },
        ],
      }),
    ];
    const part = (key: string, runsTests: boolean, scoped: boolean) =>
      estimateParts(scanHistory(files), planned({ [key]: 5 }, [key]), [
        { key, name: key, runsTests, scoped },
      ])[0]?.basis;

    expect(part("a", true, false)).toBe("5 modules, last run's pace");
    expect(part("b", true, true)).toBe("5 modules at recent pace");
    expect(part("c", false, false)).toBe("5 modules at recent pace");
  });
});

describe("the Mutation estimate counts the functions it will measure", () => {
  const FULL = scanFile("20261101T090000000Z", {
    structure_ms: 0,
    sense: [
      {
        name: "mutation",
        duration_ms: 190000,
        fixed_ms: 10000,
        modules: 40,
        work: fns(370),
      },
    ],
  });
  const REUSED = (at: number) =>
    scanFile(`2026110${at}T090000000Z`, {
      structure_ms: 0,
      sense: [
        {
          name: "mutation",
          duration_ms: 10000,
          fixed_ms: 9000,
          modules: 40,
          work: fns(0),
        },
      ],
    });

  it("reads the full run on the new build as About 3 min", () => {
    const { parts, line } = mutationLine([FULL], 370);

    expect(parts[0]?.ms).toBeCloseTo(190000, 6);
    expect(parts[0]?.basis).toBe("370 functions at recent pace");
    expect(line.text).toBe("About 3 min");
  });

  it("reads an all-reused rerun as its fixed part alone and Under a minute", () => {
    const { parts, line } = mutationLine([REUSED(2), FULL], 0);

    expect(parts).toHaveLength(1);
    expect(parts[0]?.ms).toBe(9000);
    expect(parts[0]?.basis).toBe(
      "nothing to measure; the baseline and coverage runs only",
    );
    expect(line.text).toBe("Under a minute");
  });

  it("reads a rerun after one function changes as the fixed part plus one function", () => {
    const { parts, line } = mutationLine([REUSED(2), FULL], 1);

    expect(parts[0]?.ms).toBeCloseTo(9000 + 180000 / 370, 6);
    expect(parts[0]?.basis).toBe("1 function at recent pace");
    expect(line.text).toBe("Under a minute");
  });

  it("keeps the rate honest when the newest entries all reused everything", () => {
    const { parts } = mutationLine(
      [REUSED(6), REUSED(5), REUSED(4), REUSED(3), REUSED(2), FULL],
      40,
    );

    expect(parts[0]?.ms).toBeCloseTo(9000 + (40 * 180000) / 370, 6);
  });

  it("reads every function changed again as About 3 min", () => {
    const { parts, line } = mutationLine([REUSED(2), FULL], 370);

    expect(parts[0]?.ms).toBeCloseTo(9000 + 180000, 6);
    expect(line.text).toBe("About 3 min");
  });

  it("gives a count and no figure when functions are to be performed and no sample has a rate", () => {
    const old = scanFile("20261101T090000000Z", {
      structure_ms: 0,
      sense: [
        { name: "mutation", duration_ms: 20000, fixed_ms: 5000, modules: 4 },
      ],
    });

    expect(mutationLine([old], 3).parts[0]).toMatchObject({
      ms: null,
      basis: "3 functions to mutate, no pace yet",
    });
    expect(mutationLine([old], 0).parts[0]?.ms).toBe(5000);
  });

  it("gives no estimate for Mutation before the sensor has answered, never a module figure", () => {
    const parts = estimateParts(
      scanHistory(MUTATION_RUNS),
      planned({ mutation: 40 }, ["mutation"]),
      [MUTATION],
    );

    expect(parts[0]).toMatchObject({ ms: null, basis: null });
  });

  it("keeps the module figure for a part that does not answer work", () => {
    const files = [
      scanFile("20261101T090000000Z", {
        structure_ms: 0,
        sense: [
          { name: "crap", duration_ms: 120000, fixed_ms: 120000, modules: 30 },
        ],
      }),
    ];
    const parts = estimateParts(
      scanHistory(files),
      planned({ crap: 5 }, ["crap"]),
      [CRAP],
      { mutation: { unit: "functions", to_perform: 9 } },
    );

    expect(parts[0]?.ms).toBe(120000);
    expect(parts[0]?.basis).toBe("5 modules, last run's pace");
  });

  it("records the newest scan record name as the last run", () => {
    expect(scanHistory([FULL, REUSED(2)]).lastRun).toBe(REUSED(2).name);
    expect(scanHistory([]).lastRun).toBeNull();
  });
});

describe("scanHistory exclusions", () => {
  const good = scanFile("20261103T090000000Z", {
    structure_ms: 0,
    sense: [
      {
        name: "mutation",
        duration_ms: 900000,
        fixed_ms: 130000,
        modules: 40,
        work: fns(40),
      },
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
          work: fns(40),
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
          work: fns(40),
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
            work: fns(10),
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

  it("names the function count when Mutation has work and no pace", () => {
    const lineWith = (toPerform: number | null) =>
      estimateLine(
        estimateParts(
          scanHistory(files),
          planned(
            { describe: 12, crap: 40, mutation: 40 },
            ["crap", "mutation"],
            true,
          ),
          rows,
          toPerform === null
            ? {}
            : { [MUTATION.key]: { unit: "functions", to_perform: toPerform } },
        ),
      );
    const many = lineWith(40);

    expect(many.title).toContain(
      "Mutation: 40 functions to mutate, no pace yet",
    );
    expect(many.text).toBe(
      "About 3 min, plus Mutation: 40 functions to mutate, no pace yet",
    );
    expect(lineWith(1).title).toContain(
      "Mutation: 1 function to mutate, no pace yet",
    );
    expect(lineWith(0).title).toContain("Mutation: no estimate yet");
    expect(lineWith(null).text).toBe(
      "About 3 min, plus Mutation: no estimate yet",
    );
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
        {
          key: "coverage-gaps",
          name: "coverage-gaps",
          runsTests: false,
          scoped: false,
        },
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

  it("time left ignores an injected sleep gap", () => {
    const wallJump = 2 * 3_600_000;
    const awakeNow = T + 20_000;
    const wallNow = awakeNow + wallJump;

    expect(left(describing(2), awakeNow)?.text).toBe("about 1 min left");
    expect(left(describing(2), wallNow)?.text).not.toBe("about 1 min left");
  });

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

  const mutating = (done: number, first = 14, total = 38) =>
    fold(frozen({ structure: 0, mutation: 600_000 }), [
      [T, { event: "phase", phase: "sense", total: 1 }],
      [T, { event: "start", phase: "sense", name: "mutation" }],
      [
        T,
        {
          event: "plugin",
          phase: "sense",
          name: "mutation",
          data: {
            event: "progress",
            done: first,
            total,
            unit: "functions",
            step: "mutants",
          },
        },
      ],
      [
        T + 60_000,
        {
          event: "plugin",
          phase: "sense",
          name: "mutation",
          data: {
            event: "progress",
            done,
            total,
            unit: "functions",
            step: "mutants",
          },
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

  it("paces a plugin from the units done since its first progress event", () => {
    expect(mutationLeft(mutating(17), ["unit"])?.text).toBe("about 7 min left");
  });

  it("paces a plugin from progress since its first event, not from the functions done before the run", () => {
    expect(mutationLeft(mutating(371, 368, 633), ["unit"])?.text).toBe(
      "about 1 h 27 min left",
    );
  });

  type Line = [number, Parameters<typeof foldRunLine>[1]];
  const plugin = (
    name: string,
    data: Extract<Line[1], { event: "plugin" }>["data"],
  ): Line["1"] => ({ event: "plugin", phase: "sense", name, data });
  const stream = (
    name: string,
    figure: number,
    start: Record<string, unknown>,
    progress: [number, number, number, string | undefined, string][],
  ) =>
    fold(frozen({ structure: 0, [name]: figure }), [
      [T, { event: "phase", phase: "sense", total: 1 }],
      [T, { event: "start", phase: "sense", name }],
      [T, plugin(name, { event: "start", ...start } as never)],
      ...progress.map(
        ([at, done, total, step, unit]): Line => [
          at,
          plugin(name, {
            event: "progress",
            done,
            total,
            unit,
            ...(step === undefined ? {} : { step }),
          }),
        ],
      ),
    ]);
  const sensorLeft = (
    key: string,
    progress: ScanProgress,
    now: number,
    suites = ["a", "b"],
  ) =>
    remaining({
      parts: [PARTS[0], { key, name: key }],
      suites: { [key]: suites },
      progress,
      startedAt: T,
      now,
    });
  const twoSuiteMutation = (bDone: number) =>
    stream("mutation", 600_000, { total: 150, unit: "functions", queued: 30 }, [
      [T, 80, 100, "a", "functions"],
      [T + 240_000, 100, 100, "a", "functions"],
      [T + 240_000, 50, 60, "b", "functions"],
      [T + 300_000, bDone, 60, "b", "functions"],
    ]);

  it("paces a two-suite mutation run from the work done across its suites", () => {
    const progress = twoSuiteMutation(53);

    expect(progress.timing.runWork).not.toBeNull();
    expect(sensorLeft("mutation", progress, T + 300_000)?.text).toBe(
      "about 2 min left",
    );
  });

  const firstSuite = (done: number) =>
    stream("mutation", 600_000, { total: 150, unit: "functions", queued: 30 }, [
      [T, 80, 100, "a", "functions"],
      [T + 30_000, done, 100, "a", "functions"],
    ]);

  it("keeps a two-suite mutation run on the frozen figure at 2 functions of work", () => {
    expect(sensorLeft("mutation", firstSuite(82), T + 30_000)?.text).toBe(
      "about 10 min left",
    );
  });

  it("paces a two-suite mutation run at 3 functions of work", () => {
    expect(sensorLeft("mutation", firstSuite(83), T + 30_000)?.text).toBe(
      "about 5 min left",
    );
  });

  const crap = (done: number) =>
    stream("crap", 840_000, { total: 2, unit: "suites" }, [
      [T, 0, 2, undefined, "suites"],
      [T + 300_000, done, 2, undefined, "suites"],
    ]);

  it("paces a two-suite crap run once one suite is done", () => {
    expect(sensorLeft("crap", crap(1), T + 300_000)?.text).toBe(
      "about 5 min left",
    );
  });

  it("keeps a two-suite crap run on the frozen figure with no suite done", () => {
    expect(sensorLeft("crap", crap(0), T + 300_000)?.text).toBe(
      "about 9 min left",
    );
  });

  it("adds nothing for a two-suite crap run with every suite done", () => {
    expect(sensorLeft("crap", crap(2), T + 300_000)?.text).toBe(
      "under a minute left",
    );
  });

  const SECOND = 1000;
  const loomHistory = {
    engine: [32 * SECOND],
    app: [84 * SECOND],
    tauri: [339 * SECOND],
  };
  const withHistory = (
    progress: ScanProgress,
    history: Record<string, number[]> = loomHistory,
  ): ScanProgress => ({
    ...progress,
    timing: { ...progress.timing, suiteHistory: { crap: history } },
  });
  const loom = (
    events: [number, number, string][],
    history?: Record<string, number[]>,
  ) =>
    withHistory(
      stream(
        "crap",
        840_000,
        { total: 3, unit: "suites" },
        events.map(([at, done, step]) => [at, done, 3, step, "suites"]),
      ),
      history,
    );
  const loomLeft = (progress: ScanProgress, now: number) =>
    sensorLeft("crap", progress, now, ["engine", "app", "tauri"]);
  const engineDone: [number, number, string][] = [
    [T, 0, "engine"],
    [T + 14 * SECOND, 1, "engine"],
    [T + 14 * SECOND, 1, "app"],
  ];

  it("paces a multi-suite run on each suite's own history, scaled by this run's speed", () => {
    expect(loomLeft(loom(engineDone), T + 14 * SECOND)?.text).toBe(
      "about 3 min left",
    );
  });

  it("counts the running suite as its median minus its elapsed time", () => {
    expect(loomLeft(loom(engineDone), T + 34 * SECOND)?.text).toBe(
      "about 3 min left",
    );
  });

  it("takes the median of the past runs at least as long as an overrunning suite", () => {
    const progress = loom(
      [
        [T, 0, "engine"],
        [T + 32 * SECOND, 1, "engine"],
        [T + 32 * SECOND, 1, "app"],
      ],
      { ...loomHistory, app: [60 * SECOND, 120 * SECOND] },
    );

    expect(loomLeft(progress, T + 132 * SECOND)?.text).toBe("about 6 min left");
  });

  it("names a suite that outran every past run and counts nothing for it beside the suites still to run", () => {
    const progress = loom(
      [
        [T, 0, "engine"],
        [T + 32 * SECOND, 1, "engine"],
        [T + 32 * SECOND, 1, "app"],
      ],
      loomHistory,
    );

    expect(loomLeft(progress, T + 400 * SECOND)?.text).toBe(
      "about 6 min left, plus crap on app: longer than estimated",
    );
  });

  it("paces a suite with no history on the suite-count pace", () => {
    expect(
      loomLeft(
        loom(
          [
            [T, 0, "engine"],
            [T + 60 * SECOND, 1, "engine"],
            [T + 60 * SECOND, 1, "app"],
          ],
          { engine: [60 * SECOND] },
        ),
        T + 60 * SECOND,
      )?.text,
    ).toBe("about 2 min left");
  });

  it("keeps the suite-count pace for a sensor with no per-suite history", () => {
    expect(
      loomLeft(
        stream("crap", 840_000, { total: 3, unit: "suites" }, [
          [T, 0, 3, "engine", "suites"],
          [T + 60 * SECOND, 1, 3, "engine", "suites"],
        ]),
        T + 60 * SECOND,
      )?.text,
    ).toBe("about 2 min left");
  });

  const crapRun = (events: [number, Line[1]][]) =>
    fold(frozen({ structure: 0, crap: 60_000 }), [
      [T, { event: "phase", phase: "sense", total: 1 }],
      [T, { event: "start", phase: "sense", name: "crap" }],
      [T, plugin("crap", { event: "start", total: 3, unit: "suites" })],
      ...events,
    ]);
  const suiteEvent = (done: number, step: string): Line[1] =>
    plugin("crap", {
      event: "progress",
      done,
      total: 3,
      unit: "suites",
      step,
    });
  const coverageNote = (suite: string): Line[1] =>
    plugin("crap", { event: "note", text: `Coverage run: ${suite}` });
  const threeSuiteRun = (
    until: "engine" | "app" | "tauri",
    history?: Record<string, number[]>,
  ): ScanProgress => {
    const events: [number, Line[1]][] = [
      [T, suiteEvent(0, "engine")],
      [T, coverageNote("engine")],
      [T + 92 * SECOND, suiteEvent(1, "engine")],
      [T + 92 * SECOND, suiteEvent(1, "app")],
      [T + 92 * SECOND, coverageNote("app")],
    ];

    if (until !== "engine") {
      events.push(
        [T + 155 * SECOND, suiteEvent(2, "app")],
        [T + 155 * SECOND, suiteEvent(2, "tauri")],
        [T + 155 * SECOND, coverageNote("tauri")],
      );
    }

    const progress = crapRun(events);

    return history === undefined ? progress : withHistory(progress, history);
  };

  it("reads about 3 min after the first of three suites and about 1 min after the second, with no history", () => {
    expect(loomLeft(threeSuiteRun("engine"), T + 92 * SECOND)?.text).toBe(
      "about 3 min left",
    );
    expect(loomLeft(threeSuiteRun("tauri"), T + 155 * SECOND)?.text).toBe(
      "about 1 min left",
    );
  });

  it("keeps those figures after the sensor starts its function run", () => {
    const progress = crapRun([
      [T, suiteEvent(0, "engine")],
      [T + 92 * SECOND, suiteEvent(1, "engine")],
      [T + 92 * SECOND, suiteEvent(1, "app")],
    ]);

    expect(loomLeft(progress, T + 92 * SECOND)?.text).toBe("about 3 min left");
  });

  it("keeps a stepped stream with no queued on the frozen figure", () => {
    const progress = stream(
      "mutation",
      600_000,
      { total: 150, unit: "functions" },
      [
        [T, 10, 100, "a", "functions"],
        [T + 60_000, 20, 100, "a", "functions"],
      ],
    );

    expect(sensorLeft("mutation", progress, T + 60_000)?.text).toBe(
      "about 9 min left",
    );
  });

  it("falls back to the frozen figure below 3 functions since the first line", () => {
    expect(mutationLeft(mutating(16), ["unit"])?.text).toBe("about 9 min left");
  });

  const started = (figures: Record<string, number>) =>
    fold(frozen(figures), [
      [T, { event: "phase", phase: "sense", total: 1 }],
      [T, { event: "start", phase: "sense", name: "mutation" }],
    ]);
  const overrunLeft = (
    progress: ScanProgress,
    now: number,
    suites = ["unit"],
    parts: { key: string; name: string }[] = [PARTS[0], PARTS[2]],
  ) =>
    remaining({
      parts,
      suites: { mutation: suites },
      progress,
      startedAt: T,
      now,
    });

  it("names a sensor past its figure with no rate as longer than estimated", () => {
    const result = overrunLeft(
      started({ structure: 0, mutation: 600_000 }),
      T + 700_000,
    );

    expect(result?.text).toBe("Mutation: longer than estimated");
    expect(result?.text).not.toContain("under a minute");
    expect(result?.title).toBe("Mutation: past its estimate of about 10 min");
  });

  it("keeps the other parts' time beside an overrun", () => {
    const result = overrunLeft(
      started({ structure: 0, crap: 300_000, mutation: 600_000 }),
      T + 700_000,
      ["unit"],
      [PARTS[0], { key: "crap", name: "C.R.A.P." }, PARTS[2]],
    );

    expect(result?.text).toBe(
      "about 5 min left, plus Mutation: longer than estimated",
    );
  });

  it("counts exactly at the figure as no overrun", () => {
    expect(
      overrunLeft(started({ structure: 0, mutation: 600_000 }), T + 600_000)
        ?.text,
    ).toBe("under a minute left");
  });

  it("names a describing phase past its figure with fewer than 3 modules done", () => {
    const result = left(describing(2), T + 100_000);

    expect(result?.text).toBe("Descriptions: longer than estimated");
  });

  it("restarts the pace at a step change", () => {
    const at = (
      time: number,
      step: string,
      done: number,
    ): [number, Parameters<typeof foldRunLine>[1]] => [
      time,
      {
        event: "plugin",
        phase: "sense",
        name: "mutation",
        data: { event: "progress", done, total: 38, unit: "functions", step },
      },
    ];
    const run = (...lines: [number, Parameters<typeof foldRunLine>[1]][]) =>
      fold(frozen({ structure: 0, mutation: 600_000 }), [
        [T, { event: "phase", phase: "sense", total: 1 }],
        [T, { event: "start", phase: "sense", name: "mutation" }],
        at(T, "a", 14),
        ...lines,
      ]);

    expect(
      overrunLeft(
        run(at(T + 60_000, "b", 20), at(T + 120_000, "b", 22)),
        T + 120_000,
      )?.text,
    ).toBe("about 8 min left");
    expect(
      overrunLeft(
        run(at(T + 60_000, "b", 20), at(T + 120_000, "b", 23)),
        T + 120_000,
      )?.text,
    ).toBe("about 5 min left");
  });

  it("keeps a two-suite sensor with no progress on the frozen figure and names the overrun", () => {
    expect(
      overrunLeft(started({ structure: 0, mutation: 600_000 }), T + 700_000, [
        "a",
        "b",
      ])?.text,
    ).toBe("Mutation: longer than estimated");
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

describe("paces from recorded durations", () => {
  const sensed = (duration: number) => [
    scanFile("20261103T090000000Z", {
      structure_ms: 0,
      sense: [
        {
          name: "mutation",
          duration_ms: duration,
          fixed_ms: 1000,
          modules: 10,
        },
      ],
    }),
  ];

  it("a pace ignores an injected sleep gap", () => {
    const awake = scanHistory(sensed(600_000)).sense.mutation?.[0];
    const legacy = scanHistory(sensed(600_000 * 100)).sense.mutation?.[0];

    expect(awake).toBeDefined();
    expect(awake?.durationMs).toBe(600_000);
    expect(legacy?.durationMs).toBe(600_000 * 100);
  });
});
