import {
  type Accumulated,
  type DeclaredMetric,
  type Diagnosis,
  type FindingsRepository,
  measuredInputs,
  type PluginEvent,
  type Repository,
  ResultAccumulator,
  type RunScope,
  type SensorFindings,
  type SensorWork,
  type SettleEnding,
  splitAtRun,
} from "@recognizer/core";
import { readSensorFindings } from "./adapters/filesystem/findings-translator.js";
import type { Io } from "./cli.js";
import { findingsFile, writeFindings } from "./findings-files.js";
import { createPluginLimits, runPlugin } from "./plugin-run.js";
import { type EntryWork, entryFrom, type RunEntry } from "./run-log.js";

export interface RunSensorsInput {
  io: Io;
  root: string;
  selected: {
    name: string;
    command: string[];
    runsTests?: boolean;
    modules?: number;
  }[];
  commit: string;
  repository: Repository;
  findings: FindingsRepository;
  scope?: RunScope;
  modified?: boolean | null;
  limits?: ReturnType<typeof createPluginLimits>;
  onStart?: (name: string) => void;
  onEntry?: (entry: RunEntry) => void;
  onEvent?: (name: string, event: PluginEvent) => void;
}

function declaredMetrics(metrics: unknown[] | undefined): DeclaredMetric[] {
  return (metrics ?? []).map((one) => {
    const { name, type, granularity, bad } = one as DeclaredMetric;

    return { name, type, granularity, bad };
  });
}

const REPORTING_ENV = { RECOGNIZER_PROTOCOL: "4" };

interface Recorded {
  diagnosis: Diagnosis | undefined;
  incomplete: boolean;
  work: SensorWork | undefined;
}

function recordedOf(document: SensorFindings): Recorded {
  return {
    diagnosis: document.diagnosis,
    incomplete:
      document.stopped !== undefined ||
      (document.suites ?? []).some(
        (suite) => suite.status === "partial" && suite.ran !== false,
      ),
    work: document.work,
  };
}

function recordInputs(
  io: Io,
  root: string,
  name: string,
  repository: Repository,
): Recorded {
  const output = findingsFile(root, name);
  const document = readSensorFindings(JSON.parse(io.readFile(output)), {
    name,
  });

  writeFindings(io, root, {
    ...document,
    inputs: document.inputs ?? measuredInputs(repository),
  });

  return recordedOf(document);
}

function moduleCount(repository: Repository): number {
  return repository.files.length;
}

export async function runSensors(input: RunSensorsInput): Promise<RunEntry[]> {
  const { io, root, commit } = input;
  const entries: RunEntry[] = [];
  const limits = input.limits ?? createPluginLimits(io, root);

  for (const { name, command, runsTests, modules } of input.selected) {
    input.onStart?.(name);

    const scope: RunScope = input.scope ?? { kind: "working-tree" };
    const output = findingsFile(root, name, scope);
    const began = io.awake();
    const validate = (document: unknown, anyCommit?: boolean) => {
      readSensorFindings(document, anyCommit ? { name } : { name, commit });
    };
    const prefix = splitAtRun(command)?.prefix ?? null;
    const manifest = prefix === null ? null : limits.manifestOf(prefix);
    const accumulator = new ResultAccumulator({
      name,
      version: manifest?.version ?? "0",
      metrics: declaredMetrics(manifest?.metrics),
      commit,
      scope,
    });
    const fallback = { modified: input.modified ?? true };
    const documentOf = (accumulated: Accumulated): SensorFindings =>
      readSensorFindings(
        {
          ...accumulated.document,
          inputs:
            accumulated.document.inputs ?? measuredInputs(input.repository),
        },
        { name, commit },
      );
    const stage = (accumulated: Accumulated): SensorFindings => {
      const document = documentOf(accumulated);

      input.findings.stage(root, scope, document, accumulated.overlay);

      return document;
    };
    let staging: string | null = null;
    const take = (given: string, event: PluginEvent): void => {
      if (event.event !== "result" && event.event !== "settled") {
        accumulator.take(event);
        input.onEvent?.(given, event);

        return;
      }

      try {
        accumulator.take(event);

        if (event.event === "settled") {
          stage(accumulator.render(fallback));
        }
      } catch (error) {
        staging ??= (error as Error).message;
      }
    };
    const reporting = (): boolean =>
      accumulator.hasSettled() ||
      accumulator.hasResults() ||
      accumulator.refused() > 0;
    const run = await runPlugin(
      io,
      limits,
      root,
      command,
      commit,
      output,
      "findings",
      validate,
      name,
      take,
      REPORTING_ENV,
      reporting,
    );
    let { reason } = run;
    let diagnosis: Diagnosis | undefined = run.diagnosis ?? undefined;
    let incomplete = false;
    let work: EntryWork | undefined;

    if (
      reason !== null &&
      run.diagnosis !== null &&
      run.status !== null &&
      run.status !== 0 &&
      reason !== "timed out"
    ) {
      reason = run.diagnosis.line;
    }

    const noted = (recorded: Recorded, reported: boolean): void => {
      diagnosis = reported ? (run.diagnosis ?? undefined) : recorded.diagnosis;
      incomplete = recorded.incomplete;
      work =
        recorded.work === undefined
          ? undefined
          : { unit: recorded.work.unit, performed: recorded.work.performed };
    };

    if (reporting()) {
      const sound = reason === null;
      const refused = accumulator.refused() > 0 || staging !== null;
      const complete =
        sound &&
        !refused &&
        accumulator.hasSettled() &&
        !accumulator.hasUnsettledTail();
      const ending: SettleEnding = complete ? "complete" : "checkpoint";

      if (sound && !complete) {
        reason = refused
          ? `a result was refused: ${accumulator.firstReason() ?? staging}`
          : "the plugin ended without settling its results";
      }

      try {
        const document = stage(
          complete
            ? accumulator.complete(fallback)
            : accumulator.demoted(fallback),
        );

        input.findings.settle(root, scope, name, ending);
        noted(recordedOf(document), true);
      } catch (error) {
        reason ??= `could not record inputs: ${(error as Error).message}`;
      }
    } else if (reason === null) {
      try {
        noted(recordInputs(io, root, name, input.repository), false);
      } catch (error) {
        reason = `could not record inputs: ${(error as Error).message}`;
      }
    }

    if (reason === null && diagnosis?.unmeasured === true) {
      reason = diagnosis.line;
    }

    const finished = io.awake();
    const fixedFrom = run.firstWorked ?? (runsTests === true ? finished : null);
    const entry = entryFrom(name, {
      command: run.command,
      status: run.status,
      stderr: run.stderr,
      duration_ms: finished - began,
      modules: modules ?? moduleCount(input.repository),
      ...(fixedFrom === null ? {} : { fixed_ms: fixedFrom - began }),
      ...(incomplete ? { incomplete: true } : {}),
      ...(work === undefined ? {} : { work }),
      ...(reason === null ? { suites: run.suites } : {}),
      ...(reason === null ? {} : { reason }),
      ...(run.stopped === true ? { stopped: true } : {}),
      ...(diagnosis === undefined ? {} : { diagnosis }),
    });

    entries.push(entry);

    if (run.stopped === true) {
      io.stderr(`stopped ${name}\n`);
    } else if (reason !== null) {
      io.stderr(`failed ${name}: ${reason}\n`);
    }

    input.onEntry?.(entry);
  }

  return entries;
}
