import { baseName, joinPath } from "../../domain/path.js";
import {
  EVENT_PREFIX,
  type PluginEvent,
  parseEventLine,
} from "../../domain/plugin-event.js";
import {
  grammarsWithoutFields,
  grammarsWithoutVocabulary,
} from "../../domain/plugins/grammar-vocabulary.js";
import {
  judgeProtocol,
  MANIFEST_TIMEOUT_MS,
  type Manifest,
  type ManifestRun,
  type PlaceholderDeclaration,
  placeholderPattern,
} from "../../domain/plugins/manifest.js";
import { sentenceProblems } from "../../domain/plugins/sentence.js";
import type { PluginPorts } from "./internal/plugin-ports.js";
import type { ProgramRun } from "./ports/programs.js";
import { runManifest } from "./read-manifest.js";

type CheckPorts = Pick<PluginPorts, "programs" | "sandbox" | "validators">;

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

export function checkValid(
  context: Context,
  ports: Pick<CheckPorts, "validators">,
): PluginCheckResult {
  if (!context.parsed) {
    return needsManifest("valid");
  }

  const problem = ports.validators.manifest(context.document);

  return problem === null ? ok("valid") : fail("valid", problem);
}

export function checkNamed(context: Context): PluginCheckResult {
  const { manifest } = context;

  if (manifest === null) {
    return needsManifest("named-for-command");
  }

  const expected = `recognizer-${VERBS[manifest.kind]}-${manifest.name}`;
  const actual = baseName(context.command);

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

const PLACEHOLDER_GLOBAL = /<([a-z][a-z0-9_]*)>/g;

function placeholdersIn(key: string): string[] {
  return [...key.matchAll(PLACEHOLDER_GLOBAL)].map((found) => found[1] ?? "");
}

function declaredPattern(declaration: PlaceholderDeclaration): RegExp | null {
  try {
    return new RegExp(placeholderPattern(declaration));
  } catch {
    return null;
  }
}

function manifestKeys(manifest: Manifest): string[] {
  const suite = manifest.suite_keys;

  return [
    ...(manifest.settings as { key: string }[]).map((entry) => entry.key),
    ...(suite === undefined
      ? []
      : [
          (suite.section as { key: string }).key,
          ...(suite.keys as { key: string }[]).map((entry) => entry.key),
        ]),
  ];
}

function placeholderProblems(manifest: Manifest): string[] {
  const declared = manifest.placeholders ?? {};
  const problems: string[] = [];
  const used = new Set<string>();

  for (const [name, declaration] of Object.entries(declared)) {
    if (
      declaration.pattern !== undefined &&
      declaredPattern(declaration) === null
    ) {
      problems.push(`${name}: pattern does not compile`);
    }
  }

  for (const key of manifestKeys(manifest)) {
    for (const name of placeholdersIn(key)) {
      used.add(name);

      if (declared[name] === undefined) {
        problems.push(
          `${key}: uses the placeholder <${name}> that the manifest does not declare`,
        );
      }
    }
  }

  for (const name of Object.keys(declared)) {
    if (!used.has(name)) {
      problems.push(`${name}: declared but no key uses it`);
    }
  }

  const published = manifest.settings as Record<string, unknown>[];

  if (
    manifest.kind === "sensor" &&
    published.length > 0 &&
    published.every(
      (setting) => setting.label === undefined && setting.labels === undefined,
    )
  ) {
    problems.push(
      `${manifest.name}: publishes settings but none has a label or labels, so it gets no Settings pane`,
    );
  }

  for (const setting of manifest.settings as Record<string, unknown>[]) {
    const first = placeholdersIn(String(setting.key))[0];
    const declaration = first === undefined ? undefined : declared[first];
    const pattern =
      declaration === undefined ? null : declaredPattern(declaration);

    if (first === undefined || pattern === null) {
      continue;
    }

    for (const field of ["labels", "units", "defaults"]) {
      const entries = setting[field];

      if (entries === undefined || entries === null) {
        continue;
      }

      for (const value of Object.keys(entries as object)) {
        if (!pattern.test(value)) {
          problems.push(
            `${String(setting.key)}: ${field} entry ${value} does not match <${first}>`,
          );
        }
      }
    }
  }

  return problems;
}

export function checkPlaceholders(context: Context): PluginCheckResult {
  const { manifest } = context;

  if (manifest === null) {
    return needsManifest("placeholders");
  }

  const problems = placeholderProblems(manifest);

  return problems.length === 0
    ? ok("placeholders")
    : fail("placeholders", problems.join("; "));
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

export function checkGrammars(context: Context): PluginCheckResult {
  const { manifest } = context;

  if (manifest === null) {
    return needsManifest("grammars");
  }

  const missing = grammarsWithoutVocabulary(manifest);
  const fieldless = grammarsWithoutFields(manifest);
  const problems = [
    ...(missing.length === 0
      ? []
      : [
          `grammar ${missing.join(", ")} publishes no vocabulary, so its comments and literals enter fingerprints and no function shape is trivial`,
        ]),
    ...(fieldless.length === 0
      ? []
      : [
          `grammar ${fieldless.join(", ")} publishes no fields declaration, so it is unknown whether a function can be named or operator-based complexity counted`,
        ]),
  ];

  return problems.length === 0
    ? ok("grammars")
    : fail("grammars", problems.join("; "));
}

async function verbResults(
  ports: CheckPorts,
  command: string,
  manifest: Manifest | null,
  options: PluginCheckOptions,
): Promise<PluginCheckResult[]> {
  const names = ["check-verb", "guide-verb", "run-verb", "events", "stop"];

  if (manifest === null) {
    return names.map(needsManifest);
  }

  const workspace = makeWorkspace(ports, manifest, options);

  if (typeof workspace === "string") {
    return names.map((name) => fail(name, workspace));
  }

  try {
    const verb = runVerb(ports, command, manifest, workspace, options);

    return [
      checkVerb(ports, command, manifest, workspace),
      guideVerb(ports, command, workspace),
      verb.checked,
      eventsResult(verb.facts, (value) => ports.validators.event(value)),
      await stopResult(ports, command, manifest, workspace, options),
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
  result: ProgramRun | null;
  output: string;
}

function git(
  ports: CheckPorts,
  repository: string,
  ...args: string[]
): ProgramRun {
  return ports.programs.run("git", [
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
  ports: CheckPorts,
  manifest: Manifest,
  options: PluginCheckOptions,
): Workspace | string {
  const output = ports.sandbox.makeTempDir();
  const drop = (directory: string) => () => ports.sandbox.removeDir(directory);

  if (options.repository !== undefined) {
    const head = git(ports, options.repository, "rev-parse", "HEAD");

    if (!head.started || head.status !== 0) {
      ports.sandbox.removeDir(output);

      return `${options.repository} has no git commit`;
    }

    return {
      repository: options.repository,
      commit: head.stdout.trim(),
      output,
      cleanup: drop(output),
    };
  }

  const repository = ports.sandbox.makeTempDir();
  const cleanup = () => {
    ports.sandbox.removeDir(repository);
    ports.sandbox.removeDir(output);
  };

  for (const extension of languageExtensions(manifest)) {
    ports.sandbox.writeFile(joinPath(repository, `sample${extension}`), "\n");
  }

  ports.sandbox.writeFile(joinPath(repository, "README"), "sample\n");

  const steps = [
    ["init", "-q"],
    ["add", "-A"],
    ["commit", "-q", "-m", "sample"],
  ];

  for (const step of steps) {
    const done = git(ports, repository, ...step);

    if (!done.started || done.status !== 0) {
      cleanup();

      return `could not make a sample repository: git ${step[0]} failed`;
    }
  }

  const head = git(ports, repository, "rev-parse", "HEAD");

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
  ports: CheckPorts,
  manifest: Manifest,
  file: string,
): string | null {
  if (!ports.sandbox.exists(file)) {
    return "wrote no document";
  }

  try {
    const document = JSON.parse(ports.sandbox.readFile(file)) as unknown;

    const problem =
      manifest.kind === "scanner"
        ? ports.validators.scan(document)
        : ports.validators.findings(document, { name: manifest.name });

    if (problem !== null) {
      throw new Error(problem);
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
  ports: CheckPorts,
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
  const run = ports.programs.run(command, checkArgs, {
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

    const problem = ports.validators.check(document);

    return problem === null
      ? ok("check-verb")
      : fail("check-verb", `the check document ${problem}`);
  } catch {
    return fail("check-verb", "stdout is not one JSON document");
  }
}

export function guideVerb(
  ports: CheckPorts,
  command: string,
  workspace: Workspace,
): PluginCheckResult {
  const run = ports.programs.run(command, ["guide"], {
    cwd: workspace.repository,
  });

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
  ports: CheckPorts,
  command: string,
  manifest: Manifest,
  workspace: Workspace,
  options: PluginCheckOptions,
): { facts: RunFacts; checked: PluginCheckResult } {
  const outputFile = joinPath(workspace.output, "document.json");
  const args = runArguments(manifest, workspace, outputFile, options.request);

  if (args === null) {
    return {
      facts: { ran: false, result: null, output: outputFile },
      checked: result("run-verb", "warn", "not run: pass --request"),
    };
  }

  const run = ports.programs.run(command, args, {
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

  const valid = (value: unknown) => ports.validators.event(value);
  const diagnosed = eventLines(run.stderr).some((line) => {
    const parsed = parseEventLine(line, valid);

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

  const problem = validateDocument(ports, manifest, outputFile);

  return {
    facts,
    checked: problem === null ? ok("run-verb") : fail("run-verb", problem),
  };
}

function stageTotalProblem(line: string): string | null {
  try {
    const value = JSON.parse(line.slice(EVENT_PREFIX.length)) as {
      event?: unknown;
      index?: unknown;
      of?: unknown;
    };

    return value.event === "stage" &&
      typeof value.index === "number" &&
      typeof value.of === "number" &&
      value.index > value.of
      ? `a stage reports index ${value.index} of ${value.of}`
      : null;
  } catch {
    return null;
  }
}

export function eventsResult(
  facts: RunFacts,
  valid: (value: unknown) => boolean,
): PluginCheckResult {
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
    const parsed = parseEventLine(line, valid);

    if (parsed.kind !== "event") {
      const past = stageTotalProblem(line);

      return fail(
        "events",
        past ?? `an event line is not a valid event: ${line}`,
      );
    }

    const event: PluginEvent = parsed.event;

    if (
      (event.event === "stage" ||
        event.event === "estimate" ||
        event.event === "result" ||
        event.event === "settled") &&
      !started
    ) {
      return fail(
        "events",
        `a ${event.event} event came before any start event`,
      );
    }

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
  ports: CheckPorts,
  command: string,
  manifest: Manifest,
  workspace: Workspace,
  options: PluginCheckOptions,
): Promise<PluginCheckResult> {
  const outputFile = joinPath(workspace.output, "stop.json");
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

  const call = ports.programs.start(command, args, {
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
  const cancelFirstEvent = ports.programs.after(STOP_WAIT_FIRST_EVENT_MS, send);
  const early = await Promise.race([settled, announced]);

  cancelFirstEvent();

  if (early !== null) {
    return afterStop(ports, manifest, outputFile, early, false);
  }

  let cancelGrace: () => void = () => {};
  const waited = await Promise.race([
    settled,
    new Promise<"late">((resolve) => {
      cancelGrace = ports.programs.after(grace, () => resolve("late"));
    }),
  ]);

  cancelGrace();

  if (waited === "late") {
    call.kill("SIGKILL");
    await settled;

    return fail(
      "stop",
      `did not exit within ${grace / 1000} seconds of SIGTERM`,
    );
  }

  return afterStop(ports, manifest, outputFile, waited, true);
}

function reachedStartTotal(
  stderr: string,
  valid: (value: unknown) => boolean,
): boolean {
  let total: number | null = null;
  let done: number | null = null;

  for (const line of eventLines(stderr)) {
    const parsed = parseEventLine(line, valid);

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
  ports: CheckPorts,
  manifest: Manifest,
  file: string,
  run: ProgramRun,
  sent: boolean,
): PluginCheckResult {
  if (!sent || run.status === 0) {
    return result("stop", "warn", "finished before it could be stopped");
  }

  if (!ports.sandbox.exists(file) || manifest.kind === "describer") {
    return ok("stop");
  }

  try {
    const document = JSON.parse(ports.sandbox.readFile(file)) as Record<
      string,
      unknown
    >;

    const invalid =
      manifest.kind === "scanner"
        ? ports.validators.scan(document)
        : ports.validators.findings(document, { name: manifest.name });

    if (invalid !== null) {
      throw new Error(invalid);
    }

    if (manifest.kind !== "scanner") {
      if (document.stopped === undefined && document.partial === undefined) {
        if (
          reachedStartTotal(run.stderr, (value) =>
            ports.validators.event(value),
          )
        ) {
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
  ports: CheckPorts,
  command: string,
  current: number = ports.validators.facts.protocol,
  options: PluginCheckOptions = {},
): Promise<PluginCheckReport> {
  const directory = ports.sandbox.makeTempDir();
  let context: Context;

  try {
    const run = runManifest(ports, command, directory);
    const leftovers = ports.sandbox
      .readDir(directory)
      .map((entry) => entry.name);
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
    ports.sandbox.removeDir(directory);
  }

  if (context.parsed && ports.validators.manifest(context.document) === null) {
    context.manifest = context.document as Manifest;
  }

  const results = [
    checkStarts(context),
    checkCleanOutput(context),
    checkValid(context, ports),
    checkNamed(context),
    checkProtocol(context),
    checkSideEffectFree(context),
    checkSentences(context),
    checkPlaceholders(context),
    checkLimits(context),
    checkGrammars(context),
  ];

  return {
    command,
    manifest: context.manifest,
    results: [
      ...results,
      ...(await verbResults(ports, command, context.manifest, options)),
    ],
  };
}
