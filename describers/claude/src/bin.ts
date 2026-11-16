#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { systemAwakeClock } from "./awake-clock.js";
import { runClaude } from "./claude-run.js";
import { describeModule, parseRequest, UsageError } from "./describe.js";
import { manifestText } from "./manifest.js";
import { readPrompt } from "./prompt.js";
import { LIMIT_STATUS, LimitError } from "./reply.js";

const PACKAGE_FILE = new URL("../package.json", import.meta.url);
const VERBS = "manifest, check, run, guide";
const USAGE =
  "usage: recognizer-describe-claude run --model <name> <request-file>";
const EVENT_PREFIX = "recognizer-event ";
const UNIT = "modules";

function emit(event: Record<string, unknown>): void {
  process.stderr.write(`${EVENT_PREFIX}${JSON.stringify(event)}\n`);
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
  if (args.length === 1 && args[0] === "manifest") {
    process.stdout.write(manifestText());

    return 0;
  }

  if (args.length === 1 && args[0] === "--version") {
    const { version } = JSON.parse(readFileSync(PACKAGE_FILE, "utf8")) as {
      version: string;
    };
    process.stdout.write(`${version}\n`);

    return 0;
  }

  if (args.length === 1 && args[0] === "check") {
    process.stdout.write(`${JSON.stringify({ gaps: [], notes: [] })}\n`);

    return 0;
  }

  if (args.length === 1 && args[0] === "guide") {
    return 0;
  }

  if (args[0] !== "run") {
    process.stderr.write(
      `recognizer-describe-claude: the first argument must be a verb: ${VERBS}\n`,
    );

    return 2;
  }

  try {
    const { model, file } = parseArguments(args.slice(1));

    let text: string;

    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      throw new UsageError(
        `cannot read the request: ${(error as Error).message}`,
      );
    }

    const request = parseRequest(text);

    emit({ event: "start", total: 1, unit: UNIT });

    const line = await describeModule(request, readPrompt(), (input) =>
      runClaude(model, input, clock),
    );

    emit({ event: "progress", done: 1, total: 1, unit: UNIT });

    process.stdout.write(`${line}\n`);

    return 0;
  } catch (error) {
    if (error instanceof LimitError) {
      emit({
        event: "diagnosis",
        code: "usage-limit",
        text: `claude usage limit: ${error.message}`,
      });
      process.stderr.write(`claude usage limit: ${error.message}\n`);

      return LIMIT_STATUS;
    }

    process.stderr.write(`${(error as Error).message}\n`);

    return error instanceof UsageError ? 2 : 1;
  }
}

const clock = systemAwakeClock();

process.exitCode = await main(process.argv.slice(2));
