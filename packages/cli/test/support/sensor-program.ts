import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "../../src/cli.js";
import type { Program, ProgramCall } from "./io/processes.js";

const MANIFEST_EXAMPLE = join(
  __dirname,
  "../../../../schema/manifest-examples/valid/sensor-crap.json",
);

export function sensorManifest(name: string): string {
  const base = JSON.parse(readFileSync(MANIFEST_EXAMPLE, "utf8"));

  delete base.suite_keys;
  delete base.placeholders;
  delete base.log_path;

  return JSON.stringify({
    ...base,
    name,
    display: name.toUpperCase(),
    runs_tests: false,
    install: `brew install ${name}`,
    settings: [],
  });
}

export class Gate {
  private release: () => void = () => {};
  private waiting: Promise<void> = Promise.resolve();

  hold(): void {
    this.waiting = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  open(): void {
    this.release();
  }

  wait(): Promise<void> {
    return this.waiting;
  }
}

export const event = (value: object): string =>
  `recognizer-event ${JSON.stringify(value)}`;

export interface SensorScript {
  before?: string[];
  after?: string[];
  fails?: boolean;
  gate?: Gate;
}

export function sensorProgram(
  name: string,
  script: SensorScript = {},
): Program {
  return (call) => {
    const [verb, ...rest] = call.args;
    const done = { started: true, status: 0, stderr: "" };

    if (verb === "manifest") {
      return { ...done, stdout: sensorManifest(name) };
    }

    if (verb === "--version") {
      return { ...done, stdout: "1\n" };
    }

    if (verb === "check") {
      return { ...done, stdout: '{"gaps":[]}' };
    }

    return running(name, script, call, rest);
  };
}

async function running(
  name: string,
  script: SensorScript,
  call: ProgramCall,
  rest: string[],
): Promise<RunResult> {
  {
    const done = { started: true, status: 0, stderr: "" };
    let commit = "";
    let output = "";

    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] === "--commit") {
        commit = rest[index + 1] ?? "";
      }

      if (rest[index] === "--output") {
        output = rest[index + 1] ?? "";
      }
    }

    for (const line of script.before ?? [
      event({ event: "start", total: 2, unit: "functions" }),
      event({ event: "progress", done: 1, total: 2, unit: "functions" }),
    ]) {
      call.stderr(line);
    }

    await Promise.race([script.gate?.wait(), call.whenKilled()]);

    if (call.killed) {
      return { started: true, status: 143, stdout: "", stderr: "" };
    }

    for (const line of script.after ?? [
      event({ event: "progress", done: 2, total: 2, unit: "functions" }),
    ]) {
      call.stderr(line);
    }

    if (script.fails) {
      return { started: true, status: 1, stdout: "", stderr: "" };
    }

    call.files.writeFile(
      output,
      `{"findings_version":1,"sensor":{"name":"${name}","version":"1"},"commit":"${commit}","modified":false,"settings":{},"findings":[]}`,
    );

    return { ...done, stdout: "" };
  }
}
