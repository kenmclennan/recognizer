import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { scannerFor } from "../src/scanners.js";
import {
  type FakeOptions,
  fakeIo,
  PYTHON,
  ROOT,
  scanJson,
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
      [ROOT, "--output", "/tmp/fake-0/scan.python.json"],
      [ROOT, "--output", "/tmp/fake-1/scan.typescript.json"],
    ]);
  });

  it("uses an absolute override in place of the scanner name", async () => {
    const { fake, code } = await scan({
      files: { [`${ROOT}/a.py`]: "" },
      env: { RECOGNIZER_SCAN_PYTHON: "/opt/py-launcher" },
      scanners: { "/opt/py-launcher": okPython },
    });

    expect(code).toBe(0);
    expect(fake.calls.map((call) => call.command)).toEqual([
      "git",
      "/opt/py-launcher",
    ]);
  });

  it("rejects a relative override without running anything", async () => {
    const { fake, code, err } = await scan({
      files: { [`${ROOT}/a.py`]: "" },
      env: { RECOGNIZER_SCAN_PYTHON: "bin/launcher" },
      scanners: { [PYTHON]: okPython },
    });

    expect(code).toBe(1);
    expect(err).toContain("python: invalid-override - ");
    expect(fake.calls.map((call) => call.command)).toEqual(["git"]);
    expect(fake.files.has(PY_CACHE)).toBe(false);
  });

  it("treats an empty override as unset", async () => {
    const { fake, code } = await scan({
      files: { [`${ROOT}/a.py`]: "" },
      env: { RECOGNIZER_SCAN_PYTHON: "" },
      scanners: { [PYTHON]: okPython },
    });

    expect(code).toBe(0);
    expect(fake.calls[1]?.command).toBe(PYTHON);
  });
});

describe("recognizer scan: kotlin", () => {
  it("fails a detected kotlin language whose scanner is missing", async () => {
    const { code, err } = await scan({ files: { [`${ROOT}/A.kt`]: "" } });

    expect(code).toBe(1);
    expect(err).toContain("recognizer-scan-kotlin is not installed");
    expect(err).toContain("RECOGNIZER_SCAN_KOTLIN");
  });

  it("runs recognizer-scan-kotlin for kotlin", () => {
    expect(scannerFor("kotlin").name).toBe("recognizer-scan-kotlin");
  });
});

describe("recognizer scan: rust", () => {
  it("fails a detected rust language whose scanner is missing", async () => {
    const { code, err } = await scan({ files: { [`${ROOT}/src/lib.rs`]: "" } });

    expect(code).toBe(1);
    expect(err).toContain("recognizer-scan-rust is not installed");
    expect(err).toContain("RECOGNIZER_SCAN_RUST");
  });

  it("runs recognizer-scan-rust for rust", () => {
    expect(scannerFor("rust").name).toBe("recognizer-scan-rust");
  });

  it("uses an absolute override in place of the scanner name", async () => {
    const { fake, code } = await scan({
      files: { [`${ROOT}/src/lib.rs`]: "" },
      env: { RECOGNIZER_SCAN_RUST: "/opt/rust-launcher" },
      scanners: { "/opt/rust-launcher": { output: scanJson(1, 0) } },
    });

    expect(code).toBe(0);
    expect(fake.calls.map((call) => call.command)).toEqual([
      "git",
      "/opt/rust-launcher",
    ]);
  });
});

describe("recognizer scan: csharp", () => {
  it("fails a detected csharp language whose scanner is missing", async () => {
    const { code, err } = await scan({ files: { [`${ROOT}/src/A.cs`]: "" } });

    expect(code).toBe(1);
    expect(err).toContain("recognizer-scan-csharp is not installed");
    expect(err).toContain("RECOGNIZER_SCAN_CSHARP");
  });

  it("runs recognizer-scan-csharp for csharp", () => {
    expect(scannerFor("csharp").name).toBe("recognizer-scan-csharp");
  });
});

describe("recognizer scan: outcomes", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["not-installed", {}, "not-installed"],
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
    expect(err).toContain("accepts 6");
  });

  it("refuses a version-2 scan naming both versions", async () => {
    const { err } = await scan({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { output: scanJson(1, 0, { schema_version: 2 }) } },
    });

    expect(err).toContain("schema_version 2");
    expect(err).toContain("accepts 6");
  });

  it("carries the scanner's stderr", async () => {
    const { err } = await scan({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { status: 2, stderr: "bad root" } },
    });

    expect(err).toContain("bad root");
  });

  it("removes the temporary directories on every path", async () => {
    const { fake } = await scan({
      files: both(),
      scanners: { [PYTHON]: { status: 1 } },
    });

    expect(
      [...fake.files.keys()].filter((key) => key.startsWith("/tmp/")),
    ).toEqual([]);
    expect(fake.tempDirs()).toHaveLength(2);
  });

  it("reports one written and one failed language in --json, exit 1", async () => {
    const { code, out, fake } = await scan(
      { files: both(), scanners: { [PYTHON]: okPython } },
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
      scanners: { [TYPESCRIPT]: okTypescript },
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
      [...fake.files.keys()].some((key) => key.includes(".recognizer")),
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
      "usage: recognizer <check|scan|open|uses|used-by|callers|path|find|show|modules|views|sensors|windows|window|describe|report|log|agents|help> ...",
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
    const first = lines(out)[0];

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

    expect(lines(out)[0]).toMatchObject({ state: "run", reason: "forced" });
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
        scanners: {},
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

  it.each([
    ["--sense with no sensors registered", ["--sense", "all"], ""],
    [
      "--describe with no describer registered and no recognizer-describe-claude to start",
      ["--describe"],
      "",
    ],
  ])("is exit 2 for %s", async (_, args, config) => {
    const { code, fake } = await scan(setup({}, { [CONFIG]: config }), ...args);

    expect(code).toBe(2);
    expect(extractCalls(fake)).toEqual([]);
    expect(records(fake)).toEqual([]);
  });

  it("describes with the shipped fallback when no describer is registered", async () => {
    const base = setup({}, { [CONFIG]: "" });
    const { code, fake } = await scan(
      {
        ...base,
        programs: {
          ...base.programs,
          "recognizer-describe-claude": (args) =>
            args[0] === "--prompt-version"
              ? { stdout: "prompt-0123456789ab\n" }
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

  it("is exit 2 for --sense with no commit", async () => {
    const { code, err } = await scan(
      { ...setup({}, { [CONFIG]: SENSORS }), commit: undefined },
      "--sense",
      "all",
    );

    expect(code).toBe(2);
    expect(err).toContain("not a git repository, or no commit");
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
      ["phase", "extract"],
      ["projection", "describe"],
      ["phase", "describe"],
      ["entry", "describe"],
      ["entry", "describe"],
      ["phase", "sense"],
      ["start", "sense"],
      ["entry", "sense"],
      ["summary", null],
    ]);
    expect(events[0]).toEqual({
      event: "phase",
      phase: "extract",
      state: "current",
      commit: COMMIT,
    });
    expect(events[2]).toEqual({ event: "phase", phase: "describe", total: 2 });
    expect(events[6]).toEqual({
      event: "start",
      phase: "sense",
      name: "first",
    });
    expect(events[7]).toEqual({
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

  describe("a sensor that reports progress", () => {
    const PROGRESS = [
      'recognizer-progress {"step":"coverage"}',
      "recognizer-progress not json",
      'recognizer-progress {"step":"later"}',
      'recognizer-progress {"step":"mutants","done":1,"total":2}',
      'recognizer-progress {"step":"mutants","done":2,"total":2}',
      "",
    ].join("\n");

    function mutating() {
      return setup({
        programs: {
          "recognizer-sensors": (args, files) => {
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

            return { stderr: PROGRESS };
          },
        },
      });
    }

    it("passes each progress line through the --json stream between start and entry", async () => {
      const { out, code } = await scan(
        mutating(),
        "--sense",
        "mutation",
        "--json",
      );
      const events = lines(out);

      expect(code).toBe(0);
      expect(
        events.map((one) => [one.event, one.step ?? one.name ?? null]),
      ).toEqual([
        ["phase", null],
        ["phase", null],
        ["start", "mutation"],
        ["progress", "coverage"],
        ["progress", "mutants"],
        ["progress", "mutants"],
        ["entry", "mutation"],
        ["summary", null],
      ]);
      expect(events[3]).toEqual({
        event: "progress",
        phase: "sense",
        name: "mutation",
        step: "coverage",
      });
      expect(events[5]).toEqual({
        event: "progress",
        phase: "sense",
        name: "mutation",
        step: "mutants",
        done: 2,
        total: 2,
      });
    });

    it("writes no progress without --json and keeps none in the run record", async () => {
      const text = await scan(mutating(), "--sense", "mutation");

      expect(text.out).not.toContain("progress");
      expect(text.out).not.toContain("recognizer-progress");

      const json = await scan(mutating(), "--sense", "mutation", "--json");

      for (const result of [text, json]) {
        const [record] = records(result.fake);

        expect(JSON.stringify(record)).not.toContain("recognizer-progress");
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
});
