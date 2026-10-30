import { describe, expect, it } from "vitest";
import type { ScanOrigin } from "./footer-scan";
import { createRescanner, type RescanPorts } from "./rescanner";
import type { Loaded } from "./scan-loading";
import type { ScanReport } from "./scan-report";

const ORIGIN: ScanOrigin = { branch: "main", commit: "a1b2c3d" };
const OK: Loaded = {
  modules: ["a.py"],
  scans: [],
  policy: null,
  baseline: null,
  notices: [],
  blocking: null,
};
const REPORT: ScanReport = {
  status: "scanned",
  exitCode: 0,
  stderr: "",
  scans: [],
  policy: null,
};

function harness(over: Partial<RescanPorts<string>> = {}) {
  const log: string[] = [];
  const ports: RescanPorts<string> = {
    scan: async () => {
      log.push("scan");

      return REPORT;
    },
    load: () => OK,
    adopt: async () => {
      log.push("adopt");

      return ORIGIN;
    },
    carry: () => {
      log.push("carry");

      return "carried";
    },
    replace: (_loaded, carried) => log.push(`replace:${carried}`),
    running: (on) => log.push(`running:${on}`),
    adopted: (origin) => log.push(`adopted:${origin.commit}`),
    notify: (text) => log.push(`notify:${text}`),
    ...over,
  };

  return { log, rescanner: createRescanner(ports) };
}

describe("createRescanner", () => {
  it("scans, carries, adopts, then replaces the explorer with the carried state", async () => {
    const { log, rescanner } = harness();

    await rescanner.run();

    expect(log).toEqual([
      "running:true",
      "scan",
      "carry",
      "adopt",
      "notify:",
      "adopted:a1b2c3d",
      "replace:carried",
      "running:false",
    ]);
  });

  it("keeps the old explorer and does not adopt when the scan throws", async () => {
    const { log, rescanner } = harness({
      scan: async () => {
        throw new Error("boom");
      },
    });

    await rescanner.run();

    expect(log).toEqual([
      "running:true",
      "notify:Rescan failed: Error: boom",
      "running:false",
    ]);
  });

  it("keeps the old explorer and does not adopt when the viewer refuses the scan", async () => {
    const { log, rescanner } = harness({
      load: () => ({ ...OK, blocking: "schema_version 9" }),
    });

    await rescanner.run();

    expect(log).toContain("notify:Rescan failed: schema_version 9");
    expect(log).not.toContain("adopt");
    expect(log.some((entry) => entry.startsWith("replace"))).toBe(false);
  });

  it("keeps the old explorer when adopting fails", async () => {
    const { log, rescanner } = harness({
      adopt: async () => {
        throw new Error("no baseline");
      },
    });

    await rescanner.run();

    expect(log.some((entry) => entry.startsWith("replace"))).toBe(false);
    expect(log).toContain("notify:Rescan failed: Error: no baseline");
  });

  it("does nothing while a rescan is running", async () => {
    let release: () => void = () => {};
    const { log, rescanner } = harness({
      scan: () =>
        new Promise<ScanReport>((resolve) => {
          log.push("scan");
          release = () => resolve(REPORT);
        }),
    });

    const first = rescanner.run();

    await rescanner.run();
    release();
    await first;

    expect(log.filter((entry) => entry === "scan")).toHaveLength(1);
  });
});
