import type { Io } from "./cli.js";
import { validateFindings } from "./findings-document.js";
import { findingsFile } from "./findings-files.js";
import { runRegistered } from "./registered-command.js";
import { entryFrom, type RunEntry } from "./run-log.js";

export const SENSOR_TIMEOUT_MS = 60_000;

export interface RunSensorsInput {
  io: Io;
  root: string;
  selected: { name: string; command: string[]; runsTests?: boolean }[];
  commit: string;
  onStart?: (name: string) => void;
  onEntry?: (entry: RunEntry) => void;
  timeoutMs?: number;
}

export function runSensors(input: RunSensorsInput): RunEntry[] {
  const { io, root, commit } = input;
  const entries: RunEntry[] = [];

  for (const { name, command, runsTests } of input.selected) {
    input.onStart?.(name);

    const output = findingsFile(root, name);
    const began = io.now();
    const run = runRegistered(
      io,
      root,
      command,
      commit,
      output,
      "findings",
      (document) => {
        validateFindings(document, { name, commit });
      },
      runsTests === true ? undefined : (input.timeoutMs ?? SENSOR_TIMEOUT_MS),
    );
    const { reason } = run;
    const entry = entryFrom(name, {
      command: run.command,
      status: run.status,
      stderr: run.stderr,
      duration_ms: io.now() - began,
      ...(reason === null ? {} : { reason }),
    });

    entries.push(entry);

    if (reason !== null) {
      io.remove(output);
      io.stderr(`failed ${name}: ${reason}\n`);
    }

    input.onEntry?.(entry);
  }

  return entries;
}
