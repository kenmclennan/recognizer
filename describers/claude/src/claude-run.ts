import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AwakeClock } from "./awake-clock.js";
import { DescribeError } from "./describe.js";
import { interpretReply } from "./reply.js";

export const TIMEOUT_MS = 120_000;

export interface ClaudeCommand {
  file: string;
  args: string[];
}

export function claudeArgs(model: string): string[] {
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

export function runClaude(
  model: string,
  input: string,
  clock: AwakeClock,
  command: ClaudeCommand = { file: "claude", args: claudeArgs(model) },
  limitMs: number = TIMEOUT_MS,
): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "recognizer-describe-"));

  return new Promise<string>((resolve, reject) => {
    const child = spawn(command.file, command.args, {
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

    const cancel = clock.after(limitMs, () => {
      timedOut = true;
      child.kill("SIGTERM");
    });

    const finish = (action: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cancel();

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
              `claude timed out after ${limitMs / 1000} seconds`,
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
