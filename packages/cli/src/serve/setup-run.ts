import { resolve } from "node:path";
import {
  createScan,
  type PlannedChange,
  rehearsalChanges,
  type SetupChoices,
  type SetupEntry,
  type SetupScan,
  type SetupStop,
} from "@recognizer/core";
import type { Io } from "../cli.js";
import { configurationFor } from "../configuration-composition.js";
import { buildRecord, entryFrom, recordRun } from "../run-log.js";
import { scanPorts } from "../scan-container.js";
import { requestFrom } from "../scan-main.js";
import { ArgsError, text } from "./wire.js";

export const SETUP_ACTIONS = ["survey", "recommend", "apply", "try"] as const;

export type SetupAction = (typeof SETUP_ACTIONS)[number];

export interface SetupRequest {
  repository: string;
  action: SetupAction;
  environment: Record<string, string>;
  args: Record<string, unknown>;
}

export interface SetupStopControl {
  stop: SetupStop;
  request(): void;
  settled: Promise<void>;
}

export function parseSetup(args: Record<string, unknown>): SetupRequest {
  const repository = resolve(text(args, "repository"));
  const action = args.action;

  if (!SETUP_ACTIONS.includes(action as SetupAction)) {
    throw new ArgsError([`action must be one of ${SETUP_ACTIONS.join(", ")}`]);
  }

  const environment: Record<string, string> = {};
  const given = args.environment;

  if (typeof given === "object" && given !== null && !Array.isArray(given)) {
    for (const [name, value] of Object.entries(given)) {
      if (typeof value === "string") {
        environment[name] = value;
      }
    }
  }

  return { repository, action: action as SetupAction, environment, args };
}

export function stopControl(): SetupStopControl {
  let requested = false;
  let handler: () => void = () => {};
  let finish: () => void = () => {};
  const settled = new Promise<void>((resolveDone) => {
    finish = resolveDone;
  });

  return {
    stop: {
      requested: () => requested,
      onRequest: (next) => {
        handler = next;

        if (requested) {
          next();
        }
      },
      settled: () => finish(),
    },
    request: () => {
      requested = true;
      handler();
    },
    settled,
  };
}

function failure(action: SetupAction, reason: string): unknown {
  if (action === "survey") {
    return { status: "unavailable", reason };
  }

  if (action === "recommend") {
    return {
      status: "failed",
      reason,
      subtype: null,
      costUsd: null,
      durationMs: null,
    };
  }

  return { status: "failed", reason };
}

function reasonOf(error: unknown): string {
  return (
    (error as { messages?: string[] }).messages?.join("; ") ??
    (error as Error).message
  );
}

function scanOver(io: Io): SetupScan {
  return {
    extract: async (root, onLine) => {
      try {
        const running = createScan(scanPorts(io, "all")).start(
          requestFrom([root, "--extract"], io).request,
        );

        for await (const event of running.events) {
          onLine(JSON.stringify(event));
        }

        const outcome = await running.outcome;

        if (outcome.status === "finished") {
          return { ok: true };
        }

        const reason = (outcome as { reason?: unknown }).reason;

        return {
          ok: false,
          reason: `the scan ${outcome.status}${typeof reason === "string" ? `: ${reason}` : ""}`,
        };
      } catch (error) {
        return { ok: false, reason: reasonOf(error) };
      }
    },
  };
}

function runEntry(entry: SetupEntry) {
  return entryFrom(entry.name, {
    command: entry.command,
    status: entry.status,
    duration_ms: entry.durationMs,
    stderr: entry.output,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
  });
}

function choicesOf(args: Record<string, unknown>): SetupChoices {
  const value = args.choices;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArgsError(["choices must be an object"]);
  }

  return value as SetupChoices;
}

export async function runSetupAction(
  io: Io,
  request: SetupRequest,
  control: SetupStopControl,
  emit: (line: string) => void,
): Promise<unknown> {
  const { repository: root, action, args } = request;
  const configuration = configurationFor(io, {
    environment: request.environment,
    scan: scanOver(io),
  });

  try {
    if (action === "survey") {
      const read = await configuration.readSetup({
        root,
        extract: args.extract === true,
        onLine: emit,
      });

      return read;
    }

    if (action === "recommend") {
      const schema =
        typeof args.schema === "string"
          ? args.schema
          : JSON.stringify(args.schema);

      return await configuration.recommendPolicy({
        root,
        model: typeof args.model === "string" ? args.model : "",
        prompt: text(args, "prompt"),
        schema,
        onLine: emit,
        environment: request.environment,
        stop: control.stop,
      });
    }

    const { survey, built } = await configuration.buildSetupChanges({
      root,
      choices: choicesOf(args),
    });
    const onEvent = (event: unknown) => emit(JSON.stringify(event));

    if (action === "apply") {
      const startedAt = io.now();
      const entries: ReturnType<typeof runEntry>[] = [];
      const outcome = await configuration.applySetup({
        root,
        changes: built.changes,
        stop: control.stop,
        onEvent,
        onEntry: (entry) => entries.push(runEntry(entry)),
      });

      if (outcome.status === "refused") {
        return outcome;
      }

      recordRun(
        io,
        root,
        buildRecord(io, "setup", startedAt, undefined, [], entries),
      );

      return { status: "finished", result: outcome.result };
    }

    const changes: PlannedChange[] = rehearsalChanges(survey, built.changes);
    const outcome = await configuration.trySetup({
      root,
      changes,
      stop: control.stop,
      onEvent,
    });

    return outcome.status === "refused"
      ? outcome
      : { status: "finished", result: outcome.result };
  } catch (error) {
    control.stop.settled();

    return failure(action, reasonOf(error));
  }
}
