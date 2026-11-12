import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import {
  APP_CONFIG,
  type FakeOptions,
  fakeIo,
  PYTHON,
  ROOT,
  type SensorsPreflight,
  scanJson,
} from "./scan-helpers.js";

const COMMIT = "abc123";
const PY_CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;
const CONFIG = `${ROOT}/.recognizer/config.yaml`;
const LOG = `${ROOT}/.recognizer/cache/log`;
const REFERENCE =
  'describer:\n  command: [recognizer-describe-claude, --model, "{model}", "{request}"]\n  version: "v1"\n';
const IN_TREE =
  'describer:\n  command: [node, "{repository}/describers/claude/dist/bin.js", --model, "{model}", "{request}"]\n  version: "v1"\n';
const CUSTOM =
  'describer:\n  command: [custom-describer, "{module}"]\n  version: "v1"\n';

const SENSOR_GAP = {
  code: "pytest-cov-missing",
  suite: "api",
  line: "suite api: pytest-cov is not installed in the activated environment",
};

const GAP = {
  id: "crap:api:pytest-cov-missing",
  line: SENSOR_GAP.line,
  needs: ["crap"],
  fix: {
    text: "recognizer help sensors crap",
    command: null,
    cwd: "",
    env: {},
    kind: "outside",
  },
};

function current(): string {
  return scanJson(2, 1, {
    commit: COMMIT,
    modified: false,
    files: [
      { path: "m0.py", hash: "0".repeat(64) },
      { path: "m1.py", hash: "1".repeat(64) },
    ],
  });
}

function setup(
  config: string,
  preflight?: SensorsPreflight,
  more: FakeOptions = {},
): FakeOptions {
  return {
    commit: COMMIT,
    files: {
      [`${ROOT}/a.py`]: "",
      [`${ROOT}/m0.py`]: "one",
      [`${ROOT}/m1.py`]: "two",
      [PY_CACHE]: current(),
      [CONFIG]: config,
    },
    scanners: { [PYTHON]: { output: current() } },
    programs: {
      "recognizer-sensors": (args, files) => {
        files.set(
          args[args.indexOf("--output") + 1] as string,
          JSON.stringify({
            findings_version: 1,
            sensor: { name: args[0], version: "1" },
            commit: COMMIT,
            modified: false,
            settings: {},
            findings: [],
          }),
        );

        return undefined;
      },
    },
    ...(preflight === undefined ? {} : { sensorsPreflight: preflight }),
    ...more,
  };
}

async function scan(options: FakeOptions, ...args: string[]) {
  const fake = fakeIo(options);
  const code = await run(["scan", ROOT, ...args], fake.io);

  return { code, fake, out: fake.out(), err: fake.err() };
}

function events(out: string): Record<string, unknown>[] {
  return out
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

function records(fake: ReturnType<typeof fakeIo>) {
  return [...fake.files.keys()]
    .filter((key) => key.startsWith(`${LOG}/`))
    .map((key) => JSON.parse(fake.files.get(key) as string));
}

function sensorRuns(fake: ReturnType<typeof fakeIo>) {
  return fake.calls.filter(
    (call) =>
      call.command === "recognizer-sensors" &&
      !call.args.includes("--check") &&
      !call.args.includes("--version"),
  );
}

const gapsFor = (name: string): SensorsPreflight => ({
  run: (args) => ({
    stdout: `${JSON.stringify({ gaps: args[0] === name ? [SENSOR_GAP] : [] })}\n`,
  }),
});

describe("scan preflight: the early stage", () => {
  it("is a no-commit gap with --sense", async () => {
    const options = { ...setup(""), commit: undefined };
    const { code, out } = await scan(options, "--sense", "crap", "--json");
    const gaps = events(out).find(
      (one) => one.event === "preflight" && one.gaps,
    );

    expect(code).toBe(4);
    expect(gaps).toMatchObject({
      gaps: [
        {
          id: "no-commit",
          needs: ["crap"],
          fix: { kind: "outside", command: null },
        },
      ],
    });
  });

  it("is no gap with --describe alone and no commit", async () => {
    const options = {
      ...setup(REFERENCE),
      commit: undefined,
      programs: {
        "recognizer-describe-claude": () => ({ stdout: "a line\n" }),
      },
    };
    const { code } = await scan(options, "--describe");

    expect(code).toBe(0);
  });

  it("gives the describer gap for a reference describer whose --check fails", async () => {
    const calls: string[][] = [];
    const options = setup(REFERENCE, undefined, {
      programs: {
        "recognizer-describe-claude": (args) => {
          calls.push(args);

          return args.includes("--check")
            ? { status: 2, stderr: "usage" }
            : { stdout: "a line\n" };
        },
      },
    });
    const { code, err } = await scan(options, "--describe");

    expect(code).toBe(4);
    expect(err).toContain(
      "the describer rejects the arguments the scan passes (describe): brew install --cask kenmclennan/tap/recognizer",
    );
    expect(calls).toEqual([["--model", "sonnet", "--check"]]);
  });

  it("gives an npm run build fix for the in-tree describer", async () => {
    const options = setup(IN_TREE, undefined, {
      programs: { node: () => ({ status: 2 }) },
    });
    const { out } = await scan(options, "--describe", "--json");
    const gap = events(out).find(
      (one) => one.event === "preflight" && one.gaps,
    ) as {
      gaps: { fix: unknown; id: string }[];
    };

    expect(gap.gaps).toEqual([
      expect.objectContaining({
        id: "describe:arguments",
        fix: {
          text: "npm run build",
          command: ["npm", "run", "build"],
          cwd: "describers/claude",
          env: {},
          kind: "repository",
        },
      }),
    ]);
  });

  it("gives no gap for a reference describer whose --check passes", async () => {
    const options = setup(REFERENCE, undefined, {
      programs: { "recognizer-describe-claude": () => ({ stdout: "ok\n" }) },
    });

    expect((await scan(options, "--describe")).code).toBe(0);
  });

  it("only start-checks a describer that is not a reference describer", async () => {
    const calls: string[][] = [];
    const options = setup(CUSTOM, undefined, {
      programs: {
        "custom-describer": (args) => {
          calls.push(args);

          return { stdout: "a line\n" };
        },
      },
    });

    expect((await scan(options, "--describe")).code).toBe(0);
    expect(calls[0]).toEqual(["--version"]);

    const absent = setup(CUSTOM, undefined, {
      programs: { "custom-describer": () => ({ started: false }) },
    });
    const refused = await scan(absent, "--describe");

    expect(refused.code).toBe(4);
    expect(refused.err).toContain(
      "the describer program custom-describer does not start",
    );
  });

  it("gives a sensors gap when recognizer-sensors does not start", async () => {
    const { code, err, fake } = await scan(
      setup("", { version: { started: false } }),
      "--sense",
      "duplication",
    );

    expect(code).toBe(4);
    expect(err).toContain("recognizer-sensors is not installed (duplication)");
    expect(sensorRuns(fake)).toEqual([]);
  });

  it("reports nothing for a describer that is not ticked", async () => {
    const options = setup(REFERENCE, undefined, {
      programs: { "recognizer-describe-claude": () => ({ status: 2 }) },
    });

    expect((await scan(options)).code).toBe(0);
  });
});

describe("scan preflight: the project stage", () => {
  it("checks only ticked sensors", async () => {
    const { code, fake } = await scan(setup(""), "--sense", "duplication,crap");
    const checks = fake.calls.filter((call) => call.args.includes("--check"));

    expect(code).toBe(0);
    expect(checks.map((call) => call.args[0])).toEqual(["duplication", "crap"]);

    for (const check of checks) {
      expect(check.args).not.toContain("--output");
      expect(check.args).not.toContain("--commit");
      expect(check.args).not.toContain("--run");
    }
  });

  it("ignores a note a check prints, so it never blocks the scan", async () => {
    const note = {
      code: "coverage-partial",
      suite: "api",
      line: "suite api: the coverage report covers 1 of 2 scanned Python files",
    };
    const { code, out } = await scan(
      setup("", {
        run: () => ({
          stdout: `${JSON.stringify({ gaps: [], notes: [note] })}\n`,
        }),
      }),
      "--sense",
      "crap",
      "--json",
    );

    expect(code).toBe(0);
    expect(out).not.toContain("coverage-partial");
  });

  it("makes no check for an unticked sensor, so its gap cannot block", async () => {
    const { code, fake } = await scan(
      setup("", gapsFor("crap")),
      "--sense",
      "duplication",
    );

    expect(code).toBe(0);
    expect(
      fake.calls.some(
        (call) => call.args.includes("--check") && call.args[0] === "crap",
      ),
    ).toBe(false);
  });

  it("is exit 4 with the gap, no sensor run, no describer call, and the skipped phases recorded", async () => {
    const described: string[][] = [];
    const options = setup(CUSTOM, gapsFor("crap"), {
      programs: {
        "custom-describer": (args) => {
          described.push(args);

          return { stdout: "a line\n" };
        },
        "recognizer-sensors": () => ({}),
      },
    });
    const { code, out, fake } = await scan(
      options,
      "--describe",
      "--sense",
      "crap",
      "--json",
    );
    const all = events(out);
    const [record] = records(fake);

    expect(code).toBe(4);
    expect(sensorRuns(fake)).toEqual([]);
    expect(described).toEqual([["--version"]]);
    expect(
      all.map((one) => [one.event, one.phase ?? one.state ?? null]),
    ).toEqual([
      ["preflight", "run"],
      ["phase", "extract"],
      ["preflight", "gaps"],
      ["summary", null],
    ]);
    expect(all[2]).toMatchObject({ gaps: [GAP] });
    expect(all[3]).toMatchObject({
      exit: 4,
      skipped: [
        { phase: "describe", reason: "preflight found 1 gap" },
        { phase: "sense", reason: "preflight found 1 gap" },
      ],
    });
    expect(record.skipped).toEqual(all[3]?.skipped);
    expect(record.outcome).toBe("failed");
  });

  it("lists each gap on stderr without --json", async () => {
    const { code, err } = await scan(
      setup("", gapsFor("crap")),
      "--sense",
      "crap",
    );

    expect(code).toBe(4);
    expect(err).toContain(
      "suite api: pytest-cov is not installed in the activated environment (crap): recognizer help sensors crap",
    );
  });

  it("is a check-failed gap when the sensor's check does not answer", async () => {
    const { code, err, out, fake } = await scan(
      setup("", { run: () => ({ status: 2, stderr: "boom\nmore" }) }),
      "--sense",
      "crap",
      "--json",
    );
    const gaps = events(out).find(
      (one) => one.event === "preflight" && one.gaps,
    );

    expect(code).toBe(4);
    expect(err).toBe("");
    expect(gaps).toMatchObject({
      gaps: [
        {
          id: "crap:config:check-failed",
          line: "the readiness check of crap did not answer: boom",
          fix: { kind: "outside", command: null },
        },
      ],
    });
    expect(sensorRuns(fake)).toEqual([]);
  });

  it("emits preflight ok on the passing path", async () => {
    const { code, out } = await scan(
      setup(""),
      "--sense",
      "duplication",
      "--json",
    );

    expect(code).toBe(0);
    expect(events(out).map((one) => one.event)).toEqual([
      "preflight",
      "phase",
      "preflight",
      "phase",
      "start",
      "entry",
      "summary",
    ]);
    expect(events(out)[2]).toEqual({ event: "preflight", state: "ok" });
    expect(events(out).at(-1)).toMatchObject({ skipped: [] });
  });
});

describe("scan preflight: skipped phases and stopped runs", () => {
  it("records the describe per-language skip", async () => {
    const options = setup(CUSTOM, undefined, {
      files: {
        [`${ROOT}/a.py`]: "",
        [CONFIG]: CUSTOM,
        [`${APP_CONFIG}/config.json`]: `${JSON.stringify({ describing: { model: "sonnet", batch_size: 4 } })}\n`,
      },
      scanners: { [PYTHON]: { status: 1, stderr: "boom" } },
      programs: { "custom-describer": () => ({ stdout: "a line\n" }) },
    });
    const { fake, out } = await scan(options, "--describe", "--json");
    const [record] = records(fake);

    expect(events(out).at(-1)).toMatchObject({
      skipped: [{ phase: "describe", reason: "no scan for python" }],
    });
    expect(record.skipped).toEqual([
      { phase: "describe", reason: "no scan for python" },
    ]);
  });

  it("never exits 4 for a describe run that the failure threshold stopped", async () => {
    const options = setup(CUSTOM, undefined, {
      programs: {
        "custom-describer": (args) =>
          args[0] === "--version" ? {} : { status: 1, stderr: "nope" },
      },
    });
    const { code } = await scan(options, "--describe");

    expect(code).toBe(1);
  });
});
