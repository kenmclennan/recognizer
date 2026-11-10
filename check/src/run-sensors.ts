import type { Io } from "./cli.js";
import { validateFindings } from "./findings-document.js";
import { findingsFile, writeFindings } from "./findings-files.js";
import { runRegistered, runRegisteredAsync } from "./registered-command.js";
import { entryFrom, type RunEntry } from "./run-log.js";
import type { Scan } from "./scan.js";
import {
  parseProgressLine,
  type SensorProgress,
  stripProgress,
} from "./sensor-progress.js";
import {
  type Diagnosis,
  parseReasonLine,
  stripReason,
} from "./sensor-reason.js";
import { measuredInputs } from "./structure-sensor.js";

export const SENSOR_TIMEOUT_MS = 60_000;

const UNMEASURED = new Set<Diagnosis["code"]>([
  "tool-missing",
  "coverage-unavailable",
]);

export interface RunSensorsInput {
  io: Io;
  root: string;
  selected: { name: string; command: string[]; runsTests?: boolean }[];
  commit: string;
  scans: Scan[];
  onStart?: (name: string) => void;
  onEntry?: (entry: RunEntry) => void;
  onProgress?: (name: string, progress: SensorProgress) => void;
  timeoutMs?: number;
}

function recordInputs(
  io: Io,
  root: string,
  name: string,
  scans: Scan[],
): Diagnosis | undefined {
  const output = findingsFile(root, name);
  const document = validateFindings(JSON.parse(io.readFile(output)), { name });

  writeFindings(io, root, {
    ...document,
    findings_version: 2,
    inputs: document.inputs ?? measuredInputs(scans),
  });

  return document.diagnosis;
}

export async function runSensors(input: RunSensorsInput): Promise<RunEntry[]> {
  const { io, root, commit } = input;
  const entries: RunEntry[] = [];

  for (const { name, command, runsTests } of input.selected) {
    input.onStart?.(name);

    const output = findingsFile(root, name);
    const began = io.now();
    let refusal: Diagnosis | undefined;
    const keepStderr = (stderr: string): string => {
      for (const line of stderr.split("\n")) {
        refusal ??= parseReasonLine(line) ?? undefined;
      }

      return stripReason(stderr);
    };
    const validate = (document: unknown, anyCommit?: boolean) => {
      validateFindings(document, anyCommit ? { name } : { name, commit });
    };
    const run =
      runsTests === true
        ? await runRegisteredAsync(
            io,
            root,
            command,
            commit,
            output,
            "findings",
            validate,
            {
              env: { RECOGNIZER_PROGRESS: input.onProgress ? "1" : "0" },
              onStderrLine: (line) => {
                const progress = parseProgressLine(line);

                if (progress !== null) {
                  input.onProgress?.(name, progress);
                }
              },
            },
            (stderr) => stripProgress(keepStderr(stderr)),
          )
        : runRegistered(
            io,
            root,
            command,
            commit,
            output,
            "findings",
            validate,
            input.timeoutMs ?? SENSOR_TIMEOUT_MS,
            keepStderr,
          );
    let { reason } = run;
    let diagnosis = refusal;

    if (reason === null) {
      try {
        diagnosis = recordInputs(io, root, name, input.scans);
      } catch (error) {
        reason = `could not record inputs: ${(error as Error).message}`;
      }
    }

    if (
      reason === null &&
      diagnosis !== undefined &&
      UNMEASURED.has(diagnosis.code)
    ) {
      reason = diagnosis.line;
    }

    const entry = entryFrom(name, {
      command: run.command,
      status: run.status,
      stderr: run.stderr,
      duration_ms: io.now() - began,
      ...(reason === null ? {} : { reason }),
      ...(diagnosis === undefined ? {} : { diagnosis }),
    });

    entries.push(entry);

    if (reason !== null) {
      io.stderr(`failed ${name}: ${reason}\n`);
    }

    input.onEntry?.(entry);
  }

  return entries;
}
