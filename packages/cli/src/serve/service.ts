import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  appSettingsProblem,
  createScan,
  type FindingsRepository,
  type Git,
  type HistoricalPorts,
  Limiter,
  listRenamesSince,
  MemoisedComparisons,
  type PlanRequest,
  Repository,
  type RunningScan,
  rangeMembers,
  readChangeRange,
  readViewAuthor,
  requestFaults,
  type Scan,
  type ScanCache,
  type Scratch,
  type StructureRepository,
  scansAtCommit,
  testsHashOf,
  View,
  type ViewFields,
} from "@recognizer/core";
import { ActiveRunAdapter } from "../adapters/filesystem/active-run-adapter.js";
import {
  BaselineTextAdapter,
  CurrentTestsAdapter,
} from "../adapters/filesystem/current-tests-adapter.js";
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
import { installedLanguages } from "../published-languages.js";
import { scanPorts } from "../scan-container.js";
import {
  ANSWER_FILE,
  answerPath,
  markerPath,
  readRun,
  refusalText,
} from "../scan-marker.js";
import { liveScopes, processScope, StopScope } from "../stop-scope.js";
import { readStructure, typedHistorical } from "../structure-read.js";
import { configKeys, configWrite } from "./config-run.js";
import { estimateRequestOf, readEstimate } from "./estimate-ops.js";
import { HistoryChannel } from "./history-channel.js";
import { readInputs } from "./inputs-ops.js";
import { classifyOpenedOp, viewMarks, viewMembers } from "./marks-ops.js";
import { quiet } from "./quiet.js";
import { RepositoryChannel } from "./repository-channel.js";
import { readResponsibilitiesOp } from "./responsibilities-ops.js";
import { clearPlugin, readPluginResults } from "./results-ops.js";
import { type ScopeFiles, writeScopeFiles } from "./scan-files.js";
import { sensorWork } from "./sensor-work.js";
import { settingsPanesReply } from "./settings-panes.js";
import {
  parseSetup,
  runSetupAction,
  type SetupStopControl,
  stopControl,
} from "./setup-run.js";
import { parseStart, withFiles } from "./start-request.js";
import { StopBackstops } from "./stop-backstops.js";
import {
  SIGNAL_BACKSTOP_MS,
  type Signals,
  type StopOwner,
  stopMarkerProcess,
  systemSignals,
} from "./stop-by-repository.js";
import { changeTicks } from "./ticks-ops.js";
import {
  ACTIVE_POLL_MS,
  DEFAULT_POLLS,
  isActive,
  newWatchState,
  type Polls,
  pollInterval,
  watchTick,
} from "./watch.js";
import {
  ArgsError,
  knownHashes,
  optionalText,
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
  scoped?: (scope: StopScope) => Io;
  polls?: Polls;
  adapters?: { git?: Git; scratch?: Scratch; cache?: ScanCache };
}

interface Started {
  repository: string;
  scope: StopScope;
  running: RunningScan;
}

export class Service {
  private readonly started = new Map<string, Started>();
  private readonly watches = new Map<string, () => void>();
  private readonly setups = new Map<string, SetupStopControl>();
  private readonly signals: Signals;
  private readonly backstopMs: number;
  private readonly shared: Io;
  private readonly polls: Polls;
  private readonly cache: ScanCache;
  private readonly planner: Scan;
  private readonly historical: HistoricalPorts;
  private readonly historyChannel = new HistoryChannel();
  private readonly backstops = new StopBackstops();
  private readonly repositories: RepositoryChannel;
  private readonly findings: FindingsRepository;
  private readonly structure: StructureRepository;
  private counter = 0;

  constructor(private readonly options: ServiceOptions) {
    this.signals = options.signals ?? systemSignals();
    this.backstopMs = options.backstopMs ?? SIGNAL_BACKSTOP_MS;
    this.shared = quiet((options.base ?? (() => nodeIo(processScope)))());
    this.polls = options.polls ?? DEFAULT_POLLS;
    const ports = scanPorts(this.shared, "all");

    this.planner = createScan(ports);
    this.findings = ports.findings;
    this.structure = ports.structure;
    const git = options.adapters?.git ?? new GitAdapter(this.shared);
    this.cache = options.adapters?.cache ?? new ScanCacheAdapter();
    const limiter = new Limiter(
      Math.max(1, Math.min(MAX_HISTORICAL_SCANS, availableParallelism())),
    );

    this.repositories = new RepositoryChannel(
      () => ({
        active: new ActiveRunAdapter(this.shared),
        runLog: ports.runLog,
        config: ports.config,
        catalog: ports.catalog,
        findings: ports.findings,
        structure: ports.structure,
        policy: ports.policy,
        baseline: new BaselineTextAdapter(this.shared),
        currentTests: new CurrentTestsAdapter(this.shared),
      }),
      (message) => this.write(message),
      () => this.nextId("r"),
      { git, limiter, stamp: (path) => this.shared.stamp(path) },
      this.shared,
      this.polls,
    );

    const scratch = options.adapters?.scratch ?? new ScratchAdapter();
    const clock = new ClockAdapter(this.shared);

    this.historical = {
      git,
      scratch,
      scan: this.planner,
      cache: this.cache,
      clock,
      comparisons: new MemoisedComparisons(clock),
      limiter,
    };
    if (options.adapters?.scratch === undefined) {
      new ScratchAdapter().sweepStale(STALE_SCRATCH_MS);
    }
  }

  private scopedIo(scope: StopScope): Io {
    return this.options.scoped === undefined
      ? nodeIo(scope)
      : this.options.scoped(scope);
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
      case "settings.validate":
        reply({
          problem: appSettingsProblem({
            describing: args.describing,
            setup: args.setup,
          }),
        });

        return;
      case "config.keys":
        reply(configKeys(this.shared));

        return;
      case "settings.panes":
        reply(settingsPanesReply(this.shared));

        return;
      case "config.write":
        reply(configWrite(this.shared, args));

        return;
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
      case "repository.watch":
        reply(this.repositories.watch(resolve(text(args, "repository"))));

        return;
      case "repository.unwatch":
        this.repositories.unwatch(text(args, "watch"));
        reply(null);

        return;
      case "repository.state":
        reply(this.repositories.state(resolve(text(args, "repository"))));

        return;
      case "structure.read": {
        const repository = resolve(text(args, "repository"));

        reply(readStructure(this.cache.read(repository)));

        return;
      }
      case "results.read": {
        const repository = resolve(text(args, "repository"));

        reply(
          readPluginResults(
            this.shared,
            repository,
            this.repositories.state(repository),
            this.structureOf(repository),
            optionalText(args, "tests"),
          ),
        );

        return;
      }
      case "responsibilities.read":
        reply(
          readResponsibilitiesOp(
            this.shared,
            resolve(text(args, "repository")),
            textList(args, "modules") ?? [],
          ),
        );

        return;
      case "inputs.read":
        reply(readInputs(this.shared, resolve(text(args, "repository"))));

        return;
      case "results.clear":
        clearPlugin(
          this.findings,
          resolve(text(args, "repository")),
          text(args, "plugin"),
        );
        this.repositories.state(resolve(text(args, "repository")));
        reply(null);

        return;
      case "scan.plan":
        text(args, "repository");
        reply(await this.planner.plan(args as unknown as PlanRequest));

        return;
      case "scan.estimate":
        reply(
          readEstimate(
            this.shared,
            resolve(text(args, "repository")),
            estimateRequestOf(args),
          ),
        );

        return;
      case "scan.ticks":
        reply(changeTicks(args));

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
          typedHistorical(
            await scansAtCommit(
              this.historical,
              resolve(text(args, "repository")),
              text(args, "commit"),
            ),
          ),
        );

        return;
      case "view.members": {
        const repository = resolve(text(args, "repository"));
        const members = typedHistorical(
          await rangeMembers(
            this.historical,
            repository,
            text(args, "base"),
            text(args, "head"),
          ),
        );

        reply(
          members.ok
            ? {
                ...members,
                ...(await viewMembers(
                  this.historical,
                  repository,
                  text(args, "base"),
                  text(args, "head"),
                  this.structureOf(repository),
                )),
              }
            : members,
        );

        return;
      }
      case "view.marks": {
        const repository = resolve(text(args, "repository"));

        reply(
          await viewMarks(
            this.historical,
            repository,
            text(args, "base"),
            text(args, "head"),
            this.structureOf(repository),
          ),
        );

        return;
      }
      case "view.classify":
        reply(classifyOpenedOp(args));

        return;
      case "history.list":
      case "history.branches":
      case "history.facts":
      case "history.detail":
      case "history.pulls":
      case "changes.take":
      case "changes.clear":
      case "changes.adopt":
      case "changes.poll":
      case "git.begin":
      case "git.poll":
      case "git.end":
      case "changes.worktree":
        reply(await this.historyChannel.call(request.op, args));

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

  private structureOf(repository: string): Repository {
    try {
      return this.structure.read(repository);
    } catch {
      return Repository.empty;
    }
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
        languages: installedLanguages(this.shared),
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
    let cancel: (() => void) | undefined;
    let ended = false;

    const tick = () => {
      if (ended) {
        return;
      }

      for (const item of watchTick(this.shared, repository, state)) {
        this.write({ stream: id, ...item });
      }

      cancel = this.shared.after(pollInterval(state, this.polls), tick);
    };

    this.watches.set(id, () => {
      ended = true;

      cancel?.();
    });
    this.shared.after(0, tick);

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

    const scope = new StopScope(false, (ms, action) =>
      this.shared.after(ms, action),
    );
    let files: ScopeFiles | undefined;
    let running: RunningScan;

    liveScopes.add(scope);

    try {
      const io = quiet(this.scopedIo(scope));

      files = writeScopeFiles(
        io,
        start.repository,
        "scan",
        start.modules,
        start.suites,
      );
      running = createScan(scanPorts(io, "all")).start(withFiles(start, files));
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
        void event;
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
    const scope = new StopScope(false, (ms, action) =>
      this.shared.after(ms, action),
    );
    const control = stopControl();

    liveScopes.add(scope);
    this.setups.set(setupId, control);
    this.write({ id, ok: setupId });

    void (async () => {
      const outcome = await runSetupAction(
        quiet(this.scopedIo(scope)),
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
      this.backstops,
    );

    return null;
  }

  backstopsSettled(): Promise<void> {
    let cancel: (() => void) | undefined;
    const bound = new Promise<void>((resolve) => {
      cancel = this.shared.after(this.backstopMs + ACTIVE_POLL_MS, resolve);
    });

    return Promise.race([this.backstops.settled(), bound]).finally(() => {
      cancel?.();
    });
  }

  stopAll(exit: number): Promise<void> {
    void this.historyChannel.close();

    for (const end of this.watches.values()) {
      end();
    }

    this.watches.clear();
    this.repositories.closeAll();

    return Promise.all([
      processScope.stop(exit),
      ...[...liveScopes].map((scope) => scope.stop(exit)),
    ]).then(() => undefined);
  }
}
