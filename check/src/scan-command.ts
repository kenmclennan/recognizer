import { join, relative, resolve } from "node:path";
import { readDescribing } from "./app-settings.js";
import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import { registeredSensors } from "./config-parse.js";
import {
  type DescribeInput,
  type DescribeResult,
  type Describer,
  describeModules,
  describeSummaryText,
  readResponsibilities,
} from "./describe-modules.js";
import { describerInEffect } from "./describer-in-effect.js";
import { detectLanguages, type Language } from "./detect.js";
import { InputError } from "./errors.js";
import { findingsFile } from "./findings-files.js";
import { readPolicy } from "./load-findings.js";
import {
  entryFrom,
  openPhasedRunLog,
  type RunEntry,
  type RunPhase,
  requireBy,
} from "./run-log.js";
import { type RunSensorsInput, runSensors } from "./run-sensors.js";
import {
  type RecordedScan,
  SCAN_SCHEMA_VERSION,
  type Scan,
  validateScan,
} from "./scan.js";
import {
  type EventEntry,
  entryLine,
  extractionNeeded,
  extractionPrecheck,
  parseModuleScope,
  parseScanArgs,
  phaseLine,
  progressLine,
  selectSensors,
  startLine,
  summaryLine,
} from "./scan-phases.js";
import {
  buildArgs,
  notInstalledMessage,
  resolveCommand,
  SCANNERS,
  scannerFor,
} from "./scanners.js";
import type { SensorProgress } from "./sensor-progress.js";
import { isScoped, runsTests, shippedSensorNames } from "./shipped-sensors.js";
import { runStructureSensor } from "./structure-run.js";
import { resolveStructureSettings } from "./structure-sensor.js";

type FailureReason =
  | "not-installed"
  | "invalid-override"
  | "scanner-failed"
  | "invalid-scan"
  | "unknown-schema-version";

type Outcome =
  | { ok: true; bytes: string; modules: number; edges: number }
  | { ok: false; reason: FailureReason; message: string };

const CACHE = ".recognizer/cache";

export function cacheFile(root: string, language: Language): string {
  return join(root, CACHE, `scan.${language}.json`);
}

export function resolveCommit(io: Io, root: string): string | null {
  const result = io.run("git", ["-C", root, "rev-parse", "HEAD"]);
  const commit = result.stdout.trim();

  return result.started && result.status === 0 && commit !== "" ? commit : null;
}

export function isDirty(io: Io, root: string): boolean {
  const result = io.run("git", [
    "-C",
    root,
    "status",
    "--porcelain",
    "--",
    ".",
    ":!.recognizer",
  ]);

  return !result.started || result.status !== 0 || result.stdout.trim() !== "";
}

function failure(reason: FailureReason, message: string): Outcome {
  return { ok: false, reason, message };
}

function checkScan(bytes: string): Outcome {
  let parsed: unknown;

  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    return failure(
      "invalid-scan",
      `output is not valid JSON: ${(error as Error).message}`,
    );
  }

  const version = (parsed as { schema_version?: unknown } | null)
    ?.schema_version;

  if (typeof version === "number" && version !== SCAN_SCHEMA_VERSION) {
    return failure(
      "unknown-schema-version",
      `scan has schema_version ${version}, recognizer accepts ${SCAN_SCHEMA_VERSION}`,
    );
  }

  try {
    const scan = validateScan(parsed);

    return {
      ok: true,
      bytes,
      modules: scan.modules.length,
      edges: scan.edges.length,
    };
  } catch (error) {
    const messages =
      error instanceof InputError ? error.messages : [(error as Error).message];

    return failure("invalid-scan", messages.join("; "));
  }
}

interface Scanned {
  outcome: Outcome;
  command: string[];
  status: number | null;
  stderr: string;
  duration_ms: number;
}

function runScanner(
  io: Io,
  language: Language,
  root: string,
  commit: string | null,
  modified: boolean | null,
): Scanned {
  const spec = scannerFor(language);
  const resolution = resolveCommand(io, spec);

  if (!resolution.ok) {
    return {
      outcome: failure("invalid-override", resolution.message),
      command: [],
      status: null,
      stderr: "",
      duration_ms: 0,
    };
  }

  const directory = io.makeTempDir();

  try {
    const output = join(directory, `scan.${language}.json`);
    const args = buildArgs(root, output, commit, modified);
    const began = io.now();
    const result = io.run(resolution.command, args);
    const scanned = (outcome: Outcome): Scanned => ({
      outcome,
      command: [resolution.command, ...args],
      status: result.started ? result.status : null,
      stderr: result.stderr,
      duration_ms: io.now() - began,
    });

    if (!result.started) {
      return scanned(failure("not-installed", notInstalledMessage(spec)));
    }

    if (result.status !== 0) {
      return scanned(
        failure(
          "scanner-failed",
          `exit ${result.status}: ${result.stderr.trim()}`,
        ),
      );
    }

    let bytes: string;

    try {
      bytes = io.readFile(output);
    } catch {
      return scanned(failure("invalid-scan", "scanner wrote no output file"));
    }

    return scanned(checkScan(bytes));
  } finally {
    io.removeDir(directory);
  }
}

function removeIfPresent(io: Io, path: string, removed: string[]): void {
  if (io.exists(path)) {
    io.remove(path);
    removed.push(path);
  }
}

export function readCachedScan(
  io: Io,
  root: string,
  language: Language,
): RecordedScan | null {
  try {
    return validateScan(
      JSON.parse(io.readFile(cacheFile(root, language))),
    ) as RecordedScan;
  } catch {
    return null;
  }
}

function installedVersion(io: Io, language: Language): string | null {
  const resolution = resolveCommand(io, scannerFor(language));

  if (!resolution.ok) {
    return null;
  }

  const result = io.run(resolution.command, ["--version"]);

  return result.started && result.status === 0 ? result.stdout.trim() : null;
}

function decideExtraction(
  io: Io,
  root: string,
  detected: Language[],
  force: boolean,
  commit: string | null,
  dirty: boolean,
) {
  const languages = detected.map((language) => {
    const cached = readCachedScan(io, root, language);

    return {
      language,
      cachedScan:
        cached === null
          ? null
          : {
              commit: cached.commit,
              modified: cached.modified !== false,
              scannerVersion: cached.scanner.version,
            },
    };
  });
  const early = extractionPrecheck({ force, commit, dirty, languages });

  if (early !== null) {
    return early;
  }

  return extractionNeeded({
    force,
    commit,
    dirty,
    languages: languages.map((one) => ({
      ...one,
      installedVersion: installedVersion(io, one.language),
    })),
  });
}

function eventEntry(entry: RunEntry): EventEntry {
  return {
    name: entry.name,
    outcome: entry.outcome,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
  };
}

function readModulesFile(io: Io, file: string): string {
  try {
    return io.readFile(resolve(file));
  } catch (error) {
    throw new InputError([
      `cannot read --modules file ${file}: ${(error as Error).message}`,
    ]);
  }
}

type ScanStep =
  | { kind: "describe"; input: DescribeInput }
  | { kind: "sense"; input: RunSensorsInput };

function* scanFlow(
  argv: string[],
  io: Io,
): Generator<ScanStep, number, DescribeResult | undefined> {
  const options = parseScanArgs(argv);

  requireBy(options.by);

  const scope =
    options.modules === undefined
      ? undefined
      : parseModuleScope(readModulesFile(io, options.modules));
  const startedAt = io.now();
  const root = resolve(options.positionals[0] ?? ".");

  try {
    io.readDir(root);
  } catch {
    throw new InputError([`repository is not a directory: ${root}`]);
  }

  const wantsConfig = options.describe !== false || options.sense !== null;
  const config = wantsConfig ? readConfig(io, root) : null;
  let describer: Describer | undefined;

  if (options.describe !== false) {
    const { source: _source, ...found } = describerInEffect(io, root);

    describer = found;
    readResponsibilities(io, root);
  }

  const selected =
    options.sense === null
      ? []
      : selectSensors(
          registeredSensors(config),
          options.sense,
          shippedSensorNames(),
        );
  const commit = resolveCommit(io, root);

  if (options.sense !== null && commit === null) {
    throw new InputError(["not a git repository, or no commit"]);
  }

  const modified = commit === null ? null : isDirty(io, root);
  const detected = detectLanguages(io, root);
  const json = options.json;
  const removed: string[] = [];
  const phases: RunPhase[] = [];
  const summary = new Map<RunPhase["phase"], EventEntry[]>();
  const runLog =
    detected.length > 0 || wantsConfig
      ? openPhasedRunLog(io, root, startedAt, options.by, argv)
      : null;
  let failed = false;

  const startPhase = (phase: RunPhase["phase"]): RunPhase => {
    const one: RunPhase = { phase, entries: [] };

    phases.push(one);
    summary.set(phase, []);

    if (!json) {
      io.stdout(`${phase}\n`);
    }

    return one;
  };

  const finishEntry = (
    phase: RunPhase,
    entry: RunEntry,
    extra: Partial<EventEntry> = {},
  ) => {
    const shown = { ...eventEntry(entry), ...extra };

    phase.entries.push(entry);
    summary.get(phase.phase)?.push(shown);
    runLog?.update(phases);

    if (json) {
      io.stdout(entryLine(phase.phase, shown));
    }

    if (entry.outcome === "failed") {
      failed = true;
    }
  };

  if (detected.length === 0) {
    io.stderr("no languages detected\n");
  }

  const decision = decideExtraction(
    io,
    root,
    detected,
    options.extract,
    commit,
    modified === true,
  );
  const extract = startPhase("extract");

  if (json) {
    io.stdout(
      phaseLine(
        "extract",
        decision.run
          ? { state: "run", commit, reason: decision.reason }
          : { state: "current", commit: decision.commit },
      ),
    );
  } else if (!decision.run) {
    io.stdout(`scans current at ${decision.commit}\n`);
  }

  for (const spec of SCANNERS) {
    const file = cacheFile(root, spec.language);
    const shown = relative(root, file);

    if (!detected.includes(spec.language)) {
      const before = removed.length;

      removeIfPresent(io, file, removed);

      if (removed.length > before) {
        io.stderr(`${spec.language}: removed stale ${shown}\n`);
      }

      continue;
    }

    if (!decision.run) {
      continue;
    }

    const scanned = runScanner(io, spec.language, root, commit, modified);
    const { outcome } = scanned;
    const entry = entryFrom(spec.language, {
      command: scanned.command,
      status: scanned.status,
      stderr: scanned.stderr,
      duration_ms: scanned.duration_ms,
      ...(outcome.ok
        ? {}
        : { reason: `${outcome.reason} - ${outcome.message}` }),
    });

    if (outcome.ok) {
      io.writeFile(file, outcome.bytes);

      if (!json) {
        io.stdout(
          `${spec.language}: ${outcome.modules} modules, ${outcome.edges} edges -> ${shown}\n`,
        );
      }

      finishEntry(extract, entry, {
        modules: outcome.modules,
        edges: outcome.edges,
      });

      continue;
    }

    io.stderr(`${spec.language}: ${outcome.reason} - ${outcome.message}\n`);

    const before = removed.length;

    removeIfPresent(io, file, removed);

    if (removed.length > before) {
      io.stderr(`${spec.language}: removed stale ${shown}\n`);
    }

    finishEntry(extract, entry);
  }

  const scans = detected
    .map((language) => readCachedScan(io, root, language))
    .filter((scan): scan is RecordedScan => scan !== null);

  if (runStructure(io, root, scans)) {
    failed = true;
  }

  if (describer !== undefined && options.describe !== false) {
    const phase = startPhase("describe");

    for (const language of detected) {
      if (readCachedScan(io, root, language) === null) {
        io.stderr(`skipped: no scan for ${language}\n`);
      }
    }

    const { model, batch_size: batchSize } = readDescribing(io);
    const result = (yield {
      kind: "describe",
      input: {
        io,
        root,
        scans,
        describer,
        model,
        batchSize,
        selection: {
          kind: options.describe === "all" ? "all" : "stale",
          ...(scope === undefined ? {} : { within: scope }),
        },
        onStart: (total) => {
          if (json) {
            io.stdout(phaseLine("describe", { total }));
          }
        },
        onEntry: (entry) => {
          finishEntry(phase, entry);

          if (!json && entry.outcome === "ok") {
            io.stdout(`described ${entry.name}\n`);
          }
        },
      },
    }) as DescribeResult;

    if (!json) {
      io.stdout(describeSummaryText(result));
    }
  }

  if (options.sense !== null && commit !== null) {
    const phase = startPhase("sense");

    if (json) {
      io.stdout(phaseLine("sense", { total: selected.length }));
    }

    yield {
      kind: "sense",
      input: {
        io,
        root,
        selected: selected.map((one) => ({
          ...one,
          command:
            options.modules !== undefined && isScoped(one.command)
              ? [...one.command, "--modules", resolve(options.modules)]
              : one.command,
          runsTests: runsTests(one.command),
        })),
        commit,
        onStart: (name) => {
          if (json) {
            io.stdout(startLine("sense", name));
          }
        },
        ...(json
          ? {
              onProgress: (name: string, progress: SensorProgress) => {
                io.stdout(progressLine("sense", name, progress));
              },
            }
          : {}),
        onEntry: (entry) => {
          finishEntry(phase, entry);

          if (!json) {
            io.stdout(
              `${entry.outcome === "ok" ? "ran" : "failed"} ${entry.name}\n`,
            );
          }
        },
      },
    };
  }

  runLog?.finish(phases);

  const exit = failed ? 1 : 0;

  if (json) {
    io.stdout(
      summaryLine({
        repository: root,
        commit,
        modified,
        exit,
        phases: phases.map((one) => ({
          phase: one.phase,
          entries: summary.get(one.phase) ?? [],
        })),
        removed,
        log: runLog?.id() ?? null,
      }),
    );
  }

  return exit;
}

export function runScanSync(argv: string[], io: Io): number {
  const flow = scanFlow(argv, io);
  const step = flow.next();

  if (!step.done) {
    throw new Error("a synchronous scan cannot describe or sense");
  }

  return step.value;
}

export async function runScan(argv: string[], io: Io): Promise<number> {
  const flow = scanFlow(argv, io);
  let step = flow.next();

  while (!step.done) {
    if (step.value.kind === "sense") {
      await runSensors(step.value.input);
      step = flow.next(undefined);
    } else {
      step = flow.next(await describeModules(step.value.input));
    }
  }

  return step.value;
}

function runStructure(io: Io, root: string, scans: Scan[]): boolean {
  if (scans.length === 0) {
    return false;
  }

  try {
    const settings = resolveStructureSettings(readConfig(io, root));

    if (settings === "off") {
      io.remove(findingsFile(root, "structure"));

      return false;
    }

    const run = runStructureSensor(
      io,
      root,
      scans,
      readPolicy(io, root),
      settings,
    );

    if (run.error !== null) {
      io.stderr(`failed structure: ${run.error}\n`);

      return true;
    }

    return false;
  } catch (error) {
    io.stderr(`failed structure: ${(error as Error).message}\n`);

    return true;
  }
}
