import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateRunRecord } from "../src/log-document.js";
import {
  asker,
  bound,
  KEEP,
  latestRun,
  listRuns,
  type RunEntry,
  type RunKind,
  type RunRecord,
  readRun,
  STDERR_LIMIT,
  writeRunLog,
} from "../src/run-log.js";
import { REPO } from "./helpers.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

const DIRECTORY = `${ROOT}/.recognizer/cache/log`;
const EXAMPLES = join(REPO, "schema/log-examples");

function entry(changes: Partial<RunEntry> = {}): RunEntry {
  return {
    name: "python",
    command: ["recognizer-scan-python"],
    status: 0,
    outcome: "ok",
    duration_ms: 5,
    stderr: "",
    ...changes,
  };
}

function record(
  started = "2026-11-02T09:30:00.120Z",
  kind: RunKind = "scan",
  entries: RunEntry[] = [entry()],
): RunRecord {
  return {
    log_version: 1,
    kind,
    started,
    finished: "2026-11-02T09:30:01.000Z",
    by: "ken",
    arguments: [],
    outcome: entries.some((one) => one.outcome === "failed") ? "failed" : "ok",
    exit: entries.some((one) => one.outcome === "failed") ? 1 : 0,
    entries,
  };
}

function names(fake: ReturnType<typeof fakeIo>): string[] {
  return fake.io
    .readDir(DIRECTORY)
    .map((one) => one.name)
    .sort();
}

describe("bound", () => {
  it("trims trailing whitespace and keeps a short stderr whole", () => {
    expect(bound("oops\n\n")).toEqual({ stderr: "oops", truncated: false });
  });

  it("keeps exactly the limit whole", () => {
    const text = "x".repeat(STDERR_LIMIT);

    expect(bound(text)).toEqual({ stderr: text, truncated: false });
  });

  it("cuts one character over the limit to its tail", () => {
    const text = `a${"b".repeat(STDERR_LIMIT)}`;
    const result = bound(text);

    expect(result.truncated).toBe(true);
    expect(result.stderr).toBe("b".repeat(STDERR_LIMIT));
  });
});

describe("asker", () => {
  it("takes --by, then USER, then LOGNAME, then unknown", () => {
    expect(asker(fakeIo({ env: { USER: "u" } }).io, "Claude")).toBe("Claude");
    expect(
      asker(fakeIo({ env: { USER: "u", LOGNAME: "l" } }).io, undefined),
    ).toBe("u");
    expect(asker(fakeIo({ env: { LOGNAME: "l" } }).io, undefined)).toBe("l");
    expect(asker(fakeIo().io, undefined)).toBe("unknown");
  });

  it("cuts a long --by to 64 characters", () => {
    expect(asker(fakeIo().io, "n".repeat(100))).toHaveLength(64);
  });
});

describe("writeRunLog and readRun", () => {
  it("round-trips a record under a stamped name", () => {
    const fake = fakeIo();
    const written = record("2026-11-02T09:30:00.120Z", "describe");

    expect(writeRunLog(fake.io, ROOT, written)).toBeNull();
    expect(names(fake)).toEqual(["20261102T093000120Z-describe.json"]);
    expect(readRun(fake.io, ROOT, "20261102T093000120Z-describe")).toEqual({
      id: "20261102T093000120Z-describe",
      ...written,
    });
    expect(fake.renames).toHaveLength(1);
  });

  it("advances the stamp when two runs start in the same millisecond", () => {
    const fake = fakeIo();

    writeRunLog(fake.io, ROOT, record());
    writeRunLog(fake.io, ROOT, record());

    expect(names(fake)).toEqual([
      "20261102T093000120Z-scan.json",
      "20261102T093000121Z-scan.json",
    ]);
    expect(readRun(fake.io, ROOT, "20261102T093000121Z-scan").started).toBe(
      "2026-11-02T09:30:00.120Z",
    );
  });

  it("keeps the newest fifty and leaves other files alone", () => {
    const fake = fakeIo({ files: { [`${DIRECTORY}/notes.txt`]: "mine" } });

    for (let index = 0; index <= KEEP; index += 1) {
      const started = new Date(
        Date.UTC(2026, 10, 2, 9, 0, index),
      ).toISOString();

      writeRunLog(fake.io, ROOT, record(started));
    }

    const kept = names(fake);

    expect(kept).toHaveLength(KEEP + 1);
    expect(kept).toContain("notes.txt");
    expect(kept).not.toContain("20261102T090000000Z-scan.json");
    expect(kept).toContain("20261102T090050000Z-scan.json");
  });

  it("returns a message and does not throw when the write fails", () => {
    const fake = fakeIo();
    const failing = {
      ...fake.io,
      writeFile: () => {
        throw new Error("disk full");
      },
    };

    expect(writeRunLog(failing, ROOT, record())).toBe("disk full");
  });

  it("refuses a path-like id before touching the filesystem", () => {
    const fake = fakeIo();

    expect(() => readRun(fake.io, ROOT, "../x")).toThrow(/not a run id/);
    expect(fake.readDirCalls()).toBe(0);
  });

  it("refuses a missing run and an invalid one", () => {
    const fake = fakeIo({
      files: { [`${DIRECTORY}/20261102T093000120Z-scan.json`]: '{"a":1}' },
    });

    expect(() => readRun(fake.io, ROOT, "20261102T093000121Z-scan")).toThrow(
      "no such run: 20261102T093000121Z-scan",
    );
    expect(() => readRun(fake.io, ROOT, "20261102T093000120Z-scan")).toThrow(
      /is not valid/,
    );
  });
});

describe("listRuns", () => {
  it("lists newest first, filters by kind and reports an invalid file as skipped", () => {
    const fake = fakeIo({
      files: { [`${DIRECTORY}/20261102T093000500Z-sense.json`]: "not json" },
    });

    writeRunLog(fake.io, ROOT, record("2026-11-02T09:30:00.100Z", "scan"));
    writeRunLog(fake.io, ROOT, record("2026-11-02T09:30:00.300Z", "describe"));

    const all = listRuns(fake.io, ROOT);

    expect(all.runs.map((run) => run.id)).toEqual([
      "20261102T093000300Z-describe",
      "20261102T093000100Z-scan",
    ]);
    expect(all.skipped.map((one) => one.id)).toEqual([
      "20261102T093000500Z-sense",
    ]);
    expect(listRuns(fake.io, ROOT, "scan").runs).toHaveLength(1);
    expect(latestRun(fake.io, ROOT)?.kind).toBe("describe");
    expect(latestRun(fake.io, ROOT, "sense")).toBeNull();
  });

  it("counts failed entries in the summary", () => {
    const fake = fakeIo();

    writeRunLog(
      fake.io,
      ROOT,
      record("2026-11-02T09:30:00.100Z", "scan", [
        entry(),
        entry({
          name: "typescript",
          outcome: "failed",
          status: 1,
          reason: "x",
        }),
      ]),
    );

    expect(listRuns(fake.io, ROOT).runs[0]).toMatchObject({
      outcome: "failed",
      entries: 2,
      failed: 1,
    });
  });

  it("lists nothing when the directory does not exist", () => {
    expect(listRuns(fakeIo().io, ROOT)).toEqual({ runs: [], skipped: [] });
  });
});

describe("a phased scan record", () => {
  function phased(): RunRecord {
    return {
      ...record(),
      outcome: "failed",
      exit: 1,
      entries: undefined,
      phases: [
        { phase: "extract", entries: [entry()] },
        {
          phase: "sense",
          entries: [
            entry({ name: "gaps", outcome: "failed", status: 1, reason: "x" }),
            entry({ name: "other" }),
          ],
        },
      ],
    };
  }

  it("sums entries and failures across phases in the summary", () => {
    const fake = fakeIo();
    const written = JSON.parse(JSON.stringify(phased()));

    writeRunLog(fake.io, ROOT, written);

    expect(listRuns(fake.io, ROOT).runs[0]).toMatchObject({
      kind: "scan",
      entries: 3,
      failed: 1,
    });
    expect(latestRun(fake.io, ROOT, "scan")?.phases).toHaveLength(2);
  });

  it("validates, and so does a legacy flat scan and a legacy sense record", () => {
    expect(() =>
      validateRunRecord(JSON.parse(JSON.stringify(phased()))),
    ).not.toThrow();
    expect(() => validateRunRecord(record())).not.toThrow();
    expect(() => validateRunRecord(record(undefined, "sense"))).not.toThrow();
  });

  it("refuses phases on a describe record and an empty finished phase list", () => {
    const describing = JSON.parse(JSON.stringify(phased()));

    describing.kind = "describe";

    expect(() => validateRunRecord(describing)).toThrow();

    const empty = JSON.parse(JSON.stringify(phased()));

    empty.phases = [];

    expect(() => validateRunRecord(empty)).toThrow();
  });
});

describe("log schema examples", () => {
  it("shares the diagnosis definition with the findings schema", () => {
    const findings = JSON.parse(
      readFileSync(join(REPO, "schema/findings.schema.json"), "utf8"),
    );
    const log = JSON.parse(
      readFileSync(join(REPO, "schema/log.schema.json"), "utf8"),
    );

    expect(log.$defs.entry.properties.diagnosis).toEqual(
      findings.$defs.diagnosis,
    );
  });

  it("holds the expected count of valid examples", () => {
    expect(readdirSync(join(EXAMPLES, "valid"))).toHaveLength(14);
  });

  it.each(readdirSync(join(EXAMPLES, "valid")))("accepts %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "valid", file), "utf8"),
    );

    expect(() => validateRunRecord(value)).not.toThrow();
  });

  it.each(readdirSync(join(EXAMPLES, "invalid")))("rejects %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "invalid", file), "utf8"),
    );

    expect(() => validateRunRecord(value)).toThrow();
  });
});
