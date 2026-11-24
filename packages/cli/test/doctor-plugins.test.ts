import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { DoctorReport } from "@recognizer/core";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import {
  ioWithPath,
  manifestFor,
  tempDirectory,
  writeShim,
} from "./plugin-path.js";

const DISPLAYS: Record<string, string> = {
  python: "Python",
  kotlin: "Kotlin",
};

const RULES = (name: string, extension: string) => ({
  languages: [
    {
      name,
      display: DISPLAYS[name] ?? name,
      extensions: [extension],
      files: [],
      skip: {
        directory_names: [],
        directory_prefixes: [],
        directory_suffixes: [],
        directory_markers: [],
        file_globs: [],
      },
    },
  ],
});

interface Setup {
  bin: string;
  repo: string;
}

function setup(config?: string, files: Record<string, string> = {}): Setup {
  const bin = tempDirectory("recognizer-doctor-bin-");
  const repo = tempDirectory("recognizer-doctor-repo-");

  if (config !== undefined) {
    mkdirSync(join(repo, ".recognizer"), { recursive: true });
    writeFileSync(join(repo, ".recognizer", "config.yaml"), config);
  }

  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(repo, name), content);
  }

  return { bin, repo };
}

async function doctor(
  { bin, repo }: Setup,
  record?: { commands: string[] },
): Promise<{ report: DoctorReport; code: number; text: string }> {
  let out = "";
  const base = ioWithPath([bin]);
  const io = {
    ...base,
    run: (
      command: string,
      args: string[],
      options?: Parameters<typeof base.run>[2],
    ) => {
      record?.commands.push(`${command} ${args[0] ?? ""}`);

      return base.run(command, args, options);
    },
    stdout: (text: string) => {
      out += text;
    },
  };
  const code = await run(["doctor", repo, "--json"], io);
  const report = JSON.parse(out) as DoctorReport;

  return { report, code, text: out };
}

function problemsOf(report: DoctorReport, area: string) {
  return report.areas.find((one) => one.name === area)?.problems ?? [];
}

describe("doctor: scanners from manifests", () => {
  it("reports one scanner-missing problem named scanners when no scanner is installed", async () => {
    const fixture = setup(undefined, { "a.py": "" });
    const { report, code } = await doctor(fixture);

    expect(code).toBe(1);
    expect(problemsOf(report, "scanners")).toEqual([
      expect.objectContaining({
        code: "scanner-missing",
        subject: "scanners",
        severity: "problem",
      }),
    ]);
  });

  it("accepts a language one installed scanner claims", async () => {
    const fixture = setup(undefined, { "a.py": "" });

    writeShim(
      fixture.bin,
      "recognizer-scan-python",
      manifestFor("scanner", "python", RULES("python", ".py")),
    );

    const { report, code } = await doctor(fixture);

    expect(code).toBe(0);
    expect(problemsOf(report, "scanners")).toEqual([]);
  });

  it("does not report a language no installed scanner claims", async () => {
    const fixture = setup(undefined, { "a.py": "", "b.kt": "" });

    writeShim(
      fixture.bin,
      "recognizer-scan-python",
      manifestFor("scanner", "python", RULES("python", ".py")),
    );

    expect(problemsOf((await doctor(fixture)).report, "scanners")).toEqual([]);
  });

  it("reports scanner-ambiguous with one command per claimant", async () => {
    const fixture = setup(undefined, { "a.py": "" });

    writeShim(
      fixture.bin,
      "recognizer-scan-python",
      manifestFor("scanner", "python", RULES("python", ".py")),
    );
    writeShim(
      fixture.bin,
      "recognizer-scan-python-alt",
      manifestFor("scanner", "python-alt", RULES("python", ".py")),
    );

    const [problem] = problemsOf((await doctor(fixture)).report, "scanners");

    expect(problem).toMatchObject({
      code: "scanner-ambiguous",
      subject: "python",
    });
    expect(problem?.fix.text).toBe(
      "recognizer config scanners.python python or recognizer config scanners.python python-alt",
    );
  });

  it("accepts the claimant the config names", async () => {
    const fixture = setup("scanners:\n  python: python-alt\n", { "a.py": "" });

    writeShim(
      fixture.bin,
      "recognizer-scan-python",
      manifestFor("scanner", "python", RULES("python", ".py")),
    );
    writeShim(
      fixture.bin,
      "recognizer-scan-python-alt",
      manifestFor("scanner", "python-alt", RULES("python", ".py")),
    );

    expect(problemsOf((await doctor(fixture)).report, "scanners")).toEqual([]);
  });

  it("reports scanner-choice when the config names an installed scanner that does not claim the language", async () => {
    const fixture = setup("scanners:\n  python: kotlin\n", { "a.py": "" });

    writeShim(
      fixture.bin,
      "recognizer-scan-python",
      manifestFor("scanner", "python", RULES("python", ".py")),
    );
    writeShim(
      fixture.bin,
      "recognizer-scan-kotlin",
      manifestFor("scanner", "kotlin", RULES("kotlin", ".kt")),
    );

    const [problem] = problemsOf((await doctor(fixture)).report, "scanners");

    expect(problem).toMatchObject({
      code: "scanner-choice",
      subject: "python",
    });
  });

  it("reports scanner-missing for a named scanner that is not installed, with other scanners installed", async () => {
    const fixture = setup("scanners:\n  swift: swift-x\n");

    writeShim(
      fixture.bin,
      "recognizer-scan-python",
      manifestFor("scanner", "python", RULES("python", ".py")),
    );

    const [problem] = problemsOf((await doctor(fixture)).report, "scanners");

    expect(problem).toMatchObject({
      code: "scanner-missing",
      subject: "swift",
    });
    expect(problem?.fix.text).toBe("install recognizer-scan-swift-x");
  });

  it("gives the install fix text for a language nothing claims when a scanner names it", async () => {
    const fixture = setup("scanners:\n  swift: swift-x\n");
    const [problem] = problemsOf((await doctor(fixture)).report, "scanners");

    expect(problem?.code).toBe("scanner-missing");
  });

  it("reports an unsupported scanner as plugin-protocol and a problem", async () => {
    const fixture = setup(undefined, { "a.py": "" });

    writeShim(
      fixture.bin,
      "recognizer-scan-python",
      manifestFor("scanner", "python", {
        ...RULES("python", ".py"),
        protocol: 7,
        install: "get it",
      }),
    );

    const { report, code } = await doctor(fixture);
    const [problem] = problemsOf(report, "scanners");

    expect(code).toBe(1);
    expect(problem).toMatchObject({
      code: "plugin-protocol",
      severity: "problem",
    });
    expect(problem?.line).toContain("protocol 7");
    expect(problem?.fix.text).toBe("get it");
  });
});

describe("doctor: a scanner's scan schema", () => {
  async function withScanner(overrides: Record<string, unknown>) {
    const fixture = setup(undefined, { "a.py": "" });

    writeShim(
      fixture.bin,
      "recognizer-scan-python",
      manifestFor("scanner", "python", {
        ...RULES("python", ".py"),
        install: "brew upgrade kenmclennan/tap/recognizer-scan-python",
        ...overrides,
      }),
    );

    return doctor(fixture);
  }

  it("reports a newer scanner as plugin-scan-schema with the cask fix", async () => {
    const { report, code } = await withScanner({ scan_schema_version: 8 });
    const found = problemsOf(report, "scanners");

    expect(code).toBe(1);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: "plugin-scan-schema",
      severity: "problem",
    });
    expect(found[0]?.line).toContain("scan schema 8");
    expect(found[0]?.fix.text).toBe(
      "brew upgrade --cask kenmclennan/tap/recognizer",
    );
  });

  it("reports a broken scanner with its install line", async () => {
    const { report } = await withScanner({ scan_schema_version: 6 });
    const [problem] = problemsOf(report, "scanners");

    expect(problem?.code).toBe("plugin-scan-schema");
    expect(problem?.fix.text).toBe(
      "brew upgrade kenmclennan/tap/recognizer-scan-python",
    );
  });

  it("reports nothing for a scanner that declares the current version", async () => {
    const { report, code } = await withScanner({ scan_schema_version: 7 });

    expect(problemsOf(report, "scanners")).toEqual([]);
    expect(code).toBe(0);
  });

  it("reports nothing for a scanner that declares nothing", async () => {
    const { scan_schema_version: _, ...rest } = manifestFor(
      "scanner",
      "python",
    );
    const { report } = await withScanner(rest);

    expect(problemsOf(report, "scanners")).toEqual([]);
  });

  it("reports both codes for a scanner that is protocol-unsupported and schema-newer", async () => {
    const { report } = await withScanner({
      protocol: 7,
      scan_schema_version: 8,
    });
    const codes = problemsOf(report, "scanners").map((one) => one.code);

    expect(codes).toEqual(["plugin-protocol", "plugin-scan-schema"]);
  });

  it("does not report a scanner no detected language chooses", async () => {
    const fixture = setup(undefined, { "a.py": "" });

    writeShim(
      fixture.bin,
      "recognizer-scan-python",
      manifestFor("scanner", "python", RULES("python", ".py")),
    );
    writeShim(
      fixture.bin,
      "recognizer-scan-swift",
      manifestFor("scanner", "swift", {
        ...RULES("swift", ".swift"),
        scan_schema_version: 9,
      }),
    );

    const { report } = await doctor(fixture);

    expect(problemsOf(report, "scanners")).toEqual([]);
  });
});

describe("doctor: a scanner that does not report tests", () => {
  const CHOSEN = "scanners:\n  acme: old\n";

  async function withTwo(older: Record<string, unknown>, newer: object) {
    const fixture = setup(CHOSEN, { "a.acme": "" });

    writeShim(
      fixture.bin,
      "recognizer-scan-old",
      manifestFor("scanner", "old", {
        ...RULES("acme", ".acme"),
        install: "brew upgrade tap/recognizer-scan-old",
        ...older,
      }),
    );
    writeShim(
      fixture.bin,
      "recognizer-scan-new",
      manifestFor("scanner", "new", { ...RULES("acme", ".acme"), ...newer }),
    );

    return doctor(fixture);
  }

  it("names the chosen scanner as a warning when another claimant declares reports_tests", async () => {
    const { report } = await withTwo({}, { reports_tests: true });
    const found = problemsOf(report, "scanners");

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: "plugin-tests-report",
      severity: "warning",
      title: "The acme scanner cannot report its tests",
    });
    expect(found[0]?.line).toContain("recognizer-scan-old");
    expect(found[0]?.line).toContain("recognizer-scan-new");
    expect(found[0]?.fix.text).toBe("brew upgrade tap/recognizer-scan-old");
  });

  it("reports nothing when the chosen scanner declares reports_tests", async () => {
    const { report } = await withTwo(
      { reports_tests: true },
      { reports_tests: true },
    );

    expect(problemsOf(report, "scanners")).toEqual([]);
  });

  it("reports nothing when no claimant declares reports_tests", async () => {
    const { report } = await withTwo({}, {});

    expect(problemsOf(report, "scanners")).toEqual([]);
  });

  it("reports nothing for a lone scanner without reports_tests", async () => {
    const fixture = setup(undefined, { "a.acme": "" });

    writeShim(
      fixture.bin,
      "recognizer-scan-old",
      manifestFor("scanner", "old", RULES("acme", ".acme")),
    );

    const { report } = await doctor(fixture);

    expect(problemsOf(report, "scanners")).toEqual([]);
  });
});

describe("doctor: registered plugins", () => {
  const SENSOR =
    "sensors:\n  mine:\n    command: [recognizer-sense-mine, run, --repository, '{repository}']\n";

  it("reports plugin-missing with the recorded install line", async () => {
    const fixture = setup(
      `${SENSOR}install:\n  recognizer-sense-mine: get mine\n`,
    );
    const { report } = await doctor(fixture);

    expect(problemsOf(report, "sensors")).toEqual([
      expect.objectContaining({
        code: "plugin-missing",
        subject: "mine",
        fix: { text: "get mine", command: null },
      }),
    ]);
  });

  it("gives the instruction when no install line is recorded", async () => {
    const [problem] = problemsOf(
      (await doctor(setup(SENSOR))).report,
      "sensors",
    );

    expect(problem?.fix.text).toBe(
      "install recognizer-sense-mine: no install line is recorded for it, run recognizer plugin add mine on a machine that has it",
    );
  });

  it("reports plugin-manifest when the manifest does not answer", async () => {
    const fixture = setup(SENSOR);

    writeShim(fixture.bin, "recognizer-sense-mine", "garbage");

    expect(problemsOf((await doctor(fixture)).report, "sensors")[0]?.code).toBe(
      "plugin-manifest",
    );
  });

  it("reports an unsupported protocol as a problem naming both versions and the install line", async () => {
    const fixture = setup(SENSOR);

    writeShim(
      fixture.bin,
      "recognizer-sense-mine",
      manifestFor("sensor", "mine", { protocol: 5, install: "get mine" }),
    );

    const { report, code } = await doctor(fixture);
    const [problem] = problemsOf(report, "sensors");

    expect(code).toBe(1);
    expect(problem).toMatchObject({
      code: "plugin-protocol",
      severity: "problem",
    });
    expect(problem?.line).toContain("protocol 5");
    expect(problem?.line).toContain("protocol 1");
    expect(problem?.fix.text).toBe("get mine");
  });

  it("reports a sensor-gap from the plugin's own check", async () => {
    const fixture = setup(SENSOR);

    writeShim(
      fixture.bin,
      "recognizer-sense-mine",
      manifestFor("sensor", "mine", { check: true }),
      {
        check: JSON.stringify({
          gaps: [{ code: "x", suite: null, line: "no tests configured" }],
        }),
      },
    );

    const [problem] = problemsOf((await doctor(fixture)).report, "sensors");

    expect(problem).toMatchObject({
      code: "sensor-gap",
      subject: "mine",
      line: "no tests configured",
      fix: { text: "recognizer help sensors mine" },
    });
  });

  it("passes the repository's test suites to a sensor that runs tests when it checks it", async () => {
    const fixture = setup(
      [
        "tests:",
        "  - name: api",
        "    language: python",
        "    directory: .",
        "    command: pytest",
        "    coverage: { path: coverage/lcov.info, format: lcov }",
        "sensors:",
        "  crap: {}",
        "",
      ].join("\n"),
    );
    const log = join(fixture.repo, "arguments.log");
    const program = join(fixture.bin, "recognizer-sense-crap");

    writeShim(
      fixture.bin,
      "recognizer-sense-crap",
      manifestFor("sensor", "crap"),
    );
    writeFileSync(
      program,
      readFileSync(program, "utf8").replace(
        'if [ "$1" = "check" ]; then',
        `if [ "$1" = "check" ]; then\necho "$@" >> '${log}'`,
      ),
    );
    chmodSync(program, 0o755);

    await doctor(fixture);

    const line = readFileSync(log, "utf8");
    const settings = JSON.parse(
      line.slice(line.indexOf("--settings") + "--settings ".length).trim(),
    ) as { tests: { name: string }[] };

    expect(settings.tests.map((suite) => suite.name)).toEqual(["api"]);
  });

  it("never passes --run to a sensor's check verb", async () => {
    const fixture = setup(
      [
        "tests:",
        "  - name: api",
        "    language: python",
        "    directory: .",
        "    command: pytest",
        "    coverage: { path: coverage/lcov.info, format: lcov }",
        "sensors:",
        "  crap: {}",
        "",
      ].join("\n"),
    );
    const log = join(fixture.repo, "arguments.log");
    const program = join(fixture.bin, "recognizer-sense-crap");

    writeShim(
      fixture.bin,
      "recognizer-sense-crap",
      manifestFor("sensor", "crap"),
    );
    writeFileSync(
      program,
      readFileSync(program, "utf8").replace(
        'if [ "$1" = "check" ]; then',
        `if [ "$1" = "check" ]; then\necho "$@" >> '${log}'`,
      ),
    );
    chmodSync(program, 0o755);

    await doctor(fixture);

    const line = readFileSync(log, "utf8");

    expect(line.startsWith("check")).toBe(true);
    expect(line.split(/\s+/)).not.toContain("--run");
  });

  it("reports a describer-gap when the describer's check fails", async () => {
    const fixture = setup(
      "describer:\n  command: [recognizer-describe-d, run, --model, '{model}', '{request}']\n  version: v1\n",
    );

    writeShim(
      fixture.bin,
      "recognizer-describe-d",
      manifestFor("describer", "d", { check: true }),
      {
        checkStatus: 3,
      },
    );

    const [problem] = problemsOf((await doctor(fixture)).report, "describers");

    expect(problem).toMatchObject({
      code: "describer-gap",
      subject: "describer",
    });
  });

  it("reports a describer-gap when the describer's command has no run element", async () => {
    const fixture = setup(
      "describer:\n  command: [recognizer-describe-d, --model, '{model}']\n  version: v1\n",
    );

    writeShim(
      fixture.bin,
      "recognizer-describe-d",
      manifestFor("describer", "d", { check: true }),
    );

    const problems = problemsOf((await doctor(fixture)).report, "describers");

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ code: "describer-gap" });
    expect(problems[0]?.line).toBe(
      "the describer does not speak the plugin verbs: its command has no run element",
    );
    expect(problems[0]?.fix.text).toBe(
      "add the run word to the describer command with recognizer config describer.command",
    );
  });

  it("passes the words before run to the describer's check", async () => {
    const fixture = setup(
      "describer:\n  command: [recognizer-describe-d, --flag, '{repository}', run, --model, '{model}', '{request}']\n  version: v1\n",
    );
    const log = join(fixture.repo, "arguments.log");
    const program = join(fixture.bin, "recognizer-describe-d");

    writeShim(
      fixture.bin,
      "recognizer-describe-d",
      manifestFor("describer", "d", { check: true }),
    );
    writeFileSync(
      program,
      readFileSync(program, "utf8").replace(
        'if [ "$1" = "check" ]; then',
        `if [ "$#" -gt 0 ] && [ "$3" = "check" ]; then\necho "$@" >> '${log}'\nfi\nif [ "$1" = "check" ]; then`,
      ),
    );
    chmodSync(program, 0o755);

    await doctor(fixture);

    expect(existsSync(log)).toBe(true);
    expect(
      readFileSync(log, "utf8").startsWith(`--flag ${fixture.repo} check`),
    ).toBe(true);
  });

  it("the failure line keeps its wording", async () => {
    const fixture = setup(
      "describer:\n  command: [recognizer-describe-d, run, --model, '{model}', '{request}']\n  version: v1\n",
    );

    writeShim(
      fixture.bin,
      "recognizer-describe-d",
      manifestFor("describer", "d", { check: true }),
      { checkStatus: 3 },
    );

    const [problem] = problemsOf((await doctor(fixture)).report, "describers");

    expect(problem?.line).toBe(
      `${join(fixture.bin, "recognizer-describe-d")} check exited 3`,
    );
  });

  it("reports plugin-settings for a key the manifest does not declare", async () => {
    const fixture = setup("sensors:\n  crap:\n    threshold: 20\n");

    writeShim(
      fixture.bin,
      "recognizer-sense-crap",
      manifestFor("sensor", "crap", { check: false, settings: [] }),
    );

    const [problem] = problemsOf((await doctor(fixture)).report, "sensors");

    expect(problem).toMatchObject({ code: "plugin-settings", subject: "crap" });
    expect(problem?.line).toContain("threshold");
  });

  it("reports plugin-settings for a value that breaks its setting", async () => {
    const fixture = setup("sensors:\n  crap:\n    threshold: 20\n");

    writeShim(
      fixture.bin,
      "recognizer-sense-crap",
      manifestFor("sensor", "crap", {
        check: false,
        settings: [
          {
            key: "threshold",
            type: "number",
            minimum: 50,
            description: "d",
            example: "e",
          },
        ],
      }),
    );

    const [problem] = problemsOf((await doctor(fixture)).report, "sensors");

    expect(problem).toMatchObject({ code: "plugin-settings" });
    expect(problem?.line).toContain("threshold");
  });

  it("accepts settings that match a manifest entry with a placeholder segment", async () => {
    const fixture = setup(
      "sensors:\n  mine:\n    size:\n      above: 12\n    command: [mine]\n",
    );

    writeShim(
      fixture.bin,
      "recognizer-sense-mine",
      manifestFor("sensor", "mine", {
        check: false,
        settings: [
          {
            key: "<metric>.above",
            type: "number",
            description: "a finding above this value",
            example: "sensors.mine.size.above 3",
          },
        ],
      }),
    );

    expect(problemsOf((await doctor(fixture)).report, "sensors")).toEqual([]);
  });

  it("starts nothing but git, manifest and check, and never a repository script", async () => {
    const fixture = setup(
      `${SENSOR}  other:\n    command: [node, scripts/x.mjs]\n`,
    );
    const record = { commands: [] as string[] };

    writeShim(
      fixture.bin,
      "recognizer-sense-mine",
      manifestFor("sensor", "mine", { check: true }),
    );
    await doctor(fixture, record);

    const started = record.commands.filter((one) => !one.startsWith("git "));

    expect(started.length).toBeGreaterThan(0);
    expect(
      started.every((one) =>
        /(recognizer-sense-mine (manifest|check)|recognizer-describe-claude manifest)$/.test(
          one,
        ),
      ),
    ).toBe(true);
  });

  it("skips the sensors and describers areas when the config has problems", async () => {
    const fixture = setup("sensors:\n  mine: 3\n");
    const { report } = await doctor(fixture);

    expect(report.areas.find((one) => one.name === "sensors")?.skipped).toBe(
      "config has problems",
    );
    expect(report.areas.find((one) => one.name === "describers")?.skipped).toBe(
      "config has problems",
    );
  });

  it("lists the areas in order with warnings and severity", async () => {
    const { report } = await doctor(setup());

    expect(report.areas.map((one) => one.name)).toEqual([
      "config",
      "policy",
      "scanners",
      "sensors",
      "describers",
    ]);
    expect(report.warnings).toBe(0);
  });
});

describe("doctor: PATH isolation", () => {
  const original = process.env.PATH;

  afterEach(() => {
    process.env.PATH = original;
  });

  it("does not see a describer that is only on the process PATH", async () => {
    const outside = tempDirectory("recognizer-doctor-outside-");

    writeShim(
      outside,
      "recognizer-describe-claude",
      manifestFor("describer", "claude"),
    );
    process.env.PATH = `${outside}:${original ?? ""}`;

    const { report } = await doctor(setup());

    expect(
      report.areas.find((one) => one.name === "describers")?.problems,
    ).toEqual([]);
  });

  it("resolves a command only on the narrowed PATH", () => {
    const outside = tempDirectory("recognizer-doctor-outside-");

    writeShim(
      outside,
      "recognizer-describe-claude",
      manifestFor("describer", "claude"),
    );
    process.env.PATH = `${outside}:${original ?? ""}`;

    const result = ioWithPath([]).run("recognizer-describe-claude", [
      "manifest",
    ]);

    expect(result.started).toBe(false);
  });
});

describe("doctor: titles name their subject", () => {
  const sensorLine = (name: string) =>
    `sensors:\n  ${name}:\n    command: [recognizer-sense-${name}, run, --repository, '{repository}']\n`;
  const SENSOR = sensorLine("mine");

  const titleOf = async (fixture: Setup, area: string) =>
    problemsOf((await doctor(fixture)).report, area).map((one) => one.title);

  it("reports two sensor-gaps with titles naming each sensor", async () => {
    const fixture = setup(
      `${sensorLine("crap")}${sensorLine("mutation").slice("sensors:\n".length)}`,
    );

    for (const [name, display] of [
      ["crap", "C.R.A.P."],
      ["mutation", "Mutation"],
    ]) {
      writeShim(
        fixture.bin,
        `recognizer-sense-${name}`,
        manifestFor("sensor", name as string, { check: true, display }),
        {
          check: JSON.stringify({
            gaps: [{ code: "x", suite: null, line: `${name} has a gap` }],
          }),
        },
      );
    }

    const problems = problemsOf((await doctor(fixture)).report, "sensors");
    const titles = problems.map((one) => one.title);

    expect(problems.map((one) => one.code)).toEqual([
      "sensor-gap",
      "sensor-gap",
    ]);
    expect(titles).toEqual([
      "C.R.A.P. cannot run as set up",
      "Mutation cannot run as set up",
    ]);
    expect(new Set(titles).size).toBe(2);
    expect(Object.keys(problems[0] ?? {}).sort()).toEqual(
      ["code", "fix", "line", "severity", "subject", "title"].sort(),
    );
  });

  it("title names the subject: sensor-gap", async () => {
    const fixture = setup(SENSOR);

    writeShim(
      fixture.bin,
      "recognizer-sense-mine",
      manifestFor("sensor", "mine", { check: true, display: "Mine" }),
      {
        check: JSON.stringify({
          gaps: [{ code: "x", suite: null, line: "g" }],
        }),
      },
    );

    expect(await titleOf(fixture, "sensors")).toEqual([
      "Mine cannot run as set up",
    ]);
  });

  it("title names the subject: describer-gap", async () => {
    const fixture = setup(
      "describer:\n  command: [recognizer-describe-d, run, --model, '{model}', '{request}']\n  version: v1\n",
    );

    writeShim(
      fixture.bin,
      "recognizer-describe-d",
      manifestFor("describer", "d", { check: true, display: "Claude" }),
      { checkStatus: 3 },
    );

    expect(await titleOf(fixture, "describers")).toEqual([
      "The Claude describer is not ready",
    ]);
  });

  it("title names the subject: plugin-missing", async () => {
    expect(await titleOf(setup(SENSOR), "sensors")).toEqual([
      "The mine plugin is not installed",
    ]);
  });

  it("title names the subject: plugin-manifest", async () => {
    const fixture = setup(SENSOR);

    writeShim(fixture.bin, "recognizer-sense-mine", "garbage");

    expect(await titleOf(fixture, "sensors")).toEqual([
      "The mine plugin cannot be read",
    ]);
  });

  it("title names the subject: plugin-settings", async () => {
    const fixture = setup("sensors:\n  crap:\n    threshold: 20\n");

    writeShim(
      fixture.bin,
      "recognizer-sense-crap",
      manifestFor("sensor", "crap", { check: false, settings: [] }),
    );

    expect(await titleOf(fixture, "sensors")).toEqual([
      "A crap setting is wrong",
    ]);
  });

  it("title names the subject: plugin-protocol for a sensor and a scanner", async () => {
    const sensor = setup(SENSOR);

    writeShim(
      sensor.bin,
      "recognizer-sense-mine",
      manifestFor("sensor", "mine", { protocol: 5, display: "Mine" }),
    );

    expect(await titleOf(sensor, "sensors")).toEqual([
      "The Mine plugin speaks another protocol version",
    ]);

    const scanner = setup(undefined, { "a.py": "" });

    writeShim(
      scanner.bin,
      "recognizer-scan-python",
      manifestFor("scanner", "python", {
        ...RULES("python", ".py"),
        protocol: 7,
      }),
    );

    expect(await titleOf(scanner, "scanners")).toEqual([
      "The python plugin speaks another protocol version",
    ]);
  });

  it("title names the subject: scanner-missing", async () => {
    expect(await titleOf(setup(undefined, { "a.py": "" }), "scanners")).toEqual(
      ["No scanner is installed"],
    );

    const named = setup("scanners:\n  kotlin: kotlin-x\n");

    expect(await titleOf(named, "scanners")).toEqual([
      "No scanner is installed",
      "No scanner for kotlin",
    ]);

    const csharp = setup("scanners:\n  csharp: csharp-x\n");
    const zig = setup("scanners:\n  zig: zig-x\n");

    expect(await titleOf(csharp, "scanners")).toContain(
      "No scanner for csharp",
    );
    expect(await titleOf(zig, "scanners")).toContain("No scanner for zig");
  });

  it("title names the subject: plugin-scan-schema", async () => {
    const fixture = setup(undefined, { "a.py": "" });

    writeShim(
      fixture.bin,
      "recognizer-scan-python",
      manifestFor("scanner", "python", {
        ...RULES("python", ".py"),
        scan_schema_version: 8,
      }),
    );

    expect(await titleOf(fixture, "scanners")).toEqual([
      "The Python scanner's output is invalid",
    ]);
  });

  it("title names the subject: scanner-ambiguous", async () => {
    const fixture = setup(undefined, { "a.py": "" });

    writeShim(
      fixture.bin,
      "recognizer-scan-python",
      manifestFor("scanner", "python", RULES("python", ".py")),
    );
    writeShim(
      fixture.bin,
      "recognizer-scan-python-alt",
      manifestFor("scanner", "python-alt", RULES("python", ".py")),
    );

    expect(await titleOf(fixture, "scanners")).toEqual([
      "Two scanners claim Python",
    ]);
  });

  it("title names the subject: scanner-choice", async () => {
    const fixture = setup("scanners:\n  python: kotlin\n", { "a.py": "" });

    writeShim(
      fixture.bin,
      "recognizer-scan-python",
      manifestFor("scanner", "python", RULES("python", ".py")),
    );
    writeShim(
      fixture.bin,
      "recognizer-scan-kotlin",
      manifestFor("scanner", "kotlin", RULES("kotlin", ".kt")),
    );

    expect(await titleOf(fixture, "scanners")).toEqual([
      "The scanner chosen for Python is not usable",
    ]);
  });
});
