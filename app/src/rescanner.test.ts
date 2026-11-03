import { describe, expect, it } from "vitest";
import type { ScanOrigin } from "./footer-scan";
import type { MessageAction, MessageInput } from "./message-tray";
import {
  createRescanner,
  type ProgressUpdate,
  type RescanPorts,
} from "./rescanner";
import { fakeScan } from "./scan-fake";
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
    adopted: (origin) => log.push(`adopted:${origin.commit}`),
    describedLine: () => log.push("described"),
    progress: (update) => {
      updates.push(update);
    },
    settled: () => log.push("settled"),
    blocked: (text) => log.push(`blocked:${text}`),
    post: (input) => {
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

    expect(scan.ran).toEqual([{ describe: true, sense: ["alpha", "beta"] }]);
    expect(scan.written).toEqual([
      {
        describe: true,
        ticked: ["alpha", "beta"],
      },
    ]);

    await rescanner.run();

    expect(scan.written).toHaveLength(1);
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
    expect(texts(updates)).toContain("Scanning\u2026 Descriptions, 1 of 1");
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

    await new Promise((resolve) => setTimeout(resolve, 10));
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
      rescanner.setTicks({ ...rescanner.ticks(), once: ["mut"] });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await rescanner.run();

      expect(scan.ran[0].sense).toContain("mut");
      expect(scan.written.every((one) => !one.ticked.includes("mut"))).toBe(
        true,
      );
      expect(rescanner.ticks().once).toEqual([]);
    }
  });

  it("clears once when the Scan fails or is stopped", async () => {
    for (const result of [
      { status: "failed" as const, exitCode: 1, stderr: "boom" },
      { status: "stopped" as const },
    ]) {
      const scan = fakeScan({ result });
      const { rescanner } = harness(scan);

      await rescanner.loadTicks();
      rescanner.setTicks({ ...rescanner.ticks(), once: ["mut"] });
      await rescanner.run();

      expect(rescanner.ticks().once).toEqual([]);
    }
  });

  it("writes the ticks through the port when they change", async () => {
    const scan = fakeScan();
    const { rescanner } = harness(scan);

    await rescanner.loadTicks();
    rescanner.setTicks({ describe: true, ticked: null, once: [] });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(scan.written).toEqual([
      { describe: true, ticked: ["alpha", "beta"] },
    ]);
    expect(rescanner.ticks()).toEqual({
      describe: true,
      ticked: null,
      once: [],
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
});
