import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { answerPath, markerPath, progressPath } from "../src/scan-marker.js";
import {
  APP_CONFIG,
  describerManifestText,
  type FakeOptions,
  fakeIo,
  PYTHON,
  ROOT,
  scanJson,
  scannerManifestText,
  TYPESCRIPT,
} from "./scan-helpers.js";

const PY_CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;
const TS_CACHE = `${ROOT}/.recognizer/cache/scan.typescript.json`;

async function scan(options: FakeOptions, ...args: string[]) {
  const fake = fakeIo(options);
  const code = await run(["scan", ROOT, ...args], fake.io);

  return { code, fake, out: fake.out(), err: fake.err() };
}

function lines(out: string): Record<string, unknown>[] {
  return out
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

function both(extra: Record<string, string> = {}): Record<string, string> {
  return { [`${ROOT}/a.py`]: "", [`${ROOT}/b.ts`]: "", ...extra };
}

const okPython = { output: scanJson(2, 1) };
const okTypescript = { output: scanJson(3, 2) };

describe("recognizer scan: command building", () => {
  it("passes the exact argv with a commit", async () => {
    const { fake } = await scan({
      files: both(),
      commit: "abc123",
      scanners: { [PYTHON]: okPython, [TYPESCRIPT]: okTypescript },
    });

    expect(fake.calls).toEqual([
      { command: "git", args: ["-C", ROOT, "rev-parse", "HEAD"] },
      {
        command: "git",
        args: ["-C", ROOT, "status", "--porcelain", "--", ".", ":!.recognizer"],
      },
      {
        command: PYTHON,
        args: [
          "run",
          ROOT,
          "--output",
          "/tmp/fake-0/scan.python.json",
          "--commit",
          "abc123",
          "--modified",
          "false",
        ],
      },
      {
        command: TYPESCRIPT,
        args: [
          "run",
          ROOT,
          "--output",
          "/tmp/fake-1/scan.typescript.json",
          "--commit",
          "abc123",
          "--modified",
          "false",
        ],
      },
    ]);
  });

  it("scans a repository holding only .js files with the typescript scanner", async () => {
    const { fake, code } = await scan({
      files: { [`${ROOT}/index.js`]: "" },
      scanners: { [TYPESCRIPT]: okTypescript },
    });

    expect(code).toBe(0);
    expect(fake.calls.map((call) => call.command)).toContain(TYPESCRIPT);
    expect(fake.calls.map((call) => call.command)).not.toContain(PYTHON);
  });

  it("passes --modified true when the tree has uncommitted changes", async () => {
    const { fake } = await scan({
      files: { [`${ROOT}/a.py`]: "" },
      commit: "abc123",
      status: " M a.py\n",
      scanners: { [PYTHON]: okPython },
    });

    const args = fake.calls.find((call) => call.command === PYTHON)?.args;

    expect(args?.slice(-2)).toEqual(["--modified", "true"]);
  });

  it("omits --commit and --modified outside git", async () => {
    const { fake } = await scan({
      files: both(),
      scanners: { [PYTHON]: okPython, [TYPESCRIPT]: okTypescript },
    });

    expect(fake.calls.slice(1).map((call) => call.args)).toEqual([
      ["run", ROOT, "--output", "/tmp/fake-0/scan.python.json"],
      ["run", ROOT, "--output", "/tmp/fake-1/scan.typescript.json"],
    ]);
  });

  it("runs the absolute path discovery found, not the bare name", async () => {
    const { fake } = await scan({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: okPython },
    });
    const io = fake.io;

    expect(io.env("PATH")).toBe("/fakebin");
    expect(fake.manifestReads).toEqual([PYTHON]);
  });

  it("reads one manifest per installed scanner per scan", async () => {
    const { fake } = await scan({
      files: both(),
      scanners: {
        [PYTHON]: okPython,
        [TYPESCRIPT]: okTypescript,
        "recognizer-scan-kotlin": {},
      },
    });

    expect([...fake.manifestReads].sort()).toEqual([
      "recognizer-scan-kotlin",
      PYTHON,
      TYPESCRIPT,
    ]);
  });
});

describe("recognizer scan: scanner choice", () => {
  it("detects no language that no installed scanner claims", async () => {
    const { code, err, fake } = await scan({
      files: { [`${ROOT}/A.kt`]: "" },
      scanners: { [PYTHON]: okPython },
    });

    expect(code).toBe(0);
    expect(err).toContain("no languages detected");
    expect(fake.calls.map((call) => call.command)).not.toContain(PYTHON);
  });

  it("says no scanner is installed when none is", async () => {
    const { code, err } = await scan({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: {},
    });

    expect(code).toBe(0);
    expect(err).toBe(
      "no scanner is installed: recognizer plugins lists what is installed\nno languages detected\n",
    );
  });

  it("scans a language no shipped scanner knows with the scanner that claims it", async () => {
    const { code, fake } = await scan({
      files: { [`${ROOT}/Sources/App.swift`]: "" },
      scanners: {
        "recognizer-scan-swift": {
          output: scanJson(1, 0, {
            modules: [
              {
                id: "Sources/App.swift",
                language: "swift",
                kind: "module",
                members: [],
              },
            ],
            edges: [],
          }),
        },
      },
    });

    expect(code).toBe(0);
    expect(fake.files.has(`${ROOT}/.recognizer/cache/scan.swift.json`)).toBe(
      true,
    );
  });

  it("fails a language with ambiguous-scanner when two claim it and the config names none, and still scans the rest", async () => {
    const { code, err, fake } = await scan({
      files: both(),
      scanners: {
        [PYTHON]: okPython,
        "recognizer-scan-python-alt": {
          languages: ["python"],
          output: scanJson(1, 0),
        },
        [TYPESCRIPT]: okTypescript,
      },
    });

    expect(code).toBe(1);
    expect(err).toContain("python: ambiguous-scanner - ");
    expect(fake.files.has(PY_CACHE)).toBe(false);
    expect(fake.files.has(TS_CACHE)).toBe(true);
  });

  it("runs the scanner the config names when two claim the language", async () => {
    const { code, fake } = await scan({
      files: {
        [`${ROOT}/a.py`]: "",
        [`${ROOT}/.recognizer/config.yaml`]:
          "scanners:\n  python: python-alt\n",
      },
      scanners: {
        [PYTHON]: okPython,
        "recognizer-scan-python-alt": {
          languages: ["python"],
          output: scanJson(1, 0),
        },
      },
    });

    expect(code).toBe(0);
    expect(fake.calls.map((call) => call.command)).toContain(
      "recognizer-scan-python-alt",
    );
    expect(fake.calls.map((call) => call.command)).not.toContain(PYTHON);
  });

  it("fails invalid-choice when the config names an installed scanner that does not claim the language", async () => {
    const { code, err, fake } = await scan({
      files: {
        [`${ROOT}/a.py`]: "",
        [`${ROOT}/.recognizer/config.yaml`]:
          "scanners:\n  python: typescript\n",
      },
      scanners: { [PYTHON]: okPython, [TYPESCRIPT]: okTypescript },
    });

    expect(code).toBe(1);
    expect(err).toContain("python: invalid-choice - ");
    expect(fake.calls.map((call) => call.command)).not.toContain(PYTHON);
  });

  it("fails not-installed when the config names a scanner that is not installed", async () => {
    const { code, err } = await scan({
      files: {
        [`${ROOT}/a.py`]: "",
        [`${ROOT}/.recognizer/config.yaml`]: "scanners:\n  python: gone\n",
      },
      scanners: { [PYTHON]: okPython },
    });

    expect(code).toBe(1);
    expect(err).toContain("python: not-installed - ");
  });

  it("never starts run on a scanner whose protocol is unsupported", async () => {
    const { code, err, fake } = await scan({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { ...okPython, protocol: 9 } },
    });

    expect(code).toBe(1);
    expect(err).toContain("python: unsupported-protocol - ");
    expect(err).toContain("install brew install");
    expect(fake.calls.map((call) => call.command)).not.toContain(PYTHON);
  });
});

describe("recognizer scan: outcomes", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["not-installed", { [PYTHON]: { unstartable: true } }, "not-installed"],
    [
      "scanner-failed",
      { [PYTHON]: { status: 3, stderr: "boom" } },
      "scanner-failed",
    ],
    [
      "invalid-scan (not JSON)",
      { [PYTHON]: { output: "nope" } },
      "invalid-scan",
    ],
    [
      "invalid-scan (schema fault)",
      { [PYTHON]: { output: scanJson(1, 0, { modules: "x" }) } },
      "invalid-scan",
    ],
    ["invalid-scan (no output file)", { [PYTHON]: {} }, "invalid-scan"],
    [
      "unknown-schema-version",
      { [PYTHON]: { output: scanJson(1, 0, { schema_version: 1 }) } },
      "unknown-schema-version",
    ],
    [
      "unknown-schema-version (a version-5 scan)",
      { [PYTHON]: { output: scanJson(1, 0, { schema_version: 5 }) } },
      "unknown-schema-version",
    ],
  ];

  it.each(cases)(
    "%s writes nothing, removes the old file and still runs the other language",
    async (_, scanners, reason) => {
      const { fake, code, err } = await scan({
        files: both({ [PY_CACHE]: "old" }),
        scanners: {
          [TYPESCRIPT]: okTypescript,
          ...(scanners as FakeOptions["scanners"]),
        },
      });

      expect(code).toBe(1);
      expect(err).toContain(`python: ${reason} - `);
      expect(fake.files.has(PY_CACHE)).toBe(false);
      expect(fake.removed).toContain(PY_CACHE);
      expect(fake.files.get(TS_CACHE)).toBe(okTypescript.output);
    },
  );

  it("names the version found and the version accepted", async () => {
    const { err } = await scan({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { output: scanJson(1, 0, { schema_version: 1 }) } },
    });

    expect(err).toContain("schema_version 1");
    expect(err).toContain("accepts 7");
  });

  it("refuses a version-2 scan naming both versions", async () => {
    const { err } = await scan({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { output: scanJson(1, 0, { schema_version: 2 }) } },
    });

    expect(err).toContain("schema_version 2");
    expect(err).toContain("accepts 7");
  });

  it("carries the scanner's stderr", async () => {
    const { err } = await scan({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { status: 2, stderr: "bad root" } },
    });

    expect(err).toContain("bad root");
  });

  it("records the stderr of a successful typescript scan in the run log", async () => {
    const stderr = "skipped project vue: vue/tsconfig.app.json: not found\n";
    const { code, fake } = await scan({
      files: { [`${ROOT}/b.ts`]: "" },
      scanners: { [TYPESCRIPT]: { output: scanJson(3, 2), stderr } },
    });
    const record = [...fake.files.keys()]
      .filter((key) => key.startsWith(`${ROOT}/.recognizer/cache/log/`))
      .map((key) => JSON.parse(fake.files.get(key) as string))[0];
    const entry = record.phases[0].entries.find(
      (one: { name: string }) => one.name === "typescript",
    );

    expect(code).toBe(0);
    expect(entry.outcome).toBe("ok");
    expect(entry.stderr).toContain("skipped project vue");
  });

  it("removes the temporary directories on every path", async () => {
    const { fake } = await scan({
      files: both(),
      scanners: {
        [PYTHON]: { status: 1 },
        [TYPESCRIPT]: { unstartable: true },
      },
    });

    expect(
      [...fake.files.keys()].filter((key) => key.startsWith("/tmp/")),
    ).toEqual([]);
    expect(fake.tempDirs()).toHaveLength(2);
  });

  it("reports one written and one failed language in --json, exit 1", async () => {
    const { code, out, fake } = await scan(
      {
        files: both(),
        scanners: { [PYTHON]: okPython, [TYPESCRIPT]: { unstartable: true } },
      },
      "--json",
    );
    const events = lines(out);

    expect(code).toBe(1);
    expect(events.filter((one) => one.event === "entry")).toEqual([
      {
        event: "entry",
        phase: "extract",
        name: "python",
        outcome: "ok",
        modules: 2,
        edges: 1,
      },
      {
        event: "entry",
        phase: "extract",
        name: "typescript",
        outcome: "failed",
        reason: expect.stringContaining("not-installed"),
      },
    ]);
    expect(fake.files.has(PY_CACHE)).toBe(true);
    expect(fake.files.has(TS_CACHE)).toBe(false);
  });

  it("handles the reverse mix", async () => {
    const { code, fake } = await scan({
      files: both(),
      scanners: {
        [PYTHON]: { unstartable: true },
        [TYPESCRIPT]: okTypescript,
      },
    });

    expect(code).toBe(1);
    expect(fake.files.has(TS_CACHE)).toBe(true);
    expect(fake.files.has(PY_CACHE)).toBe(false);
  });

  it("writes the scanner's bytes exactly", async () => {
    const odd = scanJson(1, 0, {}, "\t   ");
    const { fake } = await scan({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { output: odd } },
    });

    expect(fake.files.get(PY_CACHE)).toBe(odd);
  });
});

describe("recognizer scan: stale files", () => {
  it("removes a stale file for an undetected language and lists it", async () => {
    const { fake, out, code, err } = await scan(
      {
        files: {
          [`${ROOT}/a.py`]: "",
          [TS_CACHE]: "old",
          [`${ROOT}/.recognizer/cache/overlay.json`]: "keep",
        },
        scanners: { [PYTHON]: okPython },
      },
      "--json",
    );

    expect(code).toBe(0);
    expect(lines(out).at(-1)?.removed).toEqual([TS_CACHE]);
    expect(err).toBe(
      "typescript: removed stale .recognizer/cache/scan.typescript.json\n",
    );
    expect(fake.files.has(TS_CACHE)).toBe(false);
    expect(fake.files.get(`${ROOT}/.recognizer/cache/overlay.json`)).toBe(
      "keep",
    );
  });

  it("removes the cached scan of a language whose only files are in an ignored folder", async () => {
    const KT_CACHE = `${ROOT}/.recognizer/cache/scan.kotlin.json`;
    const { fake, err } = await scan({
      files: {
        [`${ROOT}/a.py`]: "",
        [`${ROOT}/bin/A.kt`]: "",
        [KT_CACHE]: "old",
      },
      tracked: ["a.py", ".gitignore"],
      scanners: { [PYTHON]: okPython },
    });

    expect(err).toContain(
      "kotlin: removed stale .recognizer/cache/scan.kotlin.json\n",
    );
    expect(fake.files.has(KT_CACHE)).toBe(false);
  });

  it("exits 0 with no languages, creates no directory and still removes stale files", async () => {
    const { fake, code, err } = await scan({
      files: { [`${ROOT}/readme.md`]: "", [PY_CACHE]: "old" },
    });

    expect(code).toBe(0);
    expect(err).toContain("no languages detected\n");
    expect(fake.writes).toEqual([]);
    expect(fake.removed).toEqual([PY_CACHE]);
    expect(fake.calls.map((call) => call.command)).toEqual(["git"]);
  });

  it("reports log null in the summary when no record was written", async () => {
    const { out } = await scan(
      { files: { [`${ROOT}/readme.md`]: "" } },
      "--json",
    );

    expect(lines(out).at(-1)?.log).toBeNull();
  });

  it("creates no cache directory when nothing is detected", async () => {
    const { fake } = await scan({ files: { [`${ROOT}/readme.md`]: "" } });

    expect(
      [...fake.files.keys()].some(
        (key) => key.includes(".recognizer") && !key.includes("scan-running"),
      ),
    ).toBe(false);
  });
});

describe("recognizer scan: summary", () => {
  const options: FakeOptions = {
    files: both(),
    commit: "abc123",
    scanners: { [PYTHON]: okPython, [TYPESCRIPT]: okTypescript },
  };

  it("prints one human line per written language", async () => {
    const { out, err, code } = await scan(options);

    expect(code).toBe(0);
    expect(out).toBe(
      "extract\npython: 2 modules, 1 edges -> .recognizer/cache/scan.python.json\ntypescript: 3 modules, 2 edges -> .recognizer/cache/scan.typescript.json\n",
    );
    expect(err).toBe("");
  });

  it("prints one line per event, ending in the summary", async () => {
    const { out } = await scan(options, "--json");

    expect(lines(out)).toEqual([
      { event: "preflight", state: "run" },
      {
        event: "phase",
        phase: "extract",
        state: "run",
        commit: "abc123",
        reason: "no-scan:python",
      },
      {
        event: "entry",
        phase: "extract",
        name: "python",
        outcome: "ok",
        modules: 2,
        edges: 1,
      },
      {
        event: "entry",
        phase: "extract",
        name: "typescript",
        outcome: "ok",
        modules: 3,
        edges: 2,
      },
      { event: "preflight", state: "ok" },
      {
        event: "summary",
        repository: ROOT,
        commit: "abc123",
        modified: false,
        exit: 0,
        phases: [
          {
            phase: "extract",
            entries: [
              { name: "python", outcome: "ok", modules: 2, edges: 1 },
              { name: "typescript", outcome: "ok", modules: 3, edges: 2 },
            ],
          },
        ],
        removed: [],
        skipped: [],
        log: "20261102T000000001Z-scan",
      },
    ]);
  });

  it("reports commit null outside git", async () => {
    const { out } = await scan({ ...options, commit: undefined }, "--json");

    expect(lines(out).at(-1)?.commit).toBeNull();
  });

  it("leaves stderr lines unchanged under --json", async () => {
    const failing: FakeOptions = {
      files: both(),
      scanners: { [PYTHON]: okPython },
    };

    expect((await scan(failing, "--json")).err).toBe((await scan(failing)).err);
  });
});

describe("recognizer scan: usage", () => {
  const cases: [string, string[]][] = [
    ["no subcommand", []],
    ["unknown subcommand", ["frobnicate"]],
    ["unknown flag", ["scan", ROOT, "--bogus"]],
    ["two repositories", ["scan", ROOT, ROOT]],
    ["a file as repository", ["scan", `${ROOT}/a.py`]],
    ["check with --json", ["check", "--scan", "x.json", "--json"]],
  ];

  it.each(cases)("%s is exit 2 and writes nothing", async (_, argv) => {
    const fake = fakeIo({ files: { [`${ROOT}/a.py`]: "" } });

    expect(await run(argv, fake.io)).toBe(2);
    expect(fake.writes).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("names every command in the usage line", async () => {
    const fake = fakeIo();

    await run([], fake.io);

    expect(fake.err()).toContain(
      "usage: recognizer <check|scan|open|uses|used-by|callers|path|find|show|modules|views|sensors|config|policy|doctor|plugin|plugins|windows|window|describe|report|log|agents|help> ...",
    );
  });
});

describe("recognizer scan: phases", () => {
  const COMMIT = "abc123";
  const CONFIG = `${ROOT}/.recognizer/config.yaml`;
  const STRUCTURE = `${ROOT}/.recognizer/cache/findings/structure.json`;
  const LOG = `${ROOT}/.recognizer/cache/log`;
  const SENSORS =
    'sensors:\n  first:\n    command: [first-sensor, "{commit}", "{output}"]\n  second:\n    command: [second-sensor, "{commit}", "{output}"]\n';
  const DESCRIBER =
    'describer:\n  command: [describer, "{module}"]\n  version: "v1"\n';

  function current(changes: Record<string, unknown> = {}): string {
    return scanJson(2, 1, {
      commit: COMMIT,
      modified: false,
      files: [
        { path: "m0.py", hash: "0".repeat(64) },
        { path: "m1.py", hash: "1".repeat(64) },
      ],
      ...changes,
    });
  }

  function findings(name: string) {
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

  function setup(
    changes: FakeOptions = {},
    files: Record<string, string> = {},
  ): FakeOptions {
    return {
      commit: COMMIT,
      files: {
        [`${ROOT}/a.py`]: "",
        [`${ROOT}/m0.py`]: "one",
        [`${ROOT}/m1.py`]: "two",
        [PY_CACHE]: current(),
        ...files,
      },
      scanners: { [PYTHON]: { output: current() } },
      programs: {
        describer: () => ({ stdout: "a line\n" }),
        "first-sensor": findings("first"),
        "second-sensor": findings("second"),
      },
      ...changes,
    };
  }

  function records(fake: ReturnType<typeof fakeIo>) {
    return [...fake.files.keys()]
      .filter((key) => key.startsWith(`${LOG}/`))
      .map((key) => JSON.parse(fake.files.get(key) as string));
  }

  function extractCalls(fake: ReturnType<typeof fakeIo>) {
    return fake.calls
      .filter((call) => call.command === PYTHON)
      .map((call) => call.args);
  }

  it("skips extraction on current scans, probing only the scanner version", async () => {
    const { out, fake, code } = await scan(setup());

    expect(code).toBe(0);
    expect(out).toBe(`extract\nscans current at ${COMMIT}\n`);
    expect(extractCalls(fake)).toEqual([["--version"]]);
    expect(fake.tempDirs()).toEqual([]);
  });

  it("runs the structure sensor on current scans and writes its findings", async () => {
    const { fake } = await scan(setup());

    expect(fake.files.has(STRUCTURE)).toBe(true);
    expect(records(fake)[0].phases).toEqual([
      { phase: "extract", entries: [] },
    ]);
  });

  it("writes the structure findings after extracting too", async () => {
    const { fake } = await scan(
      setup({}, { [PY_CACHE]: current({ commit: "old" }) }),
    );

    expect(fake.files.has(STRUCTURE)).toBe(true);
  });

  it("removes the structure findings when the sensor is off", async () => {
    const { fake } = await scan(
      setup(
        {},
        {
          [CONFIG]: "sensors:\n  structure: off\n",
          [STRUCTURE]: "stale",
        },
      ),
    );

    expect(fake.files.has(STRUCTURE)).toBe(false);
    expect(fake.removed).toContain(STRUCTURE);
  });

  it.each<[string, FakeOptions, Record<string, string>, string, string[]]>([
    ["no cached scan", setup(), { [PY_CACHE]: "" }, "no-scan:python", []],
    [
      "a moved commit",
      setup(),
      { [PY_CACHE]: current({ commit: "old" }) },
      "commit-changed",
      [],
    ],
    [
      "a scan taken dirty",
      setup(),
      { [PY_CACHE]: current({ modified: true }) },
      "dirty",
      [],
    ],
    ["a dirty tree", { ...setup(), status: " M a.py\n" }, {}, "dirty", []],
    [
      "an edited gitignore",
      { ...setup(), status: " M .gitignore\n" },
      {},
      "dirty",
      [],
    ],
    [
      "a different scanner version",
      {
        ...setup(),
        scanners: { [PYTHON]: { output: current(), version: "9.9.9" } },
      },
      {},
      "scanner-version:python",
      ["--version"],
    ],
  ])("extracts for %s", async (_, options, files, reason, probes) => {
    const merged = {
      ...options,
      files: { ...options.files, ...files },
    };

    if (files[PY_CACHE] === "") {
      delete merged.files[PY_CACHE];
    }

    const { out, fake } = await scan(merged, "--json");
    const first = lines(out)[1];

    expect(first).toMatchObject({ state: "run", reason });
    expect(
      extractCalls(fake).filter((args) => args[0] === "--version"),
    ).toEqual(probes.length === 0 ? [] : [probes]);
    expect(extractCalls(fake).some((args) => args.includes("--output"))).toBe(
      true,
    );
  });

  it("extracts with --extract on a current tree", async () => {
    const { out, fake } = await scan(setup(), "--extract", "--json");

    expect(lines(out)[1]).toMatchObject({ state: "run", reason: "forced" });
    expect(extractCalls(fake)).toHaveLength(1);
    expect(extractCalls(fake)[0]).toContain("--output");
  });

  it("runs extract, describe and sense in that order and records them", async () => {
    const { out, fake, code } = await scan(
      setup({}, { [CONFIG]: `${DESCRIBER}${SENSORS}` }),
      "--describe",
      "--sense",
      "all",
    );

    expect(code).toBe(0);
    expect(out).toMatch(
      /describe\nprojection: 2 modules, ~\d+ input tokens, ~\$[\d.]+ \(.+, API-equivalent estimate\)\ndescribed m0\.py/,
    );
    expect(out.replace(/projection: .*\n/, "")).toBe(
      `extract\nscans current at ${COMMIT}\ndescribe\ndescribed m0.py\ndescribed m1.py\ndescribed 2, failed 0, already current 0\nsense\nran first\nran second\n`,
    );

    const [record] = records(fake);

    expect(record.kind).toBe("scan");
    expect(record.outcome).toBe("ok");
    expect(record.phases.map((one: { phase: string }) => one.phase)).toEqual([
      "extract",
      "describe",
      "sense",
    ]);
    expect(
      record.phases[1].entries.map((one: { name: string }) => one.name),
    ).toEqual(["m0.py", "m1.py"]);
    expect(records(fake)).toHaveLength(1);
  });

  it("leaves absent phases out of the output and the record", async () => {
    const { fake, out } = await scan(
      setup({}, { [CONFIG]: `${DESCRIBER}${SENSORS}` }),
    );

    expect(out).not.toContain("describe");
    expect(out).not.toContain("sense");
    expect(records(fake)[0].phases).toHaveLength(1);
  });

  it("describes everything with --describe=all and only stale lines without", async () => {
    const files = { [CONFIG]: DESCRIBER };
    const first = await scan(setup({}, files), "--describe");

    expect(first.out).toContain("described 2, failed 0, already current 0");

    const again = fakeIo(setup({}, files));

    await run(["scan", ROOT, "--describe"], again.io);
    await run(["scan", ROOT, "--describe"], again.io);

    expect(again.out()).toContain("described 0, failed 0, already current 2");

    await run(["scan", ROOT, "--describe=all"], again.io);

    expect(again.out()).toContain("described 2, failed 0, already current 0");
  });

  it("fails the run after the remaining entries when a describer entry fails", async () => {
    const calls: string[] = [];
    const { code, fake, err } = await scan(
      setup(
        {
          programs: {
            describer: (args) => {
              if (args[0] === "--version") {
                return { stdout: "1\n" };
              }

              calls.push(args[0] as string);

              return args[0] === "m0.py"
                ? { status: 1, stderr: "nope" }
                : { stdout: "ok\n" };
            },
          },
        },
        { [CONFIG]: DESCRIBER },
      ),
      "--describe",
    );

    expect(code).toBe(1);
    expect(calls).toEqual(["m0.py", "m1.py"]);
    expect(err).toContain("failed m0.py: nope");
    expect(records(fake)[0].outcome).toBe("failed");
  });

  it("reports a describer that hit the usage limit as a stopped event before the summary", async () => {
    const limited = setup(
      {
        programs: {
          describer: (args) =>
            args[0] === "m0.py"
              ? { status: 75, stderr: "claude usage limit: out of quota" }
              : { stdout: "ok\n" },
        },
      },
      { [CONFIG]: DESCRIBER },
    );
    const { code, out } = await scan(limited, "--describe", "--json");
    const events = lines(out).map((line) => line.event);
    const stopped = lines(out).find((line) => line.event === "stopped");

    expect(code).toBe(1);
    expect(stopped).toMatchObject({
      event: "stopped",
      phase: "describe",
      cause: "limit",
      reason: "claude usage limit: out of quota",
    });
    expect(events.indexOf("stopped")).toBeGreaterThan(
      events.lastIndexOf("entry", events.indexOf("stopped")),
    );
    expect(events.indexOf("stopped")).toBeLessThan(events.indexOf("summary"));
  });

  it("emits the projection event immediately before the describe phase event", async () => {
    const { out } = await scan(
      setup({}, { [CONFIG]: DESCRIBER }),
      "--describe",
      "--json",
    );
    const all = lines(out);
    const at = all.findIndex((line) => line.event === "projection");

    expect(at).toBeGreaterThan(-1);
    expect(all[at]).toMatchObject({
      event: "projection",
      phase: "describe",
      modules: 2,
    });
    expect(all[at + 1]).toMatchObject({ event: "phase", phase: "describe" });
  });

  it("prints the projection as the first line after the describe heading", async () => {
    const { out } = await scan(
      setup({}, { [CONFIG]: DESCRIBER }),
      "--describe",
    );
    const rows = out.split("\n");
    const heading = rows.indexOf("describe");

    expect(heading).toBeGreaterThan(-1);
    expect(rows[heading + 1]).toMatch(
      /^projection: 2 modules, ~\d+ input tokens, ~\$[\d.]+ \(.+, API-equivalent estimate\)$/,
    );
  });

  describe("--confirm-above", () => {
    const ask = async (
      answers: (string | null)[],
      ...args: string[]
    ): Promise<{
      events: Record<string, unknown>[];
      reads: number;
      described: number;
    }> => {
      const reads = { count: 0 };
      const options = setup({}, { [CONFIG]: DESCRIBER });
      const { out } = await scan(
        { ...options, lines: [...answers], linesRead: reads },
        "--describe",
        "--json",
        ...args,
      );
      const events = lines(out);

      return {
        events,
        reads: reads.count,
        described: events.filter(
          (line) => line.event === "entry" && line.phase === "describe",
        ).length,
      };
    };

    it("asks and describes when the answer is describe", async () => {
      const result = await ask(["describe"], "--confirm-above", "0.0001");
      const confirm = result.events.find((line) => line.event === "confirm");

      expect(confirm).toMatchObject({
        event: "confirm",
        phase: "describe",
        modules: 2,
      });
      expect(result.reads).toBe(1);
      expect(result.described).toBe(2);
    });

    it("skips describing when the answer is skip, reporting total 0", async () => {
      const result = await ask(["skip"], "--confirm-above", "0.0001");
      const phase = result.events.find(
        (line) => line.event === "phase" && line.phase === "describe",
      );

      expect(phase).toMatchObject({ total: 0 });
      expect(result.described).toBe(0);
    });

    it("skips describing at end of input", async () => {
      const result = await ask([], "--confirm-above", "0.0001");

      expect(result.reads).toBe(1);
      expect(result.described).toBe(0);
    });

    it("reads nothing when the estimate is not above the value", async () => {
      const result = await ask(["skip"], "--confirm-above", "5");

      expect(result.events.some((line) => line.event === "confirm")).toBe(
        false,
      );
      expect(result.reads).toBe(0);
      expect(result.described).toBe(2);
    });

    it("never reads input without the flag", async () => {
      const result = await ask(["skip"]);

      expect(result.reads).toBe(0);
      expect(result.described).toBe(2);
    });

    it("asks when the model has no known price", async () => {
      const reads = { count: 0 };
      const options = setup({}, { [CONFIG]: DESCRIBER });
      const { out } = await scan(
        {
          ...options,
          files: {
            ...options.files,
            [`${APP_CONFIG}/config.json`]: `${JSON.stringify({ describing: { model: "mystery", batch_size: 4 } })}\n`,
          },
          lines: ["skip"],
          linesRead: reads,
        },
        "--describe",
        "--json",
        "--confirm-above",
        "100000",
      );

      expect(lines(out).find((line) => line.event === "confirm")).toMatchObject(
        { cost_usd: null },
      );
      expect(reads.count).toBe(1);
    });
  });

  describe("--confirm-above answered through the run record", () => {
    const ANSWER = answerPath(ROOT);
    const PROGRESS = progressPath(ROOT);

    const runIdOf = (files: Map<string, string>): string =>
      (JSON.parse(files.get(markerPath(ROOT)) ?? "{}") as { run_id: string })
        .run_id;

    const answerFile = (runId: string, describe: boolean): string =>
      JSON.stringify({ version: 1, run_id: runId, describe });

    const progressEvents = (files: Map<string, string>) =>
      lines(files.get(PROGRESS) ?? "");

    const asked = async (
      extra: Partial<FakeOptions>,
      startedBy: "app" | "cli",
    ) => {
      const options = setup({}, { [CONFIG]: DESCRIBER });
      const fake = fakeIo({
        ...options,
        env: { RECOGNIZER_STARTED_BY: startedBy },
        ...extra,
      });
      const code = await run(
        ["scan", ROOT, "--describe", "--json", "--confirm-above", "0.0001"],
        fake.io,
      );

      return { fake, code, events: progressEvents(fake.files) };
    };

    const described = (events: Record<string, unknown>[]) =>
      events.filter(
        (line) => line.event === "entry" && line.phase === "describe",
      ).length;

    it("writes the confirm line, then describes on an answer file saying describe, and writes answered", async () => {
      const waits = { count: 0 };
      const { fake, events } = await asked(
        {
          waits,
          onWait: (files) => {
            files.set(ANSWER, answerFile(runIdOf(files), true));
          },
        },
        "app",
      );
      const names = events.map((line) => line.event);

      expect(waits.count).toBeGreaterThan(0);
      expect(names.indexOf("confirm")).toBeGreaterThan(-1);
      expect(names.indexOf("confirm")).toBeLessThan(names.indexOf("answered"));
      expect(events.find((line) => line.event === "answered")).toEqual({
        event: "answered",
        phase: "describe",
        describe: true,
      });
      expect(described(events)).toBe(2);
      expect(fake.files.has(ANSWER)).toBe(false);
    });

    it("skips the describe phase on an answer file saying skip", async () => {
      const { events } = await asked(
        {
          onWait: (files) => {
            files.set(ANSWER, answerFile(runIdOf(files), false));
          },
        },
        "app",
      );

      expect(events.find((line) => line.event === "answered")).toMatchObject({
        describe: false,
      });
      expect(described(events)).toBe(0);
    });

    it("ignores stdin for a scan the app started", async () => {
      const reads = { count: 0 };
      const { events } = await asked(
        {
          lines: ["describe"],
          linesRead: reads,
          onWait: (files) => {
            files.set(ANSWER, answerFile(runIdOf(files), false));
          },
        },
        "app",
      );

      expect(reads.count).toBe(0);
      expect(described(events)).toBe(0);
    });

    it("takes a terminal line for a scan the command line started and aborts nothing before it answers", async () => {
      const signals: AbortSignal[] = [];
      const waits = { count: 0 };
      const { events } = await asked(
        { lines: ["describe"], lineSignals: signals, waits },
        "cli",
      );

      expect(signals).toHaveLength(1);
      expect(signals[0]?.aborted).toBe(true);
      expect(described(events)).toBe(2);
      expect(events.find((line) => line.event === "answered")).toMatchObject({
        describe: true,
      });
    });

    it("lets an answer file placed first win and aborts the terminal read", async () => {
      const signals: AbortSignal[] = [];
      const { events } = await asked(
        {
          holdLine: true,
          lineSignals: signals,
          onWait: (files) => {
            files.set(ANSWER, answerFile(runIdOf(files), false));
          },
        },
        "cli",
      );

      expect(signals).toHaveLength(1);
      expect(signals[0]?.aborted).toBe(true);
      expect(described(events)).toBe(0);
    });

    it("ignores and removes an answer file for another run until the right one arrives", async () => {
      const seen: boolean[] = [];
      const { events } = await asked(
        {
          onWait: (files, count) => {
            if (count === 1) {
              files.set(ANSWER, answerFile("another-run", false));
            } else if (count === 2) {
              seen.push(files.has(ANSWER));
              files.set(ANSWER, answerFile(runIdOf(files), true));
            }
          },
        },
        "app",
      );

      expect(seen).toEqual([false]);
      expect(described(events)).toBe(2);
    });

    it("ignores and removes an answer file that fails validation", async () => {
      const seen: boolean[] = [];
      const { events } = await asked(
        {
          onWait: (files, count) => {
            if (count === 1) {
              files.set(ANSWER, '{"version":1}');
            } else if (count === 2) {
              seen.push(files.has(ANSWER));
              files.set(ANSWER, answerFile(runIdOf(files), true));
            }
          },
        },
        "app",
      );

      expect(seen).toEqual([false]);
      expect(described(events)).toBe(2);
    });
  });

  it("says on stderr that the describe phase stopped", async () => {
    const { code, err, out } = await scan(
      setup(
        {
          programs: {
            describer: () => ({
              status: 75,
              stderr: "claude usage limit: out of quota",
            }),
          },
        },
        { [CONFIG]: DESCRIBER },
      ),
      "--describe",
    );

    expect(code).toBe(1);
    expect(err).toMatch(
      /stopped: claude usage limit reached \(claude usage limit: out of quota\); \d+ modules not described/,
    );
    expect(out).toContain("stopped: claude usage limit reached");
  });

  it("fails the run after the remaining entries when a sensor entry fails", async () => {
    const { code, fake, out } = await scan(
      setup(
        {
          programs: {
            "first-sensor": () => ({ status: 3, stderr: "bad" }),
            "second-sensor": findings("second"),
          },
        },
        { [CONFIG]: SENSORS },
      ),
      "--sense",
      "all",
    );

    expect(code).toBe(1);
    expect(out).toContain("failed first\nran second\n");
    expect(
      fake.files.has(`${ROOT}/.recognizer/cache/findings/second.json`),
    ).toBe(true);
  });

  it("still runs the sense phase when extraction failed", async () => {
    const { code, out } = await scan(
      {
        ...setup(
          {},
          { [CONFIG]: SENSORS, [PY_CACHE]: current({ commit: "old" }) },
        ),
        scanners: { [PYTHON]: { unstartable: true } },
      },
      "--sense",
      "first",
    );

    expect(code).toBe(1);
    expect(out).toContain("sense\nran first\n");
  });

  it("selects the named sensors in config order", async () => {
    const { out } = await scan(
      setup({}, { [CONFIG]: SENSORS }),
      "--sense",
      "second,first",
    );

    expect(out.indexOf("ran first")).toBeLessThan(out.indexOf("ran second"));
  });

  it("is exit 2 before anything runs for an unknown sensor, naming the registered ones", async () => {
    const { code, err, fake } = await scan(
      setup({}, { [CONFIG]: SENSORS }),
      "--sense",
      "first,nope,second",
    );

    expect(code).toBe(2);
    expect(err).toContain("no such sensor: nope");
    expect(err).toContain("registered sensors: first, second");
    expect(fake.calls).toEqual([]);
    expect(records(fake)).toEqual([]);
  });

  it.each([["--sense with no sensors registered", ["--sense", "all"], ""]])(
    "is exit 2 for %s",
    async (_, args, config) => {
      const { code, fake } = await scan(
        setup({}, { [CONFIG]: config }),
        ...args,
      );

      expect(code).toBe(2);
      expect(extractCalls(fake)).toEqual([]);
      expect(records(fake)).toEqual([]);
    },
  );

  it("is exit 4 with a describer gap for --describe with no describer registered and no recognizer-describe-claude to start", async () => {
    const { code, fake, err } = await scan(
      setup({}, { [CONFIG]: "" }),
      "--describe",
    );

    expect(code).toBe(4);
    expect(err).toContain(
      "no describer is registered and recognizer-describe-claude is not installed (describe): install recognizer-describe-claude",
    );
    expect(extractCalls(fake)).toEqual([]);
  });

  it("describes with the shipped fallback when no describer is registered", async () => {
    const base = setup({}, { [CONFIG]: "" });
    const { code, fake } = await scan(
      {
        ...base,
        programs: {
          ...base.programs,
          "recognizer-describe-claude": (args) =>
            args[0] === "manifest"
              ? { stdout: describerManifestText("prompt-0123456789ab") }
              : { stdout: "a shipped line\n" },
        },
      },
      "--describe",
    );
    const written = JSON.parse(
      fake.files.get(`${ROOT}/.recognizer/responsibilities.json`) as string,
    );
    const entry = Object.values(written.modules)[0] as {
      describer: string[];
      version: string;
    };

    expect(code).toBe(0);
    expect(entry.describer).toEqual([
      "recognizer-describe-claude",
      "run",
      "--model",
      "{model}",
      "{request}",
    ]);
    expect(entry.version).toBe("prompt-0123456789ab");
  });

  it("emits no start line without --json", async () => {
    const { out } = await scan(
      setup({}, { [CONFIG]: SENSORS }),
      "--sense",
      "first",
    );

    expect(out).not.toContain('"event":"start"');
  });

  it("is exit 4 with a no-commit gap for --sense with no commit", async () => {
    const { code, err, fake } = await scan(
      { ...setup({}, { [CONFIG]: SENSORS }), commit: undefined },
      "--sense",
      "all",
    );

    expect(code).toBe(4);
    expect(err).toContain(
      "the folder has no git commit (first, second): make the first commit (git add the files, then git commit)",
    );
    expect(extractCalls(fake)).toEqual([]);
  });

  function describing() {
    return setup(
      {
        programs: {
          describer: () => ({ stdout: "a line\n" }),
          "first-sensor": findings("first"),
          "second-sensor": findings("second"),
        },
      },
      { [CONFIG]: `${DESCRIBER}${SENSORS}` },
    );
  }

  it("runs extract, describe and sense in that order and records them", async () => {
    const { out, fake, code } = await scan(
      describing(),
      "--describe",
      "--sense",
      "all",
    );

    expect(code).toBe(0);
    expect(out).toContain(
      "described 2, failed 0, already current 0\nsense\nran first\n",
    );
    expect(out).not.toContain("measure");
    expect(
      records(fake)[0].phases.map((one: { phase: string }) => one.phase),
    ).toEqual(["extract", "describe", "sense"]);
  });

  it("is exit 2 for --measure as an unknown option, running nothing", async () => {
    const { code, err, fake } = await scan(describing(), "--measure", "all");

    expect(code).toBe(2);
    expect(err).toContain("unknown option: --measure");
    expect(fake.calls).toEqual([]);
    expect(records(fake)).toEqual([]);
  });

  it("is exit 2 with the retired message when the config still holds overlays", async () => {
    const { code, err, fake } = await scan(
      setup(
        {},
        {
          [CONFIG]:
            "overlays:\n  alpha:\n    command: [alpha-overlay]\n    metrics:\n      - { name: m, type: ratio, granularity: module, bad: low }\n",
        },
      ),
      "--sense",
      "all",
    );

    expect(code).toBe(2);
    expect(err).toContain("config/overlays is retired");
    expect(err).toContain("measurers are gone");
    expect(records(fake)).toEqual([]);
  });

  it("carries a refusal's diagnosis on the entry event and the summary, and none otherwise", async () => {
    const diagnosis = {
      code: "tests-failed",
      line: "The suite fails before any mutation.",
      fix: "Fix the failing tests",
    };
    const { out } = await scan(
      setup(
        {
          programs: {
            "first-sensor": () => ({
              status: 2,
              stderr: `recognizer-event ${JSON.stringify({ event: "diagnosis", code: diagnosis.code, text: diagnosis.line, fix: diagnosis.fix })}\n${diagnosis.line}\n`,
            }),
            "second-sensor": findings("second"),
          },
        },
        { [CONFIG]: SENSORS },
      ),
      "--sense",
      "all",
      "--json",
    );
    const events = lines(out);
    const entries = events.filter((one) => one.event === "entry");
    const summary = events.at(-1) as {
      phases: { phase: string; entries: Record<string, unknown>[] }[];
    };
    const sensed = summary.phases.find((one) => one.phase === "sense");

    expect(entries[0]).toMatchObject({
      name: "first",
      outcome: "failed",
      diagnosis,
    });
    expect(entries[1]).not.toHaveProperty("diagnosis");
    expect(sensed?.entries[0]).toMatchObject({ name: "first", diagnosis });
    expect(sensed?.entries[1]).not.toHaveProperty("diagnosis");
  });

  it("streams phase, entry and summary lines under --json", async () => {
    const { out } = await scan(
      setup({}, { [CONFIG]: `${DESCRIBER}${SENSORS}` }),
      "--describe",
      "--sense",
      "first",
      "--json",
    );
    const events = lines(out);

    expect(events.map((one) => [one.event, one.phase ?? null])).toEqual([
      ["preflight", null],
      ["phase", "extract"],
      ["preflight", null],
      ["projection", "describe"],
      ["phase", "describe"],
      ["entry", "describe"],
      ["entry", "describe"],
      ["phase", "sense"],
      ["start", "sense"],
      ["entry", "sense"],
      ["summary", null],
    ]);
    expect(events[1]).toEqual({
      event: "phase",
      phase: "extract",
      state: "current",
      commit: COMMIT,
    });
    expect(events[4]).toEqual({ event: "phase", phase: "describe", total: 2 });
    expect(events[8]).toEqual({
      event: "start",
      phase: "sense",
      name: "first",
    });
    expect(events[9]).toEqual({
      event: "entry",
      phase: "sense",
      name: "first",
      outcome: "ok",
    });
    expect(events.at(-1)).toMatchObject({
      exit: 0,
      commit: COMMIT,
      modified: false,
    });
  });

  describe("an unregistered shipped plugin", () => {
    const crapWarning =
      "warning: crap is not registered in .recognizer/config.yaml; register it with `recognizer plugin add crap`. From the next release an unregistered plugin will not run.\n";
    const mutationWarning = crapWarning.replaceAll("crap", "mutation");
    const claudeWarning = crapWarning.replaceAll("crap", "claude");

    function shippedRun(config: string, describe = false) {
      const base = setup({}, { [CONFIG]: config });

      return {
        ...base,
        programs: {
          ...base.programs,
          "shipped-sensors": (args: string[], files: Map<string, string>) => {
            files.set(
              args[args.indexOf("--output") + 1] as string,
              JSON.stringify({
                findings_version: 1,
                sensor: { name: "crap", version: "1" },
                commit: COMMIT,
                modified: false,
                settings: {},
                findings: [],
              }),
            );

            return undefined;
          },
          ...(describe
            ? {
                "recognizer-describe-claude": (args: string[]) =>
                  args[0] === "manifest"
                    ? { stdout: describerManifestText("prompt-0123456789ab") }
                    : { stdout: "a shipped line\n" },
              }
            : {}),
        },
      };
    }

    function count(text: string, line: string): number {
      return text.split(line).length - 1;
    }

    it("runs the sensor and warns once on stderr", async () => {
      const { code, out, err } = await scan(shippedRun(""), "--sense", "crap");

      expect(code).toBe(0);
      expect(out).toContain("ran crap");
      expect(count(err, crapWarning)).toBe(1);
    });

    it("warns once for a name requested twice", async () => {
      const { err } = await scan(shippedRun(""), "--sense", "crap,crap");

      expect(count(err, crapWarning)).toBe(1);
    });

    it("warns for each unregistered sensor", async () => {
      const { err } = await scan(shippedRun(""), "--sense", "crap,mutation");

      expect(count(err, crapWarning)).toBe(1);
      expect(count(err, mutationWarning)).toBe(1);
    });

    it("warns nothing when the sensor is registered", async () => {
      const { code, out, err } = await scan(
        shippedRun("sensors:\n  crap: {}\n"),
        "--sense",
        "crap",
      );

      expect(code).toBe(0);
      expect(out).toContain("ran crap");
      expect(err).not.toContain("not registered");
    });

    it("warns nothing for --sense all", async () => {
      const { code, err } = await scan(
        shippedRun("sensors:\n  crap: {}\n"),
        "--sense",
        "all",
      );

      expect(code).toBe(0);
      expect(err).not.toContain("not registered");
    });

    it("warns once about the shipped describer", async () => {
      const { code, err } = await scan(shippedRun("", true), "--describe");

      expect(code).toBe(0);
      expect(count(err, claudeWarning)).toBe(1);
    });

    it("warns nothing when a describer is registered", async () => {
      const { code, err } = await scan(
        shippedRun(DESCRIBER, true),
        "--describe",
      );

      expect(code).toBe(0);
      expect(err).not.toContain("not registered");
    });
  });

  describe("a sensor that reports progress", () => {
    const EVENTS = [
      'recognizer-event {"event":"start","total":2,"unit":"functions"}',
      'recognizer-event {"event":"note","text":"Coverage run: unit"}',
      "recognizer-event not json",
      'recognizer-event {"event":"later"}',
      'recognizer-event {"event":"progress","done":1,"total":2,"unit":"functions"}',
      'recognizer-event {"event":"progress","done":2,"total":2,"unit":"functions"}',
      "",
    ].join("\n");

    function mutating() {
      return setup({
        programs: {
          "shipped-sensors": (args, files) => {
            files.set(
              args[args.indexOf("--output") + 1] as string,
              JSON.stringify({
                findings_version: 1,
                sensor: { name: "mutation", version: "1" },
                commit: COMMIT,
                modified: false,
                settings: {},
                findings: [],
              }),
            );

            return { stderr: EVENTS };
          },
        },
      });
    }

    it("passes each plugin event through the --json stream as a plugin line between start and entry", async () => {
      const { out, code } = await scan(
        mutating(),
        "--sense",
        "mutation",
        "--json",
      );
      const events = lines(out);

      expect(code).toBe(0);
      expect(
        events.map((one) => [
          one.event,
          one.name ?? null,
          (one.data as { event?: string } | undefined)?.event ?? null,
        ]),
      ).toEqual([
        ["preflight", null, null],
        ["phase", null, null],
        ["preflight", null, null],
        ["phase", null, null],
        ["start", "mutation", null],
        ["plugin", "mutation", "start"],
        ["plugin", "mutation", "note"],
        ["plugin", "mutation", "progress"],
        ["plugin", "mutation", "progress"],
        ["entry", "mutation", null],
        ["summary", null, null],
      ]);
      expect(events[6]).toEqual({
        event: "plugin",
        phase: "sense",
        name: "mutation",
        data: { event: "note", text: "Coverage run: unit" },
      });
      expect(events[8]).toEqual({
        event: "plugin",
        phase: "sense",
        name: "mutation",
        data: { event: "progress", done: 2, total: 2, unit: "functions" },
      });
      expect(JSON.stringify(events)).not.toContain('"step":"coverage"');
    });

    it("forwards a scanner's events as extract plugin lines tagged with its language", async () => {
      const { out, code } = await scan(
        {
          files: { [`${ROOT}/a.py`]: "" },
          scanners: {
            [PYTHON]: {
              output: scanJson(1, 0),
              stderr: [
                'recognizer-event {"event":"start","total":1,"unit":"files"}',
                'recognizer-event {"event":"progress","done":1,"total":1,"unit":"files"}',
                "",
              ].join("\n"),
            },
          },
        },
        "--extract",
        "--json",
      );
      const plugin = lines(out).filter((one) => one.event === "plugin");

      expect(code).toBe(0);
      expect(plugin).toEqual([
        {
          event: "plugin",
          phase: "extract",
          name: "python",
          data: { event: "start", total: 1, unit: "files" },
        },
        {
          event: "plugin",
          phase: "extract",
          name: "python",
          data: { event: "progress", done: 1, total: 1, unit: "files" },
        },
      ]);
    });

    it("writes no progress without --json and keeps none in the run record", async () => {
      const text = await scan(mutating(), "--sense", "mutation");

      expect(text.out).not.toContain("plugin");
      expect(text.out).not.toContain("recognizer-event");

      const json = await scan(mutating(), "--sense", "mutation", "--json");

      for (const result of [text, json]) {
        const [record] = records(result.fake);

        expect(JSON.stringify(record)).not.toContain("recognizer-event");
        expect(JSON.stringify(record)).toContain(
          "ignored 2 invalid event lines",
        );
      }
    });
  });

  it("writes the record when it opens, after every entry and when it finishes", async () => {
    const fake = fakeIo(setup({}, { [CONFIG]: SENSORS }));
    const snapshots: string[] = [];
    const watching = {
      ...fake.io,
      rename: (from: string, to: string) => {
        fake.io.rename(from, to);

        if (to.startsWith(`${LOG}/`)) {
          snapshots.push(fake.files.get(to) as string);
        }
      },
    };

    await run(["scan", ROOT, "--sense", "all"], watching);

    const outcomes = snapshots.map((text) => JSON.parse(text).outcome);

    expect(outcomes).toEqual(["running", "running", "running", "ok"]);
  });

  describe("recorded figures", () => {
    const phaseOf = (fake: ReturnType<typeof fakeIo>, name: string) =>
      records(fake)[0].phases.find(
        (one: { phase: string }) => one.phase === name,
      );

    it("records structure_ms when the structure sensor ran and none when it is off", async () => {
      const ran = await scan(setup());
      const off = await scan(
        setup({}, { [CONFIG]: "sensors:\n  structure: off\n" }),
      );

      expect(typeof records(ran.fake)[0].structure_ms).toBe("number");
      expect(records(off.fake)[0]).not.toHaveProperty("structure_ms");
    });

    it("records the sense phase duration and a module count on each sense entry", async () => {
      const { fake } = await scan(
        setup({}, { [CONFIG]: SENSORS }),
        "--sense",
        "first,second",
      );
      const sense = phaseOf(fake, "sense");

      expect(sense.duration_ms).toBeGreaterThan(0);
      expect(
        sense.entries.map((one: { modules: number }) => one.modules),
      ).toEqual([2, 2]);
      expect(phaseOf(fake, "extract")).not.toHaveProperty("duration_ms");
    });

    it("excludes the wait for the describe confirmation from the describe duration", async () => {
      const reads = { count: 0 };
      let clock = 0;
      const { fake } = await scan(
        setup(
          {
            lines: ["describe"],
            linesRead: reads,
            now: () => {
              clock += 1;

              return clock + (reads.count > 0 ? 100_000 : 0);
            },
          },
          { [CONFIG]: DESCRIBER },
        ),
        "--describe",
        "--json",
        "--confirm-above",
        "0.0001",
      );
      const describing = phaseOf(fake, "describe");

      expect(reads.count).toBe(1);
      expect(describing.entries).toHaveLength(2);
      expect(describing.duration_ms).toBeGreaterThanOrEqual(0);
      expect(describing.duration_ms).toBeLessThan(1000);
    });
  });
});

describe("recognizer scan: --ignore-retired-config", () => {
  const CONFIG_FILE = `${ROOT}/.recognizer/config.yaml`;
  const RETIRED_STRUCTURE =
    "sensors:\n  structure:\n    composition_roots: [a]\n";

  function held(config: string): FakeOptions {
    return {
      files: { [`${ROOT}/a.py`]: "", [CONFIG_FILE]: config },
      commit: "abc123",
      scanners: { [PYTHON]: okPython },
    };
  }

  it("refuses a retired key without the flag, exit 2", async () => {
    const { code, err, fake } = await scan(held(RETIRED_STRUCTURE));

    expect(code).toBe(2);
    expect(err).toContain("config/sensors/structure/composition_roots");
    expect(fake.calls.filter((call) => call.command === PYTHON)).toEqual([]);
  });

  it("scans past the same retired key with the flag, exit 0 and no mention of it", async () => {
    const { code, err, fake } = await scan(
      held(RETIRED_STRUCTURE),
      "--ignore-retired-config",
    );

    expect(code).toBe(0);
    expect(err).not.toContain("composition_roots");
    expect(err).not.toContain("retired");
    expect(fake.calls.filter((call) => call.command === PYTHON)).toHaveLength(
      1,
    );
  });

  it("scans past a retired overlays key with the flag", async () => {
    const { code, err } = await scan(
      held("overlays:\n  crap:\n    command: [x]\n"),
      "--ignore-retired-config",
    );

    expect(code).toBe(0);
    expect(err).not.toContain("overlays");
  });

  it("still refuses another config error with the flag, exit 2", async () => {
    const { code, err } = await scan(
      held(`${RETIRED_STRUCTURE}  duplication:\n    bogus: 1\n`),
      "--ignore-retired-config",
    );

    expect(code).toBe(2);
    expect(err).toContain("sensors/duplication unknown setting: bogus");
    expect(err).not.toContain("composition_roots");
  });

  it("scans past a moved sensors.duplication with the flag, exit 0", async () => {
    const { code, err } = await scan(
      held("sensors:\n  duplication:\n    min_lines: 4\n"),
      "--ignore-retired-config",
    );

    expect(code).toBe(0);
    expect(err).not.toContain("duplication");
  });

  it("refuses sensors.duplication without the flag, exit 2", async () => {
    const { code, err } = await scan(
      held("sensors:\n  duplication:\n    min_lines: 4\n"),
    );

    expect(code).toBe(2);
    expect(err).toContain("sensors/duplication was removed");
  });

  it.each([["--describe"], ["--describe=all"], ["--sense", "all"]])(
    "refuses the flag with %s, exit 2, running nothing",
    async (...extra) => {
      const { code, err, fake } = await scan(
        held(RETIRED_STRUCTURE),
        "--ignore-retired-config",
        ...extra,
      );

      expect(code).toBe(2);
      expect(err).toContain(
        "--ignore-retired-config takes no --describe or --sense",
      );
      expect(fake.calls).toEqual([]);
    },
  );
});
