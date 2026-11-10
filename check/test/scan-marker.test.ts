import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run, stopEverything } from "../src/cli.js";
import {
  markerPath,
  parseMarker,
  progressPath,
  type ScanMarker,
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

function markerFor(changes: Partial<ScanMarker> = {}): string {
  return JSON.stringify({
    version: 1,
    pid: OTHER_PID,
    started_at: "2026-11-10T09:00:00.000Z",
    started_by: "cli",
    repository: ROOT,
    sensors: [],
    describe: false,
    ...changes,
  });
}

function options(extra: FakeOptions = {}): FakeOptions {
  return {
    commit: "abc123",
    scanners: { [PYTHON]: { output: scanJson(1, 0) } },
    ...extra,
    files: { [`${ROOT}/a.py`]: "", ...extra.files },
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
    let during: ScanMarker | null = null;
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
    });
    expect((during as unknown as ScanMarker).started_at).not.toBe(
      "2026-11-10T09:00:00.000Z",
    );
  });

  it("treats a marker that is not JSON as stale", async () => {
    const { code, fake } = await scan({ files: { [MARKER]: "not json" } });

    expect(code).toBe(0);
    expect(fake.files.has(MARKER)).toBe(false);
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
  it("removes both files after a normal end", async () => {
    const { code, fake } = await scan();

    expect(code).toBe(0);
    expect(fake.files.has(MARKER)).toBe(false);
    expect(fake.files.has(PROGRESS)).toBe(false);
  });

  it("removes both files after a failed scan", async () => {
    const { code, fake } = await scan({
      scanners: { [PYTHON]: { status: 1, stderr: "boom" } },
    });

    expect(code).toBe(1);
    expect(fake.files.has(MARKER)).toBe(false);
    expect(fake.files.has(PROGRESS)).toBe(false);
  });

  it("removes both files after a throw", async () => {
    const { code, fake } = await scan({
      programs: {
        [PYTHON]: () => {
          throw new Error("sensor blew up");
        },
      },
    });

    expect(code).toBe(2);
    expect(fake.files.has(MARKER)).toBe(false);
    expect(fake.files.has(PROGRESS)).toBe(false);
  });

  it("removes both files when stopEverything is called mid-scan", async () => {
    let held = false;
    let afterStop = true;
    const { fake } = await scan({
      programs: observing((files) => {
        held = files.has(MARKER) && files.has(PROGRESS);
        stopEverything();
        afterStop = files.has(MARKER) || files.has(PROGRESS);
      }),
    });

    expect(held).toBe(true);
    expect(afterStop).toBe(false);
    expect(fake.files.has(MARKER)).toBe(false);
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
    let captured = "";
    const programs = observing(() => {});
    const fake = fakeIo(options({ programs }));
    const io = {
      ...fake.io,
      remove: (path: string) => {
        if (path === PROGRESS) {
          captured = fake.files.get(PROGRESS) ?? "";
        }

        fake.io.remove(path);
      },
    };

    await run(["scan", ROOT, "--json"], io);

    expect(captured).toBe(fake.out());
    expect(captured).not.toBe("");

    const quiet = fakeIo(options({ programs }));
    let quietCaptured = "";

    await run(["scan", ROOT], {
      ...quiet.io,
      remove: (path: string) => {
        if (path === PROGRESS) {
          quietCaptured = quiet.files.get(PROGRESS) ?? "";
        }

        quiet.io.remove(path);
      },
    });

    expect(quietCaptured).toBe(captured);
  });

  it.each([
    ["app", "app"],
    ["cli", "cli"],
    ["other", "cli"],
    [undefined, "cli"],
  ])("records RECOGNIZER_STARTED_BY=%s as %s", async (value, expected) => {
    let during: ScanMarker | null = null;
    const env = value === undefined ? {} : { RECOGNIZER_STARTED_BY: value };

    await scan({
      env,
      programs: observing((files) => {
        during = parseMarker(files.get(MARKER) ?? "");
      }),
    });

    expect((during as unknown as ScanMarker).started_by).toBe(expected);
  });
});

describe("scan marker: examples", () => {
  it("holds the expected count of examples", () => {
    expect(readdirSync(join(EXAMPLES, "valid"))).toHaveLength(2);
    expect(readdirSync(join(EXAMPLES, "invalid"))).toHaveLength(6);
  });

  it.each(readdirSync(join(EXAMPLES, "valid")))("accepts %s", (file) => {
    const text = readFileSync(join(EXAMPLES, "valid", file), "utf8");
    const written = JSON.parse(text) as ScanMarker;

    expect(parseMarker(text)).toEqual(written);
  });

  it.each(readdirSync(join(EXAMPLES, "invalid")))("rejects %s", (file) => {
    expect(
      parseMarker(readFileSync(join(EXAMPLES, "invalid", file), "utf8")),
    ).toBeNull();
  });
});
