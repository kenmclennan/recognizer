import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseScanArgs } from "recognizer";
import { describe, expect, it } from "vitest";
import type { FreshnessModel } from "./freshness-model";
import { OPEN_RUN, planFor, suitesForSense } from "./scan-freshness";
import type { ScanPlan, ScanTicks } from "./scan-panel-model";

const FOLDER = "/work/repo";
const SUITES_FILE = "/work/repo/.recognizer/cache/scan-suites-w-1.json";

function argsFor(plan: ScanPlan): string[] {
  const args = ["scan", FOLDER, "--json"];

  if (plan.describe) {
    args.push(plan.describeAll ? "--describe=all" : "--describe");
  }

  if (plan.sense.length > 0) {
    args.push("--sense", plan.sense.join(","));
  }

  if (plan.suites !== undefined) {
    args.push("--suites", SUITES_FILE);
  }

  return args.slice(2);
}

const MODEL = {
  rows: [],
  gaps: new Map<string, string[]>(),
  update: [],
  action: { primary: { label: "Up to date" } },
} as unknown as FreshnessModel;

const ROWS = [
  { name: "structure", runsTests: false },
  { name: "crap", runsTests: true },
];

function ticksOf(overrides: Partial<ScanTicks>): ScanTicks {
  return {
    describe: false,
    ticked: [],
    once: [],
    onlyView: false,
    suites: {},
    folds: [],
    ...overrides,
  };
}

describe("the arguments the app hands the scan command", () => {
  it("parse for the run made when a folder opens", () => {
    expect(() => parseScanArgs(argsFor(OPEN_RUN.plan))).not.toThrow();
  });

  it("parse for a planned run with no tests-running sensor due", () => {
    const planned = planFor(
      MODEL,
      "rescan",
      ticksOf({ ticked: ["structure"] }),
      ROWS,
      null,
      [],
    );

    expect(planned.plan.suites).toBeUndefined();
    expect(() => parseScanArgs(argsFor(planned.plan))).not.toThrow();
  });

  it("parse for a planned run with C.R.A.P. and its suites", () => {
    const planned = planFor(
      MODEL,
      "rescan",
      ticksOf({
        once: ["crap"],
        suites: { crap: { ticked: ["unit"], known: ["unit"] } },
      }),
      [
        { name: "structure", runsTests: false },
        {
          name: "crap",
          runsTests: true,
          suites: [{ name: "unit", language: "python" }],
        },
      ],
      null,
      [],
    );
    const options = parseScanArgs(argsFor(planned.plan));

    expect(planned.plan.suites).toEqual({ crap: ["unit"] });
    expect(options.suites).toBe(SUITES_FILE);
    expect(options.sense).toEqual(["crap"]);
  });

  it("send no suites when none of the sensed sensors has any", () => {
    expect(suitesForSense([], { crap: ["unit"] })).toBeUndefined();
    expect(suitesForSense(["crap"], { crap: [] })).toBeUndefined();
    expect(suitesForSense(["crap"], {})).toBeUndefined();
    expect(suitesForSense(["structure"], { crap: ["unit"] })).toBeUndefined();
  });
});

describe("the arguments the app hands a historical scan", () => {
  const fixture = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../fixtures/views/historical-scan-args.json",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  ) as { historical: string[]; open_folder: string[] };

  it("parse with the retired-config flag and no describe or sense", () => {
    const options = parseScanArgs(fixture.historical.slice(1));

    expect(options.ignoreRetiredConfig).toBe(true);
    expect(options.describe).toBe(false);
    expect(options.sense).toBeNull();
  });

  it("are not what the open folder is scanned with", () => {
    const options = parseScanArgs(fixture.open_folder.slice(1));

    expect(options.ignoreRetiredConfig).toBe(false);
  });
});
