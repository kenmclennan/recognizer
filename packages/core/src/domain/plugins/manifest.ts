import type { Principle } from "../principles.js";
import type { FindingEntry } from "./sentence.js";

export interface PlaceholderDeclaration {
  pattern?: string;
  values?: string[];
  description: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function placeholderPattern(
  declaration: PlaceholderDeclaration,
): string {
  return (
    declaration.pattern ??
    `^(${(declaration.values ?? []).map(escapeRegExp).join("|")})$`
  );
}

export type PluginKind = "scanner" | "sensor" | "describer";

export const MANIFEST_TIMEOUT_MS = 10_000;

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
  scan_schema_version?: number;
  metrics?: unknown[];
  findings?: FindingEntry[];
  principles?: Principle[];
  runs_tests?: boolean;
  suite_keys?: { section: unknown; keys: unknown[] };
  placeholders?: Record<string, PlaceholderDeclaration>;
  reports_tests?: boolean;
  scoped?: boolean;
  planned_work?: { verb: string };
  setup_survey?: { order: number };
  log_path?: string;
  prompt_version?: string;
  prices?: Record<string, { input: number; output: number }>;
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

export type ScanVersionVerdict = "current" | "older" | "newer" | "broken";

export type ScanSchemaJudgement = ScanVersionVerdict | "undeclared";

export interface PluginFacts {
  protocol: number;
  scanSchemaVersion: number;
  scanBreakingVersions: readonly number[];
  findingsVersion: number;
}

export function judgeScanVersion(
  found: number,
  current: number,
  breaks: readonly number[],
): ScanVersionVerdict {
  if (found === current) {
    return "current";
  }

  if (found > current) {
    return "newer";
  }

  return breaks.some((b) => found < b && b <= current) ? "broken" : "older";
}

export function interpretManifest(
  command: string,
  run: ManifestRun,
  validate: (value: unknown) => string | null,
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

  const problem = validate(document);

  return problem === null
    ? { ok: true, manifest: document as Manifest }
    : { ok: false, reason: `${command} manifest: ${problem}` };
}

export function judgeProtocol(
  manifest: { protocol: number },
  current: number,
): ProtocolJudgement {
  if (manifest.protocol === current) {
    return "current";
  }

  return current > 1 && manifest.protocol === current - 1
    ? "previous"
    : "unsupported";
}

export function judgeScanSchema(
  declared: number | undefined,
  current: number,
  breaks: readonly number[],
): ScanSchemaJudgement {
  return declared === undefined
    ? "undeclared"
    : judgeScanVersion(declared, current, breaks);
}

export function supportedRange(current: number): string {
  return current > 1
    ? `protocols ${current - 1} and ${current}`
    : `protocol ${current}`;
}

export function publishedModel(settings: readonly unknown[]): string | null {
  const entry = settings.find(
    (one) =>
      typeof one === "object" &&
      one !== null &&
      (one as Record<string, unknown>).key === "model" &&
      (one as Record<string, unknown>).scope === "machine",
  ) as Record<string, unknown> | undefined;

  return typeof entry?.default === "string" ? entry.default : null;
}
