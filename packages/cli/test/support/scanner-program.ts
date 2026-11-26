import { readFileSync } from "node:fs";
import { join } from "node:path";
import { manifestText } from "../../../scanners/typescript/src/manifest.js";
import type { RunResult } from "../../src/cli.js";
import type { FakeFiles } from "./io/files.js";
import type { Program, ProgramCall } from "./io/processes.js";

const FIXTURES = join(__dirname, "../../../../fixtures/typescript");

export const TYPESCRIPT_SAMPLE = join(FIXTURES, "sample");

export function committedScan(): Record<string, any> {
  return JSON.parse(readFileSync(join(FIXTURES, "expected-scan.json"), "utf8"));
}

function option(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);

  return at < 0 ? undefined : args[at + 1];
}

export interface ScannerScript {
  before?: (call: ProgramCall) => void;
  gate?: { wait(): Promise<void> };
  fails?: boolean;
  fromTree?: boolean;
}

export function typescriptScanner(script: ScannerScript = {}): Program {
  return (call) => {
    const [verb] = call.args;
    const done = { started: true, status: 0, stderr: "" };

    if (verb === "manifest") {
      return { ...done, stdout: manifestText() };
    }

    if (verb === "--version") {
      return { ...done, stdout: "0.1.0\n" };
    }

    if (verb !== "run") {
      return { started: true, status: 2, stdout: "", stderr: "" };
    }

    return running(script, call);
  };
}

async function running(
  script: ScannerScript,
  call: ProgramCall,
): Promise<RunResult> {
  {
    const done = { started: true, status: 0, stderr: "" };
    const output = option(call.args, "--output");
    const commit = option(call.args, "--commit");
    const modified = option(call.args, "--modified");

    script.before?.(call);

    await Promise.race([script.gate?.wait(), call.whenKilled()]);

    if (call.killed) {
      return { started: true, status: 143, stdout: "", stderr: "" };
    }

    if (script.fails) {
      return { started: true, status: 1, stdout: "", stderr: "" };
    }

    const scan = committedScan();

    if (script.fromTree) {
      reflectTree(scan, call.files, call.args[1] ?? "");
    }

    scan.commit = commit ?? null;
    scan.modified = modified === undefined ? null : modified === "true";

    if (output !== undefined) {
      call.files.writeFile(output, `${JSON.stringify(scan, null, 2)}\n`);
    }

    return { ...done, stdout: "" };
  }
}

export function seedTypescriptRepository(
  files: FakeFiles,
  repository: string,
): void {
  files.seedFrom(TYPESCRIPT_SAMPLE, repository);
  files.writeFile(
    `${repository}/.gitignore`,
    ".recognizer/cache/\nnode_modules/\n",
  );
}

const SKIPPED = [".recognizer", "node_modules"];

function treePaths(files: FakeFiles, root: string): Set<string> {
  const found = new Set<string>();
  const walk = (directory: string, prefix: string) => {
    for (const entry of files.readDir(directory)) {
      if (entry.kind === "directory") {
        if (!SKIPPED.includes(entry.name)) {
          walk(`${directory}/${entry.name}`, `${prefix}${entry.name}/`);
        }
      } else {
        found.add(`${prefix}${entry.name}`);
      }
    }
  };

  walk(root, "");

  return found;
}

function reflectTree(
  scan: Record<string, any>,
  files: FakeFiles,
  root: string,
): void {
  const present = treePaths(files, root);
  const known = new Set<string>(
    (scan.modules as { id: string }[]).map((module) => module.id),
  );
  const modules = (scan.modules as { id: string }[]).filter((module) =>
    present.has(module.id),
  );

  for (const path of [...present].sort()) {
    if (
      !known.has(path) &&
      /\.tsx?$/.test(path) &&
      !path.includes("__tests__")
    ) {
      modules.push({
        id: path,
        language: "typescript",
        kind: "module",
        members: [],
      } as never);
    }
  }

  const ids = new Set(modules.map((module) => module.id));
  const kept = (id: string) => !known.has(id) || ids.has(id);

  scan.modules = modules.sort((a, b) => (a.id < b.id ? -1 : 1));
  scan.edges = scan.edges.filter(
    (edge: { from: string; to: string }) => kept(edge.from) && kept(edge.to),
  );
  scan.files = scan.files.filter((file: { path: string }) =>
    present.has(file.path),
  );
  scan.calls = scan.calls.filter(
    (call: { from: string; to: string }) =>
      kept(call.from.split("::")[0] as string) &&
      kept(call.to.split("::")[0] as string),
  );
  scan.test_imports = scan.test_imports.filter(
    (entry: { from: string; to: string }) =>
      present.has(entry.from) && ids.has(entry.to),
  );
}
