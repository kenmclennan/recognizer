import { join } from "node:path";
import type {
  ExtractCall,
  ExtractionDecision,
  ExtractResult,
  PluginProgress,
  Repository,
  RunEntry,
  ScannerQueries,
  Scanners,
  SyncScanners,
} from "@recognizer/core";
import type { Io, RunResult } from "../../cli.js";
import { detectLanguages, type Language } from "../../detect.js";
import { InputError } from "../../errors.js";
import {
  discoverPlugins,
  type InstalledPlugin,
  unsupportedMessage,
} from "../../plugin-discovery.js";
import type { PluginEvent } from "../../plugin-events.js";
import { type createPluginLimits, prepareCall } from "../../plugin-run.js";
import { entryFrom } from "../../run-log.js";
import { judgeScanVersion, SCAN_SCHEMA_VERSION } from "../../scan.js";
import { CACHE, cacheFile, readCachedRepository } from "../../scan-facts.js";
import { extractionNeeded, extractionPrecheck } from "../../scan-phases.js";
import {
  buildArgs,
  chooseScanner,
  languageRulesOf,
  type ScannerChoice,
} from "../../scanners.js";
import { readRepository } from "../filesystem/scan-translator.js";
import { sinkIo } from "./sink-io.js";

type FailureReason =
  | "not-installed"
  | "ambiguous-scanner"
  | "invalid-choice"
  | "unsupported-protocol"
  | "scanner-failed"
  | "invalid-scan"
  | "unknown-schema-version";

type Outcome =
  | { ok: true; bytes: string; modules: number; edges: number }
  | { ok: false; reason: FailureReason; message: string };

function failure(reason: FailureReason, message: string): Outcome {
  return { ok: false, reason, message };
}

function checkScan(bytes: string, language: string): Outcome {
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

  if (
    typeof version === "number" &&
    Number.isInteger(version) &&
    ["newer", "broken"].includes(judgeScanVersion(version))
  ) {
    return failure(
      "unknown-schema-version",
      `scan has schema_version ${version}, recognizer accepts ${SCAN_SCHEMA_VERSION}`,
    );
  }

  try {
    const repository = readRepository([{ language, document: parsed }]);

    return {
      ok: true,
      bytes,
      modules: repository.files.length,
      edges: repository.dependencies.length,
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

export interface ExtractInput {
  io: Io;
  language: Language;
  choice: ScannerChoice;
  root: string;
  commit: string | null;
  modified: boolean | null;
  limits: ReturnType<typeof createPluginLimits>;
  onEvent?: (name: string, event: PluginEvent) => void;
}

interface Prepared {
  language: string;
  scanner: InstalledPlugin;
  command: string;
  args: string[];
  output: string;
  directory: string;
}

function prepareScanner(
  input: ExtractInput,
): { failed: Scanned } | { ready: Prepared } {
  const { io, language, root, commit, modified, choice } = input;

  if (!choice.ok) {
    return {
      failed: {
        outcome: failure(choice.reason, choice.message),
        command: [],
        status: null,
        stderr: "",
        duration_ms: 0,
      },
    };
  }

  if (choice.scanner.judgement === "unsupported") {
    return {
      failed: {
        outcome: failure(
          "unsupported-protocol",
          unsupportedMessage(choice.scanner),
        ),
        command: [],
        status: null,
        stderr: "",
        duration_ms: 0,
      },
    };
  }

  const directory = io.makeTempDir();
  const output = join(directory, `scan.${language}.json`);

  return {
    ready: {
      language,
      scanner: choice.scanner,
      command: choice.scanner.command,
      args: buildArgs(root, output, commit, modified),
      output,
      directory,
    },
  };
}

function concludeScanner(
  io: Io,
  prepared: Prepared,
  result: RunResult,
  began: number,
): Scanned {
  const { language, scanner, command, args, output } = prepared;
  const scanned = (outcome: Outcome): Scanned => ({
    outcome,
    command: [command, ...args],
    status: result.started ? result.status : null,
    stderr: result.stderr,
    duration_ms: io.awake() - began,
  });

  if (!result.started) {
    return scanned(
      failure("not-installed", `${scanner.command} could not be started`),
    );
  }

  if (result.timedOut === true) {
    return scanned(failure("scanner-failed", "timed out"));
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

  return scanned(checkScan(bytes, language));
}

function runScannerSync(input: ExtractInput): Scanned {
  const prepared = prepareScanner(input);

  if ("failed" in prepared) {
    return prepared.failed;
  }

  const { io } = input;

  try {
    const began = io.awake();
    const result = io.run(prepared.ready.command, prepared.ready.args);

    return concludeScanner(io, prepared.ready, result, began);
  } finally {
    io.removeDir(prepared.ready.directory);
  }
}

async function runScannerAsync(input: ExtractInput): Promise<Scanned> {
  const prepared = prepareScanner(input);

  if ("failed" in prepared) {
    return prepared.failed;
  }

  const { io, language } = input;
  const { command, args, directory } = prepared.ready;

  try {
    const call = prepareCall(
      io,
      input.limits,
      [command, ...args],
      language,
      input.onEvent,
    );
    const began = io.awake();
    const result = await io.runAsync(command, args, call.options).result;

    return concludeScanner(
      io,
      prepared.ready,
      { ...result, stderr: call.reader.keep(result.stderr) },
      began,
    );
  } finally {
    io.removeDir(directory);
  }
}

function cachedLanguages(io: Io, root: string): Language[] {
  try {
    return io
      .readDir(join(root, CACHE))
      .flatMap((entry) => {
        const match = /^scan\.([a-z0-9][a-z0-9_-]*)\.json$/.exec(entry.name);

        return entry.kind === "file" && match !== null
          ? [match[1] as string]
          : [];
      })
      .sort();
  } catch {
    return [];
  }
}

function installedVersion(io: Io, choice: ScannerChoice): string | null {
  if (!choice.ok) {
    return null;
  }

  const result = io.run(choice.scanner.command, ["--version"]);

  return result.started && result.status === 0 ? result.stdout.trim() : null;
}

function decideExtraction(
  io: Io,
  root: string,
  detected: Language[],
  choices: Map<Language, ScannerChoice>,
  force: boolean,
  commit: string | null,
  dirty: boolean,
) {
  const languages = detected.map((language) => {
    const cached = readCachedRepository(io, root, language)?.extractions[0];

    return {
      language,
      cachedScan:
        cached === undefined
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
      installedVersion: installedVersion(
        io,
        choices.get(one.language) as ScannerChoice,
      ),
    })),
  });
}

function resultOf(language: string, scanned: Scanned): ExtractResult {
  const { outcome } = scanned;
  const entry = entryFrom(language, {
    command: scanned.command,
    status: scanned.status,
    stderr: scanned.stderr,
    duration_ms: scanned.duration_ms,
    ...(outcome.ok ? {} : { reason: `${outcome.reason} - ${outcome.message}` }),
  }) as unknown as RunEntry;

  return outcome.ok
    ? {
        ok: true,
        entry,
        bytes: outcome.bytes,
        modules: outcome.modules,
        edges: outcome.edges,
      }
    : { ok: false, entry, reason: outcome.reason, message: outcome.message };
}

class ScannerQueriesAdapter implements ScannerQueries {
  protected plugins: InstalledPlugin[] = [];
  protected choices = new Map<Language, ScannerChoice>();
  private detected: Language[] = [];

  constructor(protected readonly io: Io) {}

  installedPlugins(): InstalledPlugin[] {
    return this.plugins;
  }

  discover(): { installed: number } {
    this.plugins = discoverPlugins(this.io, ["scanner"]).plugins;

    return { installed: this.plugins.length };
  }

  detect(root: string, named: Record<string, string>): string[] {
    this.detected = detectLanguages(
      this.io,
      root,
      languageRulesOf(this.plugins),
    );
    this.choices = new Map(
      this.detected.map((language) => [
        language,
        chooseScanner(language, this.plugins, named[language]),
      ]),
    );

    return [...this.detected];
  }

  decide(
    root: string,
    force: boolean,
    commit: string | null,
    dirty: boolean,
  ): ExtractionDecision {
    return decideExtraction(
      this.io,
      root,
      this.detected,
      this.choices,
      force,
      commit,
      dirty,
    );
  }

  cachedLanguages(root: string): string[] {
    return cachedLanguages(this.io, root);
  }

  readCached(root: string, language: string): Repository | null {
    return readCachedRepository(this.io, root, language);
  }

  scanFile(root: string, language: string): string {
    return cacheFile(root, language);
  }

  previousProtocolNote(
    language: string,
  ): { scanner: string; text: string } | null {
    const choice = this.choices.get(language);

    return choice?.ok && choice.scanner.judgement === "previous"
      ? {
          scanner: choice.scanner.name,
          text: `${choice.scanner.command} speaks the previous protocol ${choice.scanner.manifest.protocol}: install ${choice.scanner.manifest.install}\n`,
        }
      : null;
  }

  protected inputOf(call: ExtractCall): ExtractInput {
    return {
      io: sinkIo(this.io, call.say),
      language: call.language,
      choice: this.choices.get(call.language) as ScannerChoice,
      root: call.root,
      commit: call.commit,
      modified: call.modified,
      limits: call.limits as unknown as ReturnType<typeof createPluginLimits>,
      onEvent: (name, event) =>
        call.onEvent(name, event as unknown as PluginProgress),
    };
  }
}

export class ScannersAdapter extends ScannerQueriesAdapter implements Scanners {
  async extract(call: ExtractCall): Promise<ExtractResult> {
    return resultOf(call.language, await runScannerAsync(this.inputOf(call)));
  }
}

export class SyncScannersAdapter
  extends ScannerQueriesAdapter
  implements SyncScanners
{
  extract(call: ExtractCall): ExtractResult {
    return resultOf(call.language, runScannerSync(this.inputOf(call)));
  }
}
