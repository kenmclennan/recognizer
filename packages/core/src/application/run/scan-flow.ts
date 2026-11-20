import type { Gap } from "../../domain/gap.js";
import type { ScanOutcome } from "../../domain/scan-outcome.js";
import type { ScanRequest } from "../../domain/scan-request.js";
import { InvalidRequest } from "../../domain/scan-request.js";
import type { StructureOutcome } from "../analysis/analyse-structure.js";
import type { DescribeOutcome } from "../describing/describe-files.js";
import type { DescribingSettings } from "../describing/describing-settings.js";
import type { LocatedDescriber } from "../describing/locate-describer.js";
import type { ExtractOutcome } from "../scanning/extract-scans.js";
import type { PlannedSensor } from "../sensing/plan-sensors.js";
import type { Clock } from "../shared/ports/clock.js";
import type { Git } from "../shared/ports/git.js";
import type { ProcessControl } from "../shared/ports/process.js";
import type { HeldLock, Store } from "../shared/ports/store.js";
import type { FlowContext } from "./internal/flow-context.js";
import { RunRecorder } from "./internal/run-recorder.js";
import type { RunPhases } from "./phases.js";

export interface RunPorts {
  git: Git;
  store: Store;
  clock: Clock;
  process: ProcessControl;
}

export interface RunStep {
  kind: "extract" | "structure" | "describe" | "sense";
  invoke: () => unknown;
}

export function* scanFlow(
  request: ScanRequest,
  ports: RunPorts,
  phases: RunPhases,
  ctx: FlowContext,
): Generator<RunStep, ScanOutcome, unknown> {
  const { git, store, clock } = ports;
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
  let located: LocatedDescriber = { describer: null, shipped: false };
  let selected: PlannedSensor[] = [];
  let chosen: Record<string, string[]> = {};
  let folderKnown = false;

  try {
    if (!store.isDirectory(root)) {
      throw new InvalidRequest([`repository is not a directory: ${root}`]);
    }

    folderKnown = true;

    const setup = phases.readScannerSetup(root);

    named = setup.scanners;
    install = setup.install;

    const config = phases.readRunConfig(root, request.ignoreRetiredConfig);

    if (describeOn) {
      located = phases.locateDescriber(root);
    }

    const selection = phases.selectSensors({ root, config, limits, sense });

    phases.refuseShippedDescriber(located);

    const plan = phases.planSensors({
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
        ? store.openRunLog(root, startedAt, request.by, request.invocation)
        : null;
    const recorder = new RunRecorder(ctx, runLog);
    const ticked = selected.map(({ name, command }) => ({ name, command }));
    const describing: DescribingSettings | null = describeOn
      ? phases.describingSettings()
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
      return { status: "stopped" };
    }

    const { scans, missing } = extracted;
    const later = phases.findReadinessGaps({
      root,
      commit,
      sensors: ticked,
      limits,
    });

    if (later.length > 0) {
      return refuse(later);
    }

    ctx.emit({ type: "preflight", state: "ok" });
    taken?.running();

    const structure = (yield {
      kind: "structure",
      invoke: () =>
        phases.analyseStructure({
          root,
          scans,
          analysis: request.analysis,
          ignoreRetiredConfig: request.ignoreRetiredConfig,
          sink: ctx,
        }),
    }) as StructureOutcome;

    if (ctx.stopped) {
      return { status: "stopped" };
    }

    if (structure.failed) {
      recorder.failed = true;
    }

    recorder.structure(structure.phase);

    const structureMs = structure.ms ?? undefined;
    if (phases.isDescriberRegistered(located) && describeOn) {
      const described = (yield {
        kind: "describe",
        invoke: () =>
          phases.describeFiles({
            root,
            scans,
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
        return { status: "stopped" };
      }

      if (described.failed) {
        recorder.failed = true;
      }
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
            scans,
            limits,
            sink: ctx,
            recorder,
          }),
      };

      if (ctx.stopped) {
        return { status: "stopped" };
      }
    }

    runLog?.finish(recorder.recorded(), false, structureMs);

    const exit = recorder.failed ? 1 : 0;
    const firstFailed = recorder.firstFailed();

    recorder.summaryEvent(exit, root, commit, modified);

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

    throw error;
  } finally {
    taken?.release();
  }
}
