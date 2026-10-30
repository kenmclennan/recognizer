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
const CLAUDE_ARGS = ["-p", "--tools", "", "--no-session-persistence"];

function runClaude(input: string): string {
  const directory = mkdtempSync(join(tmpdir(), "recognizer-describe-"));

  try {
    const result = spawnSync("claude", CLAUDE_ARGS, {
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

function main(args: string[]): number {
  if (args.length === 1 && args[0] === "--prompt-version") {
    process.stdout.write(`${promptVersion()}\n`);

    return 0;
  }

  try {
    if (args.length !== 1) {
      throw new UsageError("usage: recognizer-describe-claude <request-file>");
    }

    let text: string;

    try {
      text = readFileSync(args[0] as string, "utf8");
    } catch (error) {
      throw new UsageError(
        `cannot read the request: ${(error as Error).message}`,
      );
    }

    const request = parseRequest(text);
    const line = describeModule(request, readPrompt(), runClaude);

    process.stdout.write(`${line}\n`);

    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);

    return error instanceof UsageError ? 2 : 1;
  }
}

process.exitCode = main(process.argv.slice(2));
