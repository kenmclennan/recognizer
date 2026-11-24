import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createScan,
  type HistoricalPorts,
  Limiter,
  listRenamesSince,
  MemoisedComparisons,
  type PlanRequest,
  type RunningScan,
  rangeMembers,
  readChangeRange,
  readViewAuthor,
  requestFaults,
  type Scan,
  scansAtCommit,
  testsHashOf,
  View,
  type ViewFields,
} from "@recognizer/core";
import { ScanCacheAdapter } from "../adapters/filesystem/scan-cache-adapter.js";
import { SourceFilesAdapter } from "../adapters/filesystem/source-files-adapter.js";
import {
  parseViewFile,
  serialiseView,
} from "../adapters/filesystem/view-translator.js";
import { GitAdapter } from "../adapters/git/git-adapter.js";
import { TestReportsAdapter } from "../adapters/plugins/test-reports-adapter.js";
import { ClockAdapter } from "../adapters/system/clock-adapter.js";
import { DigestAdapter } from "../adapters/system/digest-adapter.js";
import { ScratchAdapter } from "../adapters/system/scratch-adapter.js";
import { type Io, nodeIo } from "../cli.js";
import { describingFor } from "../describing-container.js";
import { errorText } from "../errors.js";
import { scanPorts } from "../scan-container.js";
import {
  ANSWER_FILE,
  answerPath,
  markerPath,
  readRun,
  refusalText,
  STARTED_BY_VARIABLE,
} from "../scan-marker.js";
import { liveScopes, processScope, StopScope } from "../stop-scope.js";
import { type ScopeFiles, writeScopeFiles } from "./scan-files.js";
import { sensorWork } from "./sensor-work.js";
import {
  parseSetup,
  runSetupAction,
  type SetupStopControl,
  stopControl,
} from "./setup-run.js";
import { parseStart, withFiles } from "./start-request.js";
import {
  SIGNAL_BACKSTOP_MS,
  type Signals,
  type StopOwner,
  stopMarkerProcess,
  systemSignals,
} from "./stop-by-repository.js";
import { isActive, newWatchState, pollInterval, watchTick } from "./watch.js";
import {
  ArgsError,
  knownHashes,
  type Request,
  text,
  textList,
  wireOutcome,
} from "./wire.js";

const STALE_SCRATCH_MS = 60 * 60 * 1000;
const MAX_HISTORICAL_SCANS = 4;

export interface ServiceOptions {
  write(message: unknown): void;
  signals?: Signals;
  backstopMs?: number;
  base?: () => Io;
}

interface Started {
  repository: string;
  scope: StopScope;
  running: RunningScan;
}

function quiet(io: Io): Io {
  return Object.assign(Object.create(io) as Io, {
    env: (name: string) =>
      name === STARTED_BY_VARIABLE ? "app" : process.env[name],
    stdout: (chunk: string) => io.stderr(chunk),
  });
}

export class Service {
  private readonly started = new Map<string, Started>();
  private readonly watches = new Map<string, () => void>();
  private readonly setups = new Map<string, SetupStopControl>();
  private readonly signals: Signals;
  private readonly backstopMs: number;
  private readonly shared: Io;
  private readonly planner: Scan;
  private readonly historical: HistoricalPorts;
  private counter = 0;

  constructor(private readonly options: ServiceOptions) {
    this.signals = options.signals ?? systemSignals();
    this.backstopMs = options.backstopMs ?? SIGNAL_BACKSTOP_MS;
    this.shared = quiet((options.base ?? (() => nodeIo(processScope)))());
    this.planner = createScan(scanPorts(this.shared, "all"));

    const scratch = new ScratchAdapter();
    const clock = new ClockAdapter(this.shared);

    this.historical = {
      git: new GitAdapter(this.shared),
      scratch,
      scan: this.planner,
      cache: new ScanCacheAdapter(),
      clock,
      comparisons: new MemoisedComparisons(clock),
      limiter: new Limiter(
        Math.max(1, Math.min(MAX_HISTORICAL_SCANS, availableParallelism())),
      ),
    };
    scratch.sweepStale(STALE_SCRATCH_MS);
  }

  private write(message: unknown): void {
    this.options.write(message);
  }

  private nextId(prefix: string): string {
    this.counter += 1;

    return `${prefix}${this.counter}`;
  }

  handle(request: Request): void {
    void this.dispatch(request).catch((error: unknown) => {
      this.write({ id: request.id, error: errorText(error) });
    });
  }

  private async dispatch(request: Request): Promise<void> {
    const { id, args } = request;
    const reply = (ok: unknown) => this.write({ id, ok });

    switch (request.op) {
      case "scan.start":
        this.start(id, args);

        return;
      case "setup.start":
        this.setupStart(id, args);

        return;
      case "setup.stop": {
        const setup = text(args, "setup");
        const held = this.setups.get(setup);

        if (held === undefined) {
          throw new Error(`no setup ${setup} is running`);
        }

        held.request();
        reply(null);

        return;
      }
      case "scan.stop":
        reply(this.stop(args));

        return;
      case "scan.status":
        reply(this.status(args));

        return;
      case "scan.watch":
        reply(this.watch(args));

        return;
      case "scan.unwatch": {
        const watch = text(args, "watch");

        this.watches.get(watch)?.();
        this.watches.delete(watch);
        reply(null);

        return;
      }
      case "scan.plan":
        text(args, "repository");
        reply(await this.planner.plan(args as unknown as PlanRequest));

        return;
      case "confirm.answer":
        this.answer(args);
        reply(null);

        return;
      case "sensor.work":
        reply(this.work(args));

        return;
      case "tests.hash":
        reply(this.testsHash(args));

        return;
      case "describer.read":
        reply(
          describingFor(this.shared).readDescriber(
            resolve(text(args, "repository")),
          ),
        );

        return;
      case "view.parse": {
        const parsed = parseViewFile(text(args, "text"));

        reply(
          parsed.ok
            ? { ok: true, view: { ...parsed.view }, warnings: parsed.warnings }
            : { ok: false, reason: parsed.reason },
        );

        return;
      }
      case "view.range":
        reply(
          readChangeRange(
            this.historical,
            resolve(text(args, "repository")),
            text(args, "base"),
            text(args, "head"),
          ),
        );

        return;
      case "view.renames":
        reply(
          listRenamesSince(
            this.historical,
            resolve(text(args, "repository")),
            text(args, "commit"),
          ),
        );

        return;
      case "view.author":
        reply(
          readViewAuthor(this.historical, resolve(text(args, "repository"))),
        );

        return;
      case "view.scans":
        reply(
          await scansAtCommit(
            this.historical,
            resolve(text(args, "repository")),
            text(args, "commit"),
          ),
        );

        return;
      case "view.members":
        reply(
          await rangeMembers(
            this.historical,
            resolve(text(args, "repository")),
            text(args, "base"),
            text(args, "head"),
          ),
        );

        return;
      case "view.serialise": {
        const fields = args.view;

        if (typeof fields !== "object" || fields === null) {
          throw new ArgsError(["view must be an object"]);
        }

        reply({ text: serialiseView(View.of(fields as ViewFields)) });

        return;
      }
    }
  }

  private status(args: Record<string, unknown>): unknown {
    const repository = resolve(text(args, "repository"));
    const run = readRun(this.shared, repository);

    if (run === null || !isActive(run)) {
      return { running: false };
    }

    return {
      running: true,
      phase: run.phase,
      sensors: run.sensors,
      describe: run.describe,
      startedBy: run.started_by,
      refusal: refusalText(run, markerPath(repository)),
    };
  }

  private work(args: Record<string, unknown>): unknown {
    const repository = resolve(text(args, "repository"));
    const sensor = text(args, "sensor");

    return sensorWork(
      this.shared,
      repository,
      sensor,
      textList(args, "modules"),
      textList(args, "suites"),
    );
  }

  private testsHash(args: Record<string, unknown>): string | null {
    const repository = resolve(text(args, "repository"));

    return testsHashOf(
      {
        source: new SourceFilesAdapter(this.shared),
        digest: new DigestAdapter(),
        testReports: new TestReportsAdapter(this.shared),
      },
      repository,
      knownHashes(args, "known"),
    );
  }

  private answer(args: Record<string, unknown>): void {
    const repository = resolve(text(args, "repository"));

    if (typeof args.describe !== "boolean") {
      throw new ArgsError(["describe must be a boolean"]);
    }

    const run = readRun(this.shared, repository);

    if (run === null || run.phase !== "running") {
      throw new Error("no scan is waiting for an answer");
    }

    const path = answerPath(repository);

    if (this.shared.exists(path)) {
      try {
        const existing = JSON.parse(this.shared.readFile(path)) as {
          run_id?: unknown;
        };

        if (existing.run_id === run.run_id) {
          throw new Error("this scan was already answered");
        }
      } catch (error) {
        if ((error as Error).message === "this scan was already answered") {
          throw error;
        }
      }
    }

    const temporary = `${join(dirname(path), ANSWER_FILE)}.${process.pid}.tmp`;

    this.shared.writeFile(
      temporary,
      `${JSON.stringify({ version: 1, run_id: run.run_id, describe: args.describe })}\n`,
    );
    this.shared.rename(temporary, path);
  }

  private watch(args: Record<string, unknown>): string {
    const repository = resolve(text(args, "repository"));
    const id = this.nextId("w");
    const state = newWatchState();
    let timer: NodeJS.Timeout | undefined;
    let ended = false;

    const tick = () => {
      if (ended) {
        return;
      }

      for (const item of watchTick(this.shared, repository, state)) {
        this.write({ stream: id, ...item });
      }

      timer = setTimeout(tick, pollInterval(state));
    };

    this.watches.set(id, () => {
      ended = true;

      if (timer !== undefined) {
        clearTimeout(timer);
      }
    });
    setImmediate(tick);

    return id;
  }

  private start(id: number, args: Record<string, unknown>): void {
    const start = parseStart(args);
    const scanId = this.nextId("s");
    const faults = requestFaults(start.request);

    this.write({ id, ok: scanId });

    if (faults.length > 0) {
      this.write({
        stream: scanId,
        outcome: {
          status: "failed",
          reason: "invalid-request",
          messages: faults,
        },
      });

      return;
    }

    const scope = new StopScope();
    let files: ScopeFiles | undefined;
    let running: RunningScan;

    liveScopes.add(scope);

    try {
      files = writeScopeFiles(
        start.repository,
        "scan",
        start.modules,
        start.suites,
      );
      running = createScan(scanPorts(quiet(nodeIo(scope)), "all")).start(
        withFiles(start, files),
      );
    } catch (error) {
      files?.remove();
      liveScopes.delete(scope);
      this.write({
        stream: scanId,
        outcome: wireOutcome({ status: "failed", reason: "crashed", error }),
      });

      return;
    }

    this.started.set(scanId, { repository: start.repository, scope, running });
    void this.pump(scanId, scope, running, files);
  }

  private async pump(
    scanId: string,
    scope: StopScope,
    running: RunningScan,
    files: ScopeFiles,
  ): Promise<void> {
    try {
      for await (const event of running.events) {
        this.write({ stream: scanId, event });
      }
    } catch {}

    const outcome = await running.outcome;

    files.remove();
    this.started.delete(scanId);
    liveScopes.delete(scope);
    this.write({ stream: scanId, outcome: wireOutcome(outcome) });
  }

  private setupStart(id: number, args: Record<string, unknown>): void {
    const request = parseSetup(args);
    const setupId = this.nextId("u");
    const scope = new StopScope();
    const control = stopControl();

    liveScopes.add(scope);
    this.setups.set(setupId, control);
    this.write({ id, ok: setupId });

    void (async () => {
      const outcome = await runSetupAction(
        quiet(nodeIo(scope)),
        request,
        control,
        (line) => this.write({ stream: setupId, event: line }),
      );

      this.setups.delete(setupId);
      liveScopes.delete(scope);
      this.write({ stream: setupId, outcome });
    })();
  }

  private stop(args: Record<string, unknown>): null {
    if (typeof args.scan === "string") {
      const held = this.started.get(args.scan);

      if (held === undefined) {
        throw new Error(`no scan ${args.scan} is running`);
      }

      void held.running.stop();

      return null;
    }

    const repository = resolve(text(args, "repository"));
    const owner: StopOwner = args.owner === "app" ? "app" : "any";
    const own = [...this.started.values()].find(
      (one) => one.repository === repository,
    );

    if (own !== undefined) {
      void own.running.stop();

      return null;
    }

    stopMarkerProcess(
      this.shared,
      repository,
      owner,
      this.signals,
      this.backstopMs,
    );

    return null;
  }

  stopAll(exit: number): Promise<void> {
    for (const end of this.watches.values()) {
      end();
    }

    this.watches.clear();

    return Promise.all([
      processScope.stop(exit),
      ...[...liveScopes].map((scope) => scope.stop(exit)),
    ]).then(() => undefined);
  }
}
