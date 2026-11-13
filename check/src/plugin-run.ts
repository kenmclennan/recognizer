import type { Io, RunOptions } from "./cli.js";
import {
  createEventReader,
  type Diagnosis,
  type EventReader,
  type PluginEvent,
} from "./plugin-events.js";
import {
  type Manifest,
  type ManifestRead,
  readManifestOf,
} from "./plugin-manifest.js";
import {
  fill,
  type RegisteredRun,
  runRegisteredAsync,
} from "./registered-command.js";

export const PLUGIN_GRACE_MS = 10_000;

export function pluginPrefix(command: readonly string[]): string[] | null {
  const at = command.indexOf("run");

  return at === -1 ? null : command.slice(0, at);
}

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

    const read = readManifestOf(io, filled);

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
): PluginCall {
  const prefix = pluginPrefix(command);
  const name = limits.nameOf(prefix, fallbackName);
  const limit = limits.limitMs(prefix);
  const reader = createEventReader(
    onEvent === undefined ? undefined : (event) => onEvent(name, event),
    () => io.now(),
  );

  return {
    name,
    reader,
    options: {
      onStderrLine: reader.line,
      ...(limit === undefined ? {} : { timeoutMs: limit }),
      graceMs: limits.graceMs,
    },
  };
}

export interface PluginRun extends RegisteredRun {
  diagnosis: Diagnosis | null;
  firstWorked: number | null;
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
): Promise<PluginRun> {
  const call = prepareCall(io, limits, command, fallbackName, onEvent);
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
  );

  return {
    ...run,
    diagnosis: call.reader.diagnosis(),
    firstWorked: call.reader.firstWorked(),
  };
}
