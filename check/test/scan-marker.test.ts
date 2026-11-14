import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run, stopEverything } from "../src/cli.js";
import {
  boundReason,
  markerPath,
  parseMarker,
  progressPath,
  REASON_LIMIT,
  type ScanRunRecord,
} from "../src/scan-marker.js";
import { REPO } from "./helpers.js";
import {
  FAKE_PID,
  type FakeOptions,
  fakeIo,
  PYTHON,
  ROOT,
  scanJson,
} from "./scan-helpers.js";

const MARKER = markerPath(ROOT);
const PROGRESS = progressPath(ROOT);
const EXAMPLES = join(REPO, "schema/scan-marker-examples");
const OTHER_PID = 4242;

function markerFor(changes: Partial<ScanRunRecord> = {}): string {
  return JSON.stringify({
    version: 5,
    run_id: "11111111-2222-3333-4444-555555555555",
    pid: OTHER_PID,
    pgid: OTHER_PID,
    started_at: "2026-11-10T09:00:00.000Z",
    started_by: "cli",
    repository: ROOT,
    sensors: [],
    describe: false,
    suites: {},
    phase: "running",
    ended_at: null,
    exit: null,
    gaps: [],
    failure: null,
    commit: null,
    ran: null,
    ...changes,
  });
}

function recordOf(files: Map<string, string>): ScanRunRecord {
  return parseMarker(files.get(MARKER) ?? "") as ScanRunRecord;
}

function options(extra: FakeOptions = {}): FakeOptions {
  return {
    commit: "abc123",
    scanners: { [PYTHON]: { output: scanJson(1, 0) } },
    ...extra,
    files: {
      [`${ROOT}/a.py`]: "",
      [`${ROOT}/.recognizer/config.yaml`]: "sensors:\n  crap: {}\n",
      ...extra.files,
    },
  };
}

function observing(
  watch: (files: Map<string, string>) => void,
): Record<string, (args: string[], files: Map<string, string>) => undefined> {
  return {
    [PYTHON]: (args, files) => {
      const at = args.indexOf("--output");

      if (at !== -1) {
        files.set(args[at + 1] as string, scanJson(1, 0));
        watch(files);
      }

      return undefined;
    },
  };
}

async function scan(extra: FakeOptions = {}, ...args: string[]) {
  const fake = fakeIo(options(extra));
  const code = await run(["scan", ROOT, ...args], fake.io);

  return { code, fake };
}

describe("scan marker: refusal", () => {
  it("names the running scan, not an unregistered plugin, when a registered sensor is refused", async () => {
    const files = { [MARKER]: markerFor(), [PROGRESS]: "line\n" };
    const { code, fake } = await scan(
      { files, alivePids: [OTHER_PID] },
      "--sense",
      "crap",
    );

    expect(code).toBe(3);
    expect(fake.err()).toContain("a scan is already running");
    expect(fake.err()).not.toContain("not registered");
  });

  it("refuses a second scan while a live marker exists and leaves it untouched", async () => {
    const files = { [MARKER]: markerFor(), [PROGRESS]: "line\n" };
    const { code, fake } = await scan({ files, alivePids: [OTHER_PID] });

    expect(code).toBe(3);
    expect(fake.out()).toBe("");
    expect(fake.err()).toBe(
      `a scan is already running on ${ROOT}: started from the command line at 2026-11-10T09:00:00.000Z, process ${OTHER_PID}; remove ${MARKER} if that process is not a scan\n`,
    );
    expect(fake.files.get(MARKER)).toBe(markerFor());
    expect(fake.files.get(PROGRESS)).toBe("line\n");
    expect(fake.calls).toEqual([]);
  });

  it("names the app as the starter when the marker says so", async () => {
    const files = { [MARKER]: markerFor({ started_by: "app" }) };
    const { code, fake } = await scan({ files, alivePids: [OTHER_PID] });

    expect(code).toBe(3);
    expect(fake.err()).toContain("started from the app at");
  });

  it("replaces a marker whose process is dead", async () => {
    let during: ScanRunRecord | null = null;
    const programs = observing((files) => {
      during = parseMarker(files.get(MARKER) ?? "");
    });
    const { code } = await scan({
      files: { [MARKER]: markerFor(), [PROGRESS]: "old\n" },
      programs,
    });

    expect(code).toBe(0);
    expect(during).toMatchObject({
      pid: FAKE_PID,
      started_by: "cli",
      repository: ROOT,
      sensors: [],
      describe: false,
      phase: "checking",
    });
    expect((during as unknown as ScanRunRecord).started_at).not.toBe(
      "2026-11-10T09:00:00.000Z",
    );
  });

  it("treats a marker that is not JSON as stale", async () => {
    const { code, fake } = await scan({ files: { [MARKER]: "not json" } });

    expect(code).toBe(0);
    expect(recordOf(fake.files).pid).toBe(FAKE_PID);
  });

  it("serialises scans started in sequence", async () => {
    const holding = fakeIo(options());
    const owner = fakeIo(
      options({ files: { [MARKER]: markerFor(), [PROGRESS]: "" } }),
    );
    const refusing = fakeIo(
      options({
        files: { [MARKER]: markerFor(), [PROGRESS]: "" },
        alivePids: [OTHER_PID],
      }),
    );

    expect(await run(["scan", ROOT], refusing.io)).toBe(3);

    owner.files.delete(MARKER);
    owner.files.delete(PROGRESS);

    expect(await run(["scan", ROOT], owner.io)).toBe(0);
    expect(await run(["scan", ROOT], holding.io)).toBe(0);
  });

  it("takes no marker for a bad invocation", async () => {
    const { code, fake } = await scan({}, "--by", "");

    expect(code).toBe(2);
    expect(fake.files.has(MARKER)).toBe(false);
    expect(fake.files.has(PROGRESS)).toBe(false);
  });
});

describe("scan marker: release", () => {
  it("keeps both files and records finished after a normal end", async () => {
    const { code, fake } = await scan();

    expect(code).toBe(0);
    expect(fake.files.has(PROGRESS)).toBe(true);
    expect(recordOf(fake.files)).toMatchObject({
      phase: "finished",
      exit: 0,
      failure: null,
    });
    expect(recordOf(fake.files).ended_at).not.toBeNull();
  });

  it("records the commit and the phases that ran on a finished scan", async () => {
    const { fake } = await scan();

    expect(recordOf(fake.files)).toMatchObject({
      commit: "abc123",
      ran: ["extract"],
    });
  });

  it("records a null ran when the record ends without a summary", async () => {
    const { fake } = await scan({
      programs: {
        [PYTHON]: () => {
          throw new Error("sensor blew up");
        },
      },
    });

    expect(recordOf(fake.files)).toMatchObject({
      phase: "failed",
      commit: null,
      ran: null,
    });
  });

  it("records a null ran when stopEverything ends the scan", async () => {
    const { fake } = await scan({
      programs: observing(() => {
        stopEverything();
      }),
    });

    expect(recordOf(fake.files)).toMatchObject({
      phase: "stopped",
      commit: null,
      ran: null,
    });
  });

  it("keeps both files and records failed after a failed scan", async () => {
    const { code, fake } = await scan({
      scanners: { [PYTHON]: { status: 1, stderr: "boom" } },
    });

    expect(code).toBe(1);
    expect(fake.files.has(PROGRESS)).toBe(true);
    expect(recordOf(fake.files)).toMatchObject({ phase: "failed", exit: 1 });
    expect(recordOf(fake.files).failure?.reason).toContain("boom");
  });

  it("keeps both files and records failed after a throw", async () => {
    const { code, fake } = await scan({
      programs: {
        [PYTHON]: () => {
          throw new Error("sensor blew up");
        },
      },
    });

    expect(code).toBe(2);
    expect(fake.files.has(PROGRESS)).toBe(true);
    expect(recordOf(fake.files)).toMatchObject({ phase: "failed", exit: 1 });
    expect(recordOf(fake.files).failure).toEqual({
      sensor: "scan",
      suite: null,
      code: null,
      reason: "sensor blew up",
    });
    expect(recordOf(fake.files).ran).toBeNull();
  });

  it("records the message of an error thrown before the marker is held", async () => {
    const { code, fake } = await scan({}, "--sense", "nosuch");
    const record = recordOf(fake.files);

    expect(code).toBe(2);
    expect(record.phase).toBe("failed");
    expect(record.ran).toBeNull();
    expect(fake.err()).toBe(`${record.failure?.reason}\n`);
    expect(record.failure?.reason.length).toBeGreaterThan(0);
  });

  it("records no marker for an error before the folder is known", async () => {
    const fake = fakeIo(options());
    const code = await run(["scan", ROOT, "--by"], fake.io);

    expect(code).toBe(2);
    expect(fake.files.has(MARKER)).toBe(false);
  });

  it("takes no marker and keeps the error when the folder does not exist", async () => {
    const fake = fakeIo(options());
    const missing = "/nowhere/at-all";
    const code = await run(["scan", missing], fake.io);

    expect(code).toBe(2);
    expect(fake.err()).toContain(`repository is not a directory: ${missing}`);
    expect(
      [...fake.files.keys()].some((path) => path.startsWith(missing)),
    ).toBe(false);
  });

  it("takes no marker and keeps the error when the folder is a file", async () => {
    const fake = fakeIo(options({ files: { [`${ROOT}/a.py`]: "" } }));
    const code = await run(["scan", `${ROOT}/a.py`], fake.io);

    expect(code).toBe(2);
    expect(fake.err()).toContain("repository is not a directory");
    expect(fake.files.has(MARKER)).toBe(false);
  });

  it("rethrows the original error when the early marker cannot be taken", async () => {
    const fake = fakeIo(options());
    const failing = {
      ...fake.io,
      createExclusive: () => {
        throw new Error("ENOENT: cannot create marker");
      },
    };
    const code = await run(["scan", ROOT, "--sense", "nosuch"], failing);

    expect(code).toBe(2);
    expect(fake.err()).not.toContain("cannot create marker");
    expect(fake.err()).toContain("nosuch");
  });

  it("leaves a live scan's record untouched when an early error finds it", async () => {
    const files = { [MARKER]: markerFor() };
    const { code, fake } = await scan(
      { files, alivePids: [OTHER_PID] },
      "--sense",
      "nosuch",
    );

    expect(code).toBe(2);
    expect(fake.files.get(MARKER)).toBe(markerFor());
  });

  it("keeps both files and records stopped when stopEverything is called mid-scan", async () => {
    let during: ScanRunRecord | null = null;
    const { fake } = await scan({
      programs: observing((files) => {
        stopEverything();
        during = recordOf(files);
      }),
    });

    expect(fake.files.has(PROGRESS)).toBe(true);
    expect(during).toMatchObject({ phase: "stopped", exit: 143 });
    expect(recordOf(fake.files).phase).toBe("stopped");
  });

  it("leaves a marker that holds another pid", async () => {
    const taken = markerFor({ pid: 99 });
    const { fake } = await scan({
      programs: observing((files) => {
        files.set(MARKER, taken);
      }),
    });

    expect(fake.files.get(MARKER)).toBe(taken);
  });
});

describe("scan marker: record phases", () => {
  it("writes running after the preflight and finished at the end, with the process group of the scan", async () => {
    const fake = fakeIo(options({ pgids: { [FAKE_PID]: 4242 } }));
    const phases: string[] = [];
    const io = {
      ...fake.io,
      rename: (from: string, to: string) => {
        if (to === MARKER) {
          phases.push(parseMarker(fake.files.get(from) ?? "")?.phase ?? "?");
        }

        fake.io.rename(from, to);
      },
    };

    await run(["scan", ROOT], io);

    expect(phases).toEqual(["running", "finished"]);
    expect(recordOf(fake.files).pgid).toBe(4242);
  });

  it("holds a null process group when the lookup returns null", async () => {
    const { fake } = await scan({ pgids: { [FAKE_PID]: null } });

    expect(recordOf(fake.files).pgid).toBeNull();
  });

  it("records refused with exit 4 and the gaps a preflight with no commit emits", async () => {
    const { code, fake } = await scan({ commit: undefined }, "--sense", "crap");
    const record = recordOf(fake.files);

    expect(code).toBe(4);
    expect(record).toMatchObject({ phase: "refused", exit: 4 });
    expect(record.gaps).toHaveLength(1);
    expect(record.gaps[0]).toMatchObject({ id: "no-commit", needs: ["crap"] });
    expect(record.ended_at).not.toBeNull();
    expect(fake.files.has(PROGRESS)).toBe(true);
  });

  it("records the commit and the phases that held an entry on a refusal", async () => {
    const { fake } = await scan({ commit: undefined }, "--sense", "crap");

    expect(recordOf(fake.files)).toMatchObject({ commit: null, ran: [] });
  });

  it("leaves a refused record refused when stopEverything is called after the refusal", async () => {
    const { fake } = await scan({ commit: undefined }, "--sense", "crap");

    stopEverything();

    expect(recordOf(fake.files).phase).toBe("refused");
  });
});

describe("scan marker: replacement", () => {
  it("replaces a finished record whose pid is alive", async () => {
    const files = {
      [MARKER]: markerFor({ phase: "finished", exit: 0 }),
      [PROGRESS]: "old\n",
    };
    const { code, fake } = await scan({ files, alivePids: [OTHER_PID] });

    expect(files[MARKER]).toContain('"finished"');
    expect(code).toBe(0);
    expect(recordOf(fake.files).run_id).not.toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("removes a leftover answer file with the old progress file", async () => {
    const answer = `${ROOT}/.recognizer/cache/scan-running.answer.json`;
    const files = {
      [MARKER]: markerFor({ phase: "finished", exit: 0 }),
      [PROGRESS]: "old\n",
      [answer]: "{}",
    };
    const fake = fakeIo(options({ files, alivePids: [] }));

    expect(fake.files.has(answer)).toBe(true);

    await run(["scan", ROOT], fake.io);

    expect(fake.files.has(answer)).toBe(false);
  });

  it("refuses with exit 3 and leaves a running record with a live pid byte-identical", async () => {
    const files = { [MARKER]: markerFor({ phase: "running" }) };
    const { code, fake } = await scan({ files, alivePids: [OTHER_PID] });

    expect(code).toBe(3);
    expect(fake.files.get(MARKER)).toBe(files[MARKER]);
  });

  it("replaces a running record whose pid is dead", async () => {
    const { code, fake } = await scan({
      files: { [MARKER]: markerFor({ phase: "running" }) },
    });

    expect(code).toBe(0);
    expect(recordOf(fake.files).pid).toBe(FAKE_PID);
  });
});

describe("scan marker: progress and origin", () => {
  it("appends the event lines to the progress file without --json and never the confirm event", async () => {
    let seen = "";
    const { fake } = await scan({
      programs: observing((files) => {
        seen = files.get(PROGRESS) ?? "";
      }),
    });
    const json = fakeIo(options());

    await run(["scan", ROOT, "--json"], json.io);

    const printed = json.out();

    expect(fake.out()).not.toBe(printed);
    expect(seen).toContain('"event":"phase"');
    expect(seen).not.toContain("confirm");
    expect(printed).toContain('"event":"summary"');
  });

  it("holds exactly the lines a --json scan prints, in order", async () => {
    const programs = observing(() => {});
    const fake = fakeIo(options({ programs }));

    await run(["scan", ROOT, "--json"], fake.io);

    const captured = fake.files.get(PROGRESS) ?? "";

    expect(captured).toBe(fake.out());
    expect(captured).not.toBe("");

    const quiet = fakeIo(options({ programs }));

    await run(["scan", ROOT], quiet.io);

    const quietCaptured = quiet.files.get(PROGRESS) ?? "";

    expect(quietCaptured).toBe(captured);
  });

  it.each([
    ["app", "app"],
    ["cli", "cli"],
    ["other", "cli"],
    [undefined, "cli"],
  ])("records RECOGNIZER_STARTED_BY=%s as %s", async (value, expected) => {
    let during: ScanRunRecord | null = null;
    const env = value === undefined ? {} : { RECOGNIZER_STARTED_BY: value };

    await scan({
      env,
      programs: observing((files) => {
        during = parseMarker(files.get(MARKER) ?? "");
      }),
    });

    expect((during as unknown as ScanRunRecord).started_by).toBe(expected);
  });
});

describe("scan marker: the reason bound", () => {
  it("keeps 100 characters whole and trims trailing whitespace", () => {
    expect(boundReason(`${"a".repeat(100)}  \n`)).toBe("a".repeat(100));
  });

  it("keeps exactly the limit whole", () => {
    const text = "b".repeat(REASON_LIMIT);

    expect(boundReason(text)).toBe(text);
  });

  it("keeps the last 8192 characters of a longer text", () => {
    const text = `x${"c".repeat(REASON_LIMIT)}`;

    expect(boundReason(text)).toBe("c".repeat(REASON_LIMIT));
  });

  it("moves the cut one character later rather than keep half a surrogate pair", () => {
    const text = `\u{1F600}${"e".repeat(REASON_LIMIT - 1)}`;
    const cut = text.length - REASON_LIMIT;

    expect(text.charCodeAt(cut)).toBeGreaterThanOrEqual(0xdc00);
    expect(text.charCodeAt(cut)).toBeLessThanOrEqual(0xdfff);
    expect(boundReason(text)).toBe("e".repeat(REASON_LIMIT - 1));
  });

  it("bounds the reason of a failed entry in the record", async () => {
    const { fake } = await scan({
      scanners: {
        [PYTHON]: { status: 1, stderr: `${"z".repeat(REASON_LIMIT + 50)}` },
      },
    });

    expect(recordOf(fake.files).failure?.reason.length).toBeLessThanOrEqual(
      REASON_LIMIT,
    );
  });
});

describe("scan marker: examples", () => {
  it("holds the expected count of examples", () => {
    expect(readdirSync(join(EXAMPLES, "valid"))).toHaveLength(9);
    expect(readdirSync(join(EXAMPLES, "invalid"))).toHaveLength(15);
  });

  it.each(readdirSync(join(EXAMPLES, "valid")))("accepts %s", (file) => {
    const text = readFileSync(join(EXAMPLES, "valid", file), "utf8");
    const written = JSON.parse(text) as ScanRunRecord;

    expect(parseMarker(text)).toEqual(written);
  });

  it.each(readdirSync(join(EXAMPLES, "invalid")))("rejects %s", (file) => {
    expect(
      parseMarker(readFileSync(join(EXAMPLES, "invalid", file), "utf8")),
    ).toBeNull();
  });
});
