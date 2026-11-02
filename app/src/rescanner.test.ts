import { describe, expect, it } from "vitest";
import type { ScanOrigin } from "./footer-scan";
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
  folderMetrics: [],
  distanceThreshold: 0.3,
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
  const ports: RescanPorts<string> = {
    port: scan,
    registered: async () => ({
      names: ["alpha", "beta"],
      testing: [],
      overlays: ["cov", "mut"],
      describer: true,
    }),
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
    notify: (text) => log.push(`notify:${text}`),
    ...over,
  };

  return { log, updates, scan, rescanner: createRescanner(ports) };
}

const texts = (updates: ProgressUpdate[]) =>
  updates.map((update) => update.footer?.text ?? null);

describe("createRescanner", () => {
  it("builds the plan from the remembered ticks and remembers a repository's first ticks", async () => {
    const scan = fakeScan({ defaults: { describe: true, sensors: true } });
    const { rescanner } = harness(scan);

    await rescanner.run();

    expect(scan.ran).toEqual([
      { describe: true, measure: [], sense: ["alpha", "beta"] },
    ]);
    expect(scan.written).toEqual([
      {
        describe: true,
        measure: false,
        overlays: ["cov", "mut"],
        sensors: true,
        ticked: ["alpha", "beta"],
      },
    ]);

    await rescanner.run();

    expect(scan.written).toHaveLength(1);
  });

  it("renders the canvas when extraction settles, before describe and sense run", async () => {
    const scan = fakeScan({
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
    expect(texts(updates)).toContain("Extracting");
    expect(texts(updates)).toContain("Describing 0 of 1");
    expect(updates.at(-1)?.footer?.text).toBe(
      "Scan done - extracted, described 1",
    );
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
    expect(Object.keys(rescanner.runState().ranAt)).toEqual(["alpha"]);
    expect(rescanner.runState().running).toEqual([]);
  });

  it("tracks the measure phase, re-reading overlays as each reports, and holds a failure until the next settle", async () => {
    const scan = fakeScan({
      defaults: { describe: false, sensors: false },
      steps: [
        current,
        line({ event: "phase", phase: "measure", total: 2 }),
        entry("measure", "cov"),
        entry("measure", "mut", "boom"),
        summary,
      ],
    });
    const { log, rescanner } = harness(scan);
    const seen: string[][] = [];

    await rescanner.loadTicks();
    rescanner.setTicks({ ...rescanner.ticks(), measure: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    scan.onStep = (index) => {
      if (index === 1 || index === 2) {
        seen.push(rescanner.measureRunState().running);
      }
    };

    await rescanner.run();

    expect(scan.ran[0].measure).toEqual(["cov", "mut"]);
    expect(log.filter((entry) => entry === "resense")).toHaveLength(3);
    expect(seen).toEqual([["cov", "mut"], ["mut"]]);
    expect(rescanner.measureRunState().failures).toEqual({ mut: "boom" });
    expect(Object.keys(rescanner.measureRunState().ranAt)).toEqual(["cov"]);
    expect(rescanner.measureRunState().running).toEqual([]);
    expect(rescanner.runState().failures).toEqual({});
  });

  it("hands the log path to the final update and offers Show for a failed module", async () => {
    const scan = fakeScan({
      steps: [current, describing(1), entry("describe", "a.py", "no"), summary],
      result: {
        status: "finished",
        exitCode: 1,
        stderr: "",
        log: ".recognizer/cache/log/x-scan.json",
      },
    });
    const { updates, rescanner } = harness(scan);

    await rescanner.run();

    const last = updates.at(-1);

    expect(last?.footer?.text).toBe("Describe failed: no");
    expect(last?.log).toBe(".recognizer/cache/log/x-scan.json");
    expect(last?.target).toEqual({ kind: "module", id: "a.py", reason: "no" });
  });

  it("says Stopped, keeps what was written and settles after a stop", async () => {
    const gate = new Promise<void>(() => {});
    const scan = fakeScan({ steps: [current, describing(2), gate] });
    const { log, updates, rescanner } = harness(scan);
    const running = rescanner.run();

    await new Promise((resolve) => setTimeout(resolve, 10));
    await rescanner.stop();
    await running;

    expect(updates.at(-1)?.footer?.text).toBe(
      "Stopped - scans current, described 0",
    );
    expect(log).toContain("settled");
    expect(rescanner.running()).toBe(false);
  });

  it("reports a command that is missing or failed as blocked and clears the footer", async () => {
    const missing = harness(
      fakeScan({ result: { status: "command-missing", hint: "install it" } }),
    );

    await missing.rescanner.run();

    expect(missing.log).toContain("blocked:install it");
    expect(missing.updates.at(-1)?.footer).toBeNull();

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

  it("never writes a test-running overlay and clears once after every Scan however it ends", async () => {
    for (const steps of [
      [current, summary],
      [current, "not json at all"],
    ]) {
      const scan = fakeScan({ steps });
      const { rescanner } = harness(scan, {
        registered: async () => ({
          names: ["alpha", "beta"],
          testing: ["mut"],
          overlays: ["cov", "mut"],
          describer: true,
        }),
      });

      await rescanner.loadTicks();
      rescanner.setTicks({
        ...rescanner.ticks(),
        measure: true,
        once: ["mut"],
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await rescanner.run();

      expect(scan.ran[0].measure).toEqual(["cov", "mut"]);
      expect(scan.written.every((one) => !one.overlays.includes("mut"))).toBe(
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
    rescanner.setTicks({
      describe: true,
      measure: false,
      overlays: null,
      sensors: false,
      ticked: null,
      once: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(scan.written).toEqual([
      {
        describe: true,
        measure: false,
        overlays: ["cov", "mut"],
        sensors: false,
        ticked: ["alpha", "beta"],
      },
    ]);
    expect(rescanner.ticks()).toEqual({
      describe: true,
      measure: false,
      overlays: null,
      sensors: false,
      ticked: null,
      once: [],
    });
  });
});
