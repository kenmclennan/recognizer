import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../scripts/temp-dirs.mjs";
import { type Io, run } from "../src/cli.js";
import { capture, REPO } from "./helpers.js";
import {
  type Fake,
  type FakeOptions,
  fakeIo,
  PYTHON,
  ROOT,
  scanJson,
} from "./scan-helpers.js";

const DIRECTORY = `${ROOT}/.recognizer/cache/log`;

function scanning(options: FakeOptions = {}, ...args: string[]) {
  const fake = fakeIo({
    files: { [`${ROOT}/a.py`]: "" },
    scanners: { [PYTHON]: { output: scanJson(2, 1) } },
    ...options,
  });
  const code = run(["scan", ROOT, ...args], fake.io);

  return { fake, code, out: fake.out(), err: fake.err() };
}

function log(fake: Fake, ...args: string[]) {
  const before = fake.out();
  const beforeErr = fake.err();
  const code = run(["log", "--repository", ROOT, ...args], fake.io);

  return {
    code,
    out: fake.out().slice(before.length),
    err: fake.err().slice(beforeErr.length),
  };
}

function records(fake: Fake): string[] {
  return [...fake.files.keys()]
    .filter((key) => key.startsWith(`${DIRECTORY}/`))
    .sort();
}

describe("scan leaves a run record", () => {
  it("records a written and a failed language as two entries", () => {
    const { fake, code } = scanning({
      files: { [`${ROOT}/a.py`]: "", [`${ROOT}/b.ts`]: "" },
      scanners: {
        [PYTHON]: { output: scanJson(2, 1) },
        "recognizer-scan-typescript": { status: 3, stderr: "boom\n" },
      },
      env: { USER: "ken" },
    });
    const [file] = records(fake);
    const saved = JSON.parse(fake.files.get(file as string) as string);

    expect(code).toBe(1);
    expect(records(fake)).toHaveLength(1);
    expect(file).toMatch(/\/\d{8}T\d{9}Z-scan\.json$/);
    expect(saved.by).toBe("ken");
    expect(saved.outcome).toBe("failed");
    expect(saved.entries).toBeUndefined();
    expect(saved.phases).toHaveLength(1);
    expect(saved.phases[0].phase).toBe("extract");

    const extract = saved.phases[0].entries;

    expect(extract.map((one: { name: string }) => one.name)).toEqual([
      "python",
      "typescript",
    ]);
    expect(extract[0]).toMatchObject({ status: 0, outcome: "ok" });
    expect(extract[1]).toMatchObject({
      status: 3,
      outcome: "failed",
      stderr: "boom",
      reason: "scanner-failed - exit 3: boom",
    });
  });

  it("records --by", () => {
    const { fake } = scanning({}, "--by", "Claude");

    expect(
      JSON.parse(fake.files.get(records(fake)[0] as string) as string).by,
    ).toBe("Claude");
  });

  it("writes nothing when no language is detected", () => {
    const { fake } = scanning({ files: { [`${ROOT}/readme.md`]: "" } });

    expect(records(fake)).toEqual([]);
  });

  it("writes nothing and creates no directory on a usage error", () => {
    const { fake, code } = scanning({}, "--by", " ");

    expect(code).toBe(2);
    expect(records(fake)).toEqual([]);
  });

  it("warns on stderr and keeps stdout and the exit code when the record cannot be written", () => {
    const plain = scanning();
    const fake = fakeIo({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { output: scanJson(2, 1) } },
    });
    const broken = {
      ...fake.io,
      writeFile: (path: string, content: string) => {
        if (path.includes("/cache/log/")) {
          throw new Error("disk full");
        }

        fake.io.writeFile(path, content);
      },
    };
    const code = run(["scan", ROOT], broken);

    expect(code).toBe(plain.code);
    expect(fake.out()).toBe(plain.out);
    expect(fake.err()).toBe(`could not write run log: disk full\n`);
  });

  it("leaves one scan record when a stale cache is rescanned by another command", () => {
    const fake = fakeIo({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { output: scanJson(2, 1) } },
    });

    run(["modules", "--repository", ROOT], fake.io);

    expect(records(fake)).toHaveLength(1);
    expect(records(fake)[0]).toMatch(/-scan\.json$/);
  });
});

describe("recognizer log", () => {
  function twoRuns() {
    const fake = fakeIo({
      files: { [`${ROOT}/a.py`]: "", [`${ROOT}/b.ts`]: "" },
      scanners: {
        [PYTHON]: { output: scanJson(2, 1) },
        "recognizer-scan-typescript": { status: 3, stderr: "boom\n" },
      },
    });

    run(["scan", ROOT], fake.io);
    run(["scan", ROOT, "--by", "Claude"], fake.io);

    return fake;
  }

  it("lists runs newest first, one per line", () => {
    const fake = twoRuns();
    const result = log(fake);
    const lines = result.out.trimEnd().split("\n");

    expect(result.code).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^\d{8}T\d{9}Z-scan {2}scan {2}\S+ {2}failed {2}1 ok, 1 failed$/,
    );
    expect((lines[0] as string) > (lines[1] as string)).toBe(true);
  });

  it("prints the newest run in full with --last and one run by id", () => {
    const fake = twoRuns();
    const last = log(fake, "--last");
    const id = (
      last.out.match(/^id: (\S+)$/m) as RegExpMatchArray
    )[1] as string;

    expect(last.out).toContain("by: Claude");
    expect(last.out).toContain("typescript  failed  exit 3");
    expect(last.out).toContain("  reason: scanner-failed - exit 3: boom");
    expect(last.out).toContain("    boom");
    expect(log(fake, id).out).toBe(last.out);
  });

  it("prints one heading per phase for a phased record and none for a legacy one", () => {
    const fake = fakeIo({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { output: scanJson(2, 1) } },
    });

    run(["scan", ROOT], fake.io);

    const phased = log(fake, "--last").out;

    expect(phased).toMatch(/^extract$/m);
    expect(phased).toContain("python  ok  exit 0");
    expect(phased).not.toMatch(/^describe$/m);

    const legacy = JSON.parse(
      readFileSync(
        join(REPO, "schema/log-examples/valid/scan-ok.json"),
        "utf8",
      ),
    );

    fake.files.set(
      `${DIRECTORY}/20990101T000000000Z-scan.json`,
      JSON.stringify(legacy),
    );

    const flat = log(fake, "20990101T000000000Z-scan").out;

    expect(flat).toContain("python  ok  exit 0");
    expect(flat).not.toMatch(/^extract$/m);
  });

  it("prints json for the list, --last and an id", () => {
    const fake = twoRuns();
    const listed = JSON.parse(log(fake, "--json").out);
    const last = JSON.parse(log(fake, "--last", "--json").out);
    const one = JSON.parse(log(fake, listed.runs[1].id, "--json").out);

    expect(listed.runs).toHaveLength(2);
    expect(listed.runs[0]).toMatchObject({
      kind: "scan",
      entries: 2,
      failed: 1,
    });
    expect(last.id).toBe(listed.runs[0].id);
    expect(one.id).toBe(listed.runs[1].id);
    expect(last.phases[0].entries).toHaveLength(2);
  });

  it("filters by kind", () => {
    const fake = twoRuns();

    expect(log(fake, "--kind", "describe").out).toBe("no runs recorded\n");
    expect(
      JSON.parse(log(fake, "--kind", "scan", "--json").out).runs,
    ).toHaveLength(2);
  });

  it("answers an empty list with exit 0 and --last with exit 2", () => {
    const fake = fakeIo();

    expect(log(fake)).toMatchObject({ code: 0, out: "no runs recorded\n" });
    expect(log(fake, "--last")).toMatchObject({
      code: 2,
      err: "no runs recorded\n",
    });
  });

  it("refuses bad ids, conflicting options and an unknown kind", () => {
    const fake = twoRuns();

    expect(log(fake, "../x").code).toBe(2);
    expect(log(fake, "20200101T000000000Z-scan").err).toContain("no such run");
    expect(log(fake, "--last", "20200101T000000000Z-scan").code).toBe(2);
    expect(log(fake, "a", "b").code).toBe(2);
    expect(log(fake, "--kind", "scan", "20200101T000000000Z-scan").code).toBe(
      2,
    );
    expect(log(fake, "--kind", "audit").code).toBe(2);
  });

  it("names a skipped file on stderr and still lists the rest", () => {
    const fake = twoRuns();

    fake.files.set(`${DIRECTORY}/20990101T000000000Z-sense.json`, "nope");

    const result = log(fake);

    expect(result.code).toBe(0);
    expect(result.err).toContain("skipped 20990101T000000000Z-sense:");
    expect(result.out.trimEnd().split("\n")).toHaveLength(2);
  });

  it("writes no record and never scans", () => {
    const fake = twoRuns();
    const before = records(fake).length;
    const calls = fake.calls.length;

    log(fake);
    log(fake, "--last");

    expect(records(fake)).toHaveLength(before);
    expect(fake.calls).toHaveLength(calls);
  });

  it("marks a truncated stderr", () => {
    const fake = fakeIo({
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { status: 1, stderr: "e".repeat(9000) } },
    });

    run(["scan", ROOT], fake.io);

    const out = log(fake, "--last").out;

    expect(out).toContain("(stderr cut to the last 8192 characters)");
  });
});

describe("sense and measure", () => {
  const COMMIT = "abc123";
  const REGISTER =
    'sensors:\n  fake-sensor:\n    command: [fake-sensor, "{commit}", "{output}"]\n' +
    '  other:\n    command: [other-sensor, "{output}"]\n';

  function document(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      findings_version: 1,
      sensor: { name: "fake-sensor", version: "1" },
      commit: COMMIT,
      modified: false,
      settings: {},
      findings: [],
      ...overrides,
    });
  }

  function sensing(content: string, ...args: string[]) {
    const fake = fakeIo({
      commit: COMMIT,
      files: { [`${ROOT}/.recognizer/config.yaml`]: REGISTER },
      programs: {
        "fake-sensor": (argv, files) => {
          files.set(argv[argv.length - 1] as string, content);

          return undefined;
        },
        "other-sensor": (argv, files) => {
          files.set(argv[argv.length - 1] as string, content);

          return { stderr: "chatty\n" };
        },
      },
    });
    const code = run(["scan", ROOT, "--sense", ...args], fake.io);

    return { fake, code };
  }

  it("records a sensor that exits 0 with invalid findings as failed", () => {
    const { fake, code } = sensing(
      document({ commit: "zzz" }),
      "fake-sensor",
      "--by",
      "Claude",
    );
    const saved = JSON.parse(
      fake.files.get(records(fake)[0] as string) as string,
    );

    expect(code).toBe(1);
    expect(saved.kind).toBe("scan");
    expect(saved.by).toBe("Claude");
    expect(saved.phases.map((one: { phase: string }) => one.phase)).toEqual([
      "extract",
      "sense",
    ]);

    const sensed = saved.phases[1].entries;

    expect(sensed).toHaveLength(1);
    expect(sensed[0]).toMatchObject({
      name: "fake-sensor",
      status: 0,
      outcome: "failed",
      command: [
        "fake-sensor",
        COMMIT,
        `${ROOT}/.recognizer/cache/findings/fake-sensor.json`,
      ],
    });
    expect(sensed[0].reason).toContain("findings commit zzz");
  });

  it("selects the named sensors and records one entry per sensor", () => {
    const { fake } = sensing(document(), "other", "--json");
    const saved = JSON.parse(
      fake.files.get(records(fake)[0] as string) as string,
    );
    const sensed = saved.phases[1].entries;

    expect(sensed.map((one: { name: string }) => one.name)).toEqual(["other"]);
    expect(sensed[0].stderr).toBe("chatty");
  });

  it("writes nothing on bad input", () => {
    const { fake, code } = sensing(document(), "nope");

    expect(code).toBe(2);
    expect(records(fake)).toEqual([]);
    expect(sensing(document(), "--by", "").code).toBe(2);
  });

  it("records one measure entry per overlay, failed ones with their reason", () => {
    const fake = fakeIo({
      commit: COMMIT,
      files: {
        [`${ROOT}/.recognizer/config.yaml`]:
          'overlays:\n  cov:\n    command: [cov, "{commit}", "{output}"]\n    metrics:\n      - { name: line_coverage, type: ratio, granularity: module, bad: low }\n',
      },
      programs: { cov: () => ({ status: 1, stderr: "no" }) },
    });

    const code = run(
      ["measure", "--repository", ROOT, "--by", "Claude"],
      fake.io,
    );
    const saved = JSON.parse(
      fake.files.get(records(fake)[0] as string) as string,
    );

    expect(code).toBe(1);
    expect(records(fake)[0]).toMatch(/-measure\.json$/);
    expect(saved.kind).toBe("measure");
    expect(saved.by).toBe("Claude");
    expect(saved.outcome).toBe("failed");
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]).toMatchObject({
      name: "cov",
      status: 1,
      outcome: "failed",
      reason: "no",
      stderr: "no",
      command: ["cov", COMMIT, `${ROOT}/.recognizer/cache/overlays/cov.json`],
    });
    expect(log(fake, "--kind", "measure").out).toContain("measure");
    expect(log(fake, "--kind", "sense").out).not.toContain("measure");
  });

  it("writes nothing when measure stops on bad input", () => {
    const fake = fakeIo({ commit: COMMIT });

    expect(run(["measure", "--repository", ROOT], fake.io)).toBe(2);
    expect(records(fake)).toEqual([]);
  });
});

describe("a scan record from the real run", () => {
  it("is read back by log --json after a stubbed scan of the python sample", () => {
    const root = makeTempDir("recognizer-log-");

    cpSync(join(REPO, "fixtures/python/sample"), root, { recursive: true });

    const out = capture();
    const real = out.io.run;
    const io: Io = {
      ...out.io,
      run: (command, args, options) => {
        if (command !== PYTHON) {
          return real(command, args, options);
        }

        writeFileSync(
          args[args.indexOf("--output") + 1] as string,
          scanJson(2, 1),
        );

        return { started: true, status: 0, stdout: "", stderr: "" };
      },
    };

    expect(run(["scan", root], io)).toBe(0);
    expect(run(["log", "--json", "--repository", root], io)).toBe(0);

    const listed = JSON.parse(
      out.out().slice(out.out().indexOf('{\n  "runs"')),
    );

    expect(listed.runs).toHaveLength(1);
    expect(listed.runs[0]).toMatchObject({
      kind: "scan",
      entries: 1,
      failed: 0,
    });
  });
});
