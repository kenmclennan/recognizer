#!/usr/bin/env node
import { spawn } from "node:child_process";
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
import { interpretReply, LIMIT_STATUS, LimitError } from "./reply.js";

const TIMEOUT_MS = 120_000;
const PACKAGE_FILE = new URL("../package.json", import.meta.url);
const CHECK_FLAG = "--check";
const USAGE = "usage: recognizer-describe-claude --model <name> <request-file>";

function claudeArgs(model: string): string[] {
  return [
    "-p",
    "--model",
    model,
    "--tools",
    "",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--disable-slash-commands",
    "--system-prompt",
    "You describe code modules.",
  ];
}

const FORWARDED = { SIGINT: 2, SIGTERM: 15 } as const;

function runClaude(model: string, input: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "recognizer-describe-"));

  return new Promise<string>((resolve, reject) => {
    const child = spawn("claude", claudeArgs(model), {
      cwd: directory,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let interrupted: keyof typeof FORWARDED | undefined;
    let timedOut = false;
    let settled = false;

    const forwarders = (
      Object.keys(FORWARDED) as (keyof typeof FORWARDED)[]
    ).map((signal) => {
      const handler = () => {
        interrupted = signal;
        child.kill(signal);
      };

      process.on(signal, handler);

      return { signal, handler };
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, TIMEOUT_MS);

    const finish = (action: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      for (const { signal, handler } of forwarders) {
        process.off(signal, handler);
      }

      rmSync(directory, { recursive: true, force: true });
      action();
    };

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.stdin.on("error", () => {});

    child.on("error", (error) =>
      finish(() =>
        reject(new DescribeError(`claude could not be run: ${error.message}`)),
      ),
    );

    child.on("close", (status, signal) =>
      finish(() => {
        if (interrupted !== undefined) {
          process.exit(128 + FORWARDED[interrupted]);
        }

        if (timedOut) {
          reject(
            new DescribeError(
              `claude timed out after ${TIMEOUT_MS / 1000} seconds`,
            ),
          );

          return;
        }

        try {
          resolve(
            interpretReply(
              status,
              signal,
              Buffer.concat(out).toString("utf8"),
              Buffer.concat(err).toString("utf8"),
            ),
          );
        } catch (error) {
          reject(error);
        }
      }),
    );

    child.stdin.end(input);
  });
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

async function main(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--version") {
    const { version } = JSON.parse(readFileSync(PACKAGE_FILE, "utf8")) as {
      version: string;
    };
    process.stdout.write(`${version}\n`);

    return 0;
  }

  if (args.length === 1 && args[0] === "--prompt-version") {
    process.stdout.write(`${promptVersion()}\n`);

    return 0;
  }

  try {
    const { file } = parseArguments(args);

    if (file === CHECK_FLAG) {
      process.stdout.write("ok\n");

      return 0;
    }

    const { model } = parseArguments(args);

    let text: string;

    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      throw new UsageError(
        `cannot read the request: ${(error as Error).message}`,
      );
    }

    const request = parseRequest(text);
    const line = await describeModule(request, readPrompt(), (input) =>
      runClaude(model, input),
    );

    process.stdout.write(`${line}\n`);

    return 0;
  } catch (error) {
    if (error instanceof LimitError) {
      process.stderr.write(`claude usage limit: ${error.message}\n`);

      return LIMIT_STATUS;
    }

    process.stderr.write(`${(error as Error).message}\n`);

    return error instanceof UsageError ? 2 : 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
