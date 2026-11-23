import type { PluginEvent } from "@recognizer/core";
import {
  type Diagnosis,
  measuredInputs,
  type Repository,
  type SensorWork,
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
  limits?: ReturnType<typeof createPluginLimits>;
  onStart?: (name: string) => void;
  onEntry?: (entry: RunEntry) => void;
  onEvent?: (name: string, event: PluginEvent) => void;
}

function recordInputs(
  io: Io,
  root: string,
  name: string,
  repository: Repository,
): {
  diagnosis: Diagnosis | undefined;
  incomplete: boolean;
  work: SensorWork | undefined;
} {
  const output = findingsFile(root, name);
  const document = readSensorFindings(JSON.parse(io.readFile(output)), {
    name,
  });

  writeFindings(io, root, {
    ...document,
    inputs: document.inputs ?? measuredInputs(repository),
  });

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

function moduleCount(repository: Repository): number {
  return repository.files.length;
}

export async function runSensors(input: RunSensorsInput): Promise<RunEntry[]> {
  const { io, root, commit } = input;
  const entries: RunEntry[] = [];
  const limits = input.limits ?? createPluginLimits(io, root);

  for (const { name, command, runsTests, modules } of input.selected) {
    input.onStart?.(name);

    const output = findingsFile(root, name);
    const began = io.awake();
    const validate = (document: unknown, anyCommit?: boolean) => {
      readSensorFindings(document, anyCommit ? { name } : { name, commit });
    };
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
      input.onEvent,
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

    if (reason === null) {
      try {
        const recorded = recordInputs(io, root, name, input.repository);

        diagnosis = recorded.diagnosis;
        incomplete = recorded.incomplete;
        work =
          recorded.work === undefined
            ? undefined
            : { unit: recorded.work.unit, performed: recorded.work.performed };
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
