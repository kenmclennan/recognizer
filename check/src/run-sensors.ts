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
import { measuredInputs } from "./structure-sensor.js";

export const SENSOR_TIMEOUT_MS = 60_000;

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

function recordInputs(io: Io, root: string, name: string, scans: Scan[]): void {
  const output = findingsFile(root, name);
  const document = validateFindings(JSON.parse(io.readFile(output)), { name });

  writeFindings(io, root, {
    ...document,
    findings_version: 2,
    inputs: document.inputs ?? measuredInputs(scans),
  });
}

export async function runSensors(input: RunSensorsInput): Promise<RunEntry[]> {
  const { io, root, commit } = input;
  const entries: RunEntry[] = [];

  for (const { name, command, runsTests } of input.selected) {
    input.onStart?.(name);

    const output = findingsFile(root, name);
    const began = io.now();
    const validate = (document: unknown) => {
      validateFindings(document, { name, commit });
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
            stripProgress,
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
          );
    let { reason } = run;

    if (reason === null) {
      try {
        recordInputs(io, root, name, input.scans);
      } catch (error) {
        reason = `could not record inputs: ${(error as Error).message}`;
      }
    }

    const entry = entryFrom(name, {
      command: run.command,
      status: run.status,
      stderr: run.stderr,
      duration_ms: io.now() - began,
      ...(reason === null ? {} : { reason }),
    });

    entries.push(entry);

    if (reason !== null) {
      io.stderr(`failed ${name}: ${reason}\n`);
    }

    input.onEntry?.(entry);
  }

  return entries;
}
