import type { Io } from "./cli.js";
import validate from "./generated/manifest-validator.js";
import protocol from "./generated/protocol.json" with { type: "json" };
import type { FindingEntry } from "./plugin-sentence.js";

export const CURRENT_PROTOCOL: number = protocol.protocol;

export const MANIFEST_TIMEOUT_MS = 10_000;

export type PluginKind = "scanner" | "sensor" | "describer";

export interface Manifest {
  kind: PluginKind;
  name: string;
  display: string;
  description?: string;
  expansion?: string;
  settings_title?: string;
  version: string;
  protocol: number;
  install: string;
  check: boolean;
  long_running: boolean;
  time_limit_seconds?: number;
  units: string[];
  settings: unknown[];
  languages?: unknown[];
  metrics?: unknown[];
  findings?: FindingEntry[];
  runs_tests?: boolean;
  scoped?: boolean;
  prompt_version?: string;
}

export type ManifestRead =
  | { ok: true; manifest: Manifest }
  | { ok: false; reason: string };

export type ProtocolJudgement = "current" | "previous" | "unsupported";

export interface ManifestRun {
  started: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export function runManifest(
  io: Io,
  command: string,
  cwd?: string,
  leading: string[] = [],
): ManifestRun {
  return io.run(command, [...leading, "manifest"], {
    timeoutMs: MANIFEST_TIMEOUT_MS,
    ...(cwd === undefined ? {} : { cwd }),
  });
}

export function validateManifest(value: unknown): string | null {
  if (validate(value)) {
    return null;
  }

  const first = validate.errors?.[0];

  return first === undefined
    ? "the manifest is invalid"
    : `${first.instancePath === "" ? "the manifest" : first.instancePath} ${first.message ?? "is invalid"}`;
}

export function interpretManifest(
  command: string,
  run: ManifestRun,
): ManifestRead {
  if (!run.started) {
    return { ok: false, reason: `${command} could not be started` };
  }

  if (run.timedOut === true) {
    return { ok: false, reason: `${command} manifest timed out` };
  }

  if (run.status !== 0) {
    return {
      ok: false,
      reason: `${command} manifest exited ${run.status ?? "without a status"}`,
    };
  }

  let document: unknown;

  try {
    document = JSON.parse(run.stdout);
  } catch {
    return { ok: false, reason: `${command} manifest did not print JSON` };
  }

  const problem = validateManifest(document);

  return problem === null
    ? { ok: true, manifest: document as Manifest }
    : { ok: false, reason: `${command} manifest: ${problem}` };
}

export function readManifest(io: Io, command: string): ManifestRead {
  return interpretManifest(command, runManifest(io, command));
}

export function readManifestOf(io: Io, prefix: string[]): ManifestRead {
  const [program, ...leading] = prefix as [string, ...string[]];

  return interpretManifest(
    prefix.join(" "),
    runManifest(io, program, undefined, leading),
  );
}

export function judgeProtocol(
  manifest: { protocol: number },
  current: number = CURRENT_PROTOCOL,
): ProtocolJudgement {
  if (manifest.protocol === current) {
    return "current";
  }

  return current > 1 && manifest.protocol === current - 1
    ? "previous"
    : "unsupported";
}
