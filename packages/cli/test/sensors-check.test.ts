import {
  CHECK_TIMEOUT_MS,
  checkArguments,
  strippedArguments,
} from "@recognizer/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";
import { exampleManifest } from "./installed-read.js";
import { fakeIo, OFFICIAL_ON_PATH, ROOT } from "./scan-helpers.js";

const CONFIG = `${ROOT}/.recognizer/config.yaml`;

const API_GAP = {
  code: "pytest-cov-missing",
  suite: "api",
  line: "suite api: pytest-cov is not installed in the activated environment",
};

const WEB_GAP = {
  code: "vitest-missing",
  suite: "web",
  line: "suite web: vitest is not installed",
};

const NOTE = {
  code: "coverage-partial",
  suite: "api",
  line: "suite api: the coverage report covers 19 of 71 scanned Rust files",
};

const REGISTERED = [
  "tests:",
  "  - name: api",
  "    language: python",
  "    directory: .",
  "    command: pytest",
  "    coverage: { path: coverage/lcov.info, format: lcov }",
  "sensors:",
  "  crap: { manifest: [recognizer-sense-crap, manifest] }",
  "  mutation: { manifest: [recognizer-sense-mutation, manifest] }",
  "",
].join("\n");

function gapsBy(table: Record<string, unknown[]>) {
  return (args: string[]) => ({
    stdout: `${JSON.stringify({ gaps: table[args[0] as string] ?? [] })}\n`,
  });
}

function setup(
  config: string,
  answer: (args: string[]) => {
    stdout?: string;
    stderr?: string;
    status?: number;
    started?: boolean;
    timedOut?: boolean;
  },
) {
  return fakeIo({
    files: { [CONFIG]: config },
    sensorManifests: true,
    onPath: OFFICIAL_ON_PATH,
    sensorsPreflight: { run: answer },
  });
}

function check(fake: ReturnType<typeof fakeIo>, ...argv: string[]) {
  return run(["sensors", "check", "--repository", ROOT, ...argv], fake.io);
}

function checks(fake: ReturnType<typeof fakeIo>) {
  return fake.calls.filter(
    (call) =>
      call.command.startsWith("recognizer-sense-") && call.args[0] === "check",
  );
}

describe("recognizer sensors check", () => {
  it("prints each sensor's sentences as given and exits 1 while a gap remains", () => {
    const fake = setup(REGISTERED, gapsBy({ crap: [API_GAP, WEB_GAP] }));

    expect(check(fake)).toBe(1);
    expect(fake.out()).toBe(
      [
        "crap: 2 gaps",
        `  ${API_GAP.line}`,
        `  ${WEB_GAP.line}`,
        "mutation: ready",
        "",
      ].join("\n"),
    );
  });

  it("passes --work and --modules through to the plugin and prints the work it answers", () => {
    const fake = setup(REGISTERED, (args) => ({
      stdout: `${JSON.stringify({
        gaps: [],
        ...(args.includes("--work") && args[0] === "mutation"
          ? { work: { unit: "functions", to_perform: 3, reusable: 367 } }
          : {}),
      })}\n`,
    }));

    expect(
      check(fake, "mutation", "--work", "--modules", "/m.json", "--json"),
    ).toBe(0);

    const [call] = checks(fake);

    expect(call?.args).toContain("--work");
    expect(call?.args.slice(call.args.indexOf("--modules"))).toEqual([
      "--modules",
      "/m.json",
    ]);
    expect(JSON.parse(fake.out()).sensors).toEqual([
      {
        name: "mutation",
        ready: true,
        gaps: [],
        notes: [],
        work: { unit: "functions", to_perform: 3, reusable: 367 },
      },
    ]);
  });

  it("passes the suite names of a --suites file to the plugin", () => {
    const fake = fakeIo({
      files: { [CONFIG]: REGISTERED, "/s.json": '["unit","web"]' },
      sensorsPreflight: { run: gapsBy({}) },
    });

    expect(check(fake, "mutation", "--work", "--suites", "/s.json")).toBe(0);

    const [call] = checks(fake);

    expect(call?.args.slice(call.args.indexOf("--suites"))).toEqual([
      "--suites",
      '["unit","web"]',
    ]);
  });

  it("exits 2 for a --suites file that is not an array of names", () => {
    const fake = fakeIo({
      files: { [CONFIG]: REGISTERED, "/s.json": '{"unit":1}' },
      sensorsPreflight: { run: gapsBy({}) },
    });

    expect(check(fake, "mutation", "--work", "--suites", "/s.json")).toBe(2);
  });

  it("prints no work for a sensor that does not answer it", () => {
    const fake = setup(REGISTERED, gapsBy({}));

    expect(check(fake, "crap", "--work", "--json")).toBe(0);
    expect(JSON.parse(fake.out()).sensors[0]).not.toHaveProperty("work");
  });

  it("says 1 gap for a single gap and exits 0 when every sensor is ready", () => {
    const one = setup(REGISTERED, gapsBy({ crap: [API_GAP] }));

    check(one);

    expect(one.out()).toContain("crap: 1 gap\n");

    const none = setup(REGISTERED, gapsBy({}));

    expect(check(none)).toBe(0);
    expect(none.out()).toBe("crap: ready\nmutation: ready\n");
  });

  it("prints --json with ready and each sensor's gaps", () => {
    const fake = setup(REGISTERED, gapsBy({ mutation: [API_GAP] }));

    expect(check(fake, "--json")).toBe(1);
    expect(JSON.parse(fake.out())).toEqual({
      ready: false,
      sensors: [
        { name: "crap", ready: true, gaps: [], notes: [] },
        { name: "mutation", ready: false, gaps: [API_GAP], notes: [] },
      ],
    });
  });

  it("relays a gap's output in --json and leaves text mode without it", () => {
    const withOutput = { ...API_GAP, output: "engine not built\n" };
    const answer = () => ({
      stdout: `${JSON.stringify({ gaps: [withOutput, WEB_GAP] })}\n`,
    });
    const json = setup(REGISTERED, answer);

    check(json, "crap", "--json");

    expect(JSON.parse(json.out()).sensors[0].gaps).toEqual([
      withOutput,
      WEB_GAP,
    ]);

    const text = setup(REGISTERED, answer);

    check(text, "crap");

    expect(text.out()).not.toContain("engine not built");

    const bad = setup(REGISTERED, () => ({
      stdout: `${JSON.stringify({ gaps: [{ ...API_GAP, output: 3 }] })}\n`,
    }));

    check(bad, "crap", "--json");

    expect(
      JSON.parse(bad.out()).sensors[0].gaps.map(
        (gap: { code: string }) => gap.code,
      ),
    ).toEqual(["check-failed"]);
  });

  it("prints a note under the ready line, never as a gap, and exits 0", () => {
    const fake = setup(REGISTERED, (args) => ({
      stdout: `${JSON.stringify({ gaps: [], notes: args[0] === "crap" ? [NOTE] : [] })}\n`,
    }));

    expect(check(fake)).toBe(0);
    expect(fake.out()).toBe(`crap: ready\n  ${NOTE.line}\nmutation: ready\n`);

    const json = setup(REGISTERED, () => ({
      stdout: `${JSON.stringify({ gaps: [], notes: [NOTE] })}\n`,
    }));

    check(json, "crap", "--json");

    expect(JSON.parse(json.out()).sensors).toEqual([
      { name: "crap", ready: true, gaps: [], notes: [NOTE] },
    ]);
  });

  it("prints a note after the last gap line and still exits 1", () => {
    const fake = setup(REGISTERED, () => ({
      stdout: `${JSON.stringify({ gaps: [API_GAP], notes: [NOTE] })}\n`,
    }));

    expect(check(fake, "crap")).toBe(1);
    expect(fake.out()).toBe(`crap: 1 gap\n  ${API_GAP.line}\n  ${NOTE.line}\n`);
  });

  it("reads an answer with no notes key as no notes", () => {
    const fake = setup(REGISTERED, gapsBy({}));

    check(fake, "crap", "--json");

    expect(JSON.parse(fake.out()).sensors[0].notes).toEqual([]);
  });

  it("reports check-failed for notes that are not a list of entries", () => {
    for (const notes of ["x", [{ code: "coverage-partial", suite: "api" }]]) {
      const fake = setup(REGISTERED, () => ({
        stdout: `${JSON.stringify({ gaps: [], notes })}\n`,
      }));

      check(fake, "crap", "--json");

      const [sensor] = JSON.parse(fake.out()).sensors;

      expect(sensor.gaps.map((gap: { code: string }) => gap.code)).toEqual([
        "check-failed",
      ]);
      expect(sensor.notes).toEqual([]);
    }
  });

  it("checks only the named sensor, registered or not", () => {
    const fake = setup("", gapsBy({ crap: [API_GAP] }));

    expect(check(fake, "crap")).toBe(1);
    expect(checks(fake).map((call) => call.command)).toEqual([
      "recognizer-sense-crap",
    ]);
  });

  it("hands an installed sensor that is not registered the tests list the scan would pass", () => {
    const fake = setup(
      REGISTERED.replace(
        "  mutation: { manifest: [recognizer-sense-mutation, manifest] }\n",
        "",
      ),
      gapsBy({}),
    );

    check(fake, "mutation");

    const settings = JSON.parse(
      checks(fake)[0]?.args[
        (checks(fake)[0]?.args.indexOf("--settings") as number) + 1
      ] as string,
    );

    expect(settings.tests[0].name).toBe("api");
  });

  it("exits 2 for an unknown name, for no registered sensors with no name, and for check's extra word", () => {
    expect(check(setup("", gapsBy({})), "nope")).toBe(2);
    expect(check(setup("", gapsBy({})))).toBe(2);
    expect(check(setup(REGISTERED, gapsBy({})), "crap", "extra")).toBe(2);
  });

  it("keeps listing the installed sensors and rejects --run without check", () => {
    const listed = fakeIo({ sensorManifests: true, onPath: OFFICIAL_ON_PATH });

    expect(run(["sensors"], listed.io)).toBe(0);
    expect(listed.out()).toContain("mutation");
    expect(run(["sensors", "--run"], fakeIo().io)).toBe(2);
    expect(run(["sensors", "extra"], fakeIo().io)).toBe(2);
  });

  it("reports check-failed for a sensor whose check exits non-zero, with its first stderr line", () => {
    const fake = setup(REGISTERED, () => ({
      status: 1,
      stderr: "boom\nand more",
    }));

    expect(check(fake, "crap")).toBe(1);
    expect(fake.out()).toBe(
      "crap: 1 gap\n  the readiness check of crap did not answer: boom\n",
    );
  });

  it("reports check-failed for junk, for no output and for a timeout", () => {
    const junk = setup(REGISTERED, () => ({ stdout: "not json\n" }));
    const silent = setup(REGISTERED, () => ({ stdout: "" }));
    const slow = setup(REGISTERED, () => ({ status: 1, timedOut: true }));

    check(junk, "crap", "--json");
    check(silent, "crap", "--json");
    check(slow, "crap", "--json");

    for (const fake of [junk, silent, slow]) {
      expect(JSON.parse(fake.out()).sensors[0].gaps[0].code).toBe(
        "check-failed",
      );
    }
  });

  it("reports sensors-missing when an installed sensor's program does not start", () => {
    const fake = setup(REGISTERED, () => ({ started: false }));

    expect(check(fake, "crap", "--json")).toBe(1);
    expect(JSON.parse(fake.out()).sensors[0].gaps).toEqual([
      {
        code: "sensors-missing",
        suite: null,
        line: "recognizer-sense-crap is not installed",
      },
    ]);
  });

  it("lists a registered sensor with a custom command as having no readiness check and counts it ready", () => {
    const fake = setup(
      `${REGISTERED}  custom:\n    command: [custom-sensor, "{repository}"]\n`,
      gapsBy({}),
    );

    expect(check(fake)).toBe(0);
    expect(fake.out()).toContain("custom: no readiness check\n");
    expect(fake.calls.some((call) => call.command === "custom-sensor")).toBe(
      false,
    );
  });

  it("passes --run through with no timeout and gives the call without it the ceiling", () => {
    const withRun = setup(REGISTERED, gapsBy({}));
    const without = setup(REGISTERED, gapsBy({}));

    check(withRun, "crap", "--run");
    check(without, "crap");

    expect(checks(withRun)[0]?.args).toContain("--run");
    expect(checks(withRun)[0]?.timeoutMs).toBeUndefined();
    expect(checks(without)[0]?.args).not.toContain("--run");
    expect(checks(without)[0]?.timeoutMs).toBe(CHECK_TIMEOUT_MS);
    expect(CHECK_TIMEOUT_MS).toBe(600_000);
  });

  it("calls the sensor with --check, the settings and the tests list, and no commit, output, modules or preflight", () => {
    const fake = setup(REGISTERED, gapsBy({}));

    check(fake, "crap");

    const [call] = checks(fake);
    const args = call?.args as string[];

    expect(call?.cwd).toBe(ROOT);
    expect(args[0]).toBe("check");
    expect(args).toContain(ROOT);

    for (const dropped of [
      "--commit",
      "--output",
      "--modules",
      "{repository}",
      "{commit}",
      "{output}",
    ]) {
      expect(args).not.toContain(dropped);
    }

    expect(JSON.parse(args[args.indexOf("--settings") + 1] as string)).toEqual({
      tests: expect.any(Array),
    });
  });
});

describe("checkArguments", () => {
  it("drops the commit, output and modules pairs and fills the repository", () => {
    expect(
      checkArguments(
        [
          "recognizer-sense-mutation",
          "run",
          "--repository",
          "{repository}",
          "--commit",
          "{commit}",
          "--output",
          "{output}",
          "--modules",
          "{modules}",
        ],
        "/r",
        true,
      ),
    ).toEqual([
      "recognizer-sense-mutation",
      "check",
      "--repository",
      "/r",
      "--run",
    ]);
  });
});

describe("recognizer help sensors <name>", () => {
  const guided = (stdout: string) =>
    fakeIo({
      files: { [CONFIG]: REGISTERED },
      onPath: OFFICIAL_ON_PATH,
      programs: {
        "recognizer-sense-crap": () => ({ stdout }),
        "recognizer-sense-mutation": () => ({ stdout }),
      },
    });

  it("prints the guide the sensor supplies, verbatim", () => {
    const fake = guided("the guide\nsecond line\n");

    expect(run(["help", "sensors", "crap"], fake.io)).toBe(0);
    expect(fake.out()).toBe("the guide\nsecond line\n");
    expect(fake.calls[0]?.args).toEqual(["guide"]);
  });

  it("says a sensor that prints nothing supplies no setup guide", () => {
    const fake = guided("");

    expect(run(["help", "sensors", "mutation"], fake.io)).toBe(0);
    expect(fake.out()).toBe("mutation supplies no setup guide\n");
  });

  it("exits 2 for an unknown sensor and leaves help sensors alone unchanged", () => {
    expect(run(["help", "sensors", "nope"], guided("x").io)).toBe(2);

    const plain = guided("x");

    expect(run(["help", "sensors"], plain.io)).toBe(0);
    expect(plain.out()).toContain("recognizer sensors");
    expect(plain.calls).toEqual([]);
  });
});

describe("suites pair", () => {
  const command = [
    "recognizer-sense-crap",
    "run",
    "--repository",
    "{repository}",
    "--suites",
    '["unit"]',
  ];

  it("is kept by the readiness check arguments", () => {
    expect(checkArguments(command, "/r", false)).toEqual([
      "recognizer-sense-crap",
      "check",
      "--repository",
      "/r",
      "--suites",
      '["unit"]',
    ]);
  });

  it("is dropped from the guide arguments", () => {
    expect(strippedArguments(command, "/r")).toEqual([
      "recognizer-sense-crap",
      "run",
      "--repository",
      "/r",
    ]);
  });
});

describe("a custom-command sensor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const RUN =
    "[python3, tools/sense.py, run, --repository, '{repository}', --commit, '{commit}', --output, '{output}']";

  const configOf = (manifest: boolean) =>
    [
      "sensors:",
      "  mine:",
      `    command: ${RUN}`,
      ...(manifest
        ? ["    manifest: [python3, tools/sense.py, manifest]"]
        : []),
      "",
    ].join("\n");

  const customIo = (manifest: boolean) =>
    fakeIo({
      files: { [CONFIG]: configOf(manifest) },
      onPath: OFFICIAL_ON_PATH,
      programs: {
        python3: (args) => {
          if (args.at(-1) === "manifest") {
            return {
              stdout: JSON.stringify({
                ...exampleManifest("crap"),
                name: "mine",
                check: true,
              }),
            };
          }

          return args.includes("guide")
            ? { stdout: "custom guide\n" }
            : {
                stdout: `${JSON.stringify({ gaps: [API_GAP] })}\n`,
              };
        },
      },
    });

  it("is checked through its manifest and its words before run", () => {
    const fake = customIo(true);

    expect(check(fake)).toBe(1);
    expect(fake.out()).toContain("mine: 1 gap");

    const call = fake.calls.find((one) => one.args.includes("check"));

    expect(call?.command).toBe("python3");
    expect(call?.args.slice(0, 2)).toEqual(["tools/sense.py", "check"]);
  });

  it("with no manifest is counted ready and never run", () => {
    const fake = customIo(false);

    expect(check(fake)).toBe(0);
    expect(fake.out()).toBe("mine: no readiness check\n");
    expect(fake.calls).toEqual([]);
  });

  it("with a manifest prints the guide from its words before run", () => {
    const fake = customIo(true);
    vi.spyOn(process, "cwd").mockReturnValue(ROOT);

    expect(run(["help", "sensors", "mine"], fake.io)).toBe(0);
    expect(fake.out()).toBe("custom guide\n");
    expect(fake.calls.at(-1)?.args).toEqual(["tools/sense.py", "guide"]);
  });

  it("with no manifest supplies no setup guide", () => {
    const fake = customIo(false);
    vi.spyOn(process, "cwd").mockReturnValue(ROOT);

    expect(run(["help", "sensors", "mine"], fake.io)).toBe(0);
    expect(fake.out()).toBe("mine supplies no setup guide\n");
    expect(fake.calls).toEqual([]);
  });
});
