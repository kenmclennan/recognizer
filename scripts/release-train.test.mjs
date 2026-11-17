import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ciVerdict,
  latestTag,
  main,
  plan,
  plannedUnits,
  verifyTrain,
} from "./release-train.mjs";
import { makeTempDir } from "./temp-dirs.mjs";

const UNITS = [
  {
    unit: "scan-python",
    folder: "scanners/python",
    ci_workflow: "scanner-python",
  },
  { unit: "scan-rust", folder: "scanners/rust", ci_workflow: "scanner-rust" },
  { unit: "sensors", folder: "sensors", ci_workflow: "sensors" },
];

function facts({
  tags = {},
  changed = [],
  runs = {},
  history = ["c3", "c2", "c1"],
} = {}) {
  return {
    latestTag: (unit) => tags[unit] ?? null,
    changed: (_tag, folder) => changed.includes(folder),
    firstParent: () => history,
    runsOn: (workflow, commit) => runs[`${workflow}@${commit}`] ?? [],
  };
}

const OK = [{ status: "completed", conclusion: "success" }];
const FAILED = [{ status: "completed", conclusion: "failure" }];
const RUNNING = [{ status: "in_progress", conclusion: null }];

function allGreen(extra = {}) {
  const runs = {};

  for (const workflow of [
    "check",
    "app",
    "schema-compat",
    "scanner-python",
    "scanner-rust",
    "sensors",
  ]) {
    runs[`${workflow}@c3`] = OK;
  }

  return { ...runs, ...extra };
}

describe("latestTag", () => {
  it("picks the highest version of the unit by number, not text", () => {
    expect(
      latestTag("scan-python", [
        "scan-python-v0.1.9",
        "scan-python-v0.1.10",
        "scan-python-v0.1.2",
        "scan-rust-v9.9.9",
      ]),
    ).toBe("scan-python-v0.1.10");
  });

  it("is null when the unit has no tag", () => {
    expect(latestTag("sensors", ["scan-python-v0.1.1", ""])).toBeNull();
  });
});

describe("plannedUnits", () => {
  it("plans every unit when none is tagged", () => {
    expect(plannedUnits(UNITS, facts())).toEqual([
      "scan-python",
      "scan-rust",
      "sensors",
    ]);
  });

  it("plans only the unit whose folder changed", () => {
    const all = {
      tags: {
        "scan-python": "scan-python-v0.1.1",
        "scan-rust": "scan-rust-v0.1.1",
        sensors: "sensors-v0.1.1",
      },
      changed: ["scanners/rust"],
    };

    expect(plannedUnits(UNITS, facts(all))).toEqual(["scan-rust"]);
  });

  it("plans a tagged unit that did not change by nothing, and an untagged one anyway", () => {
    const some = { tags: { "scan-python": "scan-python-v0.1.1" } };

    expect(plannedUnits(UNITS, facts(some))).toEqual(["scan-rust", "sensors"]);
  });
});

describe("ciVerdict", () => {
  it("is green when the run on the commit succeeded", () => {
    expect(
      ciVerdict("check", "c3", facts({ runs: { "check@c3": OK } })).ok,
    ).toBe(true);
  });

  it("is green when there is no run and the nearest earlier run succeeded", () => {
    const verdict = ciVerdict(
      "check",
      "c3",
      facts({ runs: { "check@c1": OK } }),
    );

    expect(verdict.ok).toBe(true);
  });

  it("uses the commit itself when it is the nearest run", () => {
    expect(
      ciVerdict(
        "check",
        "c3",
        facts({ runs: { "check@c3": OK, "check@c2": FAILED } }),
      ).ok,
    ).toBe(true);
  });

  it("fails for a running run", () => {
    const verdict = ciVerdict(
      "check",
      "c3",
      facts({ runs: { "check@c3": RUNNING } }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("still running");
  });

  it("fails for a failed run", () => {
    const verdict = ciVerdict(
      "check",
      "c3",
      facts({ runs: { "check@c3": FAILED } }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("did not succeed");
  });

  it("fails for a missing run whose earlier run failed", () => {
    const verdict = ciVerdict(
      "check",
      "c3",
      facts({ runs: { "check@c2": FAILED, "check@c1": OK } }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("c2");
  });

  it("fails when no run exists anywhere in the history", () => {
    expect(ciVerdict("check", "c3", facts()).ok).toBe(false);
  });
});

describe("plan", () => {
  it("passes with the units listed when every required workflow is green", () => {
    const result = plan(UNITS, "c3", facts({ runs: allGreen() }));

    expect(result.failures).toEqual([]);
    expect(result.units).toHaveLength(3);
  });

  it("fails naming schema-compat when it failed", () => {
    const result = plan(
      UNITS,
      "c3",
      facts({ runs: allGreen({ "schema-compat@c3": FAILED }) }),
    );

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("schema-compat");
  });

  it("does not require the CI workflow of a unit that is not releasing", () => {
    const tags = {
      "scan-python": "scan-python-v0.1.1",
      "scan-rust": "scan-rust-v0.1.1",
      sensors: "sensors-v0.1.1",
    };
    const runs = allGreen({ "sensors@c3": FAILED });
    const result = plan(
      UNITS,
      "c3",
      facts({ tags, changed: ["scanners/rust"], runs }),
    );

    expect(result.units).toEqual(["scan-rust"]);
    expect(result.failures).toEqual([]);
  });

  it("requires the CI workflow of a releasing unit", () => {
    const result = plan(
      UNITS,
      "c3",
      facts({ runs: allGreen({ "scanner-rust@c3": FAILED }) }),
    );

    expect(result.failures.some((line) => line.includes("scanner-rust"))).toBe(
      true,
    );
  });
});

describe("verifyTrain", () => {
  it("fails when a built scanner declares 8 and the app reads 7", () => {
    const failures = verifyTrain(7, [
      { unit: "scan-python", scan_schema_version: 7 },
      { unit: "scan-rust", scan_schema_version: 8 },
    ]);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scan-rust");
    expect(failures[0]).toContain("8");
  });

  it("passes when every scanner equals the app", () => {
    expect(
      verifyTrain(7, [
        { unit: "scan-python", scan_schema_version: 7 },
        { unit: "sensors", scan_schema_version: null },
      ]),
    ).toEqual([]);
  });

  it("fails a scanner that declares nothing", () => {
    expect(
      verifyTrain(7, [{ unit: "scan-kotlin", scan_schema_version: null }]),
    ).toHaveLength(1);
  });
});

describe("main verify", () => {
  function built(entries) {
    const root = makeTempDir("release-train-");

    for (const entry of entries) {
      mkdirSync(join(root, `plugin-${entry.unit}`));
      writeFileSync(
        join(root, `plugin-${entry.unit}`, "meta.json"),
        JSON.stringify(entry),
      );
    }

    return root;
  }

  it("exits 1 on a mismatch and 0 when equal", () => {
    const bad = built([{ unit: "scan-rust", scan_schema_version: 8 }]);
    const good = built([{ unit: "scan-rust", scan_schema_version: 7 }]);

    expect(main(["verify", "7", bad], ".")).toBe(1);
    expect(main(["verify", "7", good], ".")).toBe(0);
  });

  it("exits 2 on an unknown mode", () => {
    expect(main(["nope"], ".")).toBe(2);
  });
});
