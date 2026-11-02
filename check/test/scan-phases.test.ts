import { describe, expect, it } from "vitest";
import { InputError } from "../src/errors.js";
import {
  type ExtractionState,
  entryLine,
  extractionNeeded,
  parseScanArgs,
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
  const registered = [{ name: "a" }, { name: "b" }];

  it("selects in config order", () => {
    expect(selectSensors(registered, ["b", "a"])).toEqual(registered);
    expect(selectSensors(registered, "all")).toEqual(registered);
  });

  it("names the unknown sensor and the registered ones, selecting none", () => {
    expect(() => selectSensors(registered, ["a", "nope", "b"])).toThrow(
      /no such sensor: nope[\s\S]*registered sensors: a, b/,
    );
  });

  it("refuses when no sensor is registered", () => {
    expect(() => selectSensors([], "all")).toThrow(/no sensors are registered/);
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
    });
  });
});
