import { describe, expect, it } from "vitest";
import {
  checkRepository,
  DEFAULT_STRUCTURE_SETTINGS,
  Finding,
  measuredInputs,
  type SensorFindings,
  Warning,
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

describe("checkRepository warnings", () => {
  function withWarnings() {
    const { fakes, say } = worldOf();
    const crap: SensorFindings = {
      sensor: { name: "crap", version: "1" },
      commit: "c0ffee",
      modified: false,
      settings: {},
      findings: [
        Finding.stored({
          id: "coverage:a/x.py",
          kind: "coverage",
          severity: "warning",
          principle: "p",
          summary: "s",
          files: ["a/x.py"],
        }),
      ],
      inputs: measuredInputs(breaching("c0ffee")),
    };

    fakes.config.settings = DEFAULT_STRUCTURE_SETTINGS;
    fakes.analysis.shipped.push("crap");
    fakes.findings.stored.set("crap", {
      name: "crap",
      status: "read",
      document: crap,
    });

    return { fakes, say };
  }

  it("reports a structure warning as a Warning entity", () => {
    const { fakes, say } = withWarnings();

    const save = fakes.findings.save.bind(fakes.findings);

    fakes.findings.save = (root, document) =>
      save(
        root,
        document.sensor.name === "structure"
          ? {
              ...document,
              findings: [
                ...document.findings,
                Finding.stored({
                  id: "crap:a/x.py",
                  kind: "crap",
                  severity: "warning",
                  principle: "p",
                  summary: "not a structure warning",
                  files: ["a/x.py"],
                }),
              ],
            }
          : document,
      );

    const report = checkRepository(
      checkPortsOf(fakes),
      say,
      requestOf(),
      breaching("c0ffee"),
    );
    const orphan = report.warnings.find(
      (one) => one.value instanceof Warning && one.value.kind === "orphan",
    );
    const coverage = report.warnings.find(
      (one) => one.type === "finding" && one.value.kind === "coverage",
    );
    const crapKind = report.warnings.find(
      (one) => one.type === "finding" && one.value.kind === "crap",
    );

    expect(report.warnings.length).toBeGreaterThan(0);
    expect(orphan?.type).toBe("warning");
    expect(orphan?.value).toBeInstanceOf(Warning);
    expect(coverage?.type).toBe("finding");
    expect(crapKind?.type).toBe("finding");
  });

  it("narrows warnings to the named files", () => {
    const run = (named: string[]) => {
      const { fakes, say } = withWarnings();

      return checkRepository(
        checkPortsOf(fakes),
        say,
        requestOf({ named }),
        breaching("c0ffee"),
      ).warnings.filter(
        (one) => one.type === "warning" && one.value.kind === "orphan",
      );
    };

    expect(run(["a/x.py"]).map((one) => one.value.files)).toEqual([["a/x.py"]]);
    expect(run(["b/y.py"])).toEqual([]);
  });
});
