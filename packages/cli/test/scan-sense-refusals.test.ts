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
const CONFIG = `${ROOT}/.recognizer/config.yaml`;
const FILE = "/scope/suites.json";
const MODULES = "/scope/modules.json";
const SUITES = [
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
];
const REGISTERED = [...SUITES, "sensors:", "  crap: {}", "  mutation: {}", ""];

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

function setup(config: string[], extra: Record<string, string>): FakeOptions {
  return {
    commit: COMMIT,
    files: {
      [`${ROOT}/a.py`]: "",
      [CONFIG]: config.join("\n"),
      ...extra,
    },
    scanners: { [PYTHON]: { output: scanJson(1, 0) } },
    sensorManifests: true,
    programs: {
      "shipped-sensors": (args, files) =>
        findingsFor(args[0] as string)(args, files),
    },
  };
}

async function scan(
  config: string[],
  extra: Record<string, string>,
  ...args: string[]
) {
  const fake = fakeIo(setup(config, extra));
  const code = await run(["scan", ROOT, ...args], fake.io);

  return { code, err: fake.err(), fake };
}

describe("recognizer scan --sense refusals", () => {
  it("refuses an unknown sensor, naming the registered and shipped ones", async () => {
    const { code, err } = await scan(REGISTERED, {}, "--sense", "ghost");

    expect(code).toBe(2);
    expect(err).toContain("no such sensor: ghost\n");
    expect(err).toContain("registered sensors: crap, mutation\n");
    expect(err).toMatch(/shipped sensors: .*crap.*\n/);
  });

  it("refuses duplication as part of structural analysis", async () => {
    const { code, err } = await scan(REGISTERED, {}, "--sense", "duplication");

    expect(code).toBe(2);
    expect(err).toContain(
      "duplication is part of structural analysis and runs with every scan\n",
    );
  });

  it("refuses all when no sensor is registered", async () => {
    const { code, err } = await scan(SUITES, {}, "--sense", "all");

    expect(code).toBe(2);
    expect(err).toContain(
      "no sensors are registered: name one, or add it to .recognizer/config.yaml\n",
    );
  });

  it("refuses a shipped sensor that is not registered", async () => {
    const { code, err } = await scan(SUITES, {}, "--sense", "crap");

    expect(code).toBe(2);
    expect(err).toContain(
      "crap is not registered in .recognizer/config.yaml; register it with `recognizer plugin add crap`.\n",
    );
  });

  it("refuses an unreadable suites file", async () => {
    const { code, err } = await scan(
      REGISTERED,
      {},
      "--sense",
      "crap",
      "--suites",
      FILE,
    );

    expect(code).toBe(2);
    expect(err).toContain(`cannot read --suites file ${FILE}: `);
  });

  it.each([
    ["is not JSON", "{", "--suites file is not valid JSON: "],
    [
      "is not an object",
      "[]",
      "--suites file must be a JSON object from sensor name to an array of suite names\n",
    ],
    [
      "names a sensor that is not selected",
      '{"mutation":["unit"]}',
      "--suites names mutation, which is not selected\n",
    ],
    [
      "names an unknown suite",
      '{"crap":["nope"]}',
      "--suites crap: no such suite: nope\nconfigured suites: unit, web\n",
    ],
  ])("refuses a suites file that %s", async (_, text, message) => {
    const { code, err } = await scan(
      REGISTERED,
      { [FILE]: text },
      "--sense",
      "crap",
      "--suites",
      FILE,
    );

    expect(code).toBe(2);
    expect(err).toContain(message);
  });

  it("runs a sensor with a suites file and a modules file", async () => {
    const { code, fake } = await scan(
      REGISTERED,
      { [FILE]: '{"crap":["unit"]}', [MODULES]: '["a.py"]' },
      "--sense",
      "crap",
      "--suites",
      FILE,
      "--modules",
      MODULES,
    );

    expect(code).toBe(0);
    expect(
      fake.calls.find(
        (call) =>
          call.command === "recognizer-sense-crap" && call.args[0] === "run",
      )?.args,
    ).toContain("--suites");
  });
});
