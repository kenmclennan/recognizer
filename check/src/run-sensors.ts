import type { Io } from "./cli.js";
import { validateFindings } from "./findings-document.js";
import { findingsFile, writeFindings } from "./findings-files.js";
import type { Diagnosis, PluginEvent } from "./plugin-events.js";
import { createPluginLimits, runPlugin } from "./plugin-run.js";
import { entryFrom, type RunEntry } from "./run-log.js";
import type { Scan } from "./scan.js";
import { measuredInputs } from "./structure-sensor.js";

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
  scans: Scan[];
  onStart?: (name: string) => void;
  onEntry?: (entry: RunEntry) => void;
  onEvent?: (name: string, event: PluginEvent) => void;
}

function recordInputs(
  io: Io,
  root: string,
  name: string,
  scans: Scan[],
): { diagnosis: Diagnosis | undefined; incomplete: boolean } {
  const output = findingsFile(root, name);
  const document = validateFindings(JSON.parse(io.readFile(output)), { name });

  writeFindings(io, root, {
    ...document,
    findings_version: 2,
    inputs: document.inputs ?? measuredInputs(scans),
  });

  return {
    diagnosis: document.diagnosis,
    incomplete:
      document.stopped !== undefined ||
      (document.suites ?? []).some((suite) => suite.status === "partial"),
  };
}

function moduleCount(scans: Scan[]): number {
  return scans.reduce((total, scan) => total + scan.modules.length, 0);
}

export async function runSensors(input: RunSensorsInput): Promise<RunEntry[]> {
  const { io, root, commit } = input;
  const entries: RunEntry[] = [];
  const limits = createPluginLimits(io, root);

  for (const { name, command, runsTests, modules } of input.selected) {
    input.onStart?.(name);

    const output = findingsFile(root, name);
    const began = io.now();
    const validate = (document: unknown, anyCommit?: boolean) => {
      validateFindings(document, anyCommit ? { name } : { name, commit });
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
        const recorded = recordInputs(io, root, name, input.scans);

        diagnosis = recorded.diagnosis;
        incomplete = recorded.incomplete;
      } catch (error) {
        reason = `could not record inputs: ${(error as Error).message}`;
      }
    }

    if (reason === null && diagnosis?.unmeasured === true) {
      reason = diagnosis.line;
    }

    const finished = io.now();
    const fixedFrom = run.firstWorked ?? (runsTests === true ? finished : null);
    const entry = entryFrom(name, {
      command: run.command,
      status: run.status,
      stderr: run.stderr,
      duration_ms: finished - began,
      modules: modules ?? moduleCount(input.scans),
      ...(fixedFrom === null ? {} : { fixed_ms: fixedFrom - began }),
      ...(incomplete ? { incomplete: true } : {}),
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
