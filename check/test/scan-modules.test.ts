import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import {
  type FakeOptions,
  fakeIo,
  PYTHON,
  ROOT,
  scanJson,
} from "./scan-helpers.js";

const COMMIT = "abc123";
const PY_CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;
const CONFIG = `${ROOT}/.recognizer/config.yaml`;
const FILE = "/scope/modules.json";
const DESCRIBER =
  'describer:\n  command: [describer, "{module}"]\n  version: "v1"\nsensors:\n  crap: {}\n  mutation: {}\n  thresholds: {}\n';

function current(): string {
  return scanJson(3, 1, {
    commit: COMMIT,
    modified: false,
    files: [
      { path: "m0.py", hash: "0".repeat(64) },
      { path: "m1.py", hash: "1".repeat(64) },
      { path: "m2.py", hash: "2".repeat(64) },
    ],
  });
}

function findingsFor(name: string) {
  return (args: string[], files: Map<string, string>) => {
    files.set(
      args[args.length - 1] as string,
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

function setup(scope: string | undefined): FakeOptions {
  return {
    commit: COMMIT,
    files: {
      [`${ROOT}/a.py`]: "",
      [`${ROOT}/m0.py`]: "zero",
      [`${ROOT}/m1.py`]: "one",
      [`${ROOT}/m2.py`]: "two",
      [PY_CACHE]: current(),
      [CONFIG]: DESCRIBER,
      ...(scope === undefined ? {} : { [FILE]: scope }),
    },
    scanners: { [PYTHON]: { output: current() } },
    sensorManifests: true,
    programs: {
      describer: () => ({ stdout: "a line\n" }),
      "shipped-sensors": (args, files) =>
        findingsFor(args[0] as string)(args, files),
    },
  };
}

async function scan(scope: string | undefined, ...args: string[]) {
  const fake = fakeIo(setup(scope));
  const code = await run(["scan", ROOT, ...args], fake.io);

  return { code, fake, out: fake.out(), err: fake.err() };
}

function describeTotal(out: string): unknown {
  return out
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line))
    .find((event) => event.event === "phase" && event.phase === "describe")
    ?.total;
}

function senseArgs(fake: ReturnType<typeof fakeIo>, name: string) {
  return fake.calls.find(
    (call) =>
      call.command === `recognizer-sense-${name}` && call.args[0] === "run",
  )?.args;
}

describe("recognizer scan --modules", () => {
  it("limits the describe phase to the named modules and reports their count as the total", async () => {
    const { code, out } = await scan(
      JSON.stringify(["m0.py", "m2.py"]),
      "--describe",
      "--modules",
      FILE,
      "--json",
    );

    expect(code).toBe(0);
    expect(describeTotal(out)).toBe(2);
    expect(out).toContain('"name":"m0.py"');
    expect(out).toContain('"name":"m2.py"');
    expect(out).not.toContain('"name":"m1.py"');
  });

  it("describes all the named modules with =all and still only those", async () => {
    const { out } = await scan(
      JSON.stringify(["m1.py"]),
      "--describe=all",
      `--modules=${FILE}`,
      "--json",
    );

    expect(describeTotal(out)).toBe(1);
  });

  it("keeps only the stale modules among the named ones", async () => {
    const fake = fakeIo(setup(JSON.stringify(["m0.py", "m1.py"])));

    await run(["scan", ROOT, "--describe", "--modules", FILE], fake.io);
    await run(["scan", ROOT, "--describe", "--modules", FILE], fake.io);

    expect(fake.out()).toContain("described 0, failed 0, already current 2");
  });

  it("skips an id that is not in the scan with one stderr line and exit 0", async () => {
    const { code, err, out } = await scan(
      JSON.stringify(["m0.py", "gone.py", "also-gone.py"]),
      "--describe",
      "--modules",
      FILE,
    );

    expect(code).toBe(0);
    expect(err).toContain("skipped: no such module gone.py\n");
    expect(err).toContain("skipped: no such module also-gone.py\n");
    expect(out).toContain("described m0.py");
  });

  it("is exit 2 with neither --describe nor --sense", async () => {
    const { code, err } = await scan(
      JSON.stringify(["m0.py"]),
      "--modules",
      FILE,
    );

    expect(code).toBe(2);
    expect(err).toContain("--modules needs --describe or --sense");
  });

  it.each([
    ["not json", "not json"],
    ["not an array", '{"a":1}'],
    ["an empty id", '["m0.py",""]'],
    ["a non-string", "[1]"],
  ])(
    "is exit 2 for a file that is %s, before any phase runs",
    async (_, text) => {
      const { code, out } = await scan(text, "--describe", "--modules", FILE);

      expect(code).toBe(2);
      expect(out).toBe("");
    },
  );

  it("is exit 2 for an unreadable file", async () => {
    const { code, err } = await scan(
      undefined,
      "--describe",
      "--modules",
      FILE,
    );

    expect(code).toBe(2);
    expect(err).toContain("cannot read --modules file");
  });

  it("passes the file to the mutation sensor only", async () => {
    const { fake } = await scan(
      JSON.stringify(["m0.py"]),
      "--sense",
      "mutation,thresholds,crap",
      "--modules",
      FILE,
    );

    expect(senseArgs(fake, "mutation")).toContain("--modules");
    expect(senseArgs(fake, "mutation")?.slice(-2)).toEqual(["--modules", FILE]);
    expect(senseArgs(fake, "thresholds")).not.toContain("--modules");
    expect(senseArgs(fake, "crap")).not.toContain("--modules");
  });

  it("passes no scope argument to a registered command", async () => {
    const options = setup(JSON.stringify(["m0.py"]));
    options.files = {
      ...options.files,
      [CONFIG]:
        'sensors:\n  mine:\n    command: [recognizer-sensors, mutation, "{output}"]\n  other:\n    command: [other-sensor, "{output}"]\n',
    };
    options.programs = {
      ...options.programs,
      "other-sensor": (args, files) => findingsFor("other")(args, files),
    };

    const fake = fakeIo(options);

    await run(["scan", ROOT, "--sense", "other", "--modules", FILE], fake.io);

    const call = fake.calls.find((one) => one.command === "other-sensor");

    expect(call?.args).not.toContain("--modules");
  });
});
