import { basename, join, posix, relative, resolve } from "node:path";
import { parse } from "yaml";
import type { Io } from "./cli.js";
import { packageVersion } from "./cli.js";
import { configFile } from "./config.js";
import { CORE_KEYS, type KeyEntry } from "./config-keys.js";
import {
  detectLanguages,
  type LanguageRule,
  SKIPPED_DIRECTORIES,
} from "./detect.js";
import { doctorReport } from "./doctor-command.js";
import { InputError } from "./errors.js";
import { discoverPlugins } from "./plugin-discovery.js";
import type { RecordedScan } from "./scan.js";
import { readCachedScan } from "./scan-command.js";
import { languageRulesOf } from "./scanners.js";
import { readShippedSensors } from "./shipped-sensors.js";

export const SURVEY_VERSION = 1;

export interface SurveyFolder {
  path: string;
  files: number;
}

export interface SurveyLanguage {
  language: string;
  files: number;
  folders: SurveyFolder[];
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

export interface SurveyUpgrade {
  code: string;
  subject: string;
  line: string;
  command: string;
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
  upgrade: SurveyUpgrade[];
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

const VITEST_COMMAND =
  "npx vitest run --coverage --coverage.reporter=lcov --coverage.reportsDirectory=coverage";
const JEST_COMMAND =
  "npx jest --coverage --coverageReporters=lcov --coverageDirectory=coverage";
const CARGO_COMMAND = "cargo llvm-cov --lcov --output-path target/lcov.info";
const PYTEST_COMMAND = "pytest --cov --cov-report=lcov:coverage/lcov.info";

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
  command: string;
  tool: string | null;
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

    const runner = runnerOf(manifest, workspacesOf(manifest).length > 0);

    if (runner !== null) {
      found.push({
        language: "typescript",
        runner,
        directory: directoryOf(path),
        from: path,
        command: runner === "vitest" ? VITEST_COMMAND : JEST_COMMAND,
        tool: runner === "vitest" ? "@vitest/coverage-v8" : null,
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
      command: CARGO_COMMAND,
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
      command: PYTEST_COMMAND,
      tool: "pytest-cov",
    }))
    .sort((a, b) => compareText(a.directory, b.directory));
}

function nameRunners(found: Found[], root: string): SurveyRunner[] {
  const used = new Map<string, number>();

  return found.map((one) => {
    const base = basename(one.directory === "." ? root : one.directory).replace(
      /^src-/,
      "",
    );
    const seen = (used.get(base) ?? 0) + 1;

    used.set(base, seen);

    return {
      name: seen === 1 ? base : `${base}-${seen}`,
      language: one.language,
      runner: one.runner,
      directory: one.directory,
      from: one.from,
      command: one.command,
      coverage: {
        path:
          one.runner === "cargo" ? "target/lcov.info" : "coverage/lcov.info",
        format: "lcov",
      },
      tool: one.tool,
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

function checksOf(io: Io, document: Record<string, unknown>): SurveyCheck[] {
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
    },
    ...shipped.map((sensor) => ({
      id: sensor.name,
      display: sensor.display,
      description: sensor.description ?? "",
      always_on: false,
      enabled:
        typeof registered === "object" &&
        registered !== null &&
        sensor.name in registered,
      runs_tests: sensor.runs_tests,
      limits: [],
    })),
    ...describers.map((describer) => ({
      id: describer.name,
      display: describer.manifest.display,
      description: describer.manifest.description ?? "",
      always_on: false,
      enabled: "describer" in document,
      runs_tests: false,
      limits: [],
    })),
  ];
}

const UPGRADE_CODES = ["config-retired", "config-empty", "policy-retired"];

function upgradeOf(io: Io, root: string): SurveyUpgrade[] {
  const report = doctorReport(io, root, false);

  return report.areas
    .flatMap((area) => area.problems)
    .filter(
      (problem) =>
        UPGRADE_CODES.includes(problem.code) && problem.fix.command !== null,
    )
    .map((problem) => ({
      code: problem.code,
      subject: problem.subject,
      line: problem.line,
      command: problem.fix.command as string,
    }));
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
  const found = [
    ...typescriptRunners(io, root, files),
    ...rustRunners(io, root, files),
    ...pythonRunners(io, root, files),
  ];
  const runners = nameRunners(found, root);

  return {
    survey_version: SURVEY_VERSION,
    version: packageVersion(),
    repository: root,
    configured: io.exists(configFile(root)),
    files: scans === null ? null : filesOf(scans),
    unread: unreadOf(files, rules),
    checks: checksOf(io, document),
    runners,
    tools: toolsOf(io, root, runners, files),
    upgrade: upgradeOf(io, root),
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
