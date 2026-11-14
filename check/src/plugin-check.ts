import { basename, join } from "node:path";
import type { Io, RunResult } from "./cli.js";
import { validateFindings } from "./findings-document.js";
import validateCheckDocument from "./generated/check-validator.js";
import {
  EVENT_PREFIX,
  type PluginEvent,
  parseEventLine,
} from "./plugin-events.js";
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
import { validateScan } from "./scan.js";

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

interface LimitSetting {
  key: string;
  type?: string;
  labels?: unknown;
  units?: unknown;
  limit?: { metric: string; severity?: string };
}

const PLACEHOLDER = /<[a-z][a-z0-9_]*>/;

function limitProblems(manifest: Manifest): string[] {
  const settings = manifest.settings as LimitSetting[];
  const metrics = ((manifest.metrics ?? []) as { name: string }[]).map(
    (entry) => entry.name,
  );

  return settings.flatMap((setting) => {
    const placeholder = PLACEHOLDER.exec(setting.key)?.[0];
    const found: string[] = [];

    if (placeholder === undefined) {
      for (const field of ["labels", "units"] as const) {
        if (setting[field] !== undefined) {
          found.push(`${setting.key}: ${field} needs a key with a placeholder`);
        }
      }
    }

    const { limit } = setting;

    if (limit === undefined) {
      return found;
    }

    if (manifest.kind !== "sensor") {
      found.push(`${setting.key}: only a sensor may declare a limit`);
    } else if (PLACEHOLDER.test(limit.metric)) {
      if (limit.metric !== placeholder) {
        found.push(
          `${setting.key}: limit metric ${limit.metric} is not the key's own placeholder`,
        );
      }
    } else if (!metrics.includes(limit.metric)) {
      found.push(
        `${setting.key}: limit metric ${limit.metric} is not a metric of ${manifest.name}`,
      );
    }

    if (
      limit.severity !== undefined &&
      !settings.some(
        (other) => other.key === limit.severity && other.type === "enum",
      )
    ) {
      found.push(
        `${setting.key}: limit severity ${limit.severity} is not an enum setting of ${manifest.name}`,
      );
    }

    return found;
  });
}

export function checkLimits(context: Context): PluginCheckResult {
  const { manifest } = context;

  if (manifest === null) {
    return needsManifest("limits");
  }

  const problems = limitProblems(manifest);

  return problems.length === 0
    ? ok("limits")
    : fail("limits", problems.join("; "));
}

async function verbResults(
  io: Io,
  command: string,
  manifest: Manifest | null,
  options: PluginCheckOptions,
): Promise<PluginCheckResult[]> {
  const names = ["check-verb", "guide-verb", "run-verb", "events", "stop"];

  if (manifest === null) {
    return names.map(needsManifest);
  }

  const workspace = makeWorkspace(io, manifest, options);

  if (typeof workspace === "string") {
    return names.map((name) => fail(name, workspace));
  }

  try {
    const verb = runVerb(io, command, manifest, workspace, options);

    return [
      checkVerb(io, command, manifest, workspace),
      guideVerb(io, command, workspace),
      verb.checked,
      eventsResult(verb.facts),
      await stopResult(io, command, manifest, workspace, options),
    ];
  } finally {
    workspace.cleanup();
  }
}

function parse(text: string): { parsed: boolean; document: unknown } {
  try {
    return { parsed: true, document: JSON.parse(text) };
  } catch {
    return { parsed: false, document: null };
  }
}

export interface PluginCheckOptions {
  repository?: string;
  request?: string;
  graceMs?: number;
}

const OPEN_RUN_LIMIT_MS = 600_000;

const STOP_WAIT_FIRST_EVENT_MS = 2000;

interface Workspace {
  repository: string;
  commit: string;
  output: string;
  cleanup: () => void;
}

interface RunFacts {
  ran: boolean;
  result: RunResult | null;
  output: string;
}

function git(io: Io, repository: string, ...args: string[]): RunResult {
  return io.run("git", [
    "-C",
    repository,
    "-c",
    "user.name=recognizer",
    "-c",
    "user.email=recognizer@example.invalid",
    "-c",
    "commit.gpgsign=false",
    ...args,
  ]);
}

function languageExtensions(manifest: Manifest): string[] {
  return ((manifest.languages ?? []) as { extensions?: string[] }[]).flatMap(
    (language) => (language.extensions?.[0] ? [language.extensions[0]] : []),
  );
}

function makeWorkspace(
  io: Io,
  manifest: Manifest,
  options: PluginCheckOptions,
): Workspace | string {
  const output = io.makeTempDir();
  const drop = (directory: string) => () => io.removeDir(directory);

  if (options.repository !== undefined) {
    const head = git(io, options.repository, "rev-parse", "HEAD");

    if (!head.started || head.status !== 0) {
      io.removeDir(output);

      return `${options.repository} has no git commit`;
    }

    return {
      repository: options.repository,
      commit: head.stdout.trim(),
      output,
      cleanup: drop(output),
    };
  }

  const repository = io.makeTempDir();
  const cleanup = () => {
    io.removeDir(repository);
    io.removeDir(output);
  };

  for (const extension of languageExtensions(manifest)) {
    io.writeFile(join(repository, `sample${extension}`), "\n");
  }

  io.writeFile(join(repository, "README"), "sample\n");

  const steps = [
    ["init", "-q"],
    ["add", "-A"],
    ["commit", "-q", "-m", "sample"],
  ];

  for (const step of steps) {
    const done = git(io, repository, ...step);

    if (!done.started || done.status !== 0) {
      cleanup();

      return `could not make a sample repository: git ${step[0]} failed`;
    }
  }

  const head = git(io, repository, "rev-parse", "HEAD");

  return { repository, commit: head.stdout.trim(), output, cleanup };
}

function runArguments(
  manifest: Manifest,
  workspace: Workspace,
  outputFile: string,
  request: string | undefined,
): string[] | null {
  if (manifest.kind === "scanner") {
    return [
      "run",
      workspace.repository,
      "--output",
      outputFile,
      "--commit",
      workspace.commit,
    ];
  }

  if (manifest.kind === "sensor") {
    return [
      "run",
      "--repository",
      workspace.repository,
      "--commit",
      workspace.commit,
      "--output",
      outputFile,
    ];
  }

  return request === undefined ? null : ["run", "--model", "haiku", request];
}

function validateDocument(
  io: Io,
  manifest: Manifest,
  file: string,
): string | null {
  if (!io.exists(file)) {
    return "wrote no document";
  }

  try {
    const document = JSON.parse(io.readFile(file)) as unknown;

    if (manifest.kind === "scanner") {
      validateScan(document);
    } else {
      validateFindings(document, { name: manifest.name });
    }

    return null;
  } catch (error) {
    return `the document is invalid: ${(error as Error).message}`;
  }
}

function eventLines(stderr: string): string[] {
  return stderr.split("\n").filter((line) => line.startsWith(EVENT_PREFIX));
}

export function checkVerb(
  io: Io,
  command: string,
  manifest: Manifest,
  workspace: Workspace,
): PluginCheckResult {
  if (!manifest.check) {
    return result("check-verb", "ok", "declares no check");
  }

  const checkArgs =
    manifest.kind === "sensor"
      ? ["check", "--repository", workspace.repository]
      : ["check"];
  const run = io.run(command, checkArgs, {
    cwd: workspace.repository,
    timeoutMs: OPEN_RUN_LIMIT_MS,
  });

  if (!run.started || run.status !== 0) {
    return fail(
      "check-verb",
      `check exited ${run.status ?? "without a status"}`,
    );
  }

  try {
    const document = JSON.parse(run.stdout) as unknown;

    if (validateCheckDocument(document)) {
      return ok("check-verb");
    }

    const first = validateCheckDocument.errors?.[0];

    return fail(
      "check-verb",
      `the check document ${first?.instancePath ?? ""} ${first?.message ?? "is invalid"}`.replace(
        "  ",
        " ",
      ),
    );
  } catch {
    return fail("check-verb", "stdout is not one JSON document");
  }
}

export function guideVerb(
  io: Io,
  command: string,
  workspace: Workspace,
): PluginCheckResult {
  const run = io.run(command, ["guide"], { cwd: workspace.repository });

  if (!run.started || run.status !== 0) {
    return fail(
      "guide-verb",
      `guide exited ${run.status ?? "without a status"}`,
    );
  }

  return run.stderr === ""
    ? ok("guide-verb")
    : fail("guide-verb", "guide wrote to stderr");
}

function limitFor(manifest: Manifest): number {
  return manifest.long_running || manifest.time_limit_seconds === undefined
    ? OPEN_RUN_LIMIT_MS
    : manifest.time_limit_seconds * 1000;
}

export function runVerb(
  io: Io,
  command: string,
  manifest: Manifest,
  workspace: Workspace,
  options: PluginCheckOptions,
): { facts: RunFacts; checked: PluginCheckResult } {
  const outputFile = join(workspace.output, "document.json");
  const args = runArguments(manifest, workspace, outputFile, options.request);

  if (args === null) {
    return {
      facts: { ran: false, result: null, output: outputFile },
      checked: result("run-verb", "warn", "not run: pass --request"),
    };
  }

  const run = io.run(command, args, {
    cwd: workspace.repository,
    timeoutMs: limitFor(manifest),
  });
  const facts: RunFacts = { ran: true, result: run, output: outputFile };

  if (!run.started) {
    return { facts, checked: fail("run-verb", "run could not be started") };
  }

  if (run.timedOut === true) {
    return {
      facts,
      checked: fail("run-verb", "run did not finish within its time limit"),
    };
  }

  const diagnosed = eventLines(run.stderr).some((line) => {
    const parsed = parseEventLine(line);

    return parsed.kind === "event" && parsed.event.event === "diagnosis";
  });

  if (run.status !== 0) {
    return {
      facts,
      checked: diagnosed
        ? ok("run-verb")
        : fail(
            "run-verb",
            `run exited ${run.status ?? "without a status"} with no diagnosis event`,
          ),
    };
  }

  if (manifest.kind === "describer") {
    return {
      facts,
      checked:
        run.stdout.trim() === ""
          ? fail("run-verb", "run printed nothing")
          : ok("run-verb"),
    };
  }

  const problem = validateDocument(io, manifest, outputFile);

  return {
    facts,
    checked: problem === null ? ok("run-verb") : fail("run-verb", problem),
  };
}

export function eventsResult(facts: RunFacts): PluginCheckResult {
  if (!facts.ran || facts.result === null) {
    return ok("events");
  }

  const lines = eventLines(facts.result.stderr);

  if (lines.length === 0) {
    return result("events", "warn", "the run reported nothing");
  }

  let unit: string | null = null;
  let started = false;

  for (const line of lines) {
    const parsed = parseEventLine(line);

    if (parsed.kind !== "event") {
      return fail("events", `an event line is not a valid event: ${line}`);
    }

    const event: PluginEvent = parsed.event;

    if (event.event === "start") {
      started = true;
      unit = event.unit;
    }

    if (event.event === "progress") {
      if (!started) {
        return fail("events", "a progress event came before any start event");
      }

      if (event.done > event.total) {
        return fail(
          "events",
          `progress reports ${event.done} done of ${event.total}`,
        );
      }

      if (event.unit !== unit) {
        return fail(
          "events",
          `progress counts ${event.unit}, but the last start counted ${unit}`,
        );
      }
    }
  }

  return ok("events");
}

export async function stopResult(
  io: Io,
  command: string,
  manifest: Manifest,
  workspace: Workspace,
  options: PluginCheckOptions,
): Promise<PluginCheckResult> {
  const outputFile = join(workspace.output, "stop.json");
  const args = runArguments(manifest, workspace, outputFile, options.request);

  if (args === null) {
    return result("stop", "warn", "not run: pass --request");
  }

  const grace = options.graceMs ?? 10_000;
  let sent = false;
  let finished = false;
  let announce: () => void = () => {};
  const announced = new Promise<null>((resolve) => {
    announce = () => resolve(null);
  });

  const call = io.runAsync(command, args, {
    cwd: workspace.repository,
    onStderrLine: (line) => {
      if (line.startsWith(EVENT_PREFIX)) {
        send();
      }
    },
  });

  function send(): void {
    if (sent || finished) {
      return;
    }

    sent = true;
    call.kill("SIGTERM");
    announce();
  }

  const settled = call.result.then((value) => {
    finished = true;

    return value;
  });
  const firstEvent = setTimeout(send, STOP_WAIT_FIRST_EVENT_MS);
  const early = await Promise.race([settled, announced]);

  clearTimeout(firstEvent);

  if (early !== null) {
    return afterStop(io, manifest, outputFile, early, false);
  }

  let graceTimer: NodeJS.Timeout | undefined;
  const waited = await Promise.race([
    settled,
    new Promise<"late">((resolve) => {
      graceTimer = setTimeout(() => resolve("late"), grace);
    }),
  ]);

  clearTimeout(graceTimer);

  if (waited === "late") {
    call.kill("SIGKILL");
    await settled;

    return fail(
      "stop",
      `did not exit within ${grace / 1000} seconds of SIGTERM`,
    );
  }

  return afterStop(io, manifest, outputFile, waited, true);
}

function reachedStartTotal(stderr: string): boolean {
  let total: number | null = null;
  let done: number | null = null;

  for (const line of eventLines(stderr)) {
    const parsed = parseEventLine(line);

    if (parsed.kind !== "event") {
      continue;
    }

    if (parsed.event.event === "start") {
      total = parsed.event.total;
      done = null;
    }

    if (parsed.event.event === "progress") {
      done = parsed.event.done;
    }
  }

  return total !== null && done !== null && done >= total;
}

function afterStop(
  io: Io,
  manifest: Manifest,
  file: string,
  run: RunResult,
  sent: boolean,
): PluginCheckResult {
  if (!sent || run.status === 0) {
    return result("stop", "warn", "finished before it could be stopped");
  }

  if (!io.exists(file) || manifest.kind === "describer") {
    return ok("stop");
  }

  try {
    const document = JSON.parse(io.readFile(file)) as Record<string, unknown>;

    if (manifest.kind === "scanner") {
      validateScan(document);
    } else {
      validateFindings(document, { name: manifest.name });

      if (document.stopped === undefined && document.partial === undefined) {
        if (reachedStartTotal(run.stderr)) {
          return result("stop", "warn", "finished before it could be stopped");
        }

        return fail(
          "stop",
          "the document left after SIGTERM is complete, but the run had not reported all its work",
        );
      }
    }

    return ok("stop");
  } catch (error) {
    return fail(
      "stop",
      `the document left after SIGTERM is invalid: ${(error as Error).message}`,
    );
  }
}

export async function pluginCheck(
  io: Io,
  command: string,
  current: number = CURRENT_PROTOCOL,
  options: PluginCheckOptions = {},
): Promise<PluginCheckReport> {
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

  const results = [
    checkStarts(context),
    checkCleanOutput(context),
    checkValid(context),
    checkNamed(context),
    checkProtocol(context),
    checkSideEffectFree(context),
    checkSentences(context),
    checkLimits(context),
  ];

  return {
    command,
    manifest: context.manifest,
    results: [
      ...results,
      ...(await verbResults(io, command, context.manifest, options)),
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
