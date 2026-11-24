import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

export interface SurveyRequest {
  root: string;
  files: string[];
  suites: { language: string; directory: string }[];
}

export interface AnswerRunner {
  language: string;
  runner: string;
  directory: string;
  from: string;
  command: string;
  coverage: { path: string; format: string };
  tool: string | null;
  env?: Record<string, string>;
}

export interface AnswerTool {
  name: string;
  kind: "npm";
  installed: boolean;
  why: string;
  needed_by: string[];
  installs: string;
  command: string[];
  cwd: string;
  files: string[];
  undo_note: string;
}

export interface SurveyAnswer {
  runners: AnswerRunner[];
  tools: AnswerTool[];
  notes: { language: string; directory: string; text: string }[];
}

interface Found {
  runner: "vitest" | "jest";
  directory: string;
  from: string;
  tool: string | null;
  env?: Record<string, string>;
  args?: string[];
}

const LOCKFILE = "package-lock.json";
const LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];
const COVERAGE_TOOL = "@vitest/coverage-v8";
const REPORT_ROOT = "{up}.recognizer/cache/coverage/{slug}";
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

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  return a > b ? 1 : 0;
}

function escaped(text: string): string {
  return text.replaceAll("{", "{{").replaceAll("}", "}}");
}

function directoryOf(path: string): string {
  return posix.dirname(path);
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));

    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
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

function testScript(manifest: Record<string, unknown>): string {
  return scriptsOf(manifest).test ?? "";
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

function typescriptRunners(root: string, files: string[]): Found[] {
  const workspaces = workspacesOf(readJson(join(root, "package.json")));
  const found: Found[] = [];

  for (const path of files.filter(
    (file) => posix.basename(file) === "package.json",
  )) {
    const manifest = readJson(join(root, path));

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
        ? resolveScript(scriptsOf(manifest), "test", [])
        : ({ kind: "none" } as const);

    if (chain.kind === "hit") {
      found.push({
        runner: "vitest",
        directory,
        from: path,
        tool: COVERAGE_TOOL,
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
        runner: detected,
        directory,
        from: path,
        tool: detected === "vitest" ? COVERAGE_TOOL : null,
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

function commandFor(found: Found): string {
  if (found.runner === "vitest") {
    const args = (found.args ?? []).map(escaped);

    return `npx vitest run ${[...args, `--coverage --coverage.reporter=lcov --coverage.reportsDirectory=${REPORT_ROOT}`].join(" ")}`;
  }

  return `npx jest --coverage --coverageReporters=lcov --coverageDirectory=${REPORT_ROOT}`;
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

function changedFiles(packageRoot: string, members: Found[]): string {
  const files = [
    ...new Set([
      ...members.map((member) => member.from),
      posix.join(packageRoot, LOCKFILE),
    ]),
  ];

  return files.join(", ");
}

function restoredFiles(
  packageRoot: string,
  workspaceFlags: string[],
): string[] {
  const files = new Set<string>([join(packageRoot, "package.json")]);

  for (const name of LOCKFILES) {
    files.add(join(packageRoot, name));
  }

  workspaceFlags.forEach((word, at) => {
    if (word === "-w") {
      files.add(
        join(packageRoot, workspaceFlags[at + 1] as string, "package.json"),
      );
    }
  });

  return [...files];
}

function npmTools(
  root: string,
  runners: Found[],
  files: string[],
): AnswerTool[] {
  const needing = runners.filter((runner) => runner.tool === COVERAGE_TOOL);
  const roots = files
    .filter((file) => posix.basename(file) === LOCKFILE)
    .map(directoryOf);
  const groups = new Map<string, Found[]>();

  for (const runner of needing) {
    const packageRoot = packageRootOf(runner.directory, roots);

    groups.set(packageRoot, [...(groups.get(packageRoot) ?? []), runner]);
  }

  return [...groups]
    .sort(([a], [b]) => compareText(a, b))
    .map(([packageRoot, members]) => {
      const lock = readJson(join(root, packageRoot, LOCKFILE));
      const rootManifest = readJson(join(root, packageRoot, "package.json"));
      const hoisted =
        typeof lock?.packages === "object" &&
        lock.packages !== null &&
        `node_modules/${COVERAGE_TOOL}` in lock.packages;
      const installed = members.every((member) => {
        const own = readJson(join(root, member.from));

        return (
          hoisted ||
          (own !== null && dependencyNames(own).has(COVERAGE_TOOL)) ||
          (rootManifest !== null &&
            dependencyNames(rootManifest).has(COVERAGE_TOOL))
        );
      });
      const version = lockedVersion(lock, "vitest");
      const workspaceFlags = members
        .map((member) => posix.relative(packageRoot, member.directory))
        .filter((path) => path !== "")
        .flatMap((path) => ["-w", path]);

      return {
        name: COVERAGE_TOOL,
        kind: "npm" as const,
        installed,
        why: "vitest writes its coverage report through this package",
        needed_by: members.map((member) => member.from),
        installs: escaped(changedFiles(packageRoot, members)),
        command: [
          "npm",
          "install",
          "--save-dev",
          version === null ? COVERAGE_TOOL : `${COVERAGE_TOOL}@${version}`,
          ...workspaceFlags.map(escaped),
        ],
        cwd: packageRoot,
        files: restoredFiles(packageRoot, workspaceFlags),
        undo_note:
          "package.json and the lockfile are restored; the package stays in node_modules until the next npm install",
      };
    });
}

export function survey(request: SurveyRequest): SurveyAnswer {
  const found = typescriptRunners(request.root, request.files).filter(
    (one) =>
      !request.suites.some(
        (suite) =>
          suite.directory === one.directory && suite.language === "typescript",
      ),
  );

  return {
    runners: found.map((one) => ({
      language: "typescript",
      runner: one.runner,
      directory: one.directory,
      from: one.from,
      command: commandFor(one),
      coverage: {
        path: ".recognizer/cache/coverage/{slug}/lcov.info",
        format: "lcov",
      },
      tool: one.tool,
      ...(one.env === undefined ? {} : { env: one.env }),
    })),
    tools: npmTools(request.root, found, request.files),
    notes: [],
  };
}
