import {
  createEventReader,
  type Diagnosis,
  type EventReader,
  type Manifest,
  type ManifestRead,
  type PluginEvent,
  readManifestOf,
  type SuiteDuration,
  splitAtRun,
} from "@recognizer/core";
import type { Io, RunOptions } from "./cli.js";
import { documentValidators, manifestPorts } from "./manifest-ports.js";
import {
  fill,
  type RegisteredRun,
  runRegisteredAsync,
} from "./registered-command.js";

export const PLUGIN_GRACE_MS = 10_000;

export interface PluginLimits {
  readOf(prefix: string[]): ManifestRead;
  manifestOf(prefix: string[]): Manifest | null;
  limitMs(prefix: string[] | null): number | undefined;
  nameOf(prefix: string[] | null, fallback: string): string;
}

export function createPluginLimits(
  io: Io,
  root: string,
  graceMs: number = PLUGIN_GRACE_MS,
  known: readonly { command: string; manifest: Manifest }[] = [],
): PluginLimits & { graceMs: number } {
  const reads = new Map<string, ManifestRead>(
    known.map(({ command, manifest }) => [
      command,
      { ok: true, manifest } as ManifestRead,
    ]),
  );

  const readOf = (prefix: string[]): ManifestRead => {
    const filled = prefix.map((item) => fill(item, root, "", ""));
    const key = filled.join("\0");
    const known = reads.get(key);

    if (known !== undefined) {
      return known;
    }

    const read = readManifestOf(manifestPorts(io), filled);

    reads.set(key, read);

    return read;
  };

  const manifestOf = (prefix: string[]): Manifest | null => {
    const read = readOf(prefix);

    return read.ok ? read.manifest : null;
  };

  return {
    graceMs,
    readOf,
    manifestOf,
    limitMs: (prefix) => {
      const manifest = prefix === null ? null : manifestOf(prefix);

      if (manifest === null || manifest.long_running) {
        return undefined;
      }

      return manifest.time_limit_seconds === undefined
        ? undefined
        : manifest.time_limit_seconds * 1000;
    },
    nameOf: (prefix, fallback) =>
      (prefix === null ? null : manifestOf(prefix))?.name ?? fallback,
  };
}

export interface PluginCall {
  options: Omit<RunOptions, "cwd">;
  reader: EventReader;
  name: string;
}

export function prepareCall(
  io: Io,
  limits: PluginLimits & { graceMs: number },
  command: readonly string[],
  fallbackName: string,
  onEvent?: (name: string, event: PluginEvent) => void,
  env?: Record<string, string>,
): PluginCall {
  const prefix = splitAtRun(command)?.prefix ?? null;
  const name = limits.nameOf(prefix, fallbackName);
  const limit = limits.limitMs(prefix);
  const reader = createEventReader(
    (value) => documentValidators.event(value),
    onEvent === undefined ? undefined : (event) => onEvent(name, event),
    () => io.awake(),
  );

  return {
    name,
    reader,
    options: {
      onStderrLine: reader.line,
      ...(env === undefined ? {} : { env }),
      ...(limit === undefined ? {} : { timeoutMs: limit }),
      graceMs: limits.graceMs,
    },
  };
}

export interface PluginRun extends RegisteredRun {
  diagnosis: Diagnosis | null;
  firstWorked: number | null;
  suites: SuiteDuration[];
}

export async function runPlugin(
  io: Io,
  limits: PluginLimits & { graceMs: number },
  root: string,
  command: string[],
  commit: string,
  output: string,
  what: string,
  validate: (document: unknown, anyCommit?: boolean) => void,
  fallbackName: string,
  onEvent?: (name: string, event: PluginEvent) => void,
  env?: Record<string, string>,
  reports?: () => boolean,
): Promise<PluginRun> {
  const call = prepareCall(io, limits, command, fallbackName, onEvent, env);
  const run = await runRegisteredAsync(
    io,
    root,
    command,
    commit,
    output,
    what,
    validate,
    call.options,
    call.reader.keep,
    reports,
  );

  return {
    ...run,
    diagnosis: call.reader.diagnosis(),
    firstWorked: call.reader.firstWorked(),
    suites: call.reader.suites(),
  };
}
