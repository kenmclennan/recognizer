#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DescribeError,
  describeModule,
  parseRequest,
  UsageError,
} from "./describe.js";
import { promptVersion, readPrompt } from "./prompt.js";

const TIMEOUT_MS = 120_000;
const USAGE = "usage: recognizer-describe-claude --model <name> <request-file>";

function claudeArgs(model: string): string[] {
  return ["-p", "--model", model, "--tools", "", "--no-session-persistence"];
}

function runClaude(model: string, input: string): string {
  const directory = mkdtempSync(join(tmpdir(), "recognizer-describe-"));

  try {
    const result = spawnSync("claude", claudeArgs(model), {
      input,
      cwd: directory,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });

    if (result.error) {
      const timedOut =
        (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";

      throw new DescribeError(
        timedOut
          ? `claude timed out after ${TIMEOUT_MS / 1000} seconds`
          : `claude could not be run: ${result.error.message}`,
      );
    }

    if (result.status !== 0) {
      const detail = (result.stderr ?? "").trim();

      throw new DescribeError(
        `claude exited with ${result.status ?? result.signal}${detail ? `: ${detail}` : ""}`,
      );
    }

    return result.stdout;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function parseArguments(args: string[]): { model: string; file: string } {
  const positionals: string[] = [];
  let model: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--model") {
      model = args[index + 1];
      index += 1;
    } else {
      positionals.push(args[index] as string);
    }
  }

  if (model === undefined || model === "" || positionals.length !== 1) {
    throw new UsageError(USAGE);
  }

  return { model, file: positionals[0] as string };
}

function main(args: string[]): number {
  if (args.length === 1 && args[0] === "--prompt-version") {
    process.stdout.write(`${promptVersion()}\n`);

    return 0;
  }

  try {
    const { model, file } = parseArguments(args);

    let text: string;

    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      throw new UsageError(
        `cannot read the request: ${(error as Error).message}`,
      );
    }

    const request = parseRequest(text);
    const line = describeModule(request, readPrompt(), (input) =>
      runClaude(model, input),
    );

    process.stdout.write(`${line}\n`);

    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);

    return error instanceof UsageError ? 2 : 1;
  }
}

process.exitCode = main(process.argv.slice(2));
