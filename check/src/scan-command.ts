import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { detectLanguages, type Language } from "./detect.js";
import { InputError } from "./errors.js";
import { SCAN_SCHEMA_VERSION, validateScan } from "./scan.js";
import {
  buildArgs,
  notInstalledMessage,
  resolveCommand,
  SCANNERS,
  scannerFor,
} from "./scanners.js";

type FailureReason =
  | "not-installed"
  | "invalid-override"
  | "scanner-failed"
  | "invalid-scan"
  | "unknown-schema-version";

type LanguageResult =
  | {
      language: Language;
      status: "written";
      modules: number;
      edges: number;
      file: string;
    }
  | {
      language: Language;
      status: "failed";
      reason: FailureReason;
      message: string;
    };

type Outcome =
  | { ok: true; bytes: string; modules: number; edges: number }
  | { ok: false; reason: FailureReason; message: string };

const CACHE = ".recognizer/cache";

function cacheFile(root: string, language: Language): string {
  return join(root, CACHE, `scan.${language}.json`);
}

function resolveCommit(io: Io, root: string): string | null {
  const result = io.run("git", ["-C", root, "rev-parse", "HEAD"]);
  const commit = result.stdout.trim();

  return result.started && result.status === 0 && commit !== "" ? commit : null;
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

function runScanner(
  io: Io,
  language: Language,
  root: string,
  commit: string | null,
): Outcome {
  const spec = scannerFor(language);
  const resolution = resolveCommand(io, spec);

  if (!resolution.ok) {
    return failure("invalid-override", resolution.message);
  }

  const directory = io.makeTempDir();

  try {
    const output = join(directory, `scan.${language}.json`);
    const result = io.run(resolution.command, buildArgs(root, output, commit));

    if (!result.started) {
      return failure("not-installed", notInstalledMessage(spec));
    }

    if (result.status !== 0) {
      return failure(
        "scanner-failed",
        `exit ${result.status}: ${result.stderr.trim()}`,
      );
    }

    let bytes: string;

    try {
      bytes = io.readFile(output);
    } catch {
      return failure("invalid-scan", "scanner wrote no output file");
    }

    return checkScan(bytes);
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

export function runScan(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { json: { type: "boolean" } },
  });

  if (positionals.length > 1) {
    throw new InputError(["usage: recognizer scan [REPOSITORY] [--json]"]);
  }

  const root = resolve(positionals[0] ?? ".");

  try {
    io.readDir(root);
  } catch {
    throw new InputError([`repository is not a directory: ${root}`]);
  }

  const detected = detectLanguages(io, root);
  const removed: string[] = [];
  const results: LanguageResult[] = [];
  const stderr: string[] = [];
  const stdout: string[] = [];
  const commit = resolveCommit(io, root);

  if (detected.length === 0) {
    stderr.push("no languages detected");
  }

  for (const spec of SCANNERS) {
    const file = cacheFile(root, spec.language);
    const shown = relative(root, file);

    if (!detected.includes(spec.language)) {
      const before = removed.length;

      removeIfPresent(io, file, removed);

      if (removed.length > before) {
        stderr.push(`${spec.language}: removed stale ${shown}`);
      }

      continue;
    }

    const outcome = runScanner(io, spec.language, root, commit);

    if (outcome.ok) {
      io.writeFile(file, outcome.bytes);
      results.push({
        language: spec.language,
        status: "written",
        modules: outcome.modules,
        edges: outcome.edges,
        file,
      });
      stdout.push(
        `${spec.language}: ${outcome.modules} modules, ${outcome.edges} edges -> ${shown}`,
      );

      continue;
    }

    results.push({
      language: spec.language,
      status: "failed",
      reason: outcome.reason,
      message: outcome.message,
    });
    stderr.push(`${spec.language}: ${outcome.reason} - ${outcome.message}`);

    const before = removed.length;

    removeIfPresent(io, file, removed);

    if (removed.length > before) {
      stderr.push(`${spec.language}: removed stale ${shown}`);
    }
  }

  for (const line of stderr) {
    io.stderr(`${line}\n`);
  }

  if (values.json) {
    io.stdout(
      `${JSON.stringify({ repository: root, commit, languages: results, removed }, null, 2)}\n`,
    );
  } else {
    for (const line of stdout) {
      io.stdout(`${line}\n`);
    }
  }

  return results.some((result) => result.status === "failed") ? 1 : 0;
}
