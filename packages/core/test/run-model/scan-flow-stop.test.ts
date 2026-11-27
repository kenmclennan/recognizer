import { describe, expect, it } from "vitest";
import {
  type ExtractResult,
  type RunningScan,
  type ScanRequest,
  scanSync,
} from "../../src/index.js";
import { createFakes, scanOver } from "../fakes/container.js";

const REPOSITORY = "/work/repository";

function request(overrides: Partial<ScanRequest> = {}): ScanRequest {
  return {
    repository: REPOSITORY,
    mode: "full",
    sensors: null,
    describe: false,
    analysis: true,
    ignoreRetiredConfig: false,
    invocation: ["scan"],
    ...overrides,
  };
}

function world() {
  const fakes = createFakes();

  fakes.scanners.languages.set("alpha", { modules: 3, edges: 2, fails: false });
  fakes.sensors.installed.set("tally", {
    name: "tally",
    runsTests: false,
    held: true,
  });

  return fakes;
}

async function drain(scan: RunningScan) {
  for await (const _event of scan.events) {
  }

  return scan.outcome;
}

describe("a stopped scan's run log", () => {
  it("the_run_log_opens_at_the_time_the_lock_was_taken", async () => {
    const fakes = world();

    fakes.lock.startedAt = 1_000;
    fakes.clock.advance(-500);

    await drain(scanOver(fakes).start(request()));

    expect(fakes.runLog.runLogs).toHaveLength(1);
    expect(fakes.runLog.runLogs[0]?.startedAt).toBe(1_000);
  });

  it("the_run_log_opens_with_the_lock_s_run_id", async () => {
    const fakes = world();

    fakes.lock.runId = "run-9";

    await drain(scanOver(fakes).start(request()));

    expect(fakes.runLog.runLogs).toHaveLength(1);
    expect(fakes.runLog.runLogs[0]?.runId).toBe("run-9");
  });

  it("with_no_lock_held_the_run_log_has_no_run_id", () => {
    const fakes = world();
    const scanners = {
      discover: () => fakes.scanners.discover(),
      detect: (root: string, named: string[]) =>
        fakes.scanners.detect(root, named),
      decide: (root: string, force: boolean, commit: string, dirty: boolean) =>
        fakes.scanners.decide(root, force, commit, dirty),
      cachedLanguages: (root: string) => fakes.scanners.cachedLanguages(root),
      readCached: (root: string, language: string) =>
        fakes.scanners.readCached(root, language),
      scanFile: (root: string, language: string) =>
        fakes.scanners.scanFile(root, language),
      previousProtocolNote: (language: string) =>
        fakes.scanners.previousProtocolNote(language),
      extract: (call: { language: string }): ExtractResult => ({
        ok: false,
        entry: {
          name: call.language,
          command: [],
          status: 1,
          outcome: "failed",
          duration_ms: 1,
          stderr: "",
        },
      }),
    };

    scanSync(request(), { ...fakes, scanners } as never, () => {});

    expect(fakes.runLog.runLogs).toHaveLength(1);
    expect(fakes.runLog.runLogs[0]?.runId).toBeUndefined();
  });

  it("a_stopped_scan_stops_its_run_log", async () => {
    const fakes = world();
    const scan = scanOver(fakes).start(
      request({ sensors: [{ name: "tally" }] }),
    );
    const drained = drain(scan);

    await fakes.sensors.started;
    await scan.stop();

    expect(await drained).toEqual({ status: "stopped" });
    expect(fakes.runLog.runLogs).toHaveLength(1);
    expect(fakes.runLog.runLogs[0]).toMatchObject({
      ended: "stop",
      stops: 1,
      finishes: 0,
    });
  });

  it("a_stop_after_a_failed_entry_is_still_stopped", async () => {
    const fakes = world();

    fakes.scanners.languages.set("alpha", {
      modules: 3,
      edges: 2,
      fails: true,
    });

    const scan = scanOver(fakes).start(
      request({ sensors: [{ name: "tally" }] }),
    );
    const drained = drain(scan);

    await fakes.sensors.started;
    await scan.stop();

    expect(await drained).toEqual({ status: "stopped" });
    expect(fakes.runLog.runLogs[0]).toMatchObject({ ended: "stop", stops: 1 });
  });

  it("a_describer_halt_stops_its_run_log", async () => {
    const fakes = world();

    fakes.describer.registered = true;

    const scan = scanOver(fakes).start(request({ describe: "all" }));

    fakes.describer.requestDocument = (one) => {
      void scan.stop();

      return one;
    };

    expect(await drain(scan)).toEqual({ status: "stopped" });
    expect(fakes.describer.started.length).toBeGreaterThan(0);
    expect(fakes.runLog.runLogs[0]).toMatchObject({
      ended: "stop",
      stops: 1,
      finishes: 0,
    });
    expect(
      fakes.runLog.runLogs[0]?.phases.some(({ phase }) => phase === "extract"),
    ).toBe(true);
  });

  it("a_describer_usage_limit_halt_stops_the_scan_run_log", async () => {
    const fakes = world();

    fakes.describer.registered = true;
    fakes.describer.results.get = () => ({ status: 75, stdout: "" });

    const outcome = await drain(
      scanOver(fakes).start(request({ describe: "all" })),
    );

    expect(outcome).toEqual({ status: "failed", reason: "phases" });
    expect(fakes.runLog.runLogs[0]).toMatchObject({
      ended: "stop",
      stops: 1,
      finishes: 0,
    });
  });

  it("a_stop_during_a_crash_stops_its_run_log", async () => {
    const fakes = world();
    const scan = scanOver(fakes).start(
      request({ sensors: [{ name: "tally" }] }),
    );

    fakes.scanners.extract = async () => {
      void scan.stop();

      throw new Error("boom");
    };

    expect(await drain(scan)).toEqual({ status: "stopped" });
    expect(fakes.runLog.runLogs[0]).toMatchObject({
      ended: "stop",
      stops: 1,
      finishes: 0,
    });
  });

  it("a_crash_without_a_stop_still_finishes_its_run_log_failed", async () => {
    const fakes = world();
    const scan = scanOver(fakes).start(
      request({ sensors: [{ name: "tally" }] }),
    );

    fakes.scanners.extract = async () => {
      throw new Error("boom");
    };

    expect(await drain(scan)).toMatchObject({
      status: "failed",
      reason: "crashed",
    });
    expect(fakes.runLog.runLogs[0]).toMatchObject({
      ended: "finish",
      failed: true,
      stops: 0,
    });
  });
});
