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
      steps: [current, describing(1), entry("describe", "a.py", "no"), summary],
      result: {
        status: "finished",
        exitCode: 1,
        stderr: "",
        log: ".recognizer/cache/log/x-scan.json",
      },
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
        summary,
      ],
      result: {
        status: "finished",
        exitCode: 0,
        stderr: "",
        log: ".recognizer/cache/log/x-scan.json",
      },
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
        result: { status: "finished", exitCode: 0, stderr: "", log: null },
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
        result: { status: "failed", exitCode: 2, stderr: "bad flag\n" },
      }),
    );

    await failed.rescanner.run();

    expect(failed.log).toContain("blocked:bad flag");
  });

  it("shows the detail of a scan that ran nothing it was asked to run", async () => {
    const { log, updates, rescanner } = harness(
      fakeScan({
        result: {
          status: "nothing-ran",
          phases: ["sense"],
          detail: "sense did not run: the folder has no commit",
        },
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

    it("opens the ask and answers describe through the port once", async () => {
      const { rescanner, scan, updates } = await waiting();

      expect(texts(updates).at(-1)).toContain("Waiting for your answer");

      await rescanner.answerDescribe(true);
      await rescanner.answerDescribe(true);

      expect(scan.answers).toEqual([true]);
      expect(rescanner.progress().describeAsk).toBeNull();
      expect(rescanner.progress().describeSkipped).toBe(false);

      await rescanner.stop();
    });

    it("marks the describe phase skipped on a skip answer", async () => {
      const { rescanner, scan } = await waiting();

      await rescanner.answerDescribe(false);

      expect(scan.answers).toEqual([false]);
      expect(rescanner.progress().describeSkipped).toBe(true);

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
    const cli = {
      origin: "cli" as const,
      pid: 4242,
      startedAt: "2026-11-10T09:00:00.000Z",
      sensors: ["alpha", "mut"],
      describe: true,
    };
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    async function observed() {
      const made = harness();

      made.scan.emitExternal({ kind: "scan", scan: cli });
      made.scan.emitExternal({ kind: "line", line: describing(2) });
      made.scan.emitExternal({ kind: "line", line: sensing(2) });
      await flush();

      return made;
    }

    it("shows the scan's rows and progress under the command-line heading", async () => {
      const { rescanner, updates } = await observed();

      expect(rescanner.running()).toBe(true);
      expect(rescanner.external()).toBe(true);
      expect(rescanner.runState().running).toEqual([
        "describe",
        "alpha",
        "mut",
      ]);

      const latest = texts(updates).at(-1);

      expect(latest).toContain("Started from the command line:");
    });

    it("labels a scan started by another window", async () => {
      const made = harness();

      made.scan.emitExternal({
        kind: "scan",
        scan: { ...cli, origin: "app" },
      });
      await flush();

      expect(texts(made.updates).at(-1)).toContain(
        "Started in another window:",
      );
    });

    it("starts nothing and takes no side-effecting branch for its lines", async () => {
      const { rescanner, scan, posted, log } = await observed();

      await rescanner.run();
      scan.emitExternal({
        kind: "line",
        line: entry("sense", "alpha", "boom"),
      });
      await flush();

      expect(scan.ran).toEqual([]);
      expect(posted).toEqual([]);
      expect(log).not.toContain("described");
      expect(rescanner.runState().failures).toEqual({ alpha: "boom" });
    });

    it("leaves Running and reloads the results once when the marker goes", async () => {
      const { rescanner, scan, log, updates } = await observed();

      scan.emitExternal({ kind: "scan", scan: null });
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

      scan.emitExternal({ kind: "scan", scan: cli });
      await flush();

      expect(rescanner.progress()).toBe(before);
    });
  });
});

const GAP = {
  id: "crap:python:sensors:environment",
  line: "coverage and pytest are not installed",
  needs: ["mut"],
  project: { language: "python", directory: "sensors" },
  fix: {
    text: "uv sync",
    command: ["uv", "sync"],
    cwd: "sensors",
    env: {},
    kind: "repository" as const,
  },
};

const OUTSIDE = {
  ...GAP,
  id: "mutation:rust:root:cargo",
  line: "cargo-llvm-cov is not installed",
  project: null,
  fix: {
    ...GAP.fix,
    text: "cargo install cargo-llvm-cov",
    kind: "outside" as const,
  },
};

describe("scan notifications", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it("posts Scan started naming the sensors and scope, and Scan complete with its duration", async () => {
    const scan = fakeScan({
      defaults: { describe: true, sensors: true },
      steps: [extract, entry("extract", "python"), summary],
    });
    const { clock, made } = timed(scan);

    scan.onStep = (index) => {
      if (index === 1) {
        clock(192_000);
      }
    };
    await made.rescanner.run();

    expect(made.lifecycle).toEqual([
      {
        kind: "info",
        text: "Scan started - Alpha, Beta, describe, Whole repository",
      },
      { kind: "done", text: "Scan complete - 3m 12s" },
    ]);
  });

  it("reads seconds alone under a minute", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [extract, summary],
    });
    const { clock, made } = timed(scan);

    scan.onStep = (index) => {
      if (index === 0) {
        clock(45_000);
      }
    };
    await made.rescanner.run();

    expect(made.lifecycle.at(-1)).toEqual({
      kind: "done",
      text: "Scan complete - 45s",
    });
  });

  it("posts the failure with its reason and no Scan complete", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      result: {
        status: "failed",
        exitCode: 2,
        stderr: "boom",
        log: null,
      } as never,
    });
    const { made } = timed(scan);

    await made.rescanner.run();

    expect(made.lifecycle.map((one) => one.text)).toEqual([
      "Scan started - Alpha, Beta, Whole repository",
      "Scan failed - boom",
    ]);
  });

  it("posts a failed run that finished with exit 1 as Scan failed with the first failed entry", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [extract, entry("sense", "alpha", "no coverage"), summary],
      result: { status: "finished", exitCode: 1, stderr: "", log: null },
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

  it("posts the same start, completion, failure and refusal for a scan another process runs", async () => {
    const cli = {
      origin: "cli" as const,
      pid: 7,
      startedAt: new Date(1_000_000 - 90_000).toISOString(),
      sensors: ["alpha"],
      describe: true,
    };

    for (const [exit, expected] of [
      [0, { kind: "done", text: "Scan complete - 1m 30s" }],
      [1, { kind: "error", text: "Scan failed - recognizer scan exited 1" }],
      [
        4,
        {
          kind: "warning",
          text: "Scan refused - 1 tool missing: coverage and pytest are not installed",
        },
      ],
    ] as const) {
      const made = harness(fakeScan(), { now: () => 1_000_000 });

      made.scan.emitExternal({ kind: "scan", scan: cli });
      await flush();

      if (exit === 4) {
        made.scan.emitExternal({
          kind: "line",
          line: line({ event: "preflight", state: "gaps", gaps: [GAP] }),
        });
      }

      made.scan.emitExternal({
        kind: "line",
        line: line({ event: "summary", exit }),
      });
      await flush();

      expect(made.lifecycle).toEqual([
        { kind: "info", text: "Scan started - alpha, describe" },
        expected,
      ]);
    }
  });
});

describe("the preflight flow", () => {
  const gapsResult = {
    status: "gaps" as const,
    gaps: [GAP, OUTSIDE],
  };

  async function refused() {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      result: gapsResult,
    });
    const made = harness(scan);

    await made.rescanner.run();

    return { ...made, scan };
  }

  it("is running while the scan starts and idle once preflight passes", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [
        line({ event: "preflight", state: "run" }),
        line({ event: "preflight", state: "ok" }),
        extract,
        summary,
      ],
    });
    const made = harness(scan);
    const seen: string[] = [];

    made.scan.onStep = () => seen.push(made.rescanner.preflight().state);
    await made.rescanner.run();

    expect(seen.slice(0, 2)).toEqual(["running", "idle"]);
    expect(made.updates[0]?.preflight?.state).toBe("running");
    expect(made.rescanner.preflight().state).toBe("idle");
  });

  it("holds the gaps of a refused scan, unfixed, with no blocked message", async () => {
    const { rescanner, log } = await refused();

    expect(rescanner.preflight()).toEqual({
      state: "gaps",
      gaps: [
        { gap: GAP, fixed: false, failure: null },
        { gap: OUTSIDE, fixed: false, failure: null },
      ],
    });
    expect(log.some((one) => one.startsWith("blocked:"))).toBe(false);
    expect(rescanner.running()).toBe(false);
  });

  it("calls fix(id) once and marks the gap fixed", async () => {
    const { rescanner, scan } = await refused();

    await rescanner.fix(GAP.id);
    await rescanner.fix(GAP.id);

    expect(scan.fixed).toEqual([GAP.id]);
    expect(rescanner.preflight().gaps[0]).toMatchObject({
      fixed: true,
      failure: null,
    });
  });

  it("keeps a gap open with the failure when its fix fails", async () => {
    const { rescanner, scan } = await refused();

    scan.fixFailures[GAP.id] = "uv: no network";
    await rescanner.fix(GAP.id);

    expect(rescanner.preflight().gaps[0]).toMatchObject({
      fixed: false,
      failure: "uv: no network",
    });
  });

  it("marks an outside gap installed without calling fix", async () => {
    const { rescanner, scan } = await refused();

    rescanner.installed(OUTSIDE.id);

    expect(scan.fixed).toEqual([]);
    expect(rescanner.preflight().gaps[1]?.fixed).toBe(true);
  });

  it("keeps a once-ticked sensor ticked after a refusal so Check again and run includes it", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      result: gapsResult,
    });
    const { rescanner } = harness(scan);

    await rescanner.loadTicks();
    rescanner.setTicks({ ...rescanner.ticks(), once: ["mut"] });
    await rescanner.run();

    expect(rescanner.ticks().once).toEqual(["mut"]);

    scan.result = { status: "finished", exitCode: 0, stderr: "", log: null };
    await rescanner.run();

    expect(scan.ran[1]?.sense).toContain("mut");
    expect(rescanner.ticks().once).toEqual([]);
    expect(rescanner.preflight().state).toBe("idle");
  });

  it("returns to idle with no gaps when the user stops the scan", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: true },
      steps: [new Promise<void>(() => {})],
    });
    const { rescanner } = harness(scan);
    const running = rescanner.run();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rescanner.preflight().state).toBe("running");
    await rescanner.stop();
    await running;

    expect(rescanner.preflight()).toEqual({ state: "idle", gaps: [] });
  });
});
