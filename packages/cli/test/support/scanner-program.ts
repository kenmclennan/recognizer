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
