import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanOutcome } from "@recognizer/core";
import { describe, expect, it, vi } from "vitest";
import { StoreAdapter } from "../src/adapters/filesystem/store-adapter.js";
import { GitAdapter } from "../src/adapters/git/git-adapter.js";
import { DescriberAdapter } from "../src/adapters/plugins/describer-adapter.js";
import { ProcessAdapter } from "../src/adapters/plugins/process-adapter.js";
import {
  ScannersAdapter,
  SyncScannersAdapter,
} from "../src/adapters/plugins/scanners-adapter.js";
import { SensorsAdapter } from "../src/adapters/plugins/sensors-adapter.js";
import { ClockAdapter } from "../src/adapters/system/clock-adapter.js";
import { ConfirmAdapter } from "../src/adapters/terminal/confirm-adapter.js";
import { InputError } from "../src/errors.js";
import { runScan, runScanSync } from "../src/scan-command.js";
import { scanPorts, syncScanPorts } from "../src/scan-container.js";
import { exitOf } from "../src/scan-main.js";
import { REPO } from "./helpers.js";
import { fakeIo, PYTHON, ROOT, scanJson } from "./scan-helpers.js";

const COMMIT = "abc123";
const HASH = "0".repeat(64);
const SOURCE = readFileSync(
  join(REPO, "fixtures/duplication/sample/app/pricing.py"),
  "utf8",
);

function document(): string {
  return scanJson(0, 0, {
    commit: COMMIT,
    modified: false,
    files: [{ path: "app/pricing.py", hash: HASH }],
    modules: [
      { id: "app/pricing.py", language: "python", kind: "module", members: [] },
    ],
  });
}

describe("scan container", () => {
  it("the container wires one real adapter per port", () => {
    const { io } = fakeIo({ commit: COMMIT, files: {} });
    const ports = scanPorts(io, "all");

    expect(ports.scanners).toBeInstanceOf(ScannersAdapter);
    expect(ports.sensors).toBeInstanceOf(SensorsAdapter);
    expect(ports.analysis).toBe(ports.sensors);
    expect(ports.describer).toBeInstanceOf(DescriberAdapter);
    expect(ports.git).toBeInstanceOf(GitAdapter);
    expect(ports.store).toBeInstanceOf(StoreAdapter);
    expect(ports.confirm).toBeInstanceOf(ConfirmAdapter);
    expect(ports.clock).toBeInstanceOf(ClockAdapter);
    expect(ports.process).toBeInstanceOf(ProcessAdapter);
    expect(Object.keys(ports).sort()).toEqual([
      "analysis",
      "clock",
      "confirm",
      "describer",
      "git",
      "process",
      "scanners",
      "sensors",
      "store",
    ]);
    expect(syncScanPorts(io, "all").scanners).toBeInstanceOf(
      SyncScannersAdapter,
    );
  });

  it("runScan delegates to the scan adapter", async () => {
    vi.resetModules();
    vi.doMock("../src/scan-main.js", () => ({
      scanMain: vi.fn(async () => 7),
      scanSyncMain: vi.fn(() => 9),
    }));

    const delegated = await import("../src/scan-command.js");
    const { io } = fakeIo({ commit: COMMIT, files: {} });

    expect(await delegated.runScan(["--extract"], io)).toBe(7);

    vi.doUnmock("../src/scan-main.js");
    vi.resetModules();
  });

  it("runScanSync delegates to scanSync", () => {
    const cache = `${ROOT}/.recognizer/cache/scan.python.json`;
    const fake = fakeIo({
      commit: COMMIT,
      files: { [`${ROOT}/app/pricing.py`]: SOURCE, [cache]: document() },
      scanners: { [PYTHON]: { output: document() } },
    });

    expect(runScanSync([ROOT, "--extract"], fake.io, "all")).toBe(0);
    expect(typeof runScan).toBe("function");
  });

  it("outcomes map to exit codes", () => {
    const cases: [ScanOutcome, number][] = [
      [{ status: "finished" }, 0],
      [{ status: "failed", reason: "phases" }, 1],
      [{ status: "refused", reason: "lock" }, 3],
      [{ status: "refused", reason: "preflight", gaps: [] }, 4],
    ];

    for (const [outcome, exit] of cases) {
      expect(exitOf(outcome)).toBe(exit);
    }

    expect(() =>
      exitOf({
        status: "failed",
        reason: "invalid-request",
        messages: ["bad request"],
      }),
    ).toThrow(InputError);

    const crash = new Error("boom");

    expect(() =>
      exitOf({ status: "failed", reason: "crashed", error: crash }),
    ).toThrow(crash);
  });
});
