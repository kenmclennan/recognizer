import { Repository, type RunReport } from "@recognizer/core";
import type { ScanRunRecord } from "recognizer";
import { describe, expect, it, vi } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import type { ScanOrigin } from "../../src/footer-scan";
import type { MessageAction, MessageInput } from "../../src/message-tray";
import {
  createRescanner,
  type ProgressUpdate,
  type RescanPorts,
} from "../../src/rescanner";
import { fakeRunSnapshot } from "../../src/run-snapshot-fake";
import {
  type FakeSummary,
  fakeScan,
  NO_PLAN_DATA,
  planFromFacts,
  type ScanStep,
} from "../../src/scan-fake";
import { OPEN_RUN, type PlannedRun } from "../../src/scan-freshness";
import type { Loaded } from "../../src/scan-loading";
import { registeredWith } from "./look-support";

const ORIGIN: ScanOrigin = { branch: "main", commit: "a1b2c3d" };
const OK: Loaded = {
  modules: ["a.py"],
  scans: [],
  repository: Repository.empty,
  policy: null,
  baseline: null,
  notices: [],
  blocking: null,
  findings: [],
  sensors: [],
};

const SUITE_TICKS = {
  mut: { ticked: ["unit", "web"], known: ["unit", "web"] },
};

const record = (over: Partial<ScanRunRecord> = {}): ScanRunRecord => ({
  version: 5,
  suites: {},
  run_id: "run-1",
  pid: 4242,
  pgid: 4242,
  started_at: new Date(Date.now() + 60_000).toISOString(),
  started_by: "cli",
  repository: "/work/repo",
  sensors: ["alpha", "mut"],
  describe: true,
  phase: "running",
  ended_at: null,
  exit: null,
  gaps: [],
  failure: null,
  commit: null,
  ran: null,
  ...over,
});
type Report = RunReport | FakeSummary;
const started = (name: string): Report => ({
  kind: "plugin-started",
  name,
  progress: null,
});
const extract: Report = { kind: "extract-planned", languages: ["python"] };
const current: Report = { kind: "extract-current" };
const describing = (total: number): Report => ({
  kind: "plugin-started",
  name: "describe",
  progress: { done: 0, total, unit: "files" },
  phase: "describe",
});
const sensing = (_total: number): Report => ({
  kind: "structure",
  state: "done",
  files: 0,
});
const entry = (phase: string, name: string, reason?: string): Report => {
  if (phase === "describe") {
    return {
      kind: "plugin-item",
      name: "describe",
      item: name,
      ok: reason === undefined,
      reason: reason ?? "",
      phase: "describe",
    };
  }

  const where = phase === "extract" ? { phase: "extract" as const } : {};

  return reason === undefined
    ? { kind: "plugin-ended", name, state: "finished", ...where }
    : {
        kind: "plugin-ended",
        name,
        state: "failed",
        failure: { reason, diagnosis: null },
        ...where,
      };
};
const summary: Report = { kind: "summary", exit: 0, log: null };
const preflightOk: Report = { kind: "running" };
const LOG = "x-scan";
const ENDED_AT = "2026-11-10T09:00:05.000Z";
const summaryLogged = (exit: number): Report => ({
  kind: "summary",
  exit,
  log: LOG,
});
const exited = (exit: number): Report => ({
  kind: "summary",
  exit,
  log: null,
});

function harness(scan = fakeScan(), over: Partial<RescanPorts<string>> = {}) {
  const log: string[] = [];
  const updates: ProgressUpdate[] = [];
  const posted: MessageInput[] = [];
  const lifecycle: MessageInput[] = [];
  const attached: { id: number; extra: MessageAction }[] = [];
  const snapshot = fakeRunSnapshot(scan);
  const ports: RescanPorts<string> = {
    port: scan,
    snapshot,
    registered: async () =>
      registeredWith([
        { name: "alpha", display: "Alpha", runsTests: false },
        { name: "beta", display: "Beta", runsTests: false },
        { name: "mut", display: "Mutation", runsTests: true },
      ]),
    load: () => OK,
    sense: async (loaded) => {
      log.push("sense");

      return loaded;
    },
    resense: async () => {
      log.push("resense");

      return OK;
    },
    adopt: async () => {
      log.push("adopt");

      return ORIGIN;
    },
    carry: () => {
      log.push("carry");

      return "carried";
    },
    replace: (_loaded, carried) => log.push(`replace:${carried}`),
    update: () => false,
    adopted: (origin) => log.push(`adopted:${origin.commit}`),
    describedLine: () => log.push("described"),
    progress: (update) => {
      updates.push(update);
    },
    settled: () => log.push("settled"),
    attached: () => log.push("attached"),
    hasExplorer: () => false,
    blocked: (text) => log.push(`blocked:${text}`),
    post: (input) => {
      if (/^Scan (started|complete|failed|refused)/.test(input.text)) {
        lifecycle.push(input);

        return null;
      }

      posted.push(input);
      log.push(`post:${input.kind}:${input.text}`);

      return posted.length;
    },
    attach: (id, extra) => attached.push({ id, extra }),
    openLog: (path) => log.push(`openLog:${path}`),
    show: (target) => log.push(`show:${target.kind}`),
    ...over,
  };

  scan.plan = async (request) => {
    const registered = await ports.registered();

    return planFromFacts(request, {
      ...NO_PLAN_DATA,
      describerRegistered: registered.describerRegistered,
      sensors: registered.sensors.map((one) => ({ ...one, scoped: false })),
    });
  };

  if (over.now) {
    scan.now = over.now;
  }

  return {
    log,
    updates,
    posted,
    lifecycle,
    attached,
    scan,
    snapshot,
    rescanner: createRescanner(ports),
  };
}

const texts = (updates: ProgressUpdate[]) =>
  updates.map((update) => update.scanning);

describe("createRescanner", () => {
  it("builds the plan from the remembered ticks and remembers a repository's first ticks", async () => {
    const scan = fakeScan({ defaults: { describe: true, sensors: true } });
    const { rescanner } = harness(scan);

    await rescanner.run();

    expect(scan.ran).toEqual([
      {
        describe: true,
        analysis: true,
        describeAll: false,
        sense: ["alpha", "beta"],
        modules: null,
      },
    ]);
    expect(scan.written).toEqual([
      {
        describe: true,
        analysis: true,
        ticked: ["alpha", "beta"],
        onlyView: false,
        suites: {},
        folds: [],
      },
    ]);

    await rescanner.run();

    expect(scan.written).toHaveLength(1);
  });

  it("runs only the structure scan on open and leaves the remembered ticks alone", async () => {
    const scan = fakeScan({ defaults: { describe: true, sensors: true } });
    const { rescanner } = harness(scan);

    await rescanner.run();

    const written = [...scan.written];
    const before = rescanner.ticks();

    await rescanner.run(null, OPEN_RUN);

    expect(scan.ran[1]).toEqual({
      describe: false,
      analysis: true,
      describeAll: false,
      sense: [],
      modules: null,
    });
    expect(scan.written).toEqual(written);
    expect(rescanner.ticks()).toEqual(before);
    expect(before.describe).toBe(true);
  });

  it("renders the canvas when extraction settles, before describe and sense run", async () => {
    const scan = fakeScan({
      defaults: { describe: true, sensors: false },
      steps: [
        extract,
        entry("extract", "python"),
        describing(1),
        entry("describe", "a.py"),
        summary,
      ],
    });
    const { log, updates, rescanner } = harness(scan);

    scan.onStep = (index) => log.push(`step:${index}`);

    await rescanner.run();

    expect(log.indexOf("replace:carried")).toBeGreaterThan(
      log.indexOf("step:1"),
    );
    expect(log.indexOf("replace:carried")).toBeLessThan(log.indexOf("step:3"));
    expect(log).toContain("adopted:a1b2c3d");
    expect(log).toContain("described");
    expect(texts(updates)).toContain("Scanning\u2026");
    expect(texts(updates)).toContain("Describing\u2026 0 of 1 files");
    expect(updates.at(-1)?.scanning).toBeNull();
  });

  it("re-reads findings and updates the running state as each sensor reports", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [
        current,
        sensing(2),
        entry("sense", "alpha"),
        entry("sense", "beta", "boom"),
        summary,
      ],
    });
    const { log, rescanner } = harness(scan);
    const seen: string[][] = [];

    scan.onStep = (index) => {
      if (index === 1 || index === 2) {
        seen.push(rescanner.runState().running);
      }
    };

    await rescanner.run();

    expect(log.filter((entry) => entry === "resense")).toHaveLength(3);
    expect(seen).toEqual([["alpha", "beta"], ["beta"]]);
    expect(rescanner.runState().failures).toEqual({ beta: "boom" });
    expect(Object.keys(rescanner.runState().ranAt)).toEqual(["alpha", "beta"]);
    expect(rescanner.runState().running).toEqual([]);
  });

  it("shows only the started sensor as running, the rest waiting, and holds a failure until the sensor next finishes ok", async () => {
    const start = started;
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [
        current,
        sensing(2),
        start("alpha"),
        entry("sense", "alpha", "boom"),
        start("beta"),
        entry("sense", "beta"),
        summary,
      ],
    });
    const { rescanner } = harness(scan);
    const seen: (string | null)[] = [];

    scan.onStep = (index) => {
      if (index === 2 || index === 4) {
        seen.push(rescanner.runState().started);
      }
    };

    await rescanner.run();

    expect(seen).toEqual(["alpha", "beta"]);
    expect(rescanner.runState().failures).toEqual({ alpha: "boom" });
    expect(rescanner.runState().running).toEqual([]);
    expect(rescanner.runState().started).toBeNull();

    const again = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [current, sensing(1), entry("sense", "alpha"), summary],
    });
    const second = harness(again);

    await second.rescanner.run();

    expect(second.rescanner.runState().failures).toEqual({});
  });

  it("clears a sensor's diagnosis when a later run finishes it ok", async () => {
    const refused: Report = {
      kind: "plugin-ended",
      name: "alpha",
      state: "failed",
      failure: {
        reason: "refused",
        diagnosis: { code: "tool-missing", line: "cargo-llvm-cov is missing" },
      },
    };
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [current, sensing(1), started("alpha"), refused, summary],
    });
    const { rescanner } = harness(scan);

    await rescanner.run();

    expect(rescanner.runState().diagnoses).toEqual({
      alpha: { code: "tool-missing", line: "cargo-llvm-cov is missing" },
    });

    scan.steps = [
      current,
      sensing(1),
      started("alpha"),
      entry("sense", "alpha"),
      summary,
    ];

    await rescanner.run();

    expect(rescanner.runState().diagnoses).toEqual({});
    expect(rescanner.runState().failures).toEqual({});
  });

  it("posts exactly one tray message for a failed sensor entry, not one per refresh", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [
        current,
        sensing(2),
        entry("sense", "alpha", "boom"),
        entry("sense", "beta"),
        summary,
      ],
    });
    const { posted, rescanner } = harness(scan);

    await rescanner.run();
    await rescanner.refresh();

    expect(posted.filter((one) => one.kind === "error")).toHaveLength(1);
    expect(posted[0]?.text).toBe("alpha failed: boom");
  });

  it("posts no error message for a sensor entry that ended because the user pressed Stop", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [
        current,
        sensing(1),
        { kind: "plugin-ended", name: "mutation", state: "stopped" },
        summary,
      ],
    });
    const { posted, rescanner } = harness(scan);

    await rescanner.run();

    expect(posted.filter((one) => one.kind === "error")).toEqual([]);
  });

  it("runs Descriptions as running while the describe phase is open and waiting before it", async () => {
    const scan = fakeScan({
      defaults: { describe: true, sensors: true },
      steps: [
        current,
        describing(1),
        entry("describe", "a.py"),
        sensing(1),
        entry("sense", "alpha"),
        summary,
      ],
    });
    const { rescanner } = harness(scan);
    const seen: { running: string[]; started: string | null }[] = [];

    scan.onStep = (index) => {
      const { running, started } = rescanner.runState();

      if (index <= 3) {
        seen.push({ running, started });
      }
    };

    await rescanner.run();

    expect(seen[0]).toEqual({
      running: ["describe", "alpha", "beta"],
      started: null,
    });
    expect(seen[1]?.started).toBe("describe");
    expect(seen[3]?.running).not.toContain("describe");
    expect(seen[3]?.started).toBe("alpha");
  });

  it("attaches Open log to a failed describe message once the run ends with a log", async () => {
    const scan = fakeScan({
      defaults: { describe: true, sensors: false },
      steps: [
        current,
        describing(1),
        entry("describe", "a.py", "no"),
        summaryLogged(1),
      ],
      result: { status: "finished", exitCode: 1 },
    });
    const { log, posted, attached, updates, rescanner } = harness(scan);

    await rescanner.run();

    expect(posted.map((one) => one.text)).toEqual([
      "Describe wrote 0 lines, 1 files failed.",
    ]);
    expect(posted[0]?.action?.label).toBe("Show");
    expect(attached.map((one) => one.id)).toEqual([1]);
    expect(attached[0]?.extra.label).toBe("Open log");

    attached[0]?.extra.run();

    expect(log).toContain("openLog:.recognizer/cache/log/x-scan.json");
    expect(updates.at(-1)?.scanning).toBeNull();
  });

  it("attaches Open log once to a mixed run's only failure, and posts an extract failure", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [
        extract,
        entry("extract", "python", "boom"),
        sensing(2),
        entry("sense", "alpha"),
        entry("sense", "beta", "slow"),
        summaryLogged(0),
      ],
      result: { status: "finished", exitCode: 0 },
    });
    const { posted, attached, rescanner } = harness(scan);

    await rescanner.run();

    expect(posted.map((one) => one.text)).toEqual([
      "python failed: boom",
      "beta failed: slow",
    ]);
    expect(posted[0]?.action).toBeUndefined();
    expect(posted[1]?.action?.label).toBe("Show");
    expect(attached.map((one) => one.id)).toEqual([1, 2]);
  });

  it("opens the explorer from the cache when the service's outcome arrives before any run record", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [],
      records: false,
      result: { status: "finished", exitCode: 0 },
    });
    const { log, rescanner } = harness(scan);

    await rescanner.run();

    const opened = log.indexOf("replace:carried");

    expect(opened).toBeGreaterThan(-1);
    expect(log.indexOf("settled")).toBeGreaterThan(opened);
  });

  it("attaches nothing when the run has no log or was stopped", async () => {
    const noLog = harness(
      fakeScan({
        defaults: { describe: false, sensors: true },
        steps: [current, sensing(1), entry("sense", "alpha", "bad"), summary],
        result: { status: "finished", exitCode: 0 },
      }),
    );

    await noLog.rescanner.run();

    expect(noLog.posted).toHaveLength(1);
    expect(noLog.attached).toEqual([]);

    const gate = new Promise<void>(() => {});
    const stopped = harness(
      fakeScan({
        defaults: { describe: false, sensors: true },
        steps: [current, sensing(1), entry("sense", "alpha", "bad"), gate],
      }),
    );
    const running = stopped.rescanner.run();

    await vi.waitFor(() => expect(stopped.posted).toHaveLength(1), {
      timeout: scaledTimeout(4000),
    });
    await stopped.rescanner.stop();
    await running;

    expect(stopped.posted).toHaveLength(1);
    expect(stopped.attached).toEqual([]);
  });

  it("says Stopped, keeps what was written and settles after a stop", async () => {
    const gate = new Promise<void>(() => {});
    const scan = fakeScan({ steps: [current, describing(2), gate] });
    const { log, updates, rescanner } = harness(scan);
    const running = rescanner.run();

    await new Promise((resolve) => setTimeout(resolve, 10));
    await rescanner.stop();
    await running;

    expect(updates.at(-1)?.scanning).toBeNull();
    expect(log).toContain("settled");
    expect(rescanner.running()).toBe(false);
  });

  it("reports a command that is missing or failed as blocked and clears the footer", async () => {
    const missing = harness(
      fakeScan({ result: { status: "command-missing", hint: "install it" } }),
    );

    await missing.rescanner.run();

    expect(missing.log).toContain("blocked:install it");
    expect(missing.updates.at(-1)?.scanning).toBeNull();

    const failed = harness(
      fakeScan({
        records: false,
        result: { status: "failed", exitCode: 2, stderr: "bad flag\n" },
      }),
    );

    await failed.rescanner.run();

    expect(failed.log).toContain("blocked:bad flag");
  });

  it("shows the detail of a scan that ran nothing it was asked to run", async () => {
    const { log, updates, rescanner } = harness(
      fakeScan({
        defaults: { describe: false, sensors: true },
        steps: [current, preflightOk, summary],
        record: { commit: null, ran: ["extract"] },
        result: { status: "finished", exitCode: 0 },
      }),
    );

    await rescanner.run();

    expect(log).toContain(
      "blocked:sense did not run: the folder has no commit",
    );
    expect(updates.at(-1)?.scanning).toBeNull();
  });

  describe("opening from the cache when the scan fails", () => {
    const failing = () =>
      fakeScan({
        records: false,
        result: { status: "failed", exitCode: 2, stderr: "bad flag\n" },
      });
    const cached: Loaded = {
      ...OK,
      scans: [{ file: "scan.python.json" } as never],
    };

    it("builds the explorer from the cache before reporting the failure", async () => {
      let built = false;
      const { log, rescanner } = harness(failing(), {
        load: () => cached,
        hasExplorer: () => built,
        replace: () => {
          built = true;
          log.push("replace:");
        },
      });

      await rescanner.run(null, OPEN_RUN);

      expect(log.length).toBeGreaterThan(0);

      const order = [
        "sense",
        "adopt",
        "replace:",
        "blocked:bad flag",
        "settled",
      ];
      const at = order.map((name) => log.indexOf(name));

      expect(at.every((index) => index >= 0)).toBe(true);
      expect(at).toEqual([...at].sort((a, b) => a - b));
    });

    it("blocks with no explorer when nothing is cached", async () => {
      const { log, rescanner } = harness(failing());

      await rescanner.run(null, OPEN_RUN);

      expect(log).toContain("blocked:bad flag");
      expect(log.some((entry) => /^(replace|sense|adopt)/.test(entry))).toBe(
        false,
      );
    });

    it("blocks when the viewer refuses the cache", async () => {
      const { log, rescanner } = harness(failing(), {
        load: () => ({ ...cached, blocking: "schema_version 9" }),
      });

      await rescanner.run(null, OPEN_RUN);

      expect(log).toContain("blocked:bad flag");
      expect(log.some((entry) => entry.startsWith("replace"))).toBe(false);
    });

    it("leaves an open explorer alone", async () => {
      const { log, rescanner } = harness(failing(), {
        load: () => cached,
        hasExplorer: () => true,
      });

      await rescanner.run(null, OPEN_RUN);

      expect(log).toContain("blocked:bad flag");
      expect(log.some((entry) => /^(replace|sense|adopt)/.test(entry))).toBe(
        false,
      );
    });

    it("opens from the cache when a scan ran nothing it was asked to run", async () => {
      let built = false;
      const { log, rescanner } = harness(
        fakeScan({
          defaults: { describe: false, sensors: true },
          steps: [current, preflightOk, summary],
          record: { commit: null, ran: ["extract"] },
          result: { status: "finished", exitCode: 0 },
        }),
        {
          load: () => cached,
          hasExplorer: () => built,
          replace: () => {
            built = true;
            log.push("replace:");
          },
        },
      );

      await rescanner.run();

      const blocked = log.indexOf(
        "blocked:sense did not run: the folder has no commit",
      );

      expect(log.indexOf("replace:")).toBeGreaterThanOrEqual(0);
      expect(log.indexOf("replace:")).toBeLessThan(blocked);
    });
  });

  it("keeps the old explorer when the viewer refuses the scan", async () => {
    const { log, rescanner } = harness(
      fakeScan({ steps: [extract, summary] }),
      {
        load: () => ({ ...OK, blocking: "schema_version 9" }),
      },
    );

    await rescanner.run();

    expect(log).toContain("blocked:schema_version 9");
    expect(log).not.toContain("adopt");
    expect(log.some((entry) => entry.startsWith("replace"))).toBe(false);
  });

  it("keeps the old explorer when adopting fails", async () => {
    const { log, rescanner } = harness(
      fakeScan({ steps: [extract, summary] }),
      {
        adopt: async () => {
          throw new Error("no baseline");
        },
      },
    );

    await rescanner.run();

    expect(log.some((entry) => entry.startsWith("replace"))).toBe(false);
    expect(log).toContain("blocked:Error: no baseline");
  });

  it("settles once extraction has run even when no later phase line arrives", async () => {
    const { log, rescanner } = harness(fakeScan({ steps: [] }));

    await rescanner.run();

    expect(log).toContain("replace:carried");
  });

  it("joins the run this window has in flight instead of starting a second", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scan = fakeScan({ steps: [gate] });
    const { rescanner } = harness(scan);

    const first = rescanner.run();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = rescanner.run();

    release();
    await Promise.all([first, second]);

    expect(scan.ran).toHaveLength(1);
  });

  it("refreshes the sensors without scanning, carrying the state", async () => {
    const { log, rescanner } = harness();

    await rescanner.refresh();

    expect(log).toEqual(["resense", "carry", "replace:carried"]);
  });

  it("replaces once and skips a refresh whose sensed data equals the last replaced", async () => {
    const { log, rescanner } = harness();

    for (let turn = 0; turn < 5; turn++) {
      await rescanner.refresh();
    }

    expect(log.filter((entry) => entry.startsWith("replace"))).toHaveLength(1);
    expect(log.filter((entry) => entry === "carry")).toHaveLength(1);
  });

  it("replaces again when a refresh senses changed data", async () => {
    let turn = 0;
    const { log, rescanner } = harness(fakeScan(), {
      resense: async () => ({ ...OK, baseline: [`p${turn++}`] }),
    });

    await rescanner.refresh();
    await rescanner.refresh();

    expect(log.filter((entry) => entry.startsWith("replace"))).toHaveLength(2);
  });

  it("compares a refresh with the data a scan run replaced", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: false },
      steps: [current, summary],
    });
    const { log, rescanner } = harness(scan);

    await rescanner.run();

    const before = log.filter((entry) => entry.startsWith("replace")).length;

    await rescanner.refresh();

    expect(log.filter((entry) => entry.startsWith("replace"))).toHaveLength(
      before,
    );
  });

  it("updates in place when only sensor results change, never replacing after the first scan", async () => {
    let turn = 0;
    const updated: Loaded[] = [];
    const { log, rescanner } = harness(fakeScan(), {
      resense: async () => ({ ...OK, baseline: [`p${turn++}`] }),
      update: (loaded) => {
        updated.push(loaded);

        return true;
      },
    });

    await rescanner.refresh();
    await rescanner.refresh();
    await rescanner.refresh();

    expect(log.filter((entry) => entry.startsWith("replace"))).toHaveLength(1);
    expect(log.filter((entry) => entry === "carry")).toHaveLength(1);
    expect(updated.map((loaded) => loaded.baseline)).toEqual([["p1"], ["p2"]]);
  });

  it("updates in place from a sensor-only scan run after the first scan", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: false },
      steps: [current, summary],
    });
    let updates = 0;
    const { log, rescanner } = harness(scan, {
      update: () => {
        updates++;

        return true;
      },
    });

    await rescanner.refresh();
    await rescanner.run();

    expect(log.filter((entry) => entry.startsWith("replace"))).toHaveLength(1);
    expect(log.filter((entry) => entry === "carry")).toHaveLength(1);
    expect(updates).toBe(1);
  });

  it("replaces with the carried value when the loaded structure changes", async () => {
    let turn = 0;
    const { log, rescanner } = harness(fakeScan(), {
      resense: async () => {
        const next = turn++;

        return { ...OK, baseline: [`p${next}`], modules: [`m${next}.py`] };
      },
      update: () => true,
    });

    await rescanner.refresh();
    await rescanner.refresh();

    expect(log.filter((entry) => entry === "replace:carried")).toHaveLength(2);
  });

  it("falls back to replace when update returns false", async () => {
    let turn = 0;
    const { log, rescanner } = harness(fakeScan(), {
      resense: async () => ({ ...OK, baseline: [`p${turn++}`] }),
      update: () => false,
    });

    await rescanner.refresh();
    await rescanner.refresh();

    expect(log.filter((entry) => entry === "replace:carried")).toHaveLength(2);
  });

  it("replaces on the first run, with nothing applied yet", async () => {
    const { log, rescanner } = harness(fakeScan(), { update: () => true });

    await rescanner.refresh();

    expect(log).toEqual(["resense", "carry", "replace:carried"]);
  });

  it("refreshes nothing when there is nothing loaded", async () => {
    const { log, rescanner } = harness(fakeScan(), {
      resense: async () => null,
    });

    await rescanner.refresh();

    expect(log).toEqual([]);
  });

  it("does not present a refresh as running and starts no scan or sensor run", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scan = fakeScan();
    const { log, rescanner } = harness(scan, {
      resense: async () => {
        log.push("resense");
        await gate;

        return OK;
      },
    });

    const pending = rescanner.refresh();

    expect(rescanner.running()).toBe(false);
    expect(rescanner.external()).toBe(false);
    release();
    await pending;

    expect(rescanner.running()).toBe(false);
    expect(scan.ran).toHaveLength(0);
  });

  it("a_refresh_is_a_render_of_the_newest_revision", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const rendered: (string[] | null)[] = [];
    const { rescanner } = harness(fakeScan(), {
      resense: async () => {
        reads += 1;

        if (reads === 1) {
          await gate;
        }

        return { ...OK, baseline: [`revision-${reads}`] };
      },
      replace: (loaded) => {
        rendered.push(loaded.baseline);
      },
      update: () => false,
    });

    const first = rescanner.refresh();
    const second = rescanner.refresh();

    release();
    await Promise.all([first, second]);

    expect(reads).toBe(2);
    expect(rendered.at(-1)).toEqual(["revision-2"]);
  });

  it("renders a refresh during a run from the newest revision, deferring nothing", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { log, rescanner } = harness(fakeScan({ steps: [gate] }));

    const first = rescanner.run();

    await new Promise((resolve) => setTimeout(resolve, 10));
    await rescanner.refresh();

    expect(log).toContain("resense");

    release();
    await first;
  });

  it("does not read again after a scan when no input changed while it ran", async () => {
    const scan = fakeScan();
    const { log, rescanner } = harness(scan);

    await rescanner.run();

    const after = log.filter((line) => line === "resense").length;

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(log.filter((line) => line === "resense").length).toBe(after);
  });

  it("writes a test-running sensor's tick with the others and keeps it after every Scan however it ends", async () => {
    for (const steps of [
      [current, summary],
      [current, { kind: "unreadable" } as Report],
    ]) {
      const scan = fakeScan({ steps });
      const { rescanner } = harness(scan);

      await rescanner.loadTicks();
      rescanner.setTicks({
        ...rescanner.ticks(),
        armed: ["mut"],
        onlyView: false,
        suites: SUITE_TICKS,
        folds: ["mut"],
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(Object.keys(rescanner.ticks().suites)).not.toEqual([]);
      expect(rescanner.ticks().folds).not.toEqual([]);

      await rescanner.run();

      expect(scan.ran[0].sense).toContain("mut");
      expect(scan.written.at(-1)?.ticked).toContain("mut");
      expect(rescanner.ticks().armed).toEqual(["mut"]);
      expect(rescanner.ticks().suites).toEqual(SUITE_TICKS);
      expect(rescanner.ticks().folds).toEqual(["mut"]);
      expect(scan.written.at(-1)?.suites).toEqual(SUITE_TICKS);
      expect(scan.written.at(-1)?.folds).toEqual(["mut"]);
    }
  });

  it("does not hand the port a stale plan's test-running sensor that is not armed", async () => {
    const scan = fakeScan();
    const { rescanner } = harness(scan);

    await rescanner.loadTicks();
    rescanner.setTicks({
      ...rescanner.ticks(),
      armed: [],
      suites: SUITE_TICKS,
    });

    const stale = {
      describe: false,
      describeAll: false,
      analysis: true,
      sense: ["mut", "alpha"],
      modules: null,
      suites: { mut: ["unit", "web"] },
    };
    const planned = {
      plan: stale,
      label: "Run",
      progress: "Running",
      modules: 0,
      idle: false,
    } as unknown as PlannedRun;

    expect(stale.sense).toContain("mut");

    await rescanner.run(null, planned);

    expect(scan.ran[0].sense).toEqual(["alpha"]);
    expect(scan.ran[0].suites).toEqual({});
  });

  it("hands the port a stale plan's test-running sensor that is armed", async () => {
    const scan = fakeScan();
    const { rescanner } = harness(scan);

    await rescanner.loadTicks();
    rescanner.setTicks({
      ...rescanner.ticks(),
      armed: ["mut"],
      suites: SUITE_TICKS,
    });

    const planned = {
      plan: {
        describe: false,
        describeAll: false,
        analysis: true,
        sense: ["mut"],
        modules: null,
        suites: { mut: ["unit"] },
      },
      label: "Run",
      progress: "Running",
      modules: 0,
      idle: false,
    } as unknown as PlannedRun;

    await rescanner.run(null, planned);

    expect(scan.ran[0].sense).toEqual(["mut"]);
  });

  it("re-reads the sensor findings after a stopped Scan", async () => {
    const scan = fakeScan({ result: { status: "stopped" } });
    const { log, rescanner } = harness(scan);

    await rescanner.loadTicks();
    await rescanner.run();

    expect(log).toContain("resense");
  });

  it("keeps the ticks as set when the Scan fails or is stopped", async () => {
    for (const result of [
      { status: "failed" as const, exitCode: 1, stderr: "boom" },
      { status: "stopped" as const },
    ]) {
      const scan = fakeScan({ result });
      const { rescanner } = harness(scan);

      await rescanner.loadTicks();
      rescanner.setTicks({
        ...rescanner.ticks(),
        armed: ["mut"],
        onlyView: false,
        suites: SUITE_TICKS,
        folds: ["mut"],
      });

      expect(Object.keys(rescanner.ticks().suites)).not.toEqual([]);

      await rescanner.run();

      expect(rescanner.ticks().armed).toEqual(["mut"]);
      expect(rescanner.ticks().suites).toEqual(SUITE_TICKS);
      expect(rescanner.ticks().folds).toEqual(["mut"]);
    }
  });

  it("keeps both sensors' armed entries and suite ticks after a Scan", async () => {
    const scan = fakeScan({ steps: [current, summary] });
    const { rescanner } = harness(scan, {
      registered: async () =>
        registeredWith([
          {
            name: "crap",
            display: "C.R.A.P.",
            runsTests: true,
            suites: [
              { name: "unit", language: "python" },
              { name: "web", language: "typescript" },
            ],
          },
          {
            name: "mut",
            display: "Mutation",
            runsTests: true,
            suites: [{ name: "unit", language: "python" }],
          },
        ]),
    });
    const suites = {
      crap: { ticked: ["unit", "web"], known: ["unit", "web"] },
      mut: { ticked: ["unit"], known: ["unit"] },
    };

    await rescanner.loadTicks();
    rescanner.setTicks({
      ...rescanner.ticks(),
      armed: ["crap"],
      suites,
      folds: ["crap", "mut"],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(Object.keys(rescanner.ticks().suites)).toEqual(["crap", "mut"]);

    await rescanner.run();

    expect(scan.ran[0]?.sense).toEqual(["crap"]);
    expect(scan.ran[0]?.suites).toEqual({ crap: ["unit", "web"] });
    expect(rescanner.ticks().armed).toEqual(["crap"]);
    expect(rescanner.ticks().suites).toEqual(suites);
    expect(rescanner.ticks().folds).toEqual(["crap", "mut"]);
  });

  describe("unregistered plugins", () => {
    it("keeps a remembered tick for an unregistered sensor and describe out of the plan", async () => {
      const scan = fakeScan({ defaults: { describe: true, sensors: true } });
      const { rescanner } = harness(scan, {
        registered: async () =>
          registeredWith(
            [
              { name: "alpha", display: "Alpha", runsTests: false },
              {
                name: "beta",
                display: "Beta",
                runsTests: false,
                registered: false,
              },
            ],
            false,
          ),
      });

      await rescanner.loadTicks();

      expect(rescanner.ticks().describe).toBe(true);
      expect(rescanner.ticks().ticked).toBeNull();

      rescanner.setTicks({
        ...rescanner.ticks(),
        ticked: ["alpha", "beta"],
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await rescanner.run();

      expect(rescanner.ticks().ticked).toEqual(["alpha", "beta"]);
      expect(scan.ran[0]?.sense).toEqual(["alpha"]);
      expect(scan.ran[0]?.describe).toBe(false);
    });
  });

  it("sends the file scope in the plan and remembers the switch", async () => {
    const scan = fakeScan({
      defaults: { describe: true, sensors: true },
    });
    const { rescanner } = harness(scan);

    await rescanner.loadTicks();
    rescanner.setTicks({ ...rescanner.ticks(), onlyView: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await rescanner.run(["a.py", "b.py"]);

    expect(scan.written.at(-1)?.onlyView).toBe(true);
    expect(scan.ran[0]?.modules).toEqual(["a.py", "b.py"]);
  });

  it("sends no scope when none is given or nothing but extraction would run", async () => {
    const scan = fakeScan();
    const { rescanner } = harness(scan);

    await rescanner.loadTicks();
    await rescanner.run();
    await rescanner.run(["a.py"]);

    expect(scan.ran.map((plan) => plan.modules)).toEqual([null, null]);
  });

  it("reads the remembered switch back from the port", async () => {
    const scan = fakeScan();
    const { rescanner } = harness(scan);

    await rescanner.loadTicks();
    rescanner.setTicks({ ...rescanner.ticks(), onlyView: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const again = harness(scan).rescanner;

    await again.loadTicks();

    expect(again.ticks().onlyView).toBe(true);
  });

  it("writes the ticks through the port when they change", async () => {
    const scan = fakeScan();
    const { rescanner } = harness(scan);

    await rescanner.loadTicks();
    rescanner.setTicks({
      describe: true,
      analysis: true,
      ticked: null,
      armed: [],
      onlyView: false,
      suites: {},
      folds: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(scan.written).toEqual([
      {
        describe: true,
        analysis: true,
        ticked: ["alpha", "beta"],
        onlyView: false,
        suites: {},
        folds: [],
      },
    ]);
    expect(rescanner.ticks()).toEqual({
      describe: true,
      analysis: true,
      ticked: null,
      armed: [],
      onlyView: false,
      suites: {},
      folds: [],
    });
  });

  it("posts a failed sensor as an error whose Show reaches the sensor row", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [current, sensing(1), entry("sense", "alpha", "boom"), summary],
    });
    const { log, posted, rescanner } = harness(scan);

    await rescanner.run();

    const failure = posted.find((input) => input.text.startsWith("alpha"));

    expect(failure).toMatchObject({
      kind: "error",
      text: "alpha failed: boom",
    });
    expect(failure?.key).toBeUndefined();
    expect(failure?.action?.label).toBe("Show");

    failure?.action?.run();

    expect(log).toContain("show:sensor");
  });

  it("posts the describe result as info with no action when nothing failed", async () => {
    const scan = fakeScan({
      defaults: { describe: true, sensors: false },
      steps: [
        current,
        describing(2),
        entry("describe", "a.py"),
        entry("describe", "b.py"),
        summary,
      ],
    });
    const { posted, rescanner } = harness(scan);

    await rescanner.run();

    expect(posted.at(-1)).toEqual({
      kind: "info",
      text: "Describe wrote 2 lines, 0 files failed.",
    });
  });

  it("posts the describe result with Show on the first failed file", async () => {
    const scan = fakeScan({
      defaults: { describe: true, sensors: false },
      steps: [
        current,
        describing(4),
        entry("describe", "a.py"),
        entry("describe", "b.py", "x"),
        entry("describe", "c.py", "y"),
        entry("describe", "d.py", "z"),
        summary,
      ],
    });
    const { log, posted, rescanner } = harness(scan);

    await rescanner.run();

    const result = posted.find((input) => input.text.startsWith("Describe"));

    expect(result?.text).toBe("Describe wrote 1 lines, 3 files failed.");
    expect(result?.action?.label).toBe("Show");

    result?.action?.run();

    expect(log).toContain("show:module");
  });

  it("posts nothing about describe when no describe phase ran", async () => {
    const { posted, rescanner } = harness(
      fakeScan({ steps: [current, summary] }),
    );

    await rescanner.run();

    expect(posted.some((input) => input.text.startsWith("Describe"))).toBe(
      false,
    );
  });

  it("hands the port the planned run and prefixes its progress line with the mode", async () => {
    const start = started;
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [
        current,
        sensing(1),
        start("alpha"),
        entry("sense", "alpha"),
        summary,
      ],
    });
    const { rescanner, updates } = harness(scan);
    const planned = {
      plan: {
        describe: false,
        analysis: true,
        describeAll: true,
        sense: ["alpha"],
        modules: ["a.py"],
        suites: {},
      },
      dropped: [],
      modules: 1,
      idle: false,
      label: "Rescan 1 file",
      progress: "Rescanning 1 file\u2026",
      work: {},
    };

    await rescanner.run(planned.plan.modules, planned);

    expect(scan.ran).toEqual([planned.plan]);

    const shown = texts(updates).filter((text) => text !== null);

    expect(shown.length).toBeGreaterThan(0);
    expect(
      shown.every((text) => text?.startsWith("Rescanning 1 file\u2026 ")),
    ).toBe(true);
  });

  describe("the describe confirmation", () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    const ask: Report = {
      kind: "confirmation-asked",
      ask: { modules: 3, model: "sonnet", inputTokens: 12000, costUsd: 9.5 },
    };

    async function waiting(over: Parameters<typeof fakeScan>[0] = {}) {
      const gate = new Promise<void>(() => {});
      const scan = fakeScan({
        defaults: { describe: true, sensors: false },
        steps: [current, ask, gate],
        ...over,
      });
      const made = harness(scan);
      const running = made.rescanner.run();

      await vi.waitFor(
        () => expect(made.rescanner.progress().describeAsk).not.toBeNull(),
        { timeout: scaledTimeout(4000) },
      );

      return { ...made, running };
    }

    const answered = (describe: boolean): Report => ({
      kind: "confirmation-answered",
      describe,
    });

    it("opens the ask from the record's confirm line and answers describe through the port once", async () => {
      const { rescanner, scan, updates } = await waiting();

      expect(texts(updates).at(-1)).toContain("Waiting for your answer");

      await rescanner.answerDescribe(true);

      expect(scan.answers).toEqual([true]);
      expect(rescanner.progress().describeAsk).not.toBeNull();

      scan.emitReport(answered(true));
      await flush();
      await rescanner.answerDescribe(true);

      expect(scan.answers).toEqual([true]);
      expect(rescanner.progress().describeAsk).toBeNull();
      expect(rescanner.progress().describeSkipped).toBe(false);

      await rescanner.stop();
    });

    it("marks the describe phase skipped when the answered line says skip", async () => {
      const { rescanner, scan } = await waiting();

      await rescanner.answerDescribe(false);
      scan.emitReport(answered(false));
      await flush();

      expect(scan.answers).toEqual([false]);
      expect(rescanner.progress().describeAsk).toBeNull();
      expect(rescanner.progress().describeSkipped).toBe(true);

      await rescanner.stop();
    });

    it("answers a scan the command line started through the same port call", async () => {
      const made = harness();

      made.scan.emitRun({ kind: "run", run: record() });
      made.scan.emitReport(ask);
      await flush();

      expect(made.rescanner.progress().describeAsk).not.toBeNull();

      await made.rescanner.answerDescribe(true);
      made.scan.emitReport(answered(true));
      await flush();

      expect(made.scan.answers).toEqual([true]);
      expect(made.rescanner.progress().describeAsk).toBeNull();
    });

    it("posts an error when the port refuses the answer", async () => {
      const { rescanner, scan, posted } = await waiting();

      scan.answerDescribe = async () => {
        throw new Error("no scan is waiting for an answer");
      };
      await rescanner.answerDescribe(true);

      expect(posted.at(-1)).toMatchObject({
        kind: "error",
        text: "Error: no scan is waiting for an answer",
      });

      await rescanner.stop();
    });

    it("clears the ask when the scan is stopped while it is open", async () => {
      const { rescanner, running } = await waiting();

      await rescanner.stop();
      await running;

      expect(rescanner.progress().describeAsk).toBeNull();
    });
  });

  describe("a scan another process started", () => {
    const cli = record();
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    async function observed() {
      const made = harness();

      made.scan.emitRun({ kind: "run", run: cli });
      made.scan.emitReport(describing(0));
      made.scan.emitReport(started("alpha"));
      await flush();

      return made;
    }

    it("shows the scan's rows and progress under the command-line heading", async () => {
      const { rescanner } = await observed();

      expect(rescanner.running()).toBe(true);
      expect(rescanner.external()).toBe(true);
      expect(rescanner.runState().running).toEqual(["alpha", "mut"]);
      expect(rescanner.runView().run?.id).toBe(cli.run_id);
    });

    it("clears the running line and the running state when the snapshot reports the run stopped", async () => {
      const { rescanner, snapshot, updates } = await observed();
      const held = snapshot.latest();

      if (held === null) {
        throw new Error("the snapshot holds no run");
      }

      snapshot.publish({ ...held, state: "running" });
      await flush();

      expect(rescanner.running()).toBe(true);
      expect(updates.at(-1)?.scanning).not.toBeNull();

      snapshot.publish({ ...held, state: "stopped" });
      await flush();

      expect(updates.at(-1)?.scanning).toBeNull();
      expect(rescanner.running()).toBe(false);
    });

    it("takes no side-effecting branch for its lines", async () => {
      const { scan, posted, log, rescanner } = await observed();

      scan.emitReport(entry("sense", "alpha", "boom"));
      await flush();

      expect(scan.ran).toEqual([]);
      expect(posted.map((one) => one.text)).toEqual(["alpha failed: boom"]);
      expect(log).not.toContain("described");
      expect(rescanner.runState().failures).toEqual({ alpha: "boom" });
    });

    it("reads_no_scan_stream_line_for_a_sensor", async () => {
      const made = harness();
      const { scan, snapshot, rescanner, posted } = made;
      const diagnosis = { code: "no-coverage", line: "no report" };

      scan.emitRun({ kind: "run", run: cli });
      scan.emitReport(started("alpha"));
      await flush();

      const held = snapshot.latest();

      if (held === null) {
        throw new Error("the snapshot holds no run");
      }

      snapshot.publish({
        ...held,
        plugins: held.plugins.map((plugin) =>
          plugin.name === "alpha"
            ? {
                ...plugin,
                state: "failed",
                failure: { reason: "from the snapshot", diagnosis },
              }
            : plugin,
        ),
      });
      await flush();

      expect(posted.map((one) => one.text)).toEqual([
        "alpha failed: from the snapshot",
      ]);
      expect(rescanner.runState().failures).toEqual({
        alpha: "from the snapshot",
      });
      expect(rescanner.runState().diagnoses).toMatchObject({
        alpha: diagnosis,
      });
    });

    it("starting_a_run_goes_through_core_and_trusts_the_lock_for_a_refusal", async () => {
      const { rescanner, scan, lifecycle } = await observed();

      scan.result = { status: "refused", reason: "a scan is already running" };

      await rescanner.run();

      expect(scan.ran).toHaveLength(1);
      expect(lifecycle.map((one) => one.text)).toContain(
        "Scan refused - a scan is already running",
      );
      expect(rescanner.external()).toBe(true);
    });

    it("leaves Running and reloads the results once when the marker goes", async () => {
      const { rescanner, scan, log, updates } = await observed();

      scan.emitRun({
        kind: "run",
        run: record({
          phase: "finished",
          ended_at: "2026-11-10T09:01:00.000Z",
          exit: 0,
        }),
      });
      await flush();

      expect(rescanner.running()).toBe(false);
      expect(rescanner.runState().running).toEqual([]);
      expect(log.filter((one) => one === "sense")).toHaveLength(1);
      expect(log).toContain(`adopted:${ORIGIN.commit}`);
      expect(texts(updates).at(-1)).toBeNull();
    });

    it("ignores a repeated announcement of the same scan", async () => {
      const { scan, rescanner } = await observed();
      const before = rescanner.progress();

      scan.emitRun({ kind: "run", run: cli });
      await flush();

      expect(rescanner.progress()).toEqual(before);
    });

    it("gives a pre-phase failure none of an earlier run's progress", async () => {
      const earlier = fakeScan({
        defaults: { describe: false, sensors: true },
        steps: [extract, current, preflightOk, sensing(1), summary],
      });
      const made = harness(earlier);

      await made.rescanner.run();
      await flush();

      expect(made.rescanner.runView().progress.extract).not.toBe("pending");

      made.scan.emitRun({
        kind: "run",
        run: record({
          run_id: "refused-before-phase",
          phase: "failed",
          ended_at: "2026-11-10T09:02:00.000Z",
          exit: 1,
          failure: {
            sensor: "scan",
            suite: null,
            code: null,
            reason: "claude is not registered in .recognizer/config.yaml",
          },
        }),
      });
      await flush();

      const view = made.rescanner.runView();

      expect(view.run?.id).toBe("refused-before-phase");
      expect(view.progress.extract).toBe("pending");
    });

    it("stops through the port once for a command-line run", async () => {
      const { scan, rescanner } = await observed();

      await rescanner.stop();

      expect(scan.stopped).toBe(1);
    });
  });
});

const GAP = {
  id: "crap:python:sensors:environment",
  line: "coverage and pytest are not installed",
  needs: ["mut"],
};

const OUTSIDE = {
  ...GAP,
  id: "mutation:rust:root:cargo",
  line: "cargo-llvm-cov is not installed",
};

describe("scan notifications", () => {
  function timed(
    scan = fakeScan({ defaults: { describe: true, sensors: true } }),
  ) {
    let clock = 1_000_000;

    return {
      clock: (ms: number) => {
        clock += ms;
      },
      made: harness(scan, { now: () => clock }),
    };
  }

  it("posts Scan started naming the sensors, and Scan complete with its duration from the record", async () => {
    const scan = fakeScan({
      defaults: { describe: true, sensors: true },
      steps: [extract, entry("extract", "python"), summary],
      record: {
        started_at: "2026-11-10T09:00:00.000Z",
        ended_at: "2026-11-10T09:03:12.000Z",
      },
    });
    const { made } = timed(scan);

    await made.rescanner.run();

    expect(made.lifecycle).toEqual([
      { kind: "info", text: "Scan started - Alpha, Beta, describe" },
      { kind: "done", text: "Scan complete - 3m 12s" },
    ]);
  });

  it("reads seconds alone under a minute", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [extract, summary],
      record: {
        started_at: "2026-11-10T09:00:00.000Z",
        ended_at: "2026-11-10T09:00:45.000Z",
      },
    });
    const { made } = timed(scan);

    await made.rescanner.run();

    expect(made.lifecycle.at(-1)).toEqual({
      kind: "done",
      text: "Scan complete - 45s",
    });
  });

  it("posts the failure with its reason and no Scan complete", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      records: false,
      result: {
        status: "failed",
        exitCode: 2,
        stderr: "boom",
      },
    });
    const { made } = timed(scan);

    await made.rescanner.run();

    expect(made.lifecycle.map((one) => one.text)).toEqual([
      "Scan failed - boom",
    ]);
  });

  it("posts a failed run that finished with exit 1 as Scan failed with the first failed entry", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [extract, entry("sense", "alpha", "no coverage"), exited(1)],
      record: {
        failure: {
          sensor: "alpha",
          suite: null,
          code: null,
          reason: "no coverage",
        },
      },
      result: { status: "finished", exitCode: 1 },
    });
    const { made } = timed(scan);

    await made.rescanner.run();

    expect(made.lifecycle.at(-1)).toEqual({
      kind: "error",
      text: "Scan failed - alpha: no coverage",
    });
  });

  it("posts a warning for a gaps result and never Scan complete", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      result: { status: "gaps", gaps: [GAP, OUTSIDE] },
    });
    const { made } = timed(scan);

    await made.rescanner.run();

    expect(made.lifecycle.at(-1)).toEqual({
      kind: "warning",
      text: "Scan refused - 2 problems: coverage and pytest are not installed",
    });
    expect(
      made.lifecycle.some((one) => one.text.startsWith("Scan complete")),
    ).toBe(false);
  });

  it("posts a config gap as a problem, not a missing tool", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      result: {
        status: "gaps",
        gaps: [
          {
            ...GAP,
            id: "crap:python:root:suite",
            line: "no test suites are configured in .recognizer/config.yaml",
          },
        ],
      },
    });
    const { made } = timed(scan);

    await made.rescanner.run();

    expect(made.lifecycle.at(-1)).toEqual({
      kind: "warning",
      text: "Scan refused - 1 problem: no test suites are configured in .recognizer/config.yaml",
    });
  });

  it("posts a refusal for the live marker as a warning", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      result: { status: "refused", reason: "another scan is running" },
    });
    const { made } = timed(scan);

    await made.rescanner.run();

    expect(made.lifecycle.at(-1)).toEqual({
      kind: "warning",
      text: "Scan refused - another scan is running",
    });
  });
});

describe("the preflight flow", () => {
  const gapsResult = {
    status: "gaps" as const,
    gaps: [GAP, OUTSIDE],
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function refused(overrides: Partial<RescanPorts<string>> = {}) {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      result: gapsResult,
    });
    const made = harness(scan, overrides);

    await made.rescanner.run();

    return { ...made, scan };
  }

  it("shows the checking card from Scan until the record arrives", async () => {
    const scan = fakeScan({
      records: false,
      defaults: { describe: false, sensors: true },
      steps: [preflightOk, extract, summary],
    });
    const made = harness(scan);
    const seen: boolean[] = [];

    made.scan.onStep = () =>
      seen.push(made.rescanner.runView().starting !== null);
    await made.rescanner.run();

    expect(seen.slice(0, 2)).toEqual([true, true]);

    scan.emitRun({
      kind: "run",
      run: record({ run_id: "new", phase: "checking" }),
    });
    await flush();

    expect(made.rescanner.runView().starting).toBeNull();
    expect(made.rescanner.runView().run?.id).toBe("new");
  });

  it("scan start and elapsed use the awake clock", async () => {
    let wall = 1_000_000;
    const awake = 500;
    const scan = fakeScan({
      records: false,
      defaults: { describe: false, sensors: true },
      steps: [preflightOk, extract, current, summary],
    });
    const made = harness(scan, { now: () => wall, awake: () => awake });
    const seen: { at: number | undefined }[] = [];

    made.scan.onStep = () => {
      wall += 8 * 3_600_000;
      seen.push({
        at: made.rescanner.runView().starting?.at,
      });
    };
    await made.rescanner.run();

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.at).toBe(1_000_000);
  });

  it("shows the gaps of the refused run, with no blocked message", async () => {
    const { rescanner, log, scan } = await refused({
      hasExplorer: () => true,
    });

    scan.emitRun({
      kind: "run",
      run: record({
        run_id: "refused-1",
        phase: "refused",
        started_by: "app",
        exit: 4,
        ended_at: "2026-11-10T09:00:01.000Z",
        gaps: [GAP, OUTSIDE],
      }),
    });
    await flush();

    expect(rescanner.runView().run?.gaps).toEqual([GAP, OUTSIDE]);
    expect(rescanner.runView().starting).toBeNull();
    expect(log.some((one) => one.startsWith("blocked:"))).toBe(false);
    expect(rescanner.running()).toBe(false);
  });

  describe("a refused open", () => {
    const cached: Loaded = {
      ...OK,
      scans: [{ file: "scan.python.json" } as never],
    };
    const refusalText = "2 problems: coverage and pytest are not installed";
    const refusedRecord = () =>
      record({
        run_id: "refused-open",
        phase: "refused",
        started_by: "app",
        exit: 4,
        ended_at: "2026-11-10T09:00:01.000Z",
        gaps: [GAP, OUTSIDE],
      });
    const ways: Record<
      string,
      (over: Partial<RescanPorts<string>>) => Promise<string[]>
    > = {
      "a gaps result": async (over) => (await refused(over)).log,
      "a refused run record": async (over) => {
        const scan = fakeScan({
          records: false,
          defaults: { describe: false, sensors: true },
          result: gapsResult,
        });
        const made = harness(scan, over);

        scan.emitRun({ kind: "run", run: refusedRecord() });
        await made.rescanner.run();
        await flush();

        return made.log;
      },
    };

    for (const [name, open] of Object.entries(ways)) {
      it(`adopts the cached scan and blocks nothing for ${name}`, async () => {
        let built = false;
        const log = await open({
          load: () => cached,
          hasExplorer: () => built,
          replace: () => {
            built = true;
          },
        });

        expect(log).toContain("adopt");
        expect(built).toBe(true);
        expect(log.some((one) => one.startsWith("blocked:"))).toBe(false);
      });

      it(`shows the refusal full-window when nothing is cached for ${name}`, async () => {
        const log = await open({});

        expect(log).toContain(`blocked:${refusalText}`);
        expect(log.some((one) => /^(replace|sense|adopt)/.test(one))).toBe(
          false,
        );
      });

      it(`changes nothing with an explorer open for ${name}`, async () => {
        const log = await open({ load: () => cached, hasExplorer: () => true });

        expect(
          log.some((one) => /^(replace|sense|adopt|blocked)/.test(one)),
        ).toBe(false);
      });
    }

    it("posts the warning when the cache is adopted", async () => {
      const made = harness(
        fakeScan({
          defaults: { describe: false, sensors: true },
          result: gapsResult,
        }),
        { load: () => cached },
      );

      await made.rescanner.run();

      expect(made.lifecycle.at(-1)).toEqual({
        kind: "warning",
        text: `Scan refused - ${refusalText}`,
      });
    });
  });

  it("keeps a ticked sensor ticked through a refusal and a finished Scan, and both Scans include it", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      result: gapsResult,
    });
    const { rescanner } = harness(scan);

    await rescanner.loadTicks();
    rescanner.setTicks({ ...rescanner.ticks(), armed: ["mut"] });
    await rescanner.run();

    expect(rescanner.ticks().armed).toEqual(["mut"]);

    scan.result = { status: "finished", exitCode: 0 };
    await rescanner.run();

    expect(scan.ran[1]?.sense).toContain("mut");
    expect(rescanner.ticks().armed).toEqual(["mut"]);

    await rescanner.run();

    expect(scan.ran[2]?.sense).toContain("mut");
  });

  describe.each([
    { label: "C.R.A.P. only", ticked: ["crap"] },
    { label: "Mutation only", ticked: ["mut"] },
    { label: "C.R.A.P. and Mutation", ticked: ["crap", "mut"] },
    { label: "none", ticked: [] as string[] },
  ])("keeps the ticks as set after a Scan ends", ({ label, ticked }) => {
    it.each([
      {
        end: "finished",
        steps: [current, summary],
        result: { status: "finished", exitCode: 0 } as const,
      },
      {
        end: "stopped",
        steps: [] as ScanStep[],
        result: { status: "stopped" } as const,
      },
    ])(`with ${label} when it $end`, async ({ steps, result }) => {
      const scan = fakeScan({ steps, result });
      const { rescanner } = harness(scan, {
        registered: async () =>
          registeredWith([
            { name: "alpha", display: "Alpha", runsTests: false },
            { name: "crap", display: "C.R.A.P.", runsTests: true },
            { name: "mut", display: "Mutation", runsTests: true },
          ]),
      });

      await rescanner.loadTicks();
      rescanner.setTicks({ ...rescanner.ticks(), armed: ticked });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(rescanner.ticks().armed).toEqual(ticked);

      for (const name of ticked) {
        expect(scan.written.at(-1)?.ticked).toContain(name);
      }

      await rescanner.run();

      expect(rescanner.ticks().armed).toEqual(ticked);
      expect(
        (scan.written.at(-1)?.ticked ?? []).filter((name) =>
          ["crap", "mut"].includes(name),
        ),
      ).toEqual(ticked);
    });
  });

  it("restores a tests-running sensor tick from the stored list", async () => {
    const scan = fakeScan();
    const registered = async () =>
      registeredWith([
        { name: "alpha", display: "Alpha", runsTests: false },
        { name: "crap", display: "C.R.A.P.", runsTests: true },
      ]);
    const first = harness(scan, { registered });

    await first.rescanner.loadTicks();
    first.rescanner.setTicks({
      ...first.rescanner.ticks(),
      ticked: ["alpha"],
      armed: ["crap"],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = harness(scan, { registered });

    await second.rescanner.loadTicks();
    await flush();

    expect(second.rescanner.ticks().armed).toEqual(["crap"]);
    expect(second.rescanner.ticks().ticked).toEqual(["alpha"]);
  });

  it("splits a stored list into plain, armed and unregistered names", async () => {
    const scan = fakeScan();
    const { rescanner } = harness(scan, {
      registered: async () =>
        registeredWith([
          { name: "alpha", display: "Alpha", runsTests: false },
          { name: "crap", display: "C.R.A.P.", runsTests: true },
        ]),
    });

    await scan.writeTicks({
      describe: false,
      analysis: true,
      ticked: ["alpha", "crap", "ghost"],
      onlyView: false,
      suites: {},
      folds: [],
    });
    await rescanner.loadTicks();
    await flush();

    expect(rescanner.ticks().ticked).toEqual(["alpha", "ghost"]);
    expect(rescanner.ticks().armed).toEqual(["crap"]);
  });

  it("applies the fresh sensor results before the finished state shows", async () => {
    for (const steps of [[current, summary], []]) {
      const scan = fakeScan({
        steps,
        result: { status: "finished", exitCode: 0 },
      });
      const shown: (string | null)[] = [];
      const holder: { updates?: ProgressUpdate[] } = {};
      const made = harness(scan, {
        resense: async () => {
          shown.push(holder.updates?.at(-1)?.scanning ?? "none");

          return { ...OK, modules: ["fresh.py"] };
        },
      });

      holder.updates = made.updates;
      await made.rescanner.loadTicks();
      await made.rescanner.run();

      expect(shown.length).toBeGreaterThan(0);
      expect(shown[0]).not.toBeNull();
      expect(made.updates.at(-1)?.scanning).toBeNull();
      expect(made.rescanner.progress().done).toBe(true);
    }
  });

  it("shows the stopped card with no gaps when the user stops the scan", async () => {
    const scan = fakeScan({
      records: false,
      defaults: { describe: false, sensors: true },
      steps: [new Promise<void>(() => {})],
    });
    const { rescanner } = harness(scan);
    const running = rescanner.run();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rescanner.runView().starting).not.toBeNull();
    await rescanner.stop();
    await running;
    scan.emitRun({
      kind: "run",
      run: record({
        run_id: "own",
        phase: "stopped",
        started_by: "app",
        exit: 143,
        ended_at: "2026-11-10T09:00:02.000Z",
      }),
    });
    await flush();

    expect(rescanner.runView().starting).toBeNull();
    expect(rescanner.runView().run?.state).toBe("stopped");
    expect(rescanner.runView().run?.gaps).toEqual([]);
  });

  it("shows only the running card, with no gaps, when a command-line scan follows a refused app attempt", async () => {
    const { rescanner, scan } = await refused();

    scan.emitRun({
      kind: "run",
      run: record({
        run_id: "refused-1",
        phase: "refused",
        started_by: "app",
        exit: 4,
        ended_at: "2026-11-10T09:00:01.000Z",
        gaps: [GAP, OUTSIDE],
      }),
    });
    await flush();

    expect(rescanner.runView().run?.gaps).toEqual([GAP, OUTSIDE]);

    scan.emitRun({ kind: "run", run: record({ run_id: "cli-2" }) });
    await flush();

    expect(rescanner.runView().run).toMatchObject({
      id: "cli-2",
      state: "running",
      gaps: [],
    });
    expect(rescanner.external()).toBe(true);
  });

  it("hides an ended record the window opened with and shows a running one", async () => {
    const made = harness();

    made.scan.emitRun({
      kind: "run",
      run: record({
        phase: "finished",
        exit: 0,
        ended_at: "2026-11-10T09:01:00.000Z",
      }),
    });
    await flush();

    expect(made.rescanner.runView().adoptedAtOpen).toBe("run-1");

    made.scan.emitRun({ kind: "run", run: record({ run_id: "run-2" }) });
    await flush();

    expect(made.rescanner.runView().adoptedAtOpen).toBe("run-1");
    expect(made.rescanner.runView().run?.id).toBe("run-2");
  });
});

describe("one fold of the run record", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const BEGAN = "2026-11-10T09:00:00.000Z";
  const ENDED = "2026-11-10T09:01:30.000Z";
  const ask: Report = {
    kind: "confirmation-asked",
    ask: { modules: 3, model: "sonnet", inputTokens: 12000, costUsd: 9.5 },
  };
  const logged = summaryLogged;

  const sequences: Record<
    string,
    {
      lines: Report[];
      end: Partial<ScanRunRecord>;
      result: Parameters<typeof fakeScan>[0] extends infer O
        ? O extends { result?: infer R }
          ? R
          : never
        : never;
    }
  > = {
    "a finished run with a failed second sensor": {
      lines: [
        current,
        preflightOk,
        sensing(2),
        entry("sense", "alpha"),
        entry("sense", "beta", "slow"),
        logged(1),
      ],
      end: {
        phase: "failed",
        exit: 1,
        failure: { sensor: "beta", suite: null, code: null, reason: "slow" },
      },
      result: { status: "finished", exitCode: 1 },
    },
    "a run with a describe phase": {
      lines: [
        current,
        preflightOk,
        ask,
        { kind: "confirmation-answered", describe: true } as Report,
        describing(2),
        entry("describe", "a.py"),
        entry("describe", "b.py", "no"),
        sensing(1),
        entry("sense", "alpha"),
        logged(0),
      ],
      end: { phase: "finished", exit: 0 },
      result: { status: "finished", exitCode: 0 },
    },
    "a refused run": {
      lines: [exited(4)],
      end: { phase: "refused", exit: 4, gaps: [GAP] },
      result: { status: "gaps", gaps: [GAP] },
    },
    "a stopped run": {
      lines: [current, preflightOk, sensing(2), entry("sense", "alpha")],
      end: { phase: "stopped", exit: 143 },
      result: { status: "stopped" },
    },
  };

  const SENSORS = ["alpha", "beta"];
  const shown = (posted: MessageInput[]) =>
    posted.map((one) => ({
      kind: one.kind,
      text: one.text,
      action: one.action?.label,
    }));

  async function viaWindow(name: string) {
    const sequence = sequences[name] as (typeof sequences)[string];
    const stopping = name === "a stopped run";
    let reached: () => void = () => {};
    const delivered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const scan = fakeScan({
      defaults: { describe: true, sensors: true },
      steps: stopping
        ? [...sequence.lines, new Promise<void>(() => {})]
        : sequence.lines,
      result: sequence.result,
      record: { started_at: BEGAN, ended_at: ENDED, ...sequence.end },
    });
    const made = harness(scan, { now: () => Date.parse(BEGAN) });

    scan.onStep = (index) => {
      if (index === sequence.lines.length - 1) {
        reached();
      }
    };

    const running = made.rescanner.run();

    if (stopping) {
      await delivered;
      await flush();
      await made.rescanner.stop();
    }

    await running;
    await flush();

    return made;
  }

  async function viaCommandLine(name: string) {
    const sequence = sequences[name] as (typeof sequences)[string];
    const made = harness();
    const cli = record({
      run_id: "cli-run",
      started_by: "cli",
      started_at: BEGAN,
      sensors: SENSORS,
      describe: true,
      phase: "checking",
    });

    made.scan.emitRun({ kind: "run", run: cli });
    await flush();

    for (const one of sequence.lines) {
      made.scan.emitReport(one);

      if (one === preflightOk) {
        made.scan.emitRun({ kind: "run", run: { ...cli, phase: "running" } });
      }

      await flush();
    }

    made.scan.emitRun({
      kind: "run",
      run: { ...cli, ended_at: ENDED, ...sequence.end } as ScanRunRecord,
    });
    await flush();

    return made;
  }

  it.each(Object.keys(sequences))(
    "gives an app-started and a command-line scan the same effects: %s",
    async (name) => {
      const own = await viaWindow(name);
      const other = await viaCommandLine(name);
      const progressOf = (made: typeof own) => {
        const {
          sensing: _sensing,
          timing: _timing,
          ...rest
        } = made.rescanner.progress();

        return rest;
      };

      expect(own.log.length).toBeGreaterThan(0);
      expect(own.lifecycle.length).toBeGreaterThan(0);
      expect(other.log).toEqual(own.log);
      expect(other.lifecycle).toEqual(own.lifecycle);
      expect(shown(other.posted)).toEqual(shown(own.posted));
      expect(other.rescanner.runState().failures).toEqual(
        own.rescanner.runState().failures,
      );
      expect(progressOf(other)).toEqual(progressOf(own));
      expect(other.rescanner.running()).toBe(own.rescanner.running());
    },
  );

  it("reloads once per sense entry and describes once per describe entry, with no line subscription on the port", async () => {
    const scan = fakeScan({
      defaults: { describe: true, sensors: true },
      steps: [
        current,
        preflightOk,
        ask,
        describing(2),
        entry("describe", "a.py"),
        entry("describe", "b.py"),
        sensing(2),
        entry("sense", "alpha"),
        entry("sense", "beta"),
        summary,
      ],
    });
    const { log, rescanner } = harness(scan);

    await rescanner.run();

    expect(log.filter((one) => one === "resense")).toHaveLength(3);
    expect(log.filter((one) => one === "described")).toHaveLength(2);
  });

  it("shows the blocked detail and posts no Scan complete for a finished record whose requested phase ran nothing", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [current, preflightOk, summary],
      record: { commit: null, ran: ["extract"] },
      result: { status: "finished", exitCode: 0 },
    });
    const { log, lifecycle, rescanner } = harness(scan);

    await rescanner.run();

    expect(log).toContain(
      "blocked:sense did not run: the folder has no commit",
    );
    expect(lifecycle.some((one) => one.text.startsWith("Scan complete"))).toBe(
      false,
    );
  });

  it("posts a command-missing result with no record once", async () => {
    const { lifecycle, rescanner } = harness(
      fakeScan({ result: { status: "command-missing", hint: "install it" } }),
    );

    await rescanner.run();

    expect(lifecycle.map((one) => one.text)).toEqual([
      "Scan failed - install it",
    ]);
  });

  it("posts one Scan failed for a failed result with a failed record", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [current, preflightOk, exited(1)],
      record: {
        failure: { sensor: "alpha", suite: null, code: null, reason: "boom" },
      },
      result: { status: "failed", exitCode: 1, stderr: "boom" },
    });
    const { lifecycle, rescanner } = harness(scan);

    await rescanner.run();

    expect(
      lifecycle.filter((one) => one.text.startsWith("Scan failed")),
    ).toEqual([{ kind: "error", text: "Scan failed - alpha: boom" }]);
  });

  it("posts the refusal once whether Rust refused it or the record did", async () => {
    const rust = harness(
      fakeScan({
        defaults: { describe: false, sensors: true },
        result: { status: "gaps", gaps: [GAP] },
      }),
    );

    await rust.rescanner.run();

    const text =
      "Scan refused - 1 problem: coverage and pytest are not installed";

    expect(rust.lifecycle.map((one) => one.text)).toEqual([text]);

    const recorded = harness(
      fakeScan({
        defaults: { describe: false, sensors: true },
        steps: [exited(4)],
        result: { status: "gaps", gaps: [GAP] },
      }),
    );

    await recorded.rescanner.run();

    expect(
      recorded.lifecycle.filter((one) => one.text.startsWith("Scan refused")),
    ).toEqual([{ kind: "warning", text }]);
  });
});

describe("the outcome comes from the run record", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const ASKED = {
    sensors: ["alpha"],
    describe: true,
  };
  const idleRecord = (origin: "cli" | "app", over: Partial<ScanRunRecord>) =>
    record({
      run_id: `${origin}-idle`,
      started_by: origin,
      started_at: "2026-11-10T09:00:00.000Z",
      ended_at: "2026-11-10T09:00:05.000Z",
      ...ASKED,
      phase: "finished",
      exit: 0,
      commit: null,
      ran: ["extract", "describe"],
      ...over,
    });

  async function viaCommandLine(over: Partial<ScanRunRecord>) {
    const made = harness();
    const ended = idleRecord("cli", over);

    made.scan.emitRun({
      kind: "run",
      run: { ...ended, phase: "checking", exit: null, ended_at: null },
    });
    await flush();
    made.scan.emitRun({
      kind: "run",
      run: { ...ended, phase: "running", exit: null, ended_at: null },
    });
    await flush();
    made.scan.emitRun({ kind: "run", run: ended });
    await flush();

    return made;
  }

  async function viaWindow(over: Partial<ScanRunRecord>) {
    const made = harness(
      fakeScan({
        defaults: { describe: true, sensors: true },
        steps: [current, preflightOk, summary],
        record: { ...ASKED, ...over, commit: null },
        result: { status: "finished", exitCode: 0 },
      }),
    );

    await made.rescanner.run();
    await flush();

    return made;
  }

  it("shows the same blocked detail for an app-started and a command-line scan that ran nothing", async () => {
    const other = await viaCommandLine({ ran: ["extract", "describe"] });
    const own = await viaWindow({ ran: ["extract", "describe"] });
    const text = "sense did not run: the folder has no commit";

    const failures = (made: typeof own) =>
      made.lifecycle.filter((one) => one.text.startsWith("Scan failed"));

    expect(failures(other)).toHaveLength(1);
    expect(failures(other)).toEqual([
      { kind: "error", text: `Scan failed - ${text}` },
    ]);
    expect(failures(own)).toEqual(failures(other));
    expect(other.log.filter((one) => one.startsWith("blocked:"))).toEqual([
      `blocked:${text}`,
    ]);
    expect(own.log.filter((one) => one.startsWith("blocked:"))).toEqual(
      other.log.filter((one) => one.startsWith("blocked:")),
    );
    expect(other.log).not.toContain("described");
    expect(own.log).not.toContain("described");
    expect(other.posted).toEqual(own.posted);
  });

  it("names only the phases that did not run when others did", async () => {
    const other = await viaCommandLine({ ran: ["extract", "describe"] });

    expect(
      other.lifecycle
        .map((one) => one.text)
        .filter((one) => one.startsWith("Scan failed")),
    ).toEqual(["Scan failed - sense did not run: the folder has no commit"]);
  });

  it("posts the failure text, not the blocked detail, when the record holds no summary", async () => {
    const made = await viaCommandLine({
      phase: "failed",
      exit: 1,
      ran: null,
      failure: {
        sensor: "scan",
        suite: null,
        code: null,
        reason: "the scan ended on an error",
      },
    });

    expect(
      made.lifecycle
        .map((one) => one.text)
        .filter((one) => one.startsWith("Scan failed")),
    ).toEqual(["Scan failed - scan: the scan ended on an error"]);
    expect(made.log.some((one) => one.startsWith("blocked:"))).toBe(false);
  });

  const MESSAGE = "unknown sensor: nosuch\nuse one of: crap, mutation";
  const crash = {
    phase: "failed" as const,
    exit: 1,
    ran: null,
    failure: { sensor: "scan", suite: null, code: null, reason: MESSAGE },
  };
  const failures = (made: { lifecycle: { text: string }[] }) =>
    made.lifecycle
      .map((one) => one.text)
      .filter((one) => one.startsWith("Scan failed"));
  const blocked = (made: { log: string[] }) =>
    made.log.filter((one) => one.startsWith("blocked:"));

  async function failedViaWindow(
    stderr: string,
    withRecord: boolean,
    reason = MESSAGE,
  ) {
    const made = harness(
      fakeScan({
        defaults: { describe: true, sensors: true },
        steps: [],
        records: withRecord,
        record: {
          ...ASKED,
          ...crash,
          failure: { sensor: "scan", suite: null, code: null, reason },
          commit: null,
        },
        result: { status: "failed", exitCode: 2, stderr },
      }),
    );

    await made.rescanner.run();
    await flush();

    return made;
  }

  it("shows the same failure text for an app-started and a command-line scan that fail the same way", async () => {
    const other = await viaCommandLine(crash);
    const own = await failedViaWindow("", true);

    expect(failures(other)).toHaveLength(1);
    expect(failures(other)).toEqual([`Scan failed - scan: ${MESSAGE}`]);
    expect(failures(own)).toEqual(failures(other));
    expect(blocked(own)).toEqual(blocked(other));
    expect(own.posted).toEqual(other.posted);
  });

  it("shows the exit code when no record arrives and the child printed nothing", async () => {
    const made = await failedViaWindow("", false);

    expect(failures(made)).toEqual(["Scan failed - recognizer scan exited 2"]);
  });

  it("shows the carried stderr when no record arrives", async () => {
    const made = await failedViaWindow("bad flag\n", false);

    expect(failures(made)).toEqual(["Scan failed - bad flag"]);
  });

  it("shows only the record's text when a record exists and differing stderr is carried", async () => {
    const made = await failedViaWindow("ignored noise", true, "real reason");

    expect(failures(made)).toHaveLength(1);
    expect(failures(made)).toEqual(["Scan failed - scan: real reason"]);
    expect(made.log.join("\n")).not.toContain("ignored noise");
  });
});

describe("adopting once per scan", () => {
  const NOT_WAITING = "no scan is waiting to be adopted";
  const finishedRecord = record({
    phase: "finished",
    exit: 0,
    ended_at: ENDED_AT,
    describe: false,
    ran: ["extract", "sense"],
    sensors: ["alpha"],
  });

  function oneShot(
    scan: ReturnType<typeof fakeScan>,
    body: () => void,
    over: Partial<RescanPorts<string>> = {},
  ) {
    let pending = false;
    const real = scan.run.bind(scan);

    scan.run = async (plan) => {
      pending = true;
      body();

      return real(plan);
    };

    const made = harness(scan, {
      adopt: async () => {
        made.log.push("adopt");

        if (!pending) {
          throw new Error(NOT_WAITING);
        }

        pending = false;

        return ORIGIN;
      },
      ...over,
    });

    return made;
  }

  const adopts = (log: string[]) => log.filter((one) => one === "adopt");

  function lateRecord(scan: ReturnType<typeof fakeScan>) {
    return () => {
      for (const text of [current, sensing(1), summary]) {
        scan.emitReport(text);
      }

      scan.emitRun({ kind: "run", run: record({ run_id: "own-1" }) });
      scan.emitRun({
        kind: "run",
        run: { ...finishedRecord, run_id: "own-1" },
      });
    };
  }

  it("adopts once when the active record arrives after the lines", async () => {
    const scan = fakeScan({ records: false });
    const { log, rescanner } = oneShot(scan, lateRecord(scan));

    await rescanner.run(null, OPEN_RUN);

    expect(adopts(log)).toHaveLength(1);
    expect(log.filter((one) => one.startsWith("replace:"))).toHaveLength(1);
    expect(log.some((one) => one.startsWith("blocked:"))).toBe(false);
    expect(log.indexOf("sense")).toBeLessThan(log.indexOf("adopt"));
  });

  it("adopts once when a settled scan then opens from the cache", async () => {
    const scan = fakeScan({ records: false });
    const { log, rescanner } = oneShot(
      scan,
      () => {
        scan.emitReport(current);
        scan.emitReport(sensing(1));
        scan.emitRun({ kind: "run", run: record({ run_id: "own-1" }) });
        scan.emitRun({
          kind: "run",
          run: { ...finishedRecord, run_id: "own-1", ran: ["extract"] },
        });
      },
      {
        load: () => ({ ...OK, scans: [{ file: "scan.python.json" } as never] }),
      },
    );

    await rescanner.run(null, OPEN_RUN);

    expect(adopts(log)).toHaveLength(1);
    expect(log.some((one) => one.startsWith("blocked:no scan"))).toBe(false);
  });

  function recordedLines(scan: ReturnType<typeof fakeScan>, runId: string) {
    return () => {
      scan.emitRun({ kind: "run", run: record({ run_id: runId }) });

      for (const text of [current, sensing(1), summary]) {
        scan.emitReport(text);
      }

      scan.emitRun({
        kind: "run",
        run: { ...finishedRecord, run_id: runId },
      });
    };
  }

  it("adopts again for the next scan", async () => {
    const scan = fakeScan({ records: false });
    let scans = 0;
    const { log, rescanner } = oneShot(scan, () => {
      scans += 1;
      recordedLines(scan, `own-${scans}`)();
    });

    await rescanner.run(null, OPEN_RUN);
    await rescanner.run(null, OPEN_RUN);

    expect(adopts(log)).toHaveLength(2);
    expect(log.some((one) => one.startsWith("blocked:"))).toBe(false);
  });

  it("retries a failed adopt on a later settle in the same scan", async () => {
    const scan = fakeScan({ records: false });
    let calls = 0;
    const { log, rescanner } = harness(scan, {
      adopt: async () => {
        calls += 1;

        if (calls === 1) {
          throw new Error("first fails");
        }

        log.push("adopt");

        return ORIGIN;
      },
    });
    const real = scan.run.bind(scan);

    scan.run = async (plan) => {
      scan.emitRun({ kind: "run", run: record({ run_id: "own-1" }) });
      scan.emitReport(describing(0));
      scan.emitRun({
        kind: "run",
        run: { ...finishedRecord, run_id: "own-1" },
      });
      recordedLines(scan, "own-2")();

      return real(plan);
    };

    await rescanner.run(null, OPEN_RUN);

    expect(log).toContain("blocked:Error: first fails");
    expect(adopts(log)).toHaveLength(1);
  });
});

describe("replaying a previous finished run at open", () => {
  const NOW = "2026-11-10T09:30:00.000Z";
  const NOT_WAITING = "no scan is waiting to be adopted";
  const previous = record({
    run_id: "prev",
    started_at: "2026-11-10T09:00:00.000Z",
    phase: "finished",
    exit: 0,
    ended_at: ENDED_AT,
    describe: false,
    ran: ["extract", "sense"],
    sensors: ["alpha"],
  });

  const adopts = (log: string[]) => log.filter((one) => one === "adopt");
  const blocked = (log: string[]) =>
    log.filter((one) => one.startsWith("blocked:"));

  function replay(
    scan: ReturnType<typeof fakeScan>,
    log: string[],
    lines = true,
    withRecord = true,
  ) {
    log.push("replayed");

    if (lines) {
      for (const text of [preflightOk, current, sensing(0), summary]) {
        scan.emitReport(text);
      }
    }

    if (withRecord) {
      scan.emitRun({ kind: "run", run: previous });
    }
  }

  function opening(
    when: "before" | "during" | "after-run" | "after-open",
    lines = true,
  ) {
    const scan = fakeScan();
    let pending = false;
    let log: string[] = [];
    const real = scan.run.bind(scan);

    scan.run = async (plan) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      pending = true;

      if (when === "during") {
        replay(scan, log, lines);
      }

      const result = await real(plan);

      if (when === "after-run") {
        replay(scan, log, lines);
      }

      return result;
    };

    const made = harness(scan, {
      registered: async () => {
        if (when === "before") {
          replay(scan, log, lines);
        }

        return registeredWith([
          { name: "alpha", display: "Alpha", runsTests: false },
        ]);
      },
      adopt: async () => {
        made.log.push("adopt");

        if (!pending) {
          throw new Error(NOT_WAITING);
        }

        pending = false;

        return ORIGIN;
      },
    });

    log = made.log;

    return { scan, made, replayAfterOpen: () => replay(scan, made.log, lines) };
  }

  const positions = ["before", "during", "after-run", "after-open"] as const;

  for (const lines of [true, false]) {
    for (const when of positions) {
      it(`adopts once when the replay lands ${when} the open scan${lines ? "" : " (record only)"}`, async () => {
        const { made, replayAfterOpen } = opening(when, lines);

        await made.rescanner.run(null, OPEN_RUN);

        if (when === "after-open") {
          replayAfterOpen();
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        expect(adopts(made.log)).toHaveLength(1);
        expect(blocked(made.log)).toEqual([]);
        expect(
          made.log.filter((one) => one.startsWith("replace:")),
        ).toHaveLength(1);
      });
    }
  }

  it("adopts from the own run, not at the replay", async () => {
    const { made } = opening("during");

    await made.rescanner.run(null, OPEN_RUN);

    expect(made.log.indexOf("sense")).toBeGreaterThan(
      made.log.indexOf("replayed"),
    );
    expect(made.log.indexOf("adopt")).toBeGreaterThan(
      made.log.indexOf("sense"),
    );
  });

  it("keeps the own run when a previous finished record lands after the own record", async () => {
    const scan = fakeScan();
    const made = harness(scan, { now: () => Date.parse(NOW) });
    const real = scan.run.bind(scan);

    scan.run = async (plan) => {
      const result = await real(plan);

      scan.emitRun({ kind: "run", run: previous });

      return result;
    };

    await made.rescanner.run(null, OPEN_RUN);

    expect(adopts(made.log)).toHaveLength(1);
    expect(made.log.filter((one) => one.startsWith("replace:"))).toHaveLength(
      1,
    );
  });

  describe("the own start boundary", () => {
    async function deliver(startedAt: string) {
      const scan = fakeScan({ records: false });
      const made = harness(scan, { now: () => Date.parse(NOW) });
      const real = scan.run.bind(scan);

      scan.run = async (plan) => {
        scan.emitRun({
          kind: "run",
          run: { ...previous, run_id: "edge", started_at: startedAt },
        });

        return real(plan);
      };

      await made.rescanner.run(null, OPEN_RUN);

      return adopts(made.log).length;
    }

    it("counts a finished record that started at the scan start as own", async () => {
      expect(await deliver(NOW)).toBe(1);
    });

    it("ignores a finished record that started 1 ms before the scan start", async () => {
      expect(await deliver(new Date(Date.parse(NOW) - 1).toISOString())).toBe(
        1,
      );
    });
  });

  it("shows the progress of an external run that started before the window's scan clock", async () => {
    const scan = fakeScan();
    const made = harness(scan);
    const flushed = () => new Promise((resolve) => setTimeout(resolve, 20));

    scan.emitRun({
      kind: "run",
      run: {
        ...previous,
        run_id: "ext",
        phase: "running",
        ended_at: null,
        exit: null,
      },
    });
    await flushed();
    scan.emitReport(preflightOk);
    scan.emitReport(current);
    await flushed();

    expect(made.rescanner.external()).toBe(true);
    expect(made.rescanner.progress().extract).not.toBe("run");
  });

  it("keeps the record of a previous finished run while no scan is busy", async () => {
    const scan = fakeScan();
    const made = harness(scan);

    scan.emitRun({ kind: "run", run: previous });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(made.rescanner.runView().adoptedAtOpen).toBe("prev");
    expect(made.rescanner.runView().run?.id).toBe(previous.run_id);
  });

  it("adopts nothing from replayed lines with no run of the app's own", async () => {
    const scan = fakeScan();
    const made = harness(scan);

    scan.run = async () => {
      replay(scan, made.log, true, false);

      return { status: "failed", exitCode: -1, stderr: "x" };
    };

    await made.rescanner.run(null, OPEN_RUN);

    expect(adopts(made.log)).toHaveLength(0);
  });
});

describe("attaching to a scan still running from before", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  function cached() {
    const state = { drawn: 0 };
    const ports: Partial<RescanPorts<string>> = {
      load: () => ({ ...OK, scans: [{ file: "scan.python.json" } as never] }),
      adopted: () => {
        state.drawn += 1;
      },
      hasExplorer: () => state.drawn > 0,
    };

    return { state, ports };
  }

  function attaching(
    over: Partial<RescanPorts<string>> = {},
    before: (scan: ReturnType<typeof fakeScan>) => void = () => {},
  ) {
    const scan = fakeScan({ records: false });
    const made = harness(scan, over);
    let calls = 0;

    scan.run = async () => {
      calls += 1;
      scan.emitRun({
        kind: "run",
        run: record({ run_id: "earlier", started_by: "app" }),
      });
      before(scan);
      await flush();

      return { status: "attached" };
    };

    return { ...made, scan, calls: () => calls };
  }

  it("attaches to a live run on open and hands a later start to core, which attaches again", async () => {
    const made = attaching();

    await made.rescanner.run(null, OPEN_RUN);
    await flush();

    expect(made.rescanner.runView().run?.state).toBe("running");
    expect(made.rescanner.runView().run?.id).toBe("earlier");
    expect(made.rescanner.external()).toBe(true);
    expect(made.calls()).toBe(1);

    await made.rescanner.run();

    expect(made.calls()).toBe(2);
    expect(made.log.some((one) => one.startsWith("blocked:"))).toBe(false);
    expect(made.posted).toEqual([]);
    expect(made.lifecycle.map((one) => one.kind)).toEqual(["info"]);
  });

  it("Stop on an attached run calls the port stop and settles when the record ends", async () => {
    const made = attaching(cached().ports);

    await made.rescanner.run(null, OPEN_RUN);
    await flush();
    await made.rescanner.stop();

    expect(made.scan.stopped).toBe(1);

    made.scan.emitRun({
      kind: "run",
      run: record({
        run_id: "earlier",
        started_by: "app",
        phase: "stopped",
        ended_at: "2026-11-10T09:00:05.000Z",
      }),
    });
    await flush();

    expect(made.rescanner.external()).toBe(false);
    expect(made.log.filter((one) => one === "settled")).toHaveLength(2);
  });

  it("an attached run that ended while the result was in flight is ended once", async () => {
    const drawing = cached();
    const made = attaching(drawing.ports, (scan) =>
      scan.emitRun({
        kind: "run",
        run: record({
          run_id: "earlier",
          started_by: "app",
          phase: "finished",
          exit: 0,
          ended_at: "2026-11-10T09:00:05.000Z",
          ran: ["extract"],
        }),
      }),
    );

    await made.rescanner.run(null, OPEN_RUN);
    await flush();

    expect(made.rescanner.external()).toBe(false);
    expect(drawing.state.drawn).toBe(1);
  });

  it("an attached open with no cache holds the gate until the run ends", async () => {
    const made = attaching();

    await made.rescanner.run(null, OPEN_RUN);
    await flush();

    expect(made.log).toContain("attached");
    expect(made.log).not.toContain("settled");

    made.scan.emitRun({
      kind: "run",
      run: record({
        run_id: "earlier",
        started_by: "app",
        phase: "stopped",
        ended_at: "2026-11-10T09:00:05.000Z",
      }),
    });
    await flush();

    expect(made.log).toContain("settled");
  });

  it("an attached open with a cache draws the explorer from it", async () => {
    const drawing = cached();
    const made = attaching(drawing.ports);

    await made.rescanner.run(null, OPEN_RUN);
    await flush();

    expect(drawing.state.drawn).toBe(1);
    expect(made.log).not.toContain("attached");
  });
});

describe("the opening scan's timing from the snapshot", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("stamps a language's start, total and end on the awake clock when the snapshot first shows them", async () => {
    let clock = 1000;
    const made = harness(fakeScan(), { awake: () => clock });
    const cli = record({ run_id: "timed", describe: false, sensors: [] });

    made.scan.emitRun({ kind: "run", run: cli });
    await flush();
    made.scan.emitReport({ kind: "extract-planned", languages: ["python"] });
    await flush();

    expect(made.rescanner.progress().timing.extractAt).toEqual({});

    clock = 2000;
    made.scan.emitReport({
      kind: "plugin-started",
      name: "python",
      progress: { done: 0, total: 40, unit: "files" },
      phase: "extract",
    });
    await flush();

    clock = 5000;
    made.scan.emitReport({
      kind: "plugin-progress",
      name: "python",
      progress: { done: 10, total: 40, unit: "files" },
      phase: "extract",
    });
    await flush();

    expect(made.rescanner.progress().timing).toEqual({
      extractAt: { python: 2000 },
      extractDoneAt: {},
      extractTotals: { python: 40 },
    });

    clock = 9000;
    made.scan.emitReport({
      kind: "plugin-ended",
      name: "python",
      state: "finished",
      phase: "extract",
    });
    await flush();

    expect(made.rescanner.progress().timing.extractDoneAt).toEqual({
      python: 9000,
    });
  });

  it("shows a language the registered sensors do not know", async () => {
    const made = harness();

    made.scan.emitRun({
      kind: "run",
      run: record({ run_id: "unknown", describe: false, sensors: [] }),
    });
    await flush();
    made.scan.emitReport({ kind: "extract-planned", languages: ["cobol"] });
    await flush();

    expect(made.rescanner.progress().languages).toEqual(["cobol"]);
  });

  it("answerDescribe with no ask does nothing and with an ask calls the port once", async () => {
    const made = harness();

    made.scan.emitRun({
      kind: "run",
      run: record({ run_id: "asking", sensors: [] }),
    });
    await flush();
    await made.rescanner.answerDescribe(true);

    expect(made.scan.answers).toEqual([]);

    made.scan.emitReport({
      kind: "confirmation-asked",
      ask: { modules: 2, model: "m", inputTokens: 10, costUsd: null },
    });
    await flush();
    await made.rescanner.answerDescribe(true);

    expect(made.scan.answers).toEqual([true]);
  });
});
