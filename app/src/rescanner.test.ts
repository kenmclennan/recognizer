import type { ScanRunRecord } from "recognizer";
import { describe, expect, it, vi } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import type { ScanOrigin } from "./footer-scan";
import type { MessageAction, MessageInput } from "./message-tray";
import {
  createRescanner,
  type ProgressUpdate,
  type RescanPorts,
} from "./rescanner";
import { fakeScan } from "./scan-fake";
import { OPEN_RUN } from "./scan-freshness";
import type { Loaded } from "./scan-loading";

const ORIGIN: ScanOrigin = { branch: "main", commit: "a1b2c3d" };
const OK: Loaded = {
  modules: ["a.py"],
  scans: [],
  policy: null,
  baseline: null,
  notices: [],
  blocking: null,
  findings: [],
  sensors: [],
};

const line = (value: object) => JSON.stringify(value);
const record = (over: Partial<ScanRunRecord> = {}): ScanRunRecord => ({
  version: 5,
  run_id: "run-1",
  pid: 4242,
  pgid: 4242,
  started_at: "2026-11-10T09:00:00.000Z",
  started_by: "cli",
  repository: "/work/repo",
  sensors: ["alpha", "mut"],
  describe: true,
  suites: {},
  phase: "running",
  ended_at: null,
  exit: null,
  gaps: [],
  failure: null,
  commit: null,
  ran: null,
  ...over,
});
const extract = line({
  event: "phase",
  phase: "extract",
  state: "run",
  commit: "abc",
});
const current = line({
  event: "phase",
  phase: "extract",
  state: "current",
  commit: "abc",
});
const describing = (total: number) =>
  line({ event: "phase", phase: "describe", total });
const sensing = (total: number) =>
  line({ event: "phase", phase: "sense", total });
const entry = (phase: string, name: string, reason?: string) =>
  line({
    event: "entry",
    phase,
    name,
    outcome: reason === undefined ? "ok" : "failed",
    ...(reason === undefined ? {} : { reason }),
  });
const summary = line({ event: "summary" });
const preflightOk = line({ event: "preflight", state: "ok" });
const LOG = "x-scan";
const summaryLogged = (exit: number) =>
  line({ event: "summary", exit, log: LOG });

function harness(scan = fakeScan(), over: Partial<RescanPorts<string>> = {}) {
  const log: string[] = [];
  const updates: ProgressUpdate[] = [];
  const posted: MessageInput[] = [];
  const lifecycle: MessageInput[] = [];
  const attached: { id: number; extra: MessageAction }[] = [];
  const ports: RescanPorts<string> = {
    port: scan,
    registered: async () => [
      { name: "alpha", display: "Alpha", runsTests: false },
      { name: "beta", display: "Beta", runsTests: false },
      { name: "mut", display: "Mutation", runsTests: true },
    ],
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

  return {
    log,
    updates,
    posted,
    lifecycle,
    attached,
    scan,
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
        describeAll: false,
        sense: ["alpha", "beta"],
        modules: null,
      },
    ]);
    expect(scan.written).toEqual([
      {
        describe: true,
        ticked: ["alpha", "beta"],
        onlyView: false,
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
    expect(texts(updates)).toContain("Describing\u2026 0 of 1 modules");
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

    expect(log.filter((entry) => entry === "resense")).toHaveLength(2);
    expect(seen).toEqual([["alpha", "beta"], ["beta"]]);
    expect(rescanner.runState().failures).toEqual({ beta: "boom" });
    expect(Object.keys(rescanner.runState().ranAt)).toEqual(["alpha", "beta"]);
    expect(rescanner.runState().running).toEqual([]);
  });

  it("shows only the started sensor as running, the rest waiting, and holds a failure until the sensor next finishes ok", async () => {
    const start = (name: string) =>
      line({ event: "start", phase: "sense", name });
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

  it("clears a sensor's diagnosis when a later sense entry for it is ok", async () => {
    const refused = line({
      event: "entry",
      phase: "sense",
      name: "alpha",
      outcome: "failed",
      reason: "refused",
      diagnosis: { code: "tool-missing", line: "cargo-llvm-cov is missing" },
    });
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [current, sensing(1), refused, entry("sense", "alpha"), summary],
    });
    const { rescanner } = harness(scan);
    const seen: Record<string, unknown>[] = [];

    scan.onStep = (index) => {
      if (index === 2) {
        seen.push({ ...rescanner.runState().diagnoses });
      }
    };

    await rescanner.run();

    expect(seen).toEqual([
      { alpha: { code: "tool-missing", line: "cargo-llvm-cov is missing" } },
    ]);
    expect(rescanner.runState().diagnoses).toEqual({});
    expect(rescanner.runState().failures).toEqual({});
  });

  it("shows the first unfinished planned sensor as running when the stream has no start events", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [
        current,
        sensing(2),
        entry("sense", "alpha"),
        entry("sense", "beta"),
        summary,
      ],
    });
    const { rescanner } = harness(scan);
    const seen: (string | null)[] = [];

    scan.onStep = (index) => {
      if (index === 1 || index === 2) {
        seen.push(rescanner.runState().started);
      }
    };

    await rescanner.run();

    expect(seen).toEqual(["alpha", "beta"]);
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
      "Describe wrote 0 lines, 1 modules failed.",
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
        current,
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

  it("does nothing while a scan is running", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scan = fakeScan({ steps: [gate] });
    const { rescanner } = harness(scan);

    const first = rescanner.run();

    await new Promise((resolve) => setTimeout(resolve, 10));
    await rescanner.run();
    release();
    await first;

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
      resense: async () => ({ ...OK, policy: `p${turn++}` }),
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
      resense: async () => ({ ...OK, policy: `p${turn++}` }),
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
    expect(updated.map((loaded) => loaded.policy)).toEqual(["p1", "p2"]);
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

        return { ...OK, policy: `p${next}`, modules: [`m${next}.py`] };
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
      resense: async () => ({ ...OK, policy: `p${turn++}` }),
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

  it("does not refresh while a scan is running", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { log, rescanner } = harness(fakeScan({ steps: [gate] }));

    const first = rescanner.run();

    await new Promise((resolve) => setTimeout(resolve, 10));
    await rescanner.refresh();
    release();
    await first;

    expect(log).not.toContain("resense");
  });

  it("never writes a test-running sensor and clears once after every Scan however it ends", async () => {
    for (const steps of [
      [current, summary],
      [current, "not json at all"],
    ]) {
      const scan = fakeScan({ steps });
      const { rescanner } = harness(scan);

      await rescanner.loadTicks();
      rescanner.setTicks({
        ...rescanner.ticks(),
        once: ["mut"],
        onlyView: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await rescanner.run();

      expect(scan.ran[0].sense).toContain("mut");
      expect(scan.written.every((one) => !one.ticked.includes("mut"))).toBe(
        true,
      );
      expect(rescanner.ticks().once).toEqual([]);
    }
  });

  it("re-reads the sensor findings after a stopped Scan", async () => {
    const scan = fakeScan({ result: { status: "stopped" } });
    const { log, rescanner } = harness(scan);

    await rescanner.loadTicks();
    await rescanner.run();

    expect(log).toContain("resense");
  });

  it("clears once when the Scan fails or is stopped", async () => {
    for (const result of [
      { status: "failed" as const, exitCode: 1, stderr: "boom" },
      { status: "stopped" as const },
    ]) {
      const scan = fakeScan({ result });
      const { rescanner } = harness(scan);

      await rescanner.loadTicks();
      rescanner.setTicks({
        ...rescanner.ticks(),
        once: ["mut"],
        onlyView: false,
      });
      await rescanner.run();

      expect(rescanner.ticks().once).toEqual([]);
    }
  });

  it("sends the module scope in the plan and remembers the switch", async () => {
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
      ticked: null,
      once: [],
      onlyView: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(scan.written).toEqual([
      { describe: true, ticked: ["alpha", "beta"], onlyView: false },
    ]);
    expect(rescanner.ticks()).toEqual({
      describe: true,
      ticked: null,
      once: [],
      onlyView: false,
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
      text: "Describe wrote 2 lines, 0 modules failed.",
    });
  });

  it("posts the describe result with Show on the first failed module", async () => {
    const scan = fakeScan({
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

    expect(result?.text).toBe("Describe wrote 1 lines, 3 modules failed.");
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
    const start = (name: string) =>
      line({ event: "start", phase: "sense", name });
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
        describeAll: true,
        sense: ["alpha"],
        modules: ["a.py"],
      },
      dropped: [],
      modules: 1,
      idle: false,
      label: "Rescan 1 module",
      progress: "Rescanning 1 module\u2026",
    };

    await rescanner.run(planned.plan.modules, planned);

    expect(scan.ran).toEqual([planned.plan]);

    const shown = texts(updates).filter((text) => text !== null);

    expect(shown.length).toBeGreaterThan(0);
    expect(
      shown.every((text) => text?.startsWith("Rescanning 1 module\u2026 ")),
    ).toBe(true);
  });

  describe("the describe confirmation", () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    const ask = line({
      event: "confirm",
      phase: "describe",
      modules: 3,
      model: "sonnet",
      input_tokens: 12000,
      cost_usd: 9.5,
    });

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

    const answered = (describe: boolean) =>
      line({ event: "answered", phase: "describe", describe });

    it("opens the ask from the record's confirm line and answers describe through the port once", async () => {
      const { rescanner, scan, updates } = await waiting();

      expect(texts(updates).at(-1)).toContain("Waiting for your answer");

      await rescanner.answerDescribe(true);

      expect(scan.answers).toEqual([true]);
      expect(rescanner.progress().describeAsk).not.toBeNull();

      scan.emitRun({ kind: "line", line: answered(true) });
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
      scan.emitRun({ kind: "line", line: answered(false) });
      await flush();

      expect(scan.answers).toEqual([false]);
      expect(rescanner.progress().describeAsk).toBeNull();
      expect(rescanner.progress().describeSkipped).toBe(true);

      await rescanner.stop();
    });

    it("answers a scan the command line started through the same port call", async () => {
      const made = harness();

      made.scan.emitRun({ kind: "run", run: record() });
      made.scan.emitRun({ kind: "line", line: ask });
      await flush();

      expect(made.rescanner.progress().describeAsk).not.toBeNull();

      await made.rescanner.answerDescribe(true);
      made.scan.emitRun({ kind: "line", line: answered(true) });
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
      made.scan.emitRun({ kind: "line", line: describing(2) });
      made.scan.emitRun({ kind: "line", line: sensing(2) });
      await flush();

      return made;
    }

    it("shows the scan's rows and progress under the command-line heading", async () => {
      const { rescanner } = await observed();

      expect(rescanner.running()).toBe(true);
      expect(rescanner.external()).toBe(true);
      expect(rescanner.runState().running).toEqual(["alpha", "mut"]);
      expect(rescanner.runView().record).toEqual(cli);
    });

    it("starts nothing and takes no side-effecting branch for its lines", async () => {
      const { rescanner, scan, posted, log } = await observed();

      await rescanner.run();
      scan.emitRun({
        kind: "line",
        line: entry("sense", "alpha", "boom"),
      });
      await flush();

      expect(scan.ran).toEqual([]);
      expect(posted.map((one) => one.text)).toEqual(["alpha failed: boom"]);
      expect(log).not.toContain("described");
      expect(rescanner.runState().failures).toEqual({ alpha: "boom" });
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

      expect(rescanner.progress()).toBe(before);
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
      steps: [
        extract,
        entry("sense", "alpha", "no coverage"),
        line({ event: "summary", exit: 1 }),
      ],
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
      text: "Scan refused - 2 tools missing: coverage and pytest are not installed",
    });
    expect(
      made.lifecycle.some((one) => one.text.startsWith("Scan complete")),
    ).toBe(false);
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

  async function refused() {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      result: gapsResult,
    });
    const made = harness(scan);

    await made.rescanner.run();

    return { ...made, scan };
  }

  it("shows the checking card from Scan until the record arrives", async () => {
    const scan = fakeScan({
      records: false,
      defaults: { describe: false, sensors: true },
      steps: [
        line({ event: "preflight", state: "run" }),
        line({ event: "preflight", state: "ok" }),
        extract,
        summary,
      ],
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
    expect(made.rescanner.runView().record?.run_id).toBe("new");
  });

  it("shows the gaps of the refused run, with no blocked message", async () => {
    const { rescanner, log, scan } = await refused();

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

    expect(rescanner.runView().record?.gaps).toEqual([GAP, OUTSIDE]);
    expect(rescanner.runView().starting).toBeNull();
    expect(log.some((one) => one.startsWith("blocked:"))).toBe(false);
    expect(rescanner.running()).toBe(false);
  });

  it("keeps a once-ticked sensor ticked after a refusal so Check again and scan includes it", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      result: gapsResult,
    });
    const { rescanner } = harness(scan);

    await rescanner.loadTicks();
    rescanner.setTicks({ ...rescanner.ticks(), once: ["mut"] });
    await rescanner.run();

    expect(rescanner.ticks().once).toEqual(["mut"]);

    scan.result = { status: "finished", exitCode: 0 };
    await rescanner.run();

    expect(scan.ran[1]?.sense).toContain("mut");
    expect(rescanner.ticks().once).toEqual([]);
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
    expect(rescanner.runView().record?.phase).toBe("stopped");
    expect(rescanner.runView().record?.gaps).toEqual([]);
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

    expect(rescanner.runView().record?.gaps).toEqual([GAP, OUTSIDE]);

    scan.emitRun({ kind: "run", run: record({ run_id: "cli-2" }) });
    await flush();

    expect(rescanner.runView().record).toMatchObject({
      run_id: "cli-2",
      phase: "running",
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
    expect(made.rescanner.runView().record?.run_id).toBe("run-2");
  });
});

describe("one fold of the run record", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const BEGAN = "2026-11-10T09:00:00.000Z";
  const ENDED = "2026-11-10T09:01:30.000Z";
  const ask = line({
    event: "confirm",
    phase: "describe",
    modules: 3,
    model: "sonnet",
    input_tokens: 12000,
    cost_usd: 9.5,
  });
  const preflightOk = line({ event: "preflight", state: "ok" });
  const logged = (exit: number) => line({ event: "summary", exit, log: LOG });

  const sequences: Record<
    string,
    {
      lines: string[];
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
        line({ event: "answered", phase: "describe", describe: true }),
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
      lines: [
        line({ event: "preflight", state: "run" }),
        line({ event: "preflight", state: "gaps", gaps: [] }),
        line({ event: "summary", exit: 4 }),
      ],
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
    const made = harness(scan);

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
      made.scan.emitRun({ kind: "line", line: one });

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
        const { sensing: _sensing, ...rest } = made.rescanner.progress();

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

    expect(log.filter((one) => one === "resense")).toHaveLength(2);
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
      steps: [current, preflightOk, line({ event: "summary", exit: 1 })],
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
      "Scan refused - 1 tool missing: coverage and pytest are not installed";

    expect(rust.lifecycle.map((one) => one.text)).toEqual([text]);

    const recorded = harness(
      fakeScan({
        defaults: { describe: false, sensors: true },
        steps: [
          line({ event: "preflight", state: "gaps", gaps: [] }),
          line({ event: "summary", exit: 4 }),
        ],
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
  const preflightOk = line({ event: "preflight", state: "ok" });
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
