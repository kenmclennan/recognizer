import { describe, expect, it } from "vitest";
import {
  checkRepository,
  DEFAULT_STRUCTURE_SETTINGS,
  Finding,
  type SensorFindings,
} from "../../src/index.js";
import {
  BASELINE,
  breaching,
  checkPortsOf,
  requestOf,
  worldOf,
} from "./analysis-world.js";

describe("checkRepository", () => {
  it("reports a new violation and exits 1", () => {
    const { fakes, say } = worldOf();
    fakes.config.settings = DEFAULT_STRUCTURE_SETTINGS;

    const report = checkRepository(
      checkPortsOf(fakes),
      say,
      requestOf(),
      breaching(),
    );

    expect(report.ranked?.violations).toHaveLength(1);
    expect(report.ranked?.new).toHaveLength(1);
    expect(report.exit).toBe(1);
  });

  it("a baselined violation is not new", () => {
    const { fakes, say } = worldOf();

    fakes.config.settings = DEFAULT_STRUCTURE_SETTINGS;
    fakes.baseline.baselines.set(BASELINE, [
      { from: "a/x.py", to: "b/y.py", kind: "depends" },
    ]);

    const report = checkRepository(
      checkPortsOf(fakes),
      say,
      requestOf(),
      breaching(),
    );

    expect(report.ranked?.violations).toHaveLength(1);
    expect(report.ranked?.new).toHaveLength(0);
    expect(report.exit).toBe(0);
  });

  it("a baseline entry with no matching violation is fixed", () => {
    const { fakes, say } = worldOf();
    const gone = { from: "a/gone.py", to: "b/y.py", kind: "depends" };

    fakes.config.settings = DEFAULT_STRUCTURE_SETTINGS;
    fakes.baseline.baselines.set(BASELINE, [
      { from: "a/x.py", to: "b/y.py", kind: "depends" },
      gone,
    ]);

    const report = checkRepository(
      checkPortsOf(fakes),
      say,
      requestOf(),
      breaching(),
    );

    expect(report.ranked?.violations).toHaveLength(1);
    expect(report.ranked?.fixed).toEqual([gone]);
  });

  it("stale and failed sensors refuse --init-baseline", () => {
    const { fakes, say } = worldOf();
    const stale: SensorFindings = {
      sensor: { name: "crap", version: "1" },
      commit: "c0ffee",
      modified: false,
      settings: {},
      findings: [
        Finding.stored({
          id: "x",
          kind: "crap",
          severity: "warning",
          principle: "p",
          summary: "s",
          files: ["a/x.py"],
        }),
      ],
      inputs: { "a/x.py": "other" },
    };

    fakes.analysis.shipped.push("crap", "mutation");
    fakes.findings.stored.set("crap", {
      name: "crap",
      status: "read",
      document: stale,
    });
    fakes.findings.stored.set("mutation", {
      name: "mutation",
      status: "invalid",
      reason: "not JSON",
    });

    expect(() =>
      checkRepository(
        checkPortsOf(fakes),
        say,
        requestOf({
          flags: { baseline: undefined, update: false, init: true },
        }),
        breaching("c0ffee"),
      ),
    ).toThrow(
      "--init-baseline refused: crap has out of date results\n--init-baseline refused: mutation has invalid results\nrerun them with recognizer scan --sense crap,mutation, then run --init-baseline again",
    );
    expect(fakes.baseline.baselines.size).toBe(0);
  });

  it("notices go to say in order", () => {
    const { fakes, say, said } = worldOf();

    fakes.config.settings = DEFAULT_STRUCTURE_SETTINGS;

    checkRepository(checkPortsOf(fakes), say, requestOf(), breaching());

    expect(said).toEqual([
      "duplication not measured since the last scan: run recognizer scan\n",
      "complexity not measured since the last scan: run recognizer scan\n",
    ]);
  });
});
