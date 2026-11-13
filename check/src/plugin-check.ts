import { basename } from "node:path";
import type { Io } from "./cli.js";
import {
  CURRENT_PROTOCOL,
  judgeProtocol,
  MANIFEST_TIMEOUT_MS,
  type Manifest,
  type ManifestRun,
  runManifest,
  validateManifest,
} from "./plugin-manifest.js";
import { sentenceProblems } from "./plugin-sentence.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface PluginCheckResult {
  name: string;
  status: CheckStatus;
  reason?: string;
}

export interface PluginCheckReport {
  command: string;
  manifest: Manifest | null;
  results: PluginCheckResult[];
}

interface Context {
  command: string;
  current: number;
  run: ManifestRun;
  leftovers: string[];
  document: unknown;
  parsed: boolean;
  manifest: Manifest | null;
}

const VERBS = { scanner: "scan", sensor: "sense", describer: "describe" };

function result(
  name: string,
  status: CheckStatus,
  reason?: string,
): PluginCheckResult {
  return reason === undefined ? { name, status } : { name, status, reason };
}

function fail(name: string, reason: string): PluginCheckResult {
  return result(name, "fail", reason);
}

function ok(name: string): PluginCheckResult {
  return result(name, "ok");
}

function needsManifest(name: string): PluginCheckResult {
  return fail(name, "there is no valid manifest to judge");
}

export function checkStarts(context: Context): PluginCheckResult {
  const { run } = context;

  if (!run.started) {
    return fail("starts", "the command could not be started");
  }

  if (run.timedOut === true) {
    return fail(
      "starts",
      `manifest did not finish in ${MANIFEST_TIMEOUT_MS / 1000} seconds`,
    );
  }

  return run.status === 0
    ? ok("starts")
    : fail("starts", `manifest exited ${run.status ?? "without a status"}`);
}

export function checkCleanOutput(context: Context): PluginCheckResult {
  const { run } = context;

  if (run.stderr !== "") {
    return fail("clean-output", "manifest wrote to stderr");
  }

  if (!context.parsed) {
    return fail("clean-output", "stdout is not one JSON document");
  }

  return run.stdout.endsWith("\n") && !run.stdout.endsWith("\n\n")
    ? ok("clean-output")
    : fail("clean-output", "stdout is not the document and one newline");
}

export function checkValid(context: Context): PluginCheckResult {
  if (!context.parsed) {
    return needsManifest("valid");
  }

  const problem = validateManifest(context.document);

  return problem === null ? ok("valid") : fail("valid", problem);
}

export function checkNamed(context: Context): PluginCheckResult {
  const { manifest } = context;

  if (manifest === null) {
    return needsManifest("named-for-command");
  }

  const expected = `recognizer-${VERBS[manifest.kind]}-${manifest.name}`;
  const actual = basename(context.command);

  return actual === expected
    ? ok("named-for-command")
    : fail(
        "named-for-command",
        `the command is named ${actual}, but a ${manifest.kind} called ${manifest.name} must be named ${expected}`,
      );
}

export function checkProtocol(context: Context): PluginCheckResult {
  const { manifest } = context;

  if (manifest === null) {
    return needsManifest("protocol");
  }

  const judged = judgeProtocol(manifest, context.current);

  if (judged === "current") {
    return ok("protocol");
  }

  if (judged === "previous") {
    return result(
      "protocol",
      "warn",
      `${manifest.name} speaks protocol ${manifest.protocol}, the previous one (current is ${context.current}); upgrade it: ${manifest.install}`,
    );
  }

  return fail(
    "protocol",
    `${manifest.name} speaks protocol ${manifest.protocol}, which this recognizer (protocol ${context.current}) does not support; fix: ${manifest.install}`,
  );
}

export function checkSideEffectFree(context: Context): PluginCheckResult {
  return context.leftovers.length === 0
    ? ok("side-effect-free")
    : fail(
        "side-effect-free",
        `manifest left ${context.leftovers.join(", ")} in its working directory`,
      );
}

export function checkSentences(context: Context): PluginCheckResult {
  const { manifest } = context;

  if (manifest === null) {
    return needsManifest("sentences");
  }

  const problems = (manifest.findings ?? []).flatMap((entry) =>
    sentenceProblems(entry.sentence).map((text) => `${entry.kind}: ${text}`),
  );

  return problems.length === 0
    ? ok("sentences")
    : fail("sentences", problems.join("; "));
}

function parse(text: string): { parsed: boolean; document: unknown } {
  try {
    return { parsed: true, document: JSON.parse(text) };
  } catch {
    return { parsed: false, document: null };
  }
}

export function pluginCheck(
  io: Io,
  command: string,
  current: number = CURRENT_PROTOCOL,
): PluginCheckReport {
  const directory = io.makeTempDir();
  let context: Context;

  try {
    const run = runManifest(io, command, directory);
    const leftovers = io.readDir(directory).map((entry) => entry.name);
    const { parsed, document } = parse(run.stdout);

    context = {
      command,
      current,
      run,
      leftovers,
      document,
      parsed: run.started && run.status === 0 && parsed,
      manifest: null,
    };
  } finally {
    io.removeDir(directory);
  }

  if (context.parsed && validateManifest(context.document) === null) {
    context.manifest = context.document as Manifest;
  }

  return {
    command,
    manifest: context.manifest,
    results: [
      checkStarts(context),
      checkCleanOutput(context),
      checkValid(context),
      checkNamed(context),
      checkProtocol(context),
      checkSideEffectFree(context),
      checkSentences(context),
    ],
  };
}

export function reportLines(report: PluginCheckReport): string[] {
  return report.results.map((entry) =>
    [entry.status.padEnd(4), entry.name, entry.reason]
      .filter((part) => part !== undefined)
      .join("  "),
  );
}

export function reportFailed(report: PluginCheckReport): boolean {
  return report.results.some((entry) => entry.status === "fail");
}
