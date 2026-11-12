import { describe, expect, it } from "vitest";
import { InputError } from "../src/errors.js";
import {
  type ExtractionState,
  entryLine,
  extractionNeeded,
  idlePhases,
  nothingRanText,
  parseScanArgs,
  parseSuiteSelection,
  phaseLine,
  selectSensors,
  summaryLine,
} from "../src/scan-phases.js";

const CURRENT = { commit: "abc", modified: false, scannerVersion: "1.0.0" };

function state(changes: Partial<ExtractionState> = {}): ExtractionState {
  return {
    force: false,
    commit: "abc",
    dirty: false,
    languages: [
      { language: "python", cachedScan: CURRENT, installedVersion: "1.0.0" },
    ],
    ...changes,
  };
}

describe("extractionNeeded", () => {
  it("skips extraction when every condition holds, naming the commit", () => {
    expect(extractionNeeded(state())).toEqual({ run: false, commit: "abc" });
  });

  it("runs when forced", () => {
    expect(extractionNeeded(state({ force: true }))).toEqual({
      run: true,
      reason: "forced",
    });
  });

  it("runs when there is no commit", () => {
    expect(extractionNeeded(state({ commit: null }))).toEqual({
      run: true,
      reason: "no-commit",
    });
  });

  it("runs when a detected language has no cached scan", () => {
    expect(
      extractionNeeded(
        state({
          languages: [
            {
              language: "python",
              cachedScan: CURRENT,
              installedVersion: "1.0.0",
            },
            { language: "rust", cachedScan: null, installedVersion: "1.0.0" },
          ],
        }),
      ),
    ).toEqual({ run: true, reason: "no-scan:rust" });
  });

  it("runs when the cached commit differs", () => {
    expect(
      extractionNeeded(
        state({
          languages: [
            {
              language: "python",
              cachedScan: { ...CURRENT, commit: "old" },
              installedVersion: "1.0.0",
            },
          ],
        }),
      ),
    ).toEqual({ run: true, reason: "commit-changed" });
  });

  it("runs when the cached scan was taken on a dirty tree", () => {
    expect(
      extractionNeeded(
        state({
          languages: [
            {
              language: "python",
              cachedScan: { ...CURRENT, modified: true },
              installedVersion: "1.0.0",
            },
          ],
        }),
      ),
    ).toEqual({ run: true, reason: "dirty" });
  });

  it("runs when the tree is dirty now", () => {
    expect(extractionNeeded(state({ dirty: true }))).toEqual({
      run: true,
      reason: "dirty",
    });
  });

  it("runs when the scanner version differs", () => {
    expect(
      extractionNeeded(
        state({
          languages: [
            {
              language: "python",
              cachedScan: CURRENT,
              installedVersion: "2.0.0",
            },
          ],
        }),
      ),
    ).toEqual({ run: true, reason: "scanner-version:python" });
  });

  it("runs when the installed version is unavailable", () => {
    expect(
      extractionNeeded(
        state({
          languages: [
            { language: "python", cachedScan: CURRENT, installedVersion: null },
          ],
        }),
      ),
    ).toEqual({ run: true, reason: "scanner-unavailable:python" });
  });

  it("names the language whose version differs when another is current", () => {
    expect(
      extractionNeeded(
        state({
          languages: [
            {
              language: "python",
              cachedScan: CURRENT,
              installedVersion: "1.0.0",
            },
            {
              language: "rust",
              cachedScan: CURRENT,
              installedVersion: "9.9.9",
            },
          ],
        }),
      ),
    ).toEqual({ run: true, reason: "scanner-version:rust" });
  });

  it("runs when no language is detected", () => {
    expect(extractionNeeded(state({ languages: [] }))).toEqual({
      run: true,
      reason: "no-languages",
    });
  });
});

describe("parseScanArgs", () => {
  it("takes no phase flag by default", () => {
    expect(parseScanArgs([])).toEqual({
      positionals: [],
      extract: false,
      describe: false,
      sense: null,
      json: false,
      by: undefined,
    });
  });

  it("reads --describe alone and --describe=all", () => {
    expect(parseScanArgs(["--describe"]).describe).toBe("stale");
    expect(parseScanArgs(["--describe=all"]).describe).toBe("all");
  });

  it("leaves a word after --describe as the repository", () => {
    const options = parseScanArgs(["--describe", "all"]);

    expect(options.describe).toBe("stale");
    expect(options.positionals).toEqual(["all"]);
    expect(() => parseScanArgs(["--describe", "all", "x"])).toThrow(InputError);
  });

  it("refuses any other --describe value", () => {
    expect(() => parseScanArgs(["--describe=some"])).toThrow(InputError);
  });

  it("reads --sense all and a comma list, dropping repeats", () => {
    expect(parseScanArgs(["--sense", "all"]).sense).toBe("all");
    expect(parseScanArgs(["--sense", "a,b"]).sense).toEqual(["a", "b"]);
    expect(parseScanArgs(["--sense", "a,a"]).sense).toEqual(["a"]);
  });

  it("refuses --sense with no value and an empty name", () => {
    expect(() => parseScanArgs(["--sense"])).toThrow(InputError);
    expect(() => parseScanArgs(["--sense", "--json"])).toThrow(InputError);
    expect(() => parseScanArgs(["--sense", "a,"])).toThrow(InputError);
  });

  it("refuses --measure as an unknown option", () => {
    expect(() => parseScanArgs(["--measure", "all"])).toThrow(
      /unknown option: --measure/,
    );
  });

  it("reads --extract, --json, --by and one repository", () => {
    expect(
      parseScanArgs(["repo", "--extract", "--json", "--by", "ken"]),
    ).toMatchObject({
      positionals: ["repo"],
      extract: true,
      json: true,
      by: "ken",
    });
  });

  it("refuses an unknown flag", () => {
    expect(() => parseScanArgs(["--bogus"])).toThrow(InputError);
  });
});

describe("selectSensors", () => {
  const registered = [
    { name: "a", command: ["run-a"] },
    { name: "b", command: ["run-b"] },
  ];

  it("selects in config order", () => {
    expect(selectSensors(registered, ["b", "a"])).toEqual(registered);
    expect(selectSensors(registered, "all")).toEqual(registered);
  });

  it("names the unknown sensor, the registered ones and the shipped ones, selecting none", () => {
    expect(() =>
      selectSensors(registered, ["a", "nope", "b"], ["crap"]),
    ).toThrow(
      /no such sensor: nope[\s\S]*registered sensors: a, b[\s\S]*shipped sensors: crap/,
    );
  });

  it("accepts a shipped name that is not registered and runs it with no settings", () => {
    const selected = selectSensors(registered, ["crap", "a"], ["crap"]);

    expect(selected.map(({ name }) => name)).toEqual(["a", "crap"]);
    expect(selected[1]?.command[0]).toBe("recognizer-sensors");
    expect(selected[1]?.command[1]).toBe("crap");
    expect(selected[1]?.command.at(-1)).toBe("{}");
  });

  it("does not list a shipped name as unknown when another name is", () => {
    let message = "";

    try {
      selectSensors(registered, ["crap", "nope"], ["crap"]);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("no such sensor: nope");
    expect(message).not.toContain("no such sensor: crap");
  });

  it("makes all mean the registered sensors only", () => {
    expect(selectSensors(registered, "all", ["crap", "mutation"])).toEqual(
      registered,
    );
  });

  it("refuses all when no sensor is registered", () => {
    expect(() => selectSensors([], "all", ["crap"])).toThrow(
      "no sensors are registered: name one, or add it to .recognizer/config.yaml",
    );
  });
});

describe("event lines", () => {
  it("builds the extract phase line for a run and for current scans", () => {
    expect(
      JSON.parse(
        phaseLine("extract", { state: "run", commit: "abc", reason: "forced" }),
      ),
    ).toEqual({
      event: "phase",
      phase: "extract",
      state: "run",
      commit: "abc",
      reason: "forced",
    });
    expect(
      JSON.parse(phaseLine("extract", { state: "current", commit: "abc" })),
    ).toEqual({
      event: "phase",
      phase: "extract",
      state: "current",
      commit: "abc",
    });
  });

  it("builds the phase line for describe and sense with a total", () => {
    expect(JSON.parse(phaseLine("sense", { total: 2 }))).toEqual({
      event: "phase",
      phase: "sense",
      total: 2,
    });
  });

  it("builds the entry line, one per line", () => {
    const line = entryLine("describe", {
      name: "orders",
      outcome: "failed",
      reason: "boom",
    });

    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({
      event: "entry",
      phase: "describe",
      name: "orders",
      outcome: "failed",
      reason: "boom",
    });
  });

  it("builds the summary line", () => {
    expect(
      JSON.parse(
        summaryLine({
          repository: "/r",
          commit: null,
          modified: null,
          exit: 1,
          phases: [
            { phase: "extract", entries: [{ name: "python", outcome: "ok" }] },
          ],
          removed: [],
          log: "20261102T123456789Z-scan",
        }),
      ),
    ).toEqual({
      event: "summary",
      repository: "/r",
      commit: null,
      modified: null,
      exit: 1,
      phases: [
        { phase: "extract", entries: [{ name: "python", outcome: "ok" }] },
      ],
      removed: [],
      log: "20261102T123456789Z-scan",
    });
  });
});

describe("idlePhases and nothingRanText", () => {
  const asked = (changes: object) => ({
    describe: true,
    sensors: ["crap"],
    ran: null,
    commit: null,
    ...changes,
  });

  it.each([
    [
      "every requested phase ran",
      asked({ ran: ["extract", "describe", "sense"], commit: "abc" }),
      [],
      "",
    ],
    [
      "sense did not run with no commit",
      asked({ ran: ["extract", "describe"] }),
      [{ phase: "sense", cause: "no-commit" }],
      "sense did not run: the folder has no commit",
    ],
    [
      "describe and sense did not run with no commit",
      asked({ ran: ["extract"] }),
      [
        { phase: "describe", cause: "no-entries" },
        { phase: "sense", cause: "no-commit" },
      ],
      "describe did not run: it ran no entries; sense did not run: the folder has no commit",
    ],
    [
      "nothing was requested",
      asked({ describe: false, sensors: [], ran: ["extract"], commit: "abc" }),
      [],
      "",
    ],
    ["no summary was written", asked({}), [], ""],
    [
      "sense found a commit and still ran no entries",
      asked({ ran: ["extract", "describe"], commit: "abc" }),
      [{ phase: "sense", cause: "no-entries" }],
      "sense did not run: it ran no entries",
    ],
  ] as const)("%s", (_name, record, idle, text) => {
    expect(idlePhases(record as never)).toEqual(idle);
    expect(nothingRanText([...idle] as never)).toBe(text);
  });

  it("asks for describe and sense in the record whose summary is missing", () => {
    const record = asked({});

    expect(record.describe).toBe(true);
    expect(record.sensors.length).toBeGreaterThan(0);
    expect(record.ran).toBeNull();
  });
});

describe("parseScanArgs --suites", () => {
  it("reads the file, separate or inline", () => {
    expect(
      parseScanArgs(["--sense", "crap", "--suites", "s.json"]).suites,
    ).toBe("s.json");
    expect(parseScanArgs(["--sense", "crap", "--suites=s.json"]).suites).toBe(
      "s.json",
    );
  });

  it("needs a file and needs --sense or --describe", () => {
    expect(() => parseScanArgs(["--sense", "crap", "--suites"])).toThrow(
      /--suites needs a file/,
    );
    expect(() => parseScanArgs(["--suites", "s.json"])).toThrow(
      /--suites needs --describe or --sense/,
    );
  });
});

describe("parseSuiteSelection", () => {
  const configured = ["unit", "web"];
  const sensors = [
    { name: "crap", runsTests: true },
    { name: "mutation", runsTests: true },
    { name: "duplication", runsTests: false },
  ];

  it("parses per-sensor arrays and deduplicates", () => {
    expect(
      parseSuiteSelection(
        '{"crap":["unit","unit"],"mutation":["unit","web"]}',
        configured,
        sensors,
      ),
    ).toEqual({ crap: ["unit"], mutation: ["unit", "web"] });
  });

  it.each([
    ["malformed", "{", /not valid JSON/],
    ["not an object", "[]", /must be a JSON object/],
    ["an unselected sensor", '{"other":["unit"]}', /not selected/],
    [
      "a sensor that runs no tests",
      '{"duplication":["unit"]}',
      /runs no tests/,
    ],
    ["an empty array", '{"crap":[]}', /at least one suite/],
    ["an unknown suite", '{"crap":["nope"]}', /no such suite: nope/],
    ["a non-array", '{"crap":"unit"}', /array of non-empty suite names/],
  ])("refuses %s with an InputError", (_, text, message) => {
    expect(() => parseSuiteSelection(text, configured, sensors)).toThrow(
      InputError,
    );
    expect(() => parseSuiteSelection(text, configured, sensors)).toThrow(
      message,
    );
  });
});
