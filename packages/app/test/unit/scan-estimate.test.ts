import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  describeRateMs,
  estimateLine,
  estimateParts,
  NO_ESTIMATE_TEXT,
  type PartSpec,
  roundedTime,
  scanHistory,
} from "../../src/scan-estimate";
import { OPEN_RUN, type PlannedRun } from "../../src/scan-freshness";

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

const fns = (performed: number) => ({ unit: "functions", performed });

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
  return {
    ...OPEN_RUN,
    idle: false,
    plan: {
      describe,
      describeAll: false,
      analysis: true,
      sense,
      modules: null,
    },
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

  it("gives C.R.A.P. its last duration whatever the file count", () => {
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
    expect(at(5)?.basis).toBe("5 files, last run's pace");
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
        { key, name: key, runsTests, scoped, workVerb: null },
      ])[0]?.basis;

    expect(part("a", true, false)).toBe("5 files, last run's pace");
    expect(part("b", true, true)).toBe("5 files at recent pace");
    expect(part("c", false, false)).toBe("5 files at recent pace");
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

  it("no-pace basis uses the declared verb", () => {
    const old = scanFile("20261101T090000000Z", {
      structure_ms: 0,
      sense: [
        { name: "mutation", duration_ms: 20000, fixed_ms: 5000, modules: 4 },
      ],
    });
    const basis = (workVerb: string) =>
      estimateParts(
        scanHistory([old]),
        planned({ mutation: 40 }, ["mutation"]),
        [{ ...MUTATION, workVerb }],
        { mutation: { unit: "functions", to_perform: 3 } },
      )[0]?.basis;

    expect(basis("mutate")).toBe("3 functions to mutate, no pace yet");
    expect(basis("check")).toBe("3 functions to check, no pace yet");
  });

  it("a sensor key never decides the work path", () => {
    const parts = estimateParts(
      scanHistory(MUTATION_RUNS),
      planned({ mutation: 40 }, ["mutation"]),
      [{ ...MUTATION, workVerb: null }],
    );

    expect(parts[0]?.basis).not.toContain("to mutate");
    expect(parts[0]?.ms).not.toBeNull();
  });

  it("exactly zero planned work gives the fixed-time basis and no no-pace row", () => {
    const old = scanFile("20261101T090000000Z", {
      structure_ms: 0,
      sense: [
        { name: "mutation", duration_ms: 20000, fixed_ms: 5000, modules: 4 },
      ],
    });
    const part = mutationLine([old], 0).parts[0];

    expect(part?.ms).toBe(5000);
    expect(part?.basis).not.toContain("no pace yet");
  });

  it("gives no estimate for Mutation before the sensor has answered, never a file figure", () => {
    const parts = estimateParts(
      scanHistory(MUTATION_RUNS),
      planned({ mutation: 40 }, ["mutation"]),
      [MUTATION],
    );

    expect(parts[0]).toMatchObject({ ms: null, basis: null });
  });

  it("keeps the file figure for a part that does not answer work", () => {
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
    expect(parts[0]?.basis).toBe("5 files, last run's pace");
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

  it("ignores a stopped record", () => {
    const stopped = wrong({ outcome: "stopped" });

    expect(scanHistory([good, stopped]).sense.mutation).toHaveLength(1);
    expect(figure([good, stopped])).toBe(figure([good]));
  });

  it("keeps_an_old_failed_record_with_a_stopped_entry", () => {
    const killed = wrong({
      outcome: "failed",
      sense: [
        {
          name: "mutation",
          duration_ms: 100000,
          fixed_ms: 10000,
          modules: 40,
          work: fns(40),
        },
        { name: "margin", duration_ms: 0, outcome: "stopped" },
      ],
    });

    expect(scanHistory([good, killed]).sense.mutation).toHaveLength(2);
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

  it("ignores an entry with no files", () => {
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
      "Descriptions: <1 min (12 files × 4 s)",
      "C.R.A.P.: 2 min (40 files, last run's pace)",
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

  it("derives the describe rate from wall time over ok entries", () => {
    expect(describeRateMs(scanHistory(files))).toBe(4000);
  });
});

const srcUrl = new URL("../../src/index.ts", import.meta.url).href;

describe("old records", () => {
  it("gives no history from the committed scan-phases-ok example", () => {
    const here = dirname(fileURLToPath(srcUrl));
    const text = readFileSync(
      join(here, "../../../schema/log-examples/valid/scan-phases-ok.json"),
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
          workVerb: null,
        },
      ],
    );

    expect(parts.every((one) => one.ms === null)).toBe(true);
    expect(estimateLine(parts).text).toBe(NO_ESTIMATE_TEXT);
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
