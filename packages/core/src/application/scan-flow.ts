import type {
  DescribeResult,
  EventEntry,
  Gap,
  PhaseName,
  PluginProgress,
  Projection,
  RunEntry,
  RunPhase,
  RunSummary,
  ScanOutcome,
  ScanRequest,
  SkippedPhase,
} from "../domain/index.js";
import { InvalidRequest } from "../domain/index.js";
import type { DescribeCall } from "../ports/driven/describer.js";
import type {
  Clock,
  Confirm,
  Describer,
  ExtractCall,
  ExtractResult,
  Git,
  HeldLock,
  LocatedDescriber,
  ParserSet,
  PlannedSensor,
  ProcessControl,
  ScanDocument,
  ScannerQueries,
  Sensors,
  Store,
} from "../ports/driven/index.js";
import type { SenseCall } from "../ports/driven/sensors.js";
import type { FlowContext } from "./flow-context.js";

export interface FlowPorts {
  scanners: ScannerQueries;
  sensors: Sensors;
  describer: Describer;
  git: Git;
  store: Store;
  confirm: Confirm;
  clock: Clock;
  process: ProcessControl;
}

export type ScanStep =
  | { kind: "extract"; call: ExtractCall }
  | { kind: "describe"; call: DescribeCall }
  | { kind: "sense"; call: SenseCall }
  | { kind: "parsers"; languages: string[] };

export type ScanAnswer =
  | ExtractResult
  | DescribeResult
  | ParserSet
  | Error
  | null
  | undefined;

type CommandPhase = RunPhase & { phase: PhaseName };

interface StructureResult {
  failed: boolean;
  ran: boolean;
  ms: number | null;
  reason?: string;
}

function eventEntry(entry: RunEntry): EventEntry {
  return {
    name: entry.name,
    outcome: entry.outcome,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    ...(entry.diagnosis === undefined ? {} : { diagnosis: entry.diagnosis }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function* scanFlow(
  request: ScanRequest,
  ports: FlowPorts,
  ctx: FlowContext,
): Generator<ScanStep, ScanOutcome, ScanAnswer> {
  const { scanners, sensors, describer, git, store, confirm, clock } = ports;
  const root = request.repository;
  const sense = request.sensors;
  const describeOn = request.describe !== false;
  const senseNames = Array.isArray(sense) ? sense.map((one) => one.name) : [];
  const wantsConfig = describeOn || sense !== null;
  const startedAt = clock.now();
  const discovery = scanners.discover();
  const limits = ports.process.limits(root);
  let named: Record<string, string> = {};
  let install: Record<string, string> = {};
  let located: LocatedDescriber = { describer: null, shipped: false };
  let selected: PlannedSensor[] = [];
  let chosen: Record<string, string[]> = {};
  let folderKnown = false;

  try {
    if (!store.isDirectory(root)) {
      throw new InvalidRequest([`repository is not a directory: ${root}`]);
    }

    folderKnown = true;

    const setup = store.scannerSetup(root);

    named = setup.scanners;
    install = setup.install;

    const config = store.runConfig(root, request.ignoreRetiredConfig);

    if (describeOn) {
      located = describer.locate(root);
    }

    const selection = sensors.select({ root, config, limits, sense });

    describer.refuseShipped(located);

    const plan = sensors.plan({
      selection,
      sense,
      config,
      suitesFile: request.suitesFile,
      modulesFile: request.modules?.file,
    });

    selected = plan.selected;
    chosen = plan.chosen;
  } catch (error) {
    if (ctx.takeLock && folderKnown) {
      try {
        const acquired = store.acquireLock(root, {
          sensors: senseNames,
          describe: describeOn,
        });

        if (acquired.ok) {
          acquired.lock.crashed(error);
          acquired.lock.release();
        }
      } catch {
        throw error;
      }
    }

    throw error;
  }

  if (ctx.takeLock) {
    const acquired = store.acquireLock(root, {
      sensors: selected.map((one) => one.name),
      describe: describeOn,
      suites: chosen,
    });

    if (!acquired.ok) {
      ctx.say("stderr", acquired.text);

      return { status: "refused", reason: "lock" };
    }

    ctx.lock = acquired.lock;
  }

  const taken: HeldLock | null = ctx.lock;

  function* scanRest(): Generator<ScanStep, ScanOutcome, ScanAnswer> {
    const commit = git.commit(root);
    const modified = commit === null ? null : git.dirty(root);
    const detected = scanners.detect(root, named);
    const removed: string[] = [];
    const phases: CommandPhase[] = [];
    let structurePhase: RunPhase | null = null;
    const summary = new Map<PhaseName, EventEntry[]>();
    const runLog =
      detected.length > 0 || wantsConfig
        ? store.openRunLog(root, startedAt, request.by, request.invocation)
        : null;
    const skippedPhases: SkippedPhase[] = [];
    let failed = false;

    const skip = (phase: string, reason: string) => {
      skippedPhases.push({ phase, reason });
      runLog?.skip({ phase, reason });
    };

    const recorded = (): RunPhase[] => {
      if (structurePhase === null) {
        return phases;
      }

      const at = phases.findIndex((one) => one.phase === "extract") + 1;

      return [...phases.slice(0, at), structurePhase, ...phases.slice(at)];
    };

    const startPhase = (phase: PhaseName): CommandPhase => {
      const one: CommandPhase = { phase, entries: [] };

      phases.push(one);
      summary.set(phase, []);
      ctx.emit({ type: "phase-started", phase });

      return one;
    };

    const finishEntry = (
      phase: CommandPhase,
      entry: RunEntry,
      extra: Partial<EventEntry> = {},
      file?: string,
    ) => {
      const shown = { ...eventEntry(entry), ...extra };

      phase.entries.push(entry);
      summary.get(phase.phase)?.push(shown);
      runLog?.update(recorded());

      ctx.emit({
        type: "entry",
        phase: phase.phase,
        entry: shown,
        ...(file === undefined ? {} : { file }),
      });

      if (entry.outcome === "failed") {
        failed = true;
      }
    };

    const plugin =
      (phase: PhaseName) =>
      (name: string, data: PluginProgress): void => {
        ctx.emit({ type: "plugin", phase, name, data });
      };

    if (detected.length === 0) {
      if (discovery.installed === 0) {
        ctx.say(
          "stderr",
          "no scanner is installed: recognizer plugins lists what is installed\n",
        );
      }

      ctx.say("stderr", "no languages detected\n");
    }

    const ticked = selected.map(({ name, command }) => ({ name, command }));
    const describing = describeOn ? describer.settings() : null;

    const ranSummary = (): RunSummary => ({
      commit,
      ran: phases
        .filter((one) => (summary.get(one.phase) ?? []).length > 0)
        .map((one) => one.phase),
    });

    const summaryEvent = (exit: 0 | 1 | 4) =>
      ctx.emit({
        type: "summary",
        repository: root,
        commit,
        modified,
        exit,
        phases: phases.map((one) => ({
          phase: one.phase,
          entries: summary.get(one.phase) ?? [],
        })),
        removed,
        skipped: skippedPhases,
        log: runLog?.id() ?? null,
      });

    const refuse = (gaps: Gap[]): ScanOutcome => {
      const reason = `preflight found ${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"}`;

      ctx.emit({ type: "preflight", state: "gaps", gaps });

      if (describeOn) {
        skip("describe", reason);
      }

      if (sense !== null) {
        skip("sense", reason);
      }

      runLog?.finish(recorded(), true);

      summaryEvent(4);

      taken?.refused(
        gaps.map(({ id, line, needs }) => ({ id, line, needs })),
        ranSummary(),
      );

      return { status: "refused", reason: "preflight", gaps };
    };

    ctx.emit({ type: "preflight", state: "run" });

    const early = sensors.earlyGaps({
      root,
      commit,
      sensors: ticked,
      describe: describeOn,
      describer: located.describer,
      model: describing?.model ?? "",
      install,
    });

    if (early.length > 0) {
      return refuse(early);
    }

    const decision = scanners.decide(
      root,
      request.mode === "full",
      commit,
      modified === true,
    );
    const extract = startPhase("extract");

    ctx.emit({
      type: "phase",
      phase: "extract",
      detail: decision.run
        ? {
            state: "run",
            commit,
            reason: decision.reason,
            languages: detected,
          }
        : { state: "current", commit: decision.commit },
    });

    if (!decision.run) {
      ctx.human("stdout", `scans current at ${decision.commit}\n`);
    }

    for (const language of scanners.cachedLanguages(root)) {
      if (detected.includes(language)) {
        continue;
      }

      const file = scanners.scanFile(root, language);

      if (store.remove(file)) {
        removed.push(file);
        ctx.say(
          "stderr",
          `${language}: removed stale ${relativeTo(root, file)}\n`,
        );
      }
    }

    const noted = new Set<string>();

    for (const language of detected) {
      const file = scanners.scanFile(root, language);
      const shown = relativeTo(root, file);

      if (!decision.run) {
        continue;
      }

      const note = scanners.previousProtocolNote(language);

      if (note !== null && !noted.has(note.scanner)) {
        noted.add(note.scanner);
        ctx.say("stderr", note.text);
      }

      const scanned = (yield {
        kind: "extract",
        call: {
          root,
          language,
          commit,
          modified,
          limits,
          onEvent: plugin("extract"),
          say: ctx.say,
        },
      }) as ExtractResult;

      if (ctx.stopped) {
        return { status: "stopped" };
      }

      if (scanned.ok) {
        store.writeScan(root, language, scanned.bytes);
        finishEntry(
          extract,
          scanned.entry,
          { modules: scanned.modules, edges: scanned.edges },
          shown,
        );

        continue;
      }

      ctx.say(
        "stderr",
        `${language}: ${scanned.reason} - ${scanned.message}\n`,
      );

      if (store.remove(file)) {
        removed.push(file);
        ctx.say("stderr", `${language}: removed stale ${shown}\n`);
      }

      finishEntry(extract, scanned.entry);
    }

    const scans = detected
      .map((language) => scanners.readCached(root, language))
      .filter((scan): scan is ScanDocument => scan !== null);

    const later =
      commit === null ? [] : sensors.readinessGaps(root, ticked, limits);

    if (later.length > 0) {
      return refuse(later);
    }

    ctx.emit({ type: "preflight", state: "ok" });
    taken?.running();

    let structureMs: number | undefined;

    if (store.readsSensorConfig()) {
      const structure = yield* runStructure(scans);

      if (ctx.stopped) {
        return { status: "stopped" };
      }

      if (structure.ran) {
        ctx.emit({
          type: "structure",
          state: structure.failed ? "failed" : "done",
          files: scans.reduce((sum, scan) => sum + scan.files.length, 0),
        });
      }

      if (structure.failed) {
        failed = true;
      }

      structureMs = structure.ms ?? undefined;

      if (structure.ran) {
        structurePhase = {
          phase: "structure",
          entries: [
            {
              name: "structure",
              command: [],
              status: null,
              outcome: structure.failed ? "failed" : "ok",
              duration_ms: structure.ms ?? 0,
              ...(structure.reason === undefined
                ? {}
                : { reason: structure.reason }),
              stderr: "",
            },
          ],
          duration_ms: structure.ms ?? 0,
        };
      }
    }

    if (located.describer !== null && describeOn) {
      const phase = startPhase("describe");
      let describeFrom = clock.awake();

      for (const language of detected) {
        if (scanners.readCached(root, language) === null) {
          ctx.say("stderr", `skipped: no scan for ${language}\n`);
          skip("describe", `no scan for ${language}`);
        }
      }

      const { model, batchSize } = describing as {
        model: string;
        batchSize: number;
      };
      const limit = request.confirmAbove;
      const result = (yield {
        kind: "describe",
        call: {
          root,
          scans,
          describer: located.describer,
          model,
          batchSize,
          selection: {
            kind: request.describe === "all" ? "all" : "stale",
            ...(request.modules === undefined
              ? {}
              : { within: request.modules.names }),
          },
          ...(limit === undefined
            ? {}
            : {
                confirm: async (projection: Projection) => {
                  if (
                    projection.modules === 0 ||
                    (projection.cost_usd !== null &&
                      projection.cost_usd <= limit)
                  ) {
                    return true;
                  }

                  ctx.emit({ type: "confirmation-asked", projection });

                  await ctx.flush();

                  const describe = await confirm.ask(taken);

                  if (taken !== null) {
                    ctx.emit({ type: "confirmation-answered", describe });
                  }

                  describeFrom = clock.awake();

                  return describe;
                },
              }),
          onProjection: (projection) => {
            ctx.emit({ type: "projection", projection });
          },
          onStart: (total) => {
            ctx.emit({ type: "phase", phase: "describe", detail: { total } });
          },
          onEvent: plugin("describe"),
          onEntry: (entry) => {
            finishEntry(phase, entry);
          },
          say: ctx.say,
        },
      }) as DescribeResult;

      if (ctx.stopped) {
        return { status: "stopped" };
      }

      phase.duration_ms = clock.awake() - describeFrom;

      const stop = result.stopped;

      if (stop !== null) {
        failed = true;
        ctx.emit({ type: "describing-stopped", stop });
      }

      ctx.emit({ type: "describing-finished", result });
    }

    if (sense !== null) {
      const phase = startPhase("sense");

      ctx.emit({
        type: "phase",
        phase: "sense",
        detail: { total: selected.length },
      });

      const senseFrom = clock.awake();
      const scope = request.modules;

      yield {
        kind: "sense",
        call: {
          root,
          selected: selected.map((one) => ({
            ...one,
            ...(scope !== undefined && one.scoped
              ? { modules: scope.names.length }
              : {}),
          })),
          commit: commit ?? "",
          scans,
          limits,
          onStart: (name) => {
            ctx.emit({ type: "start", phase: "sense", name });
          },
          onEvent: plugin("sense"),
          onEntry: (entry) => {
            finishEntry(phase, entry);
          },
          say: ctx.say,
        },
      };

      if (ctx.stopped) {
        return { status: "stopped" };
      }

      phase.duration_ms = clock.awake() - senseFrom;
    }

    runLog?.finish(recorded(), false, structureMs);

    const exit = failed ? 1 : 0;
    const firstFailed = phases
      .flatMap((one) => summary.get(one.phase) ?? [])
      .find((entry) => entry.outcome === "failed");

    summaryEvent(exit);

    taken?.end(
      exit,
      exit === 0
        ? null
        : {
            sensor: firstFailed?.name ?? "scan",
            suite: (firstFailed?.diagnosis?.suite as string | null) ?? null,
            code: (firstFailed?.diagnosis?.code as string | null) ?? null,
            reason: firstFailed?.reason ?? `recognizer scan exited ${exit}`,
          },
      ranSummary(),
    );

    return exit === 0
      ? { status: "finished" }
      : { status: "failed", reason: "phases" };
  }

  function* runStructure(
    scans: ScanDocument[],
  ): Generator<ScanStep, StructureResult, ScanAnswer> {
    if (scans.length === 0 || !request.analysis) {
      return { failed: false, ran: false, ms: null };
    }

    let began: number | null = null;
    const timed = (failedRun: boolean, reason?: string): StructureResult => ({
      failed: failedRun,
      ran: true,
      ms: began === null ? null : clock.awake() - began,
      ...(reason === undefined ? {} : { reason }),
    });
    const fail = (reason: string): StructureResult => {
      ctx.say("stderr", `failed structure: ${reason}\n`);

      return timed(true, reason);
    };

    try {
      const plan = sensors.structurePlan(
        store.structureConfig(root, request.ignoreRetiredConfig),
      );

      store.removeStructureOutputs(root, plan === "off");

      if (plan === "off") {
        return { failed: false, ran: false, ms: null };
      }

      ctx.emit({ type: "structure", state: "run" });

      began = clock.awake();

      const policy = store.policy(root);
      const prepared = sensors.structurePrepare(
        plan,
        root,
        scans,
        policy,
        ctx.say,
      );
      const answer =
        prepared.parserLanguages === null
          ? null
          : yield { kind: "parsers", languages: prepared.parserLanguages };
      const parsers =
        answer === null || answer === undefined || answer instanceof Error
          ? null
          : (answer as ParserSet);
      const run = sensors.structureRun(
        plan,
        root,
        scans,
        policy,
        parsers,
        ctx.say,
      );

      if (answer instanceof Error) {
        return fail(`${prepared.label}: ${answer.message}`);
      }

      if (run.error !== null) {
        return fail(run.error);
      }

      return timed(false);
    } catch (error) {
      return fail(errorMessage(error));
    }
  }

  try {
    return yield* scanRest();
  } catch (error) {
    taken?.crashed(error);

    throw error;
  } finally {
    taken?.release();
  }
}

function relativeTo(root: string, file: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;

  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}
