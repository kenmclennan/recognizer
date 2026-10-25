import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
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

function scan(options: FakeOptions, ...args: string[]) {
  const fake = fakeIo(options);
  const code = run(["scan", ROOT, ...args], fake.io);

  return { code, fake, out: fake.out(), err: fake.err() };
}

function both(extra: Record<string, string> = {}): Record<string, string> {
  return { [`${ROOT}/a.py`]: "", [`${ROOT}/b.ts`]: "", ...extra };
}

const okPython = { output: scanJson(2, 1) };
const okTypescript = { output: scanJson(3, 2) };

describe("recognizer scan: command building", () => {
  it("passes the exact argv with a commit", () => {
    const { fake } = scan({
      files: both(),
      commit: "abc123",
      scanners: { [PYTHON]: okPython, [TYPESCRIPT]: okTypescript },
    });

    expect(fake.calls).toEqual([
      { command: "git", args: ["-C", ROOT, "rev-parse", "HEAD"] },
      {
        command: PYTHON,
        args: [
          ROOT,
          "--output",
          "/tmp/fake-0/scan.python.json",
          "--commit",
          "abc123",
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
        ],
      },
    ]);
  });

  it("omits --commit outside git", () => {
    const { fake } = scan({
      files: both(),
      scanners: { [PYTHON]: okPython, [TYPESCRIPT]: okTypescript },
    });

    expect(fake.calls.slice(1).map((call) => call.args)).toEqual([
      [ROOT, "--output", "/tmp/fake-0/scan.python.json"],
      [ROOT, "--output", "/tmp/fake-1/scan.typescript.json"],
    ]);
  });

  it("uses an absolute override in place of the scanner name", () => {
    const { fake, code } = scan({
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

  it("rejects a relative override without running anything", () => {
    const { fake, code, err } = scan({
      files: { [`${ROOT}/a.py`]: "" },
      env: { RECOGNIZER_SCAN_PYTHON: "bin/launcher" },
      scanners: { [PYTHON]: okPython },
    });

    expect(code).toBe(1);
    expect(err).toContain("python: invalid-override - ");
    expect(fake.calls.map((call) => call.command)).toEqual(["git"]);
    expect(fake.files.has(PY_CACHE)).toBe(false);
  });

  it("treats an empty override as unset", () => {
    const { fake, code } = scan({
      files: { [`${ROOT}/a.py`]: "" },
      env: { RECOGNIZER_SCAN_PYTHON: "" },
      scanners: { [PYTHON]: okPython },
    });

    expect(code).toBe(0);
    expect(fake.calls[1]?.command).toBe(PYTHON);
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
  ];

  it.each(cases)(
    "%s writes nothing, removes the old file and still runs the other language",
    (_, scanners, reason) => {
      const { fake, code, err } = scan({
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

  it("names the version found and the version accepted", () => {
    const { err } = scan({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { output: scanJson(1, 0, { schema_version: 1 }) } },
    });

    expect(err).toContain("schema_version 1");
    expect(err).toContain("accepts 2");
  });

  it("carries the scanner's stderr", () => {
    const { err } = scan({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { status: 2, stderr: "bad root" } },
    });

    expect(err).toContain("bad root");
  });

  it("removes the temporary directories on every path", () => {
    const { fake } = scan({
      files: both(),
      scanners: { [PYTHON]: { status: 1 } },
    });

    expect(
      [...fake.files.keys()].filter((key) => key.startsWith("/tmp/")),
    ).toEqual([]);
    expect(fake.tempDirs()).toHaveLength(2);
  });

  it("reports one written and one failed language in --json, exit 1", () => {
    const { code, out, fake } = scan(
      { files: both(), scanners: { [PYTHON]: okPython } },
      "--json",
    );
    const document = JSON.parse(out);

    expect(code).toBe(1);
    expect(document.languages).toHaveLength(2);
    expect(document.languages[0]).toEqual({
      language: "python",
      status: "written",
      modules: 2,
      edges: 1,
      file: PY_CACHE,
    });
    expect(document.languages[1]).toMatchObject({
      language: "typescript",
      status: "failed",
      reason: "not-installed",
    });
    expect(Object.keys(document.languages[1]).sort()).toEqual([
      "language",
      "message",
      "reason",
      "status",
    ]);
    expect(fake.files.has(PY_CACHE)).toBe(true);
    expect(fake.files.has(TS_CACHE)).toBe(false);
  });

  it("handles the reverse mix", () => {
    const { code, fake } = scan({
      files: both(),
      scanners: { [TYPESCRIPT]: okTypescript },
    });

    expect(code).toBe(1);
    expect(fake.files.has(TS_CACHE)).toBe(true);
    expect(fake.files.has(PY_CACHE)).toBe(false);
  });

  it("writes the scanner's bytes exactly", () => {
    const odd = scanJson(1, 0, {}, "\t   ");
    const { fake } = scan({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { output: odd } },
    });

    expect(fake.files.get(PY_CACHE)).toBe(odd);
  });
});

describe("recognizer scan: stale files", () => {
  it("removes a stale file for an undetected language and lists it", () => {
    const { fake, out, code, err } = scan(
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
    expect(JSON.parse(out).removed).toEqual([TS_CACHE]);
    expect(err).toBe(
      "typescript: removed stale .recognizer/cache/scan.typescript.json\n",
    );
    expect(fake.files.has(TS_CACHE)).toBe(false);
    expect(fake.files.get(`${ROOT}/.recognizer/cache/overlay.json`)).toBe(
      "keep",
    );
  });

  it("exits 0 with no languages, creates no directory and still removes stale files", () => {
    const { fake, code, err } = scan({
      files: { [`${ROOT}/readme.md`]: "", [PY_CACHE]: "old" },
    });

    expect(code).toBe(0);
    expect(err).toContain("no languages detected\n");
    expect(fake.writes).toEqual([]);
    expect(fake.removed).toEqual([PY_CACHE]);
    expect(fake.calls.map((call) => call.command)).toEqual(["git"]);
  });

  it("creates no cache directory when nothing is detected", () => {
    const { fake } = scan({ files: { [`${ROOT}/readme.md`]: "" } });

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

  it("prints one human line per written language", () => {
    const { out, err, code } = scan(options);

    expect(code).toBe(0);
    expect(out).toBe(
      "python: 2 modules, 1 edges -> .recognizer/cache/scan.python.json\ntypescript: 3 modules, 2 edges -> .recognizer/cache/scan.typescript.json\n",
    );
    expect(err).toBe("");
  });

  it("prints the exact --json document", () => {
    const { out } = scan(options, "--json");

    expect(JSON.parse(out)).toEqual({
      repository: ROOT,
      commit: "abc123",
      languages: [
        {
          language: "python",
          status: "written",
          modules: 2,
          edges: 1,
          file: PY_CACHE,
        },
        {
          language: "typescript",
          status: "written",
          modules: 3,
          edges: 2,
          file: TS_CACHE,
        },
      ],
      removed: [],
    });
  });

  it("reports commit null outside git", () => {
    const { out } = scan({ ...options, commit: undefined }, "--json");

    expect(JSON.parse(out).commit).toBeNull();
  });

  it("leaves stderr lines unchanged under --json", () => {
    const failing: FakeOptions = {
      files: both(),
      scanners: { [PYTHON]: okPython },
    };

    expect(scan(failing, "--json").err).toBe(scan(failing).err);
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

  it.each(cases)("%s is exit 2 and writes nothing", (_, argv) => {
    const fake = fakeIo({ files: { [`${ROOT}/a.py`]: "" } });

    expect(run(argv, fake.io)).toBe(2);
    expect(fake.writes).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("names both subcommands in the usage line", () => {
    const fake = fakeIo();

    run([], fake.io);

    expect(fake.err()).toContain("usage: recognizer <check|scan> ...");
  });
});
