import { basename, join, posix, relative, resolve } from "node:path";
import { parse } from "yaml";
import type { Io } from "./cli.js";
import { packageVersion } from "./cli.js";
import { configFile, policyFile } from "./config.js";
import { CORE_KEYS, type KeyEntry } from "./config-keys.js";
import {
  detectLanguages,
  type LanguageRule,
  SKIPPED_DIRECTORIES,
} from "./detect.js";
import { doctorReport } from "./doctor-command.js";
import { InputError } from "./errors.js";
import { compileGlob } from "./glob.js";
import { discoverPlugins } from "./plugin-discovery.js";
import { type Policy, parsePolicy } from "./policy.js";
import type { RecordedScan } from "./scan.js";
import { readCachedScan } from "./scan-command.js";
import { languageRulesOf } from "./scanners.js";
import { splitCommand, withoutRepository } from "./setup-changes.js";
import { commandRefusal } from "./setup-proposal.js";
import { readShippedSensors } from "./shipped-sensors.js";

export const SURVEY_VERSION = 1;

export type SetupMark = "set-up" | "new" | "gone";

export interface SurveyFolder {
  path: string;
  files: number;
}

export interface SurveyLanguage {
  language: string;
  files: number;
  folders: SurveyFolder[];
  mark: SetupMark | null;
}

export interface SurveyUnread {
  language: string;
  files: number;
  folders: SurveyFolder[];
}

export interface SurveyLimit {
  key: string;
  label: string;
  default: number;
  current: number | null;
}

export interface SurveyCheck {
  id: string;
  display: string;
  description: string;
  always_on: boolean;
  enabled: boolean;
  runs_tests: boolean;
  limits: SurveyLimit[];
  mark: SetupMark | null;
}

export interface SurveyRunner {
  name: string;
  language: string;
  runner: string;
  directory: string;
  from: string;
  command: string;
  coverage: { path: string; format: string };
  tool: string | null;
  env?: Record<string, string>;
}

export interface SurveyTool {
  name: string;
  kind: "npm" | "cargo" | "pip";
  installed: boolean;
  why: string;
  needed_by: string[];
  installs: string;
  command: string[];
  cwd: string;
}

export interface SurveyFix {
  code: string;
  subject: string;
  title: string;
  line: string;
  fix_text: string;
  command: string | null;
}

export interface SurveySuite {
  name: string;
  language: string;
  directory: string;
  command: string;
  env?: Record<string, string>;
  mark: "set-up" | "gone";
}

export interface SurveyPolicy {
  present: boolean;
  uncovered: string[];
}

export interface Survey {
  survey_version: 1;
  version: string;
  repository: string;
  configured: boolean;
  files: SurveyLanguage[] | null;
  unread: SurveyUnread[];
  checks: SurveyCheck[];
  runners: SurveyRunner[];
  tools: SurveyTool[];
  fixes: SurveyFix[];
  suites: SurveySuite[];
  policy: SurveyPolicy;
}

export interface SurveyOptions {
  scan?: string;
}

const SOURCE_EXTENSIONS: Record<string, string> = {
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".mjs": "typescript",
  ".cjs": "typescript",
  ".rs": "rust",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".cs": "csharp",
  ".java": "java",
  ".go": "go",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".scala": "scala",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".ex": "elixir",
  ".exs": "elixir",
  ".dart": "dart",
  ".lua": "lua",
  ".zig": "zig",
};

const LIMIT_KEYS = [
  {
    key: "sensors.structure.warnings.long_function.limit",
    label: "long_function",
  },
  { key: "sensors.structure.warnings.complexity.limit", label: "complexity" },
  {
    key: "sensors.structure.duplication.pair_min_lines",
    label: "pair_min_lines",
  },
];

const FOLDER_LIMIT = 5;

const CACHE_COVERAGE = ".recognizer/cache/coverage";

export function folderSlug(name: string): string {
  const slug = name.replace(/[^A-Za-z0-9._-]/g, "-");

  return slug.startsWith(".") ? `-${slug.slice(1)}` : slug;
}

function reportFolder(name: string): string {
  return `${CACHE_COVERAGE}/${folderSlug(name)}`;
}

function reportRoot(name: string, directory: string): string {
  const depth = directory === "." ? 0 : directory.split("/").length;

  return `${"../".repeat(depth)}${reportFolder(name)}`;
}

function commandFor(
  runner: string,
  name: string,
  directory: string,
  args: string[] = [],
): string {
  const where = reportRoot(name, directory);

  switch (runner) {
    case "vitest":
      return `npx vitest run ${[...args, `--coverage --coverage.reporter=lcov --coverage.reportsDirectory=${where}`].join(" ")}`;
    case "jest":
      return `npx jest --coverage --coverageReporters=lcov --coverageDirectory=${where}`;
    case "cargo":
      return `cargo llvm-cov --lcov --output-path ${where}/lcov.info`;
    default:
      return `pytest --cov --cov-report=lcov:${where}/lcov.info`;
  }
}

const LOCKFILE = "package-lock.json";

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  return a > b ? 1 : 0;
}

function compareFolders(a: SurveyFolder, b: SurveyFolder): number {
  return b.files - a.files || compareText(a.path, b.path);
}

function folderOf(path: string): string {
  const at = path.indexOf("/");

  return at === -1 ? "." : path.slice(0, at);
}

function foldersOf(paths: string[]): SurveyFolder[] {
  const counts = new Map<string, number>();

  for (const path of paths) {
    const folder = folderOf(path);

    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }

  return [...counts]
    .map(([path, files]) => ({ path, files }))
    .sort(compareFolders)
    .slice(0, FOLDER_LIMIT);
}

function walk(io: Io, root: string, directory: string, into: string[]): void {
  const entries = [...io.readDir(directory)].sort((a, b) =>
    compareText(a.name, b.name),
  );

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.kind === "directory") {
      if (!SKIPPED_DIRECTORIES.has(entry.name) && entry.name !== "target") {
        walk(io, root, path, into);
      }
    } else if (entry.kind === "file") {
      into.push(relative(root, path).split("\\").join("/"));
    }
  }
}

export function listRepositoryFiles(io: Io, root: string): string[] {
  const listing = io.run("git", [
    "-C",
    root,
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  const files: string[] = [];

  if (listing.started && listing.status === 0) {
    for (const path of listing.stdout.split("\0")) {
      if (path !== "" && io.exists(join(root, path))) {
        files.push(path);
      }
    }
  } else {
    walk(io, root, root, files);
  }

  return files
    .filter(
      (path) =>
        !path
          .split("/")
          .some(
            (part) =>
              part === "node_modules" || part === "target" || part === ".git",
          ),
    )
    .sort(compareText);
}

function readJson(io: Io, path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(io.readFile(path));

    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readText(io: Io, path: string): string | null {
  try {
    return io.readFile(path);
  } catch {
    return null;
  }
}

function dependencyNames(manifest: Record<string, unknown>): Set<string> {
  const names = new Set<string>();

  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const value = manifest[section];

    if (typeof value === "object" && value !== null) {
      for (const name of Object.keys(value)) {
        names.add(name);
      }
    }
  }

  return names;
}

function testScript(manifest: Record<string, unknown>): string {
  const scripts = manifest.scripts;

  if (typeof scripts !== "object" || scripts === null) {
    return "";
  }

  const test = (scripts as Record<string, unknown>).test;

  return typeof test === "string" ? test : "";
}

function workspacesOf(manifest: Record<string, unknown> | null): string[] {
  const value = manifest?.workspaces;
  const list = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null
      ? (value as { packages?: unknown }).packages
      : undefined;

  return Array.isArray(list)
    ? list.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function workspaceRank(workspaces: string[], directory: string): number {
  const at = workspaces.findIndex((entry) => {
    const clean = posix.normalize(entry).replace(/\/$/, "");

    if (clean.endsWith("/*")) {
      return posix.dirname(directory) === clean.slice(0, -2);
    }

    return clean === directory;
  });

  return at === -1 ? Number.MAX_SAFE_INTEGER : at;
}

function runnerOf(
  manifest: Record<string, unknown>,
  hasWorkspaces: boolean,
): "vitest" | "jest" | null {
  const names = dependencyNames(manifest);
  const script = testScript(manifest);
  const listed = (name: string) =>
    names.has(name) || new RegExp(`\\b${name}\\b`).test(script);

  if (hasWorkspaces && !/\b(vitest|jest)\b/.test(script)) {
    return null;
  }

  if (listed("vitest")) {
    return "vitest";
  }

  return listed("jest") ? "jest" : null;
}

function directoryOf(path: string): string {
  const directory = posix.dirname(path);

  return directory === "." ? "." : directory;
}

interface Found {
  language: string;
  runner: string;
  directory: string;
  from: string;
  tool: string | null;
  env?: Record<string, string>;
  args?: string[];
}

const VITEST_CONFIG = /^vitest\.config\.(ts|mts|cts|js|mjs|cjs)$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNSAFE_VALUE = /[$`'"\\]/;
const CHAIN_DEPTH = 5;
const SAFE_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;
const OTHER_SUBCOMMANDS = new Set([
  "watch",
  "dev",
  "bench",
  "related",
  "list",
  "init",
  "typecheck",
]);
const CONFLICTING_ARGUMENT =
  /^(--coverage([.=].*)?|--watch|-w|--reporter(=.*)?|-r|--ui)$/;

type Resolution =
  | { kind: "hit"; env: Record<string, string>; args: string[] }
  | { kind: "stop" }
  | { kind: "none" };

function scriptsOf(manifest: Record<string, unknown>): Record<string, string> {
  const scripts = manifest.scripts;

  if (typeof scripts !== "object" || scripts === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(scripts).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function resolveStep(step: string): Resolution {
  const words = step.split(/\s+/).filter((word) => word !== "");
  const env: Record<string, string> = {};
  let at = 0;

  while (at < words.length && /^[^=\s]+=/.test(words[at] as string)) {
    const word = words[at] as string;
    const equals = word.indexOf("=");
    const name = word.slice(0, equals);
    const value = word.slice(equals + 1);

    if (!ENV_NAME.test(name) || UNSAFE_VALUE.test(value)) {
      return { kind: "stop" };
    }

    env[name] = value;
    at += 1;
  }

  if (words[at] === "npx") {
    at += 1;
  }

  if (words[at] !== "vitest") {
    return { kind: "none" };
  }

  const rest = words.slice(at + 1);
  const args = rest[0] === "run" ? rest.slice(1) : rest;

  if (rest[0] !== undefined && OTHER_SUBCOMMANDS.has(rest[0])) {
    return { kind: "stop" };
  }

  const keepable = args.every(
    (word) =>
      word !== "--" &&
      SAFE_ARGUMENT.test(word) &&
      !CONFLICTING_ARGUMENT.test(word),
  );

  return keepable ? { kind: "hit", env, args } : { kind: "stop" };
}

function resolveScript(
  scripts: Record<string, string>,
  name: string,
  path: string[],
): Resolution {
  const script = scripts[name];

  if (
    script === undefined ||
    path.includes(name) ||
    path.length >= CHAIN_DEPTH
  ) {
    return { kind: "stop" };
  }

  for (const raw of script.split("&&")) {
    const step = raw.trim();
    const followed = /^npm run ([^\s]+)$/.exec(step);
    const result = followed
      ? resolveScript(scripts, followed[1] as string, [...path, name])
      : resolveStep(step);

    if (result.kind !== "none") {
      return result;
    }
  }

  return { kind: "none" };
}

function vitestStepOf(manifest: Record<string, unknown>): Resolution {
  return resolveScript(scriptsOf(manifest), "test", []);
}

function typescriptRunners(io: Io, root: string, files: string[]): Found[] {
  const rootManifest = readJson(io, join(root, "package.json"));
  const workspaces = workspacesOf(rootManifest);
  const found: Found[] = [];

  for (const path of files.filter(
    (file) => posix.basename(file) === "package.json",
  )) {
    const manifest = readJson(io, join(root, path));

    if (manifest === null) {
      continue;
    }

    const directory = directoryOf(path);
    const hasConfig = files.some(
      (file) =>
        directoryOf(file) === directory &&
        VITEST_CONFIG.test(posix.basename(file)),
    );
    const detected = runnerOf(manifest, workspacesOf(manifest).length > 0);
    const chain =
      hasConfig || detected === "vitest"
        ? vitestStepOf(manifest)
        : ({ kind: "none" } as const);

    if (chain.kind === "hit") {
      found.push({
        language: "typescript",
        runner: "vitest",
        directory,
        from: path,
        tool: "@vitest/coverage-v8",
        ...(Object.keys(chain.env).length === 0 ? {} : { env: chain.env }),
        ...(chain.args.length === 0 ? {} : { args: chain.args }),
      });

      continue;
    }

    if (chain.kind === "stop") {
      continue;
    }

    if (detected !== null) {
      found.push({
        language: "typescript",
        runner: detected,
        directory,
        from: path,
        tool: detected === "vitest" ? "@vitest/coverage-v8" : null,
      });
    }
  }

  return found.sort(
    (a, b) =>
      workspaceRank(workspaces, a.directory) -
        workspaceRank(workspaces, b.directory) ||
      compareText(a.directory, b.directory),
  );
}

function rustRunners(io: Io, root: string, files: string[]): Found[] {
  return files
    .filter((file) => posix.basename(file) === "Cargo.toml")
    .filter((file) =>
      /^\[package\]/m.test(readText(io, join(root, file)) ?? ""),
    )
    .map((file) => ({
      language: "rust",
      runner: "cargo",
      directory: directoryOf(file),
      from: file,
      tool: "cargo-llvm-cov",
    }))
    .sort((a, b) => compareText(a.directory, b.directory));
}

function pythonRunners(io: Io, root: string, files: string[]): Found[] {
  const manifests = files.filter(
    (file) =>
      posix.basename(file) === "pyproject.toml" ||
      /^requirements.*\.txt$/.test(posix.basename(file)),
  );
  const byDirectory = new Map<string, string>();

  for (const file of manifests) {
    if (/\bpytest\b/.test(readText(io, join(root, file)) ?? "")) {
      const directory = directoryOf(file);

      if (
        !byDirectory.has(directory) ||
        posix.basename(file) === "pyproject.toml"
      ) {
        byDirectory.set(directory, file);
      }
    }
  }

  return [...byDirectory]
    .map(([directory, from]) => ({
      language: "python",
      runner: "pytest",
      directory,
      from,
      tool: "pytest-cov",
    }))
    .sort((a, b) => compareText(a.directory, b.directory));
}

function nameRunners(
  found: Found[],
  root: string,
  taken: Set<string> = new Set(),
): SurveyRunner[] {
  const used = new Map<string, number>();
  const names = new Set(taken);

  return found.map((one) => {
    const base = basename(one.directory === "." ? root : one.directory).replace(
      /^src-/,
      "",
    );
    let seen = (used.get(base) ?? 0) + 1;
    let name = seen === 1 ? base : `${base}-${seen}`;

    while (names.has(name)) {
      seen += 1;
      name = `${base}-${seen}`;
    }

    used.set(base, seen);
    names.add(name);

    return {
      name,
      language: one.language,
      runner: one.runner,
      directory: one.directory,
      from: one.from,
      command: commandFor(one.runner, name, one.directory, one.args),
      coverage: {
        path: `${reportFolder(name)}/lcov.info`,
        format: "lcov",
      },
      tool: one.tool,
      ...(one.env === undefined ? {} : { env: one.env }),
    };
  });
}

function packageRootOf(directory: string, roots: string[]): string {
  const containing = roots
    .filter(
      (root) =>
        root === "." || directory === root || directory.startsWith(`${root}/`),
    )
    .sort((a, b) => b.length - a.length);

  return containing[0] ?? ".";
}

function lockfileRoots(files: string[]): string[] {
  return files
    .filter((file) => posix.basename(file) === LOCKFILE)
    .map(directoryOf);
}

function lockedVersion(
  lock: Record<string, unknown> | null,
  name: string,
): string | null {
  const packages = lock?.packages;

  if (typeof packages !== "object" || packages === null) {
    return null;
  }

  const entry = (packages as Record<string, unknown>)[`node_modules/${name}`];
  const version =
    typeof entry === "object" && entry !== null
      ? (entry as { version?: unknown }).version
      : undefined;

  return typeof version === "string" ? version : null;
}

function npmTools(
  io: Io,
  root: string,
  runners: SurveyRunner[],
  files: string[],
): SurveyTool[] {
  const needing = runners.filter(
    (runner) => runner.tool === "@vitest/coverage-v8",
  );
  const roots = lockfileRoots(files);
  const groups = new Map<string, SurveyRunner[]>();

  for (const runner of needing) {
    const packageRoot = packageRootOf(runner.directory, roots);

    groups.set(packageRoot, [...(groups.get(packageRoot) ?? []), runner]);
  }

  return [...groups]
    .sort(([a], [b]) => compareText(a, b))
    .map(([packageRoot, members]) => {
      const lock = readJson(io, join(root, packageRoot, LOCKFILE));
      const rootManifest = readJson(
        io,
        join(root, packageRoot, "package.json"),
      );
      const hoisted =
        typeof lock?.packages === "object" &&
        lock.packages !== null &&
        "node_modules/@vitest/coverage-v8" in lock.packages;
      const installed = members.every((member) => {
        const own = readJson(io, join(root, member.from));

        return (
          hoisted ||
          (own !== null && dependencyNames(own).has("@vitest/coverage-v8")) ||
          (rootManifest !== null &&
            dependencyNames(rootManifest).has("@vitest/coverage-v8"))
        );
      });
      const version = lockedVersion(lock, "vitest");
      const workspaceFlags = members
        .filter((member) => member.directory !== ".")
        .flatMap((member) => ["-w", member.directory]);

      return {
        name: "@vitest/coverage-v8",
        kind: "npm" as const,
        installed,
        why: "vitest writes its coverage report through this package",
        needed_by: members.map((member) => member.name),
        installs: changedFiles(packageRoot, members),
        command: [
          "npm",
          "install",
          "--save-dev",
          version === null
            ? "@vitest/coverage-v8"
            : `@vitest/coverage-v8@${version}`,
          ...workspaceFlags,
        ],
        cwd: packageRoot,
      };
    });
}

function changedFiles(packageRoot: string, members: SurveyRunner[]): string {
  const files = [
    ...new Set([
      ...members.map((member) => member.from),
      posix.join(packageRoot, LOCKFILE),
    ]),
  ];

  return files.join(", ");
}

function cargoTool(
  io: Io,
  root: string,
  runners: SurveyRunner[],
): SurveyTool[] {
  const needing = runners.filter((runner) => runner.tool === "cargo-llvm-cov");

  if (needing.length === 0) {
    return [];
  }

  const answer = io.run("cargo", ["llvm-cov", "--version"], { cwd: root });

  return [
    {
      name: "cargo-llvm-cov",
      kind: "cargo",
      installed: answer.started && answer.status === 0,
      why: "cargo writes its coverage report through this subcommand",
      needed_by: needing.map((runner) => runner.name),
      installs: "the cargo bin folder, outside the repository",
      command: ["cargo", "install", "cargo-llvm-cov", "--locked"],
      cwd: ".",
    },
  ];
}

function pipTools(io: Io, root: string, runners: SurveyRunner[]): SurveyTool[] {
  return runners
    .filter((runner) => runner.tool === "pytest-cov")
    .map((runner) => {
      const text = readText(io, join(root, runner.from)) ?? "";

      return {
        name: "pytest-cov",
        kind: "pip" as const,
        installed: /pytest-cov/.test(text),
        why: "pytest writes its coverage report through this plugin",
        needed_by: [runner.name],
        installs: "the active Python environment",
        command: ["python", "-m", "pip", "install", "pytest-cov"],
        cwd: runner.directory,
      };
    });
}

function toolsOf(
  io: Io,
  root: string,
  runners: SurveyRunner[],
  files: string[],
): SurveyTool[] {
  return [
    ...npmTools(io, root, runners, files),
    ...cargoTool(io, root, runners),
    ...pipTools(io, root, runners),
  ];
}

function scanLanguage(scan: RecordedScan): string {
  const counts = new Map<string, number>();

  for (const module of scan.modules) {
    counts.set(module.language, (counts.get(module.language) ?? 0) + 1);
  }

  const [top] = [...counts].sort(
    ([a, x], [b, y]) => y - x || compareText(a, b),
  );

  return top?.[0] ?? scan.scanner.name.replace(/^recognizer-scan-/, "");
}

function readScanFile(io: Io, file: string): RecordedScan {
  try {
    return JSON.parse(io.readFile(resolve(file))) as RecordedScan;
  } catch (error) {
    throw new InputError([
      `cannot read --scan file ${file}: ${(error as Error).message}`,
    ]);
  }
}

function filesOf(scans: RecordedScan[]): SurveyLanguage[] {
  return scans
    .map((scan) => {
      const paths = scan.files.map((file) => file.path);

      return {
        language: scanLanguage(scan),
        files: paths.length,
        folders: foldersOf(paths),
        mark: null,
      };
    })
    .sort((a, b) => compareText(a.language, b.language));
}

function unreadOf(
  files: string[],
  rules: readonly LanguageRule[],
): SurveyUnread[] {
  const claimed = (path: string) =>
    rules.some(
      (rule) =>
        rule.files.includes(posix.basename(path)) ||
        rule.extensions.some((extension) => path.endsWith(extension)),
    );
  const byLanguage = new Map<string, string[]>();

  for (const path of files) {
    const extension = posix.extname(path);
    const language = SOURCE_EXTENSIONS[extension];

    if (language !== undefined && !claimed(path)) {
      byLanguage.set(language, [...(byLanguage.get(language) ?? []), path]);
    }
  }

  return [...byLanguage]
    .map(([language, paths]) => ({
      language,
      files: paths.length,
      folders: foldersOf(paths),
    }))
    .sort((a, b) => compareText(a.language, b.language));
}

function configDocument(text: string | null): Record<string, unknown> {
  if (text === null) {
    return {};
  }

  try {
    const value: unknown = parse(text);

    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function valueAt(document: unknown, path: string[]): unknown {
  let at = document;

  for (const part of path) {
    if (typeof at !== "object" || at === null) {
      return undefined;
    }

    at = (at as Record<string, unknown>)[part];
  }

  return at;
}

function limitsOf(document: Record<string, unknown>): SurveyLimit[] {
  return LIMIT_KEYS.map(({ key, label }) => {
    const entry = CORE_KEYS.keys.find((one: KeyEntry) => one.key === key);
    const current = valueAt(document, key.split("."));

    return {
      key,
      label,
      default: typeof entry?.default === "number" ? entry.default : 0,
      current: typeof current === "number" ? current : null,
    };
  });
}

function checkMark(configured: boolean, enabled: boolean): SetupMark | null {
  if (!configured) {
    return null;
  }

  return enabled ? "set-up" : "new";
}

function checksOf(
  io: Io,
  document: Record<string, unknown>,
  configured: boolean,
): SurveyCheck[] {
  const structure = valueAt(document, ["sensors", "structure"]);
  const registered = valueAt(document, ["sensors"]);
  const shipped = readShippedSensors(io).sensors;
  const describers = discoverPlugins(io, ["describer"]).plugins;

  return [
    {
      id: "structure",
      display: "Structure",
      description:
        "the files, imports and policy rules of the repository, read from the scan",
      always_on: true,
      enabled: true,
      runs_tests: false,
      limits: [],
      mark: configured ? "set-up" : null,
    },
    {
      id: "analysis",
      display: "Structural analysis",
      description:
        "warnings about cycles, unused exports, orphans, long functions, complexity and duplication; warnings never fail a run, only new policy violations fail recognizer check",
      always_on: false,
      enabled: structure !== "off",
      runs_tests: false,
      limits: limitsOf(document),
      mark: checkMark(configured, structure !== "off"),
    },
    ...shipped.map((sensor) => {
      const enabled =
        typeof registered === "object" &&
        registered !== null &&
        sensor.name in registered;

      return {
        id: sensor.name,
        display: sensor.display,
        description: sensor.description ?? "",
        always_on: false,
        enabled,
        runs_tests: sensor.runs_tests,
        limits: [],
        mark: checkMark(configured, enabled),
      };
    }),
    ...describers.map((describer) => {
      const enabled = "describer" in document;

      return {
        id: describer.name,
        display: describer.manifest.display,
        description: describer.manifest.description ?? "",
        always_on: false,
        enabled,
        runs_tests: false,
        limits: [],
        mark: checkMark(configured, enabled),
      };
    }),
  ];
}

function fixesOf(
  io: Io,
  root: string,
  checks: readonly SurveyCheck[],
): SurveyFix[] {
  const report = doctorReport(io, root, false);
  const offered = new Set(checks.map((check) => check.id));

  return report.areas
    .flatMap((area) => area.problems)
    .filter((problem) => problem.severity === "problem")
    .filter(
      (problem) =>
        !(
          problem.code === "unregistered-plugin" && offered.has(problem.subject)
        ),
    )
    .map((problem) => {
      const command = problem.fix.command;
      const runnable =
        command !== null &&
        commandRefusal(withoutRepository(splitCommand(command))) === null;

      return {
        code: problem.code,
        subject: problem.subject,
        title: problem.title,
        line: problem.line,
        fix_text: problem.fix.text,
        command: runnable ? command : null,
      };
    });
}

function suitesOf(
  io: Io,
  document: Record<string, unknown>,
  files: string[],
  configured: boolean,
): SurveySuite[] {
  const list = document.tests;

  if (!configured || !Array.isArray(list)) {
    return [];
  }

  const text = (value: unknown) => (typeof value === "string" ? value : "");

  return list
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry),
    )
    .map((entry) => {
      const directory = posix.normalize(text(entry.directory) || ".");
      const root = directory === "." || directory === "./";
      const holds =
        root ||
        files.some(
          (file) => file === directory || file.startsWith(`${directory}/`),
        );
      const env =
        typeof entry.env === "object" &&
        entry.env !== null &&
        !Array.isArray(entry.env)
          ? Object.fromEntries(
              Object.entries(entry.env).filter(
                (pair): pair is [string, string] => typeof pair[1] === "string",
              ),
            )
          : undefined;

      return {
        name: text(entry.name),
        language: text(entry.language),
        directory: text(entry.directory) || ".",
        command: text(entry.command),
        ...(env === undefined || Object.keys(env).length === 0 ? {} : { env }),
        mark: holds ? ("set-up" as const) : ("gone" as const),
      };
    })
    .filter((suite) => suite.name !== "")
    .sort((a, b) => compareText(a.name, b.name));
}

function markLanguages(
  languages: SurveyLanguage[],
  document: Record<string, unknown>,
  suites: SurveySuite[],
  configured: boolean,
): SurveyLanguage[] {
  if (!configured) {
    return languages;
  }

  const scanners = document.scanners;
  const named = new Set<string>([
    ...suites.map((suite) => suite.language),
    ...(typeof scanners === "object" &&
    scanners !== null &&
    !Array.isArray(scanners)
      ? Object.keys(scanners)
      : []),
  ]);
  const present = new Set(languages.map((one) => one.language));
  const marked = languages.map((one) => ({
    ...one,
    mark: named.has(one.language) ? ("set-up" as const) : ("new" as const),
  }));
  const gone = [...named]
    .filter((language) => language !== "" && !present.has(language))
    .map((language) => ({
      language,
      files: 0,
      folders: [],
      mark: "gone" as const,
    }));

  return [...marked, ...gone].sort((a, b) =>
    compareText(a.language, b.language),
  );
}

function readPolicy(io: Io, root: string): Policy | null {
  const file = policyFile(root);

  if (!io.exists(file)) {
    return null;
  }

  try {
    return parsePolicy(io.readFile(file));
  } catch {
    return null;
  }
}

function policyOf(
  io: Io,
  root: string,
  scans: RecordedScan[] | null,
): SurveyPolicy {
  const present = io.exists(policyFile(root));
  const policy = readPolicy(io, root);

  if (policy === null || scans === null) {
    return { present, uncovered: [] };
  }

  const matchers = [
    ...policy.ignore,
    ...policy.entry,
    ...policy.forbid.flatMap((rule) =>
      [...rule.fromGlobs, ...rule.toGlobs]
        .filter((glob) => !glob.startsWith("foreign:"))
        .map(compileGlob),
    ),
  ];
  const folders = new Map<string, boolean>();

  for (const scan of scans) {
    for (const module of scan.modules) {
      const folder = folderOf(module.id);
      const covered = matchers.some((matches) => matches(module.id));

      folders.set(folder, (folders.get(folder) ?? false) || covered);
    }
  }

  return {
    present,
    uncovered: [...folders]
      .filter(([, covered]) => !covered)
      .map(([folder]) => folder)
      .sort(compareText),
  };
}

export function surveyRepository(
  io: Io,
  given: string,
  options: SurveyOptions = {},
): Survey {
  const root = resolve(given);

  try {
    io.readDir(root);
  } catch {
    throw new InputError([`repository is not a directory: ${root}`]);
  }

  const scanners = discoverPlugins(io, ["scanner"]).plugins;
  const rules = languageRulesOf(scanners);
  const files = listRepositoryFiles(io, root);
  const document = configDocument(
    io.exists(configFile(root)) ? io.readFile(configFile(root)) : null,
  );
  const scans: RecordedScan[] | null =
    options.scan !== undefined
      ? [readScanFile(io, options.scan)]
      : cachedScans(io, root, rules);
  const configured = io.exists(configFile(root));
  const suites = suitesOf(io, document, files, configured);
  const found = [
    ...typescriptRunners(io, root, files),
    ...rustRunners(io, root, files),
    ...pythonRunners(io, root, files),
  ].filter(
    (one) =>
      !suites.some(
        (suite) =>
          suite.directory === one.directory && suite.language === one.language,
      ),
  );
  const runners = nameRunners(
    found,
    root,
    new Set(suites.map((suite) => suite.name)),
  );
  const checks = checksOf(io, document, configured);

  return {
    survey_version: SURVEY_VERSION,
    version: packageVersion(),
    repository: root,
    configured,
    files:
      scans === null
        ? null
        : markLanguages(filesOf(scans), document, suites, configured),
    unread: unreadOf(files, rules),
    checks,
    runners,
    tools: toolsOf(io, root, runners, files),
    fixes: fixesOf(io, root, checks),
    suites,
    policy: policyOf(io, root, scans),
  };
}

function cachedScans(
  io: Io,
  root: string,
  rules: readonly LanguageRule[],
): RecordedScan[] | null {
  const languages = detectLanguages(io, root, rules);
  const scans = languages.map((language) => readCachedScan(io, root, language));

  return scans.length > 0 && scans.every((scan) => scan !== null)
    ? (scans as RecordedScan[])
    : null;
}

export function surveyJson(survey: Survey): string {
  return `${JSON.stringify(survey, null, 2)}\n`;
}
