import type { DescriberBuild } from "../../domain/config-repository.js";
import type { Gap } from "../../domain/gap.js";
import type { ScanOutcome } from "../../domain/run/scan-outcome.js";
import type { ScanRequest } from "../../domain/run/scan-request.js";
import {
  InvalidRequest,
  requestFaults,
} from "../../domain/run/scan-request.js";
import type { RunLogRepository } from "../../domain/run-log-repository.js";
import type { StructureRepository } from "../../domain/structure-repository.js";
import type { AnalysisOutcome } from "../analysis/run-analysis.js";
import type { DescribeOutcome } from "../describing/describe-files.js";
import type { DescribingSettings } from "../describing/describing-settings.js";
import type { LocatedDescriber } from "../describing/locate-describer.js";
import { notMeasuredLine } from "../plugins/undeclared-sensors.js";
import type { ExtractOutcome } from "../scanning/extract-scans.js";
import type { PlannedSensor } from "../sensing/plan-sensors.js";
import type { Clock } from "../shared/ports/clock.js";
import type { Git } from "../shared/ports/git.js";
import type { ProcessControl } from "../shared/ports/process.js";
import type { HeldLock, ScanLock } from "../shared/ports/scan-lock.js";
import type { FlowContext } from "./internal/flow-context.js";
import { RunRecorder } from "./internal/run-recorder.js";
import type { RunPhases } from "./phases.js";

export interface RunPorts {
  git: Git;
  structure: StructureRepository;
  lock: ScanLock;
  runLog: RunLogRepository;
  clock: Clock;
  process: ProcessControl;
}

export interface RunStep {
  kind: "extract" | "analysis" | "describe" | "sense";
  invoke: () => unknown;
}

export function* scanFlow(
  request: ScanRequest,
  ports: RunPorts,
  phases: RunPhases,
  ctx: FlowContext,
): Generator<RunStep, ScanOutcome, unknown> {
  const { git, structure, lock, runLog: runLogs, clock } = ports;
  const root = request.repository;
  const sense = request.sensors;
  const describeOn = request.describe !== false;
  const senseNames = Array.isArray(sense) ? sense.map((one) => one.name) : [];
  const wantsConfig = describeOn || sense !== null;
  const startedAt = clock.now();
  const discovery = phases.discoverScanners();
  const limits = ports.process.limits(root);
  let named: Record<string, string> = {};
  let install: Record<string, string> = {};
  let describerBuild: DescriberBuild | null = null;
  let located: LocatedDescriber = { describer: null };
  let selected: PlannedSensor[] = [];
  let chosen: Record<string, string[]> = {};
  let folderKnown = false;

  try {
    if (!structure.exists(root)) {
      throw new InvalidRequest([`repository is not a directory: ${root}`]);
    }

    folderKnown = true;

    const faults = requestFaults(request);

    if (faults.length > 0) {
      throw new InvalidRequest(faults);
    }

    const setup = phases.readScannerSetup(root);

    named = setup.scanners;
    install = setup.install;
    describerBuild = setup.describerBuild;

    const config = phases.readRunConfig(root, request.ignoreRetiredConfig);

    if (describeOn) {
      located = phases.locateDescriber(root);
    }

    const selection = phases.selectSensors({ root, config, limits, sense });

    const plan = phases.planSensors({
      selection,
      sense,
      config,
      suitesFile: request.suitesFile,
      modulesFile: request.modules?.file,
    });

    selected = plan.selected;
    chosen = plan.chosen;

    for (const one of selected) {
      if (one.undeclared !== undefined) {
        ctx.say("stderr", `${one.undeclared.line}\n`);
      }
    }
  } catch (error) {
    if (ctx.takeLock && folderKnown) {
      try {
        const acquired = lock.acquire(root, {
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
    const acquired = lock.acquire(root, {
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
  const openLog: { close: (() => void) | null } = { close: null };

  function* scanRest(): Generator<RunStep, ScanOutcome, unknown> {
    const commit = git.commit(root);
    const modified = commit === null ? null : git.dirty(root);
    const detected = phases.detectLanguages({
      root,
      named,
      installed: discovery.installed,
      sink: ctx,
    });
    const runLog =
      detected.length > 0 || wantsConfig
        ? runLogs.open(
            root,
            taken === null ? startedAt : taken.startedAt,
            request.by,
            request.invocation,
            taken === null ? undefined : taken.runId,
          )
        : null;
    const recorder = new RunRecorder(ctx, runLog);

    if (runLog !== null) {
      openLog.close = () =>
        ctx.stopped
          ? runLog.stop(recorder.recorded())
          : runLog.finish(recorder.recorded(), true);
    }

    const stoppedOutcome = (analysisMs?: number): ScanOutcome => {
      runLog?.stop(recorder.recorded(), analysisMs);

      return { status: "stopped" };
    };

    const ticked = selected.map(({ name, command, manifest }) => ({
      name,
      command,
      ...(manifest === undefined ? {} : { manifest }),
    }));
    const describing: DescribingSettings | null =
      describeOn && located.describer !== null
        ? phases.describingSettings(located.describer, root)
        : null;

    const refuse = (gaps: Gap[]): ScanOutcome => {
      const reason = `preflight found ${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"}`;

      ctx.emit({ type: "preflight", state: "gaps", gaps });

      if (describeOn) {
        recorder.skip("describe", reason);
      }

      if (sense !== null) {
        recorder.skip("sense", reason);
      }

      runLog?.finish(recorder.recorded(), true);

      recorder.summaryEvent(4, root, commit, modified);

      taken?.refused(
        gaps.map(({ id, line, needs }) => ({ id, line, needs })),
        recorder.ranSummary(commit),
      );

      return { status: "refused", reason: "preflight", gaps };
    };

    ctx.emit({ type: "preflight", state: "run" });

    const early = [
      ...phases.findCommitGaps({ commit, sensors: ticked }),
      ...phases.findDescriberGaps({
        root,
        describe: describeOn,
        located,
        install,
        build: describerBuild,
      }),
      ...phases.findProgramGaps({ sensors: ticked, install }),
    ];

    if (early.length > 0) {
      return refuse(early);
    }

    const extracted = (yield {
      kind: "extract",
      invoke: () =>
        phases.extractScans({
          root,
          force: request.mode === "full",
          commit,
          modified,
          detected,
          limits,
          sink: ctx,
          recorder,
        }),
    }) as ExtractOutcome;

    if (ctx.stopped || extracted.stopped) {
      return stoppedOutcome();
    }

    const { repository, missing } = extracted;
    const later = [
      ...phases.findLanguageGaps(detected),
      ...phases.findReadinessGaps({
        root,
        commit,
        sensors: ticked,
        limits,
      }),
    ];

    if (later.length > 0) {
      return refuse(later);
    }

    ctx.emit({ type: "preflight", state: "ok" });
    taken?.running();

    const analysed = (yield {
      kind: "analysis",
      invoke: () =>
        phases.runAnalysis({
          root,
          repository,
          analysis: request.analysis,
          ignoreRetiredConfig: request.ignoreRetiredConfig,
          sink: ctx,
        }),
    }) as AnalysisOutcome;

    if (ctx.stopped) {
      return stoppedOutcome();
    }

    if (analysed.failed) {
      recorder.failed = true;
    }

    recorder.analysis(analysed.phase);

    const analysisMs = analysed.ms ?? undefined;
    let limited = false;

    if (phases.isDescriberRegistered(located) && describeOn) {
      const described = (yield {
        kind: "describe",
        invoke: () =>
          phases.describeFiles({
            root,
            repository,
            missing,
            located,
            settings: describing as DescribingSettings,
            selection: request.describe === "all" ? "all" : "stale",
            within: request.modules?.names,
            confirmAbove: request.confirmAbove,
            lock: taken,
            sink: ctx,
            recorder,
          }),
      }) as DescribeOutcome;

      if (ctx.stopped || described.halted) {
        return stoppedOutcome(analysisMs);
      }

      if (described.failed) {
        recorder.failed = true;
      }

      limited = described.limited;
    }

    if (sense !== null) {
      yield {
        kind: "sense",
        invoke: () =>
          phases.runSensors({
            root,
            selected,
            scope: request.modules,
            commit,
            runScope: { kind: "working-tree" },
            modified,
            repository,
            limits,
            sink: ctx,
            recorder,
          }),
      };

      if (ctx.stopped) {
        return stoppedOutcome(analysisMs);
      }

      for (const one of selected) {
        if (one.undeclared?.suitesWithheld === true) {
          ctx.say("stderr", `${notMeasuredLine(one.name)}\n`);
        }
      }
    }

    if (limited) {
      runLog?.stop(recorder.recorded(), analysisMs);
    } else {
      runLog?.finish(recorder.recorded(), false, analysisMs);
    }

    const exit = recorder.failed ? 1 : 0;
    const firstFailed = recorder.firstFailed();

    recorder.summaryEvent(exit, root, commit, modified);

    taken?.end(
      exit,
      exit === 0
        ? null
        : {
            sensor: firstFailed?.name ?? "scan",
            suite: firstFailed?.diagnosis?.suite ?? null,
            code: firstFailed?.diagnosis?.code ?? null,
            reason: firstFailed?.reason ?? `recognizer scan exited ${exit}`,
          },
      recorder.ranSummary(commit),
    );

    return exit === 0
      ? { status: "finished" }
      : { status: "failed", reason: "phases" };
  }

  try {
    return yield* scanRest();
  } catch (error) {
    taken?.crashed(error);

    try {
      openLog.close?.();
    } catch {
      throw error;
    }

    throw error;
  } finally {
    taken?.release();
  }
}
