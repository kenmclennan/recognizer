import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { exampleManifest } from "./installed-read.js";
import {
  type FakeOptions,
  fakeIo,
  OFFICIAL_ON_PATH,
  PYTHON,
  ROOT,
  scanJson,
} from "./scan-helpers.js";

const COMMIT = "abc123";
const CONFIG = `${ROOT}/.recognizer/config.yaml`;
const FILE = "/scope/suites.json";
const CONFIG_TEXT = [
  "tests:",
  "  - name: unit",
  "    language: python",
  "    directory: tests/unit",
  "    command: pytest",
  "    coverage: { path: coverage/lcov.info, format: lcov }",
  "  - name: web",
  "    language: python",
  "    directory: web",
  "    command: pytest",
  "    coverage: { path: coverage/lcov.info, format: lcov }",
  "sensors:",
  "  crap: { manifest: [recognizer-sense-crap, manifest] }",
  "  mutation: { manifest: [recognizer-sense-mutation, manifest] }",
  "",
].join("\n");

function findingsFor(name: string) {
  return (args: string[], files: Map<string, string>) => {
    files.set(
      args[args.indexOf("--output") + 1] as string,
      JSON.stringify({
        findings_version: 1,
        sensor: { name, version: "1" },
        commit: COMMIT,
        modified: false,
        settings: {},
        findings: [],
      }),
    );

    return undefined;
  };
}

function setup(selection: string | undefined): FakeOptions {
  return {
    commit: COMMIT,
    files: {
      [`${ROOT}/a.py`]: "",
      [CONFIG]: CONFIG_TEXT,
      ...(selection === undefined ? {} : { [FILE]: selection }),
    },
    scanners: { [PYTHON]: { output: scanJson(1, 0) } },
    sensorManifests: true,
    onPath: OFFICIAL_ON_PATH,
    programs: {
      "installed-sensors": (args, files) =>
        findingsFor(args[0] as string)(args, files),
    },
  };
}

async function scan(selection: string | undefined, ...args: string[]) {
  const fake = fakeIo(setup(selection));
  const code = await run(["scan", ROOT, ...args], fake.io);

  return { code, fake, err: fake.err() };
}

function senseArgs(fake: ReturnType<typeof fakeIo>, name: string) {
  return fake.calls.find(
    (call) =>
      call.command === `recognizer-sense-${name}` && call.args[0] === "run",
  )?.args;
}

function checkArgs(fake: ReturnType<typeof fakeIo>, name: string) {
  return fake.calls.find(
    (call) =>
      call.command === `recognizer-sense-${name}` && call.args[0] === "check",
  )?.args;
}

describe("recognizer scan --suites", () => {
  it("passes the named suites to the tests-running sensor and nothing to a plain one", async () => {
    const { fake, code } = await scan(
      JSON.stringify({ crap: ["unit"] }),
      "--sense",
      "crap,mutation",
      "--suites",
      FILE,
    );

    expect(code).toBe(0);
    expect(senseArgs(fake, "crap")?.slice(-2)).toEqual([
      "--suites",
      '["unit"]',
    ]);
    expect(senseArgs(fake, "mutation")).not.toContain("--suites");
  });

  it("passes the pair to the readiness check of the tests-running sensor", async () => {
    const { fake } = await scan(
      JSON.stringify({ crap: ["web"] }),
      "--sense",
      "crap",
      "--suites",
      FILE,
    );

    const args = checkArgs(fake, "crap");

    if (args !== undefined) {
      expect(
        args.slice(args.indexOf("--suites"), args.indexOf("--suites") + 2),
      ).toEqual(["--suites", '["web"]']);
    }
  });

  it("gives a sensor missing from the object no flag", async () => {
    const { fake } = await scan(
      JSON.stringify({ crap: ["unit"] }),
      "--sense",
      "crap,mutation",
      "--suites",
      FILE,
    );

    expect(senseArgs(fake, "mutation")).not.toContain("--suites");
  });

  it("records the run order of every tests-running sensor's suites on the record", async () => {
    const { fake } = await scan(
      JSON.stringify({ crap: ["web", "unit"] }),
      "--sense",
      "crap,mutation",
      "--suites",
      FILE,
    );

    const record = JSON.parse(
      fake.files.get(`${ROOT}/.recognizer/cache/scan-running.json`) ?? "{}",
    );

    expect(record.version).toBe(5);
    expect(record.suites).toEqual({
      crap: ["unit", "web"],
      mutation: ["unit", "web"],
    });
  });

  it.each([
    ["an unselected sensor", { mutation: ["unit"] }],
    ["an empty array", { crap: [] }],
    ["an unknown suite", { crap: ["nope"] }],
  ])("is exit 2 for %s, before any phase runs", async (_, value) => {
    const { code, err, fake } = await scan(
      JSON.stringify(value),
      "--sense",
      "crap",
      "--suites",
      FILE,
    );

    expect(code).toBe(2);
    expect(err).not.toBe("");
    expect(senseArgs(fake, "crap")).toBeUndefined();
  });

  it("is exit 2 without --sense", async () => {
    const { code, err } = await scan("{}", "--suites", FILE);

    expect(code).toBe(2);
    expect(err).toContain("--suites needs --sense");
  });

  it("is exit 2 with --describe and no --sense", async () => {
    const { code, err } = await scan("{}", "--describe", "--suites", FILE);

    expect(code).toBe(2);
    expect(err).toContain("--suites needs --sense");
  });

  it("is exit 2 for an unreadable file", async () => {
    const { code, err } = await scan(
      undefined,
      "--sense",
      "crap",
      "--suites",
      FILE,
    );

    expect(code).toBe(2);
    expect(err).toContain("cannot read --suites file");
  });
});

describe("recognizer scan --suites with a sensor that does not resolve", () => {
  it("is exit 2 and names the missing program for a bare settings entry", async () => {
    const fake = fakeIo({
      commit: COMMIT,
      files: {
        [`${ROOT}/a.py`]: "",
        [CONFIG]: [
          ...CONFIG_TEXT.split("\n").slice(0, 6),
          "sensors:",
          "  crap: {}",
          "",
        ].join("\n"),
        [FILE]: JSON.stringify({ crap: ["unit"] }),
      },
      scanners: { [PYTHON]: { output: scanJson(1, 0) } },
    });
    const code = await run(
      ["scan", ROOT, "--sense", "crap", "--suites", FILE],
      fake.io,
    );

    expect(fake.err()).not.toBe("");
    expect(code).toBe(2);
    expect(fake.err()).toContain("--suites names crap, which cannot be read");
    expect(fake.err()).toContain("is not installed");
    expect(fake.err()).not.toContain("runs no tests");
  });
});

describe("recognizer scan --suites with a sensor registered by full path", () => {
  it("runs the configured suite", async () => {
    const path = "/opt/sensors/crap-sensor";
    const ran: string[][] = [];
    const fake = fakeIo({
      commit: COMMIT,
      files: {
        [`${ROOT}/a.py`]: "",
        [CONFIG]: [
          ...CONFIG_TEXT.split("\n").slice(0, 6),
          "sensors:",
          `  crap: { command: [${path}, run, --output, "{output}"], manifest: [${path}, manifest] }`,
          "",
        ].join("\n"),
        [FILE]: JSON.stringify({ crap: ["unit"] }),
      },
      scanners: { [PYTHON]: { output: scanJson(1, 0) } },
      programs: {
        [path]: (args, files) => {
          if (args.at(-1) === "manifest") {
            return { stdout: JSON.stringify(exampleManifest("crap")) };
          }

          if (args.includes("check")) {
            return { stdout: `${JSON.stringify({ gaps: [] })}\n` };
          }

          ran.push(args);

          return findingsFor("crap")(args, files);
        },
      },
    });
    const code = await run(
      ["scan", ROOT, "--sense", "crap", "--suites", FILE],
      fake.io,
    );

    expect(fake.err()).toBe("");
    expect(code).toBe(0);
    expect(ran.flat()).toContain('["unit"]');
  });
});
