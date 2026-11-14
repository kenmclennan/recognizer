import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import type { DoctorReport } from "../src/doctor.js";
import {
  ioWithPath,
  manifestFor,
  tempDirectory,
  writeShim,
} from "./plugin-path.js";

const RULES = (name: string, extension: string) => ({
  languages: [
    {
      name,
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
      "sensors:\n  thresholds:\n    complexity:\n      above: 12\n",
    );

    writeShim(
      fixture.bin,
      "recognizer-sense-thresholds",
      manifestFor("sensor", "thresholds", { check: false }),
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
