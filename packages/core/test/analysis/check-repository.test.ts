import { describe, expect, it } from "vitest";
import {
  checkRepository,
  DEFAULT_STRUCTURE_SETTINGS,
  Finding,
  measuredInputs,
  type SensorFindings,
  Warning,
} from "../../src/index.js";
import { repositoryInLanguages } from "../fakes/files-in-languages.js";
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

    fakes.config.sensors.push("crap", "mutation");
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

  it("keeps hidden violation keys and sensor statuses from gathered files", () => {
    const { fakes, say, said } = worldOf();
    const hidden = Finding.stored({
      id: "crap-violation:a/x.py",
      kind: "crap",
      severity: "violation",
      principle: "p",
      summary: "s",
      files: ["a/x.py"],
    });
    const base = {
      commit: "c0ffee",
      modified: false,
      settings: {},
    };

    fakes.config.sensors.push("crap", "mutation");
    fakes.baseline.baselines.set(BASELINE, [{ id: "crap-violation:a/x.py" }]);
    fakes.findings.stored.set("crap", {
      name: "crap",
      status: "read",
      document: {
        ...base,
        sensor: { name: "crap", version: "1" },
        findings: [hidden],
        inputs: { "a/x.py": "other" },
      },
    });
    fakes.findings.stored.set("mutation", {
      name: "mutation",
      status: "read",
      document: {
        ...base,
        sensor: { name: "mutation", version: "1" },
        findings: [],
      },
    });

    const report = checkRepository(
      checkPortsOf(fakes),
      say,
      requestOf(),
      breaching("c0ffee"),
    );

    expect(hidden.id).toBe("crap-violation:a/x.py");
    expect(report.ranked).not.toBeNull();
    expect(report.ranked?.fixed).toEqual([]);
    expect(report.sensors).toContainEqual({
      name: "crap",
      status: "ran",
      out_of_date: 1,
    });
    expect(report.sensors).toContainEqual({
      name: "mutation",
      status: "stale",
    });
    expect(said).toContain("out of date crap: 1 findings\n");
    expect(said).toContain("stale mutation\n");
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
    fakes.config.sensors.push("crap");
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

describe("checkRepository unknown files", () => {
  const scan = () =>
    repositoryInLanguages({
      "a/x.swift": "swift",
      "a/y.swift": "swift",
      "b/z.zig": "zig",
      "b/ok.py": "python",
    });

  const run = (
    over: Parameters<typeof requestOf>[0] = {},
    settings:
      | "off"
      | typeof DEFAULT_STRUCTURE_SETTINGS = DEFAULT_STRUCTURE_SETTINGS,
    repository = scan(),
  ) => {
    const { fakes, say } = worldOf();

    fakes.config.settings = settings;

    return checkRepository(
      checkPortsOf(fakes),
      say,
      requestOf(over),
      repository,
    );
  };

  it("reports files of an unpublished language", () => {
    expect(run().unknownFiles).toEqual({
      languages: ["swift", "zig"],
      files: ["a/x.swift", "a/y.swift", "b/z.zig"],
    });
  });

  it("narrows unknown files to the named files", () => {
    expect(run({ named: ["a/x.swift", "b/ok.py"] }).unknownFiles).toEqual({
      languages: ["swift"],
      files: ["a/x.swift"],
    });
    expect(run({ named: ["b/ok.py"] }).unknownFiles).toBeNull();
  });

  it("reports none when structure is off", () => {
    expect(run({}, "off").unknownFiles).toBeNull();
  });

  it("reports none when every language is published", () => {
    expect(
      run(
        {},
        DEFAULT_STRUCTURE_SETTINGS,
        repositoryInLanguages({ "b/ok.py": "python" }),
      ).unknownFiles,
    ).toBeNull();
  });

  it("exits as it does for the same scan with the language published", () => {
    const unpublished = run(
      {},
      DEFAULT_STRUCTURE_SETTINGS,
      repositoryInLanguages({ "a/x.swift": "swift" }),
    );
    const published = run(
      {},
      DEFAULT_STRUCTURE_SETTINGS,
      repositoryInLanguages({ "a/x.py": "python" }),
    );

    expect(unpublished.unknownFiles).not.toBeNull();
    expect(unpublished.exit).toBe(published.exit);
  });
});

describe("checkRepository sensors with no manifest", () => {
  const SENSE = ["recognizer", "sense", ""].join("-");

  function withSensor(options: { manifest: boolean; suites: boolean }) {
    const { fakes, say, said } = worldOf();
    const document: SensorFindings = {
      sensor: { name: "mine", version: "1" },
      commit: "c0ffee",
      modified: false,
      settings: {},
      findings: [],
      inputs: measuredInputs(breaching("c0ffee")),
    };

    fakes.sensors.installed.set("mine", {
      name: "mine",
      runsTests: true,
      held: false,
      ...(options.manifest ? {} : { withoutManifest: true }),
    });
    fakes.config.sensors.push("mine");

    if (options.suites) {
      fakes.sensors.suites.push("unit");
    }

    fakes.findings.stored.set("mine", {
      name: "mine",
      status: "read",
      document,
    });

    const report = checkRepository(
      checkPortsOf(fakes),
      say,
      requestOf(),
      breaching("c0ffee"),
    );
    const status = report.sensors.find((one) => one.name === "mine");

    return { report, status, said };
  }

  it("marks a ran sensor with no manifest and configured suites as partial", () => {
    const { report, status, said } = withSensor({
      manifest: false,
      suites: true,
    });

    expect(status).toMatchObject({
      name: "mine",
      status: "partial",
      not_measured: ["suites"],
      reason: "not measured mine: the configured suites were not handed to it",
    });
    expect(said.some((line) => line.startsWith("mine declares nothing"))).toBe(
      true,
    );
    expect(report.exit).toBe(0);
  });

  it("says the notice but keeps the status when no suites are configured", () => {
    const { status, said } = withSensor({ manifest: false, suites: false });

    expect(status?.status).toBe("ran");
    expect(said.some((line) => line.startsWith("mine declares nothing"))).toBe(
      true,
    );
  });

  it("stays ran and silent for a sensor with a manifest", () => {
    const { status, said } = withSensor({ manifest: true, suites: true });

    expect(status?.status).toBe("ran");
    expect(said.some((line) => line.includes("declares nothing"))).toBe(false);
    expect(SENSE.length).toBeGreaterThan(0);
  });

  it("leaves a missing sensor missing", () => {
    const { fakes, say } = worldOf();

    fakes.sensors.installed.set("mine", {
      name: "mine",
      runsTests: true,
      held: false,
      withoutManifest: true,
    });
    fakes.config.sensors.push("mine");
    fakes.sensors.suites.push("unit");

    const report = checkRepository(
      checkPortsOf(fakes),
      say,
      requestOf(),
      breaching("c0ffee"),
    );

    expect(report.sensors.find((one) => one.name === "mine")?.status).toBe(
      "missing",
    );
  });
});
