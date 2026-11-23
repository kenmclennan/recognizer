import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "../../app");
const source = join(app, "src");

const PLANNING = [
  "planFor",
  "tickedPhases",
  "suitesForSense",
  "sensorFreshness",
  "staleModules",
  "gapOf",
  "modulesWithFunctions",
  "freshnessScope",
  "suitePlan",
  "suiteIsTicked",
  "tickedSuites",
  "sensorTickState",
  "afterSensorTick",
  "afterSuiteTick",
  "afterPanelOpen",
  "afterFoldToggle",
  "visibleSuiteTicks",
  "sensorArmed",
  "onlyArmed",
  "workOf",
  "describeGap",
  "phasesFor",
];

const DEFINITION = new RegExp(
  `(function|const)\\s+(${PLANNING.join("|")})\\s*[(=<]`,
);

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    return entry.isDirectory()
      ? filesUnder(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

describe("the app holds no planning logic", () => {
  it("the_planning_functions_are_gone_from_the_app", () => {
    const files = filesUnder(source);

    expect(files.length).toBeGreaterThan(0);

    const found = files.filter((file) =>
      DEFINITION.test(readFileSync(file, "utf8")),
    );

    expect(found).toEqual([]);
  });

  it("the_count_of_app_files_importing_recognizer_has_not_grown", () => {
    const listed = execFileSync(
      "git",
      ["grep", "-l", "-E", 'from "recognizer"', "--", "."],
      { cwd: app, encoding: "utf8" },
    )
      .split("\n")
      .filter((line) => line !== "");

    expect(listed.length).toBeGreaterThan(0);
    expect(listed.length).toBeLessThanOrEqual(57);
  });
});
