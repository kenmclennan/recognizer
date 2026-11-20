import { resolve } from "node:path";
import { type ScanOutcome, type ScanRequest, scanSync } from "@recognizer/core";
import type { Io } from "./cli.js";
import type { ConfigRead } from "./config-parse.js";
import { InputError } from "./errors.js";
import { requireBy } from "./run-log.js";
import { createScanContainer, syncScanPorts } from "./scan-container.js";
import { REFUSED_EXIT } from "./scan-marker.js";
import { parseModuleScope, parseScanArgs } from "./scan-phases.js";
import { printEvent } from "./scan-wire.js";

function readModulesFile(io: Io, file: string): string {
  try {
    return io.readFile(resolve(file));
  } catch (error) {
    throw new InputError([
      `cannot read --modules file ${file}: ${(error as Error).message}`,
    ]);
  }
}

export function requestFrom(
  argv: string[],
  io: Io,
): { request: ScanRequest; json: boolean } {
  const options = parseScanArgs(argv);

  requireBy(options.by);

  const names =
    options.modules === undefined
      ? undefined
      : parseModuleScope(readModulesFile(io, options.modules));

  return {
    json: options.json,
    request: {
      repository: resolve(options.positionals[0] ?? "."),
      mode: options.extract ? "full" : "incremental",
      sensors:
        options.sense === null || options.sense === "all"
          ? options.sense
          : options.sense.map((name) => ({ name })),
      describe: options.describe,
      analysis: options.analysis,
      ...(options.confirmAbove === undefined
        ? {}
        : { confirmAbove: options.confirmAbove }),
      ...(options.modules === undefined || names === undefined
        ? {}
        : { modules: { file: resolve(options.modules), names } }),
      ...(options.by === undefined ? {} : { by: options.by }),
      ignoreRetiredConfig: options.ignoreRetiredConfig,
      ...(options.suites === undefined ? {} : { suitesFile: options.suites }),
      invocation: argv,
    },
  };
}

export function exitOf(outcome: ScanOutcome): number {
  if (outcome.status === "finished") {
    return 0;
  }

  if (outcome.status === "refused") {
    return outcome.reason === "lock" ? REFUSED_EXIT : 4;
  }

  if (outcome.status === "stopped") {
    return 143;
  }

  if (outcome.reason === "phases") {
    return 1;
  }

  if (outcome.reason === "invalid-request") {
    throw new InputError(outcome.messages);
  }

  throw outcome.error ?? new Error("scan crashed");
}

export async function scanMain(argv: string[], io: Io): Promise<number> {
  const { request, json } = requestFrom(argv, io);
  const running = createScanContainer(io, "all").start(request);

  try {
    for await (const event of running.events) {
      printEvent(event, json, io);
    }
  } finally {
    await running.outcome;
  }

  return exitOf(await running.outcome);
}

export function scanSyncMain(argv: string[], io: Io, read: ConfigRead): number {
  const { request, json } = requestFrom(argv, io);
  const outcome = scanSync(request, syncScanPorts(io, read), (event) =>
    printEvent(event, json, io),
  );

  return exitOf(outcome);
}
