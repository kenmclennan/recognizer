import { describe, expect, it } from "vitest";
import {
  type ExtractCall,
  type ExtractResult,
  type ScanEvent,
  type ScanRequest,
  type SyncScanners,
  scanSync,
} from "../src/index.js";
import { createFakes } from "./fakes/container.js";
import { repositoryOf } from "./fakes/repository-of.js";

const REPOSITORY = "/work/repository";

function request(overrides: Partial<ScanRequest> = {}): ScanRequest {
  return {
    repository: REPOSITORY,
    mode: "full",
    describe: false,
    sensors: null,
    analysis: true,
    ignoreRetiredConfig: false,
    invocation: [],
    ...overrides,
  };
}

function syncOver(fakes: ReturnType<typeof createFakes>) {
  const extracted: ExtractCall[] = [];
  const scanners: SyncScanners = {
    discover: () => fakes.scanners.discover(),
    installedPlugins: () => fakes.scanners.installedPlugins(),
    detect: (root, named) => fakes.scanners.detect(root, named),
    decide: (root, force, commit, dirty) =>
      fakes.scanners.decide(root, force, commit, dirty),
    cachedLanguages: (root) => fakes.scanners.cachedLanguages(root),
    readCached: (root, language) => fakes.scanners.readCached(root, language),
    scanFile: (root, language) => fakes.scanners.scanFile(root, language),
    previousProtocolNote: (language) =>
      fakes.scanners.previousProtocolNote(language),
    extract: (call): ExtractResult => {
      const scanned = repositoryOf({ a: "", b: "", c: "" }, [], call.language);

      extracted.push(call);
      fakes.structure.save(call.root, call.language, scanned);
      fakes.scanners.cachedAt.set(call.language, call.commit ?? "");

      return {
        ok: true,
        entry: {
          name: call.language,
          command: [],
          status: 0,
          outcome: "ok",
          duration_ms: 1,
          stderr: "",
        },
        repository: scanned,
        modules: 3,
        edges: 2,
      };
    },
  };

  return { ports: { ...fakes, scanners }, extracted };
}

describe("scanSync", () => {
  it("scanSync extracts and analyses without parsers", () => {
    const fakes = createFakes();

    fakes.scanners.languages.set("python", {
      modules: 3,
      edges: 2,
      fails: false,
    });
    fakes.config.readsSensorConfig = () => true;
    fakes.analysis.analysis = { enabled: true };

    const { ports, extracted } = syncOver(fakes);
    const events: ScanEvent[] = [];
    const outcome = scanSync(request(), ports, (event) => events.push(event));

    expect(outcome).toEqual({ status: "finished" });
    expect(extracted.map((call) => call.language)).toEqual(["python"]);
    expect(
      events.filter((event) => event.type === "entry").length,
    ).toBeGreaterThan(0);
    expect(events.filter((event) => event.type === "analysis")).toContainEqual({
      type: "analysis",
      state: "done",
      files: 3,
    });
    expect(fakes.parsing.loaded).toEqual([]);
    expect(fakes.findings.overlays).toEqual([]);
  });

  it("a synchronous scan refuses to describe", () => {
    const fakes = createFakes();

    fakes.scanners.languages.set("python", {
      modules: 3,
      edges: 2,
      fails: false,
    });
    fakes.describer.registered = true;

    const { ports } = syncOver(fakes);
    const outcome = scanSync(request({ describe: "stale" }), ports, () => {});

    expect(outcome.status).toBe("failed");
    expect(
      outcome.status === "failed" && outcome.reason === "crashed"
        ? (outcome.error as Error).message
        : null,
    ).toBe("a synchronous scan cannot describe or sense");
  });
});

describe("scanSync run log start", () => {
  it("with_no_lock_held_the_run_log_keeps_the_flow_start", () => {
    const fakes = createFakes();

    fakes.scanners.languages.set("python", {
      modules: 3,
      edges: 2,
      fails: false,
    });
    fakes.config.readsSensorConfig = () => true;
    fakes.analysis.analysis = { enabled: true };
    fakes.lock.startedAt = 9_999;

    const { ports } = syncOver(fakes);
    const before = fakes.clock.now();

    scanSync(request(), ports, () => {});

    expect(fakes.runLog.runLogs).toHaveLength(1);
    expect(fakes.runLog.runLogs[0]?.startedAt).toBe(before);
  });
});
