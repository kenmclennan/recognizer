import type { ScanOutcome } from "@recognizer/core";
import { describe, expect, it, vi } from "vitest";
import { ConfigAdapter } from "../src/adapters/filesystem/config-adapter.js";
import { FindingsAdapter } from "../src/adapters/filesystem/findings-adapter.js";
import { PolicyAdapter } from "../src/adapters/filesystem/policy-adapter.js";
import { RunLogAdapter } from "../src/adapters/filesystem/run-log-adapter.js";
import { ScanLockAdapter } from "../src/adapters/filesystem/scan-lock-adapter.js";
import { StructureAdapter } from "../src/adapters/filesystem/structure-adapter.js";
import { GitAdapter } from "../src/adapters/git/git-adapter.js";
import { DescriberAdapter } from "../src/adapters/plugins/describer-adapter.js";
import { ProcessAdapter } from "../src/adapters/plugins/process-adapter.js";
import {
  ScannersAdapter,
  SyncScannersAdapter,
} from "../src/adapters/plugins/scanners-adapter.js";
import { SensorsAdapter } from "../src/adapters/plugins/sensors-adapter.js";
import { TestReportsAdapter } from "../src/adapters/plugins/test-reports-adapter.js";
import { ClockAdapter } from "../src/adapters/system/clock-adapter.js";
import { ConfirmAdapter } from "../src/adapters/terminal/confirm-adapter.js";
import { InputError } from "../src/errors.js";
import { runScan, runScanSync } from "../src/scan-command.js";
import { scanPorts, syncScanPorts } from "../src/scan-container.js";
import { exitOf } from "../src/scan-main.js";
import {
  committedScan,
  FakeIo,
  typescriptScanner,
  typescriptScenario,
} from "./support/index.js";

describe("scan container", () => {
  it("the container wires one real adapter per port", () => {
    const { io } = typescriptScenario().root;
    const ports = scanPorts(io, "all");

    expect(ports.scanners).toBeInstanceOf(ScannersAdapter);
    expect(ports.sensors).toBeInstanceOf(SensorsAdapter);
    expect(ports.analysis).toBe(ports.sensors);
    expect(ports.describer).toBeInstanceOf(DescriberAdapter);
    expect(ports.git).toBeInstanceOf(GitAdapter);
    expect(ports.structure).toBeInstanceOf(StructureAdapter);
    expect(ports.findings).toBeInstanceOf(FindingsAdapter);
    expect(ports.policy).toBeInstanceOf(PolicyAdapter);
    expect(ports.config).toBeInstanceOf(ConfigAdapter);
    expect(ports.runLog).toBeInstanceOf(RunLogAdapter);
    expect(ports.lock).toBeInstanceOf(ScanLockAdapter);
    expect(ports.confirm).toBeInstanceOf(ConfirmAdapter);
    expect(ports.clock).toBeInstanceOf(ClockAdapter);
    expect(ports.process).toBeInstanceOf(ProcessAdapter);
    expect(ports.testReports).toBeInstanceOf(TestReportsAdapter);
    expect(Object.keys(ports).sort()).toEqual([
      "analysis",
      "catalog",
      "clock",
      "config",
      "confirm",
      "describer",
      "digest",
      "files",
      "findings",
      "git",
      "grammarRules",
      "languages",
      "lock",
      "parsing",
      "policy",
      "process",
      "responsibilities",
      "runLog",
      "scanners",
      "sensors",
      "source",
      "structure",
      "testReports",
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
    const io = new FakeIo();

    expect(await delegated.runScan(["--extract"], io)).toBe(7);

    vi.doUnmock("../src/scan-main.js");
    vi.resetModules();
  });

  it("runScanSync delegates to scanSync", () => {
    const asynchronous = typescriptScanner();
    const { root, repository } = typescriptScenario({
      programs: {
        "recognizer-scan-typescript": (call) => {
          const output = call.args[call.args.indexOf("--output") + 1];

          if (call.args[0] !== "run" || output === undefined) {
            return asynchronous(call);
          }

          call.files.writeFile(output, JSON.stringify(committedScan()));

          return { started: true, status: 0, stdout: "", stderr: "" };
        },
      },
    });

    expect(runScanSync([repository, "--extract"], root.io, "all")).toBe(0);
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
