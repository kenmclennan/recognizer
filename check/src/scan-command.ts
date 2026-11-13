import { join, relative, resolve } from "node:path";
import { type Describing, readDescribing } from "./app-settings.js";
import type { Io } from "./cli.js";
import { policyFile, readConfig } from "./config.js";
import {
  type ConfigRead,
  readsAnyConfig,
  readsSensors,
  registeredSensors,
} from "./config-parse.js";
import {
  type DescribeInput,
  type DescribeResult,
  type Describer,
  describeModules,
  describeSummaryText,
  readResponsibilities,
  stopCauseText,
} from "./describe-modules.js";
import {
  type DescribeProjection,
  projectionText,
} from "./describe-projection.js";
import { findDescriber } from "./describer-in-effect.js";
import { detectLanguages, type Language } from "./detect.js";
import type { Parsers } from "./duplication/parsers.js";
import { loadParsers } from "./duplication/parsers.js";
import { errorText, InputError } from "./errors.js";
import { findingsFile } from "./findings-files.js";
import { type Gap, gapText, preflightLine } from "./gap.js";
import { readPolicy } from "./load-findings.js";
import { warnPolicyProblems } from "./policy-problems.js";
import { earlyGaps, readinessGaps } from "./preflight.js";
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
import { awaitDescribeAnswer } from "./scan-answer.js";
import {
  acquireMarker,
  type HeldMarker,
  REFUSED_EXIT,
  type RunSummary,
  refusalText,
} from "./scan-marker.js";
import {
  type EventEntry,
  entryLine,
  extractionNeeded,
  extractionPrecheck,
  parseModuleScope,
  parseScanArgs,
  parseSuiteSelection,
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

export function dirtyPaths(io: Io, root: string): string[] | null {
  const result = io.run("git", [
    "-C",
    root,
    "status",
    "--porcelain",
    "--",
    ".",
    ":!.recognizer",
  ]);

  if (!result.started || result.status !== 0) {
    return null;
  }

  return result.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3));
}

export function isDirty(io: Io, root: string): boolean {
  const paths = dirtyPaths(io, root);

  return paths === null || paths.length > 0;
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
    ...(entry.diagnosis === undefined ? {} : { diagnosis: entry.diagnosis }),
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

function readSuitesFile(io: Io, file: string): string {
  try {
    return io.readFile(resolve(file));
  } catch (error) {
    throw new InputError([
      `cannot read --suites file ${file}: ${(error as Error).message}`,
    ]);
  }
}

type ScanStep =
  | { kind: "describe"; input: DescribeInput }
  | { kind: "sense"; input: RunSensorsInput }
  | { kind: "parsers"; languages: string[] };

type ScanAnswer = DescribeResult | Parsers | Error | null | undefined;

function* scanFlow(
  argv: string[],
  io: Io,
  takeMarker: boolean,
  read: ConfigRead,
): Generator<ScanStep, number, ScanAnswer> {
  const options = parseScanArgs(argv);

  requireBy(options.by);

  const scope =
    options.modules === undefined
      ? undefined
      : parseModuleScope(readModulesFile(io, options.modules));
  const startedAt = io.now();
  const root = resolve(options.positionals[0] ?? ".");

  const wantsConfig = options.describe !== false || options.sense !== null;
  let describer: Describer | undefined;
  let selected: ReturnType<typeof selectSensors> = [];
  let folderKnown = false;
  const chosen: Record<string, string[]> = {};
  let explicit: Record<string, string[]> = {};

  try {
    try {
      io.readDir(root);
    } catch {
      throw new InputError([`repository is not a directory: ${root}`]);
    }

    folderKnown = true;

    const config = readsAnyConfig(read)
      ? readConfig(io, root, read, { skipRetired: options.ignoreRetiredConfig })
      : null;

    if (options.describe !== false) {
      const found = findDescriber(io, root);

      if (found !== null) {
        const { source: _source, ...rest } = found;

        describer = rest;
      }

      readResponsibilities(io, root);
    }

    selected =
      options.sense === null
        ? []
        : selectSensors(
            registeredSensors(config),
            options.sense,
            shippedSensorNames(),
            config?.tests,
          );

    const configured = (config?.tests ?? []).map((suite) => suite.name);
    const given =
      options.suites === undefined
        ? {}
        : parseSuiteSelection(
            readSuitesFile(io, options.suites),
            configured,
            selected.map((one) => ({
              name: one.name,
              runsTests: runsTests(one.command),
            })),
          );

    explicit = given;

    for (const one of selected.filter((entry) => runsTests(entry.command))) {
      const names = given[one.name] ?? configured;

      chosen[one.name] = configured.filter((name) => names.includes(name));
    }
  } catch (error) {
    if (takeMarker && folderKnown) {
      try {
        const acquired = acquireMarker(io, root, {
          sensors: Array.isArray(options.sense) ? options.sense : [],
          describe: options.describe !== false,
        });

        if (acquired.ok) {
          acquired.held.crashed(errorText(error));
          acquired.held.release();
        }
      } catch {
        throw error;
      }
    }

    throw error;
  }

  let marker: HeldMarker | null = null;

  if (takeMarker) {
    const acquired = acquireMarker(io, root, {
      sensors: selected.map((one) => one.name),
      describe: options.describe !== false,
      suites: chosen,
    });

    if (!acquired.ok) {
      io.stderr(refusalText(acquired.marker, acquired.path));

      return REFUSED_EXIT;
    }

    marker = acquired.held;
  }

  const taken = marker;

  function* scanRest(): Generator<ScanStep, number, ScanAnswer> {
    const commit = resolveCommit(io, root);
    const scoped = (command: string[]): string[] =>
      options.modules !== undefined && isScoped(command)
        ? [...command, "--modules", resolve(options.modules)]
        : command;
    const withSuites = (name: string, command: string[]): string[] => {
      const names = explicit[name];

      return names !== undefined && runsTests(command)
        ? [...command, "--suites", JSON.stringify(chosen[name] ?? names)]
        : command;
    };

    const emit = (line: string) => {
      taken?.append(line);

      if (options.json) {
        io.stdout(line);
      }
    };

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
    const skippedPhases: { phase: string; reason: string }[] = [];
    let failed = false;

    const skip = (phase: string, reason: string) => {
      skippedPhases.push({ phase, reason });
      runLog?.skip({ phase, reason });
    };

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

      emit(entryLine(phase.phase, shown));

      if (entry.outcome === "failed") {
        failed = true;
      }
    };

    if (detected.length === 0) {
      io.stderr("no languages detected\n");
    }

    const ticked = selected.map(({ name, command }) => ({
      name,
      command: withSuites(name, scoped(command)),
    }));
    const describing: Describing | null =
      options.describe !== false ? readDescribing(io) : null;

    const ranSummary = (): RunSummary => ({
      commit,
      ran: phases
        .filter((one) => (summary.get(one.phase) ?? []).length > 0)
        .map((one) => one.phase),
    });

    const refuse = (gaps: Gap[]): number => {
      const reason = `preflight found ${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"}`;

      emit(preflightLine({ state: "gaps", gaps }));

      if (!json) {
        for (const gap of gaps) {
          io.stderr(`${gapText(gap)}\n`);
        }
      }

      if (options.describe !== false) {
        skip("describe", reason);
      }

      if (options.sense !== null) {
        skip("sense", reason);
      }

      runLog?.finish(phases, true);

      emit(
        summaryLine({
          repository: root,
          commit,
          modified,
          exit: 4,
          phases: phases.map((one) => ({
            phase: one.phase,
            entries: summary.get(one.phase) ?? [],
          })),
          removed,
          skipped: skippedPhases,
          log: runLog?.id() ?? null,
        }),
      );

      taken?.refused(
        gaps.map(({ id, line, needs }) => ({ id, line, needs })),
        ranSummary(),
      );

      return 4;
    };

    emit(preflightLine({ state: "run" }));

    const early = earlyGaps({
      io,
      root,
      commit,
      sensors: ticked,
      describe: options.describe !== false,
      describer: describer ?? null,
      model: describing?.model ?? "",
    });

    if (early.length > 0) {
      return refuse(early);
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

    emit(
      phaseLine(
        "extract",
        decision.run
          ? { state: "run", commit, reason: decision.reason }
          : { state: "current", commit: decision.commit },
      ),
    );

    if (!json && !decision.run) {
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

    const later = commit === null ? [] : readinessGaps(io, root, ticked);

    if (later.length > 0) {
      return refuse(later);
    }

    emit(preflightLine({ state: "ok" }));
    taken?.running();

    if (
      readsSensors(read) &&
      (yield* runStructure(io, root, scans, options.ignoreRetiredConfig))
    ) {
      failed = true;
    }

    if (describer !== undefined && options.describe !== false) {
      const phase = startPhase("describe");

      for (const language of detected) {
        if (readCachedScan(io, root, language) === null) {
          io.stderr(`skipped: no scan for ${language}\n`);
          skip("describe", `no scan for ${language}`);
        }
      }

      const { model, batch_size: batchSize } = describing as Describing;
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
          ...(options.confirmAbove === undefined
            ? {}
            : {
                confirm: async (projection: DescribeProjection) => {
                  const limit = options.confirmAbove as number;

                  if (
                    projection.modules === 0 ||
                    (projection.cost_usd !== null &&
                      projection.cost_usd <= limit)
                  ) {
                    return true;
                  }

                  const asked = `${JSON.stringify({ event: "confirm", phase: "describe", ...projection })}\n`;

                  io.stdout(asked);

                  if (taken === null) {
                    return (await io.readLine())?.trim() === "describe";
                  }

                  taken.append(asked);

                  const describe = await awaitDescribeAnswer(io, root, taken);

                  taken.append(
                    `${JSON.stringify({ event: "answered", phase: "describe", describe })}\n`,
                  );

                  return describe;
                },
              }),
          onProjection: (projection) => {
            emit(
              `${JSON.stringify({ event: "projection", phase: "describe", ...projection })}\n`,
            );

            if (!json) {
              io.stdout(projectionText(projection));
            }
          },
          onStart: (total) => {
            emit(phaseLine("describe", { total }));
          },
          onEntry: (entry) => {
            finishEntry(phase, entry);

            if (!json && entry.outcome === "ok") {
              io.stdout(`described ${entry.name}\n`);
            }
          },
        },
      }) as DescribeResult;

      const stop = result.stopped;

      if (stop !== null) {
        failed = true;

        emit(
          `${JSON.stringify({
            event: "stopped",
            phase: "describe",
            cause: stop.cause,
            reason: stop.reason,
            described: stop.described,
            not_described: stop.not_described.length,
            threshold: stop.threshold,
          })}\n`,
        );

        if (!json) {
          io.stderr(
            `stopped: ${stopCauseText(stop)}; ${stop.not_described.length} modules not described\n`,
          );
        }
      }

      if (!json) {
        io.stdout(describeSummaryText(result));
      }
    }

    if (options.sense !== null) {
      const phase = startPhase("sense");

      emit(phaseLine("sense", { total: selected.length }));

      yield {
        kind: "sense",
        input: {
          io,
          root,
          selected: selected.map((one) => ({
            ...one,
            command: withSuites(one.name, scoped(one.command)),
            runsTests: runsTests(one.command),
          })),
          commit: commit ?? "",
          scans,
          onStart: (name) => {
            emit(startLine("sense", name));
          },
          onProgress: (name: string, progress: SensorProgress) => {
            emit(progressLine("sense", name, progress));
          },
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

    const firstFailed = phases
      .flatMap((one) => summary.get(one.phase) ?? [])
      .find((entry) => entry.outcome === "failed");

    emit(
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
        skipped: skippedPhases,
        log: runLog?.id() ?? null,
      }),
    );

    taken?.end(
      exit,
      exit === 0
        ? null
        : {
            sensor: firstFailed?.name ?? "scan",
            suite: firstFailed?.diagnosis?.suite ?? null,
            code: firstFailed?.diagnosis?.code ?? null,
            reason: firstFailed?.reason ?? `recognizer scan exited ${exit}`,
          },
      ranSummary(),
    );

    return exit;
  }

  try {
    return yield* scanRest();
  } catch (error) {
    taken?.crashed(errorText(error));

    throw error;
  } finally {
    taken?.release();
  }
}

export function runScanSync(argv: string[], io: Io, read: ConfigRead): number {
  const flow = scanFlow(argv, io, false, read);
  let step = flow.next();

  while (!step.done) {
    if (step.value.kind !== "parsers") {
      throw new Error("a synchronous scan cannot describe or sense");
    }

    step = flow.next(null);
  }

  return step.value;
}

export async function runScan(argv: string[], io: Io): Promise<number> {
  const flow = scanFlow(argv, io, true, "all");

  try {
    let step = flow.next();

    while (!step.done) {
      if (step.value.kind === "sense") {
        await runSensors(step.value.input);
        step = flow.next(undefined);
      } else if (step.value.kind === "parsers") {
        try {
          step = flow.next(await loadParsers(step.value.languages));
        } catch (error) {
          step = flow.next(error as Error);
        }
      } else {
        step = flow.next(await describeModules(step.value.input));
      }
    }

    return step.value;
  } finally {
    flow.return(0);
  }
}

function* runStructure(
  io: Io,
  root: string,
  scans: Scan[],
  skipRetired: boolean,
): Generator<ScanStep, boolean, ScanAnswer> {
  if (scans.length === 0) {
    return false;
  }

  try {
    const settings = resolveStructureSettings(
      readConfig(io, root, ["sensors"], { skipRetired }),
    );

    io.remove(findingsFile(root, "duplication"));

    if (settings === "off") {
      io.remove(findingsFile(root, "structure"));

      return false;
    }

    const policy = readPolicy(io, root);

    warnPolicyProblems(
      io.stderr,
      relative(root, policyFile(root)),
      scans,
      policy,
    );

    const answer =
      settings.duplication === false
        ? null
        : yield {
            kind: "parsers",
            languages: [
              ...new Set(
                scans.flatMap((scan) =>
                  scan.modules.map((module) => module.language),
                ),
              ),
            ],
          };
    const parsers =
      answer === null || answer === undefined || answer instanceof Error
        ? null
        : (answer as Parsers);
    const run = runStructureSensor(io, root, scans, policy, settings, parsers);

    if (answer instanceof Error) {
      io.stderr(`failed structure: duplication: ${answer.message}\n`);

      return true;
    }

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
