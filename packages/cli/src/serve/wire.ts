import type { ScanOutcome } from "@recognizer/core";
import { InputError } from "../errors.js";

export const OPERATIONS = [
  "scan.start",
  "scan.stop",
  "scan.status",
  "scan.watch",
  "scan.unwatch",
  "repository.watch",
  "repository.unwatch",
  "repository.state",
  "structure.read",
  "results.read",
  "results.clear",
  "inputs.read",
  "view.marks",
  "view.classify",
  "settings.validate",
  "responsibilities.read",
  "scan.plan",
  "scan.estimate",
  "scan.ticks",
  "confirm.answer",
  "sensor.work",
  "tests.hash",
  "setup.start",
  "setup.stop",
  "describer.read",
  "config.keys",
  "config.write",
  "view.parse",
  "view.serialise",
  "view.range",
  "view.renames",
  "view.author",
  "view.scans",
  "view.members",
  "history.list",
  "history.branches",
  "history.facts",
  "history.detail",
  "history.pulls",
  "changes.take",
  "changes.clear",
  "changes.adopt",
  "changes.poll",
  "git.begin",
  "git.poll",
  "git.end",
  "changes.worktree",
] as const;

export type Operation = (typeof OPERATIONS)[number];

export interface Request {
  id: number;
  op: Operation;
  args: Record<string, unknown>;
}

export type Parsed =
  | { ok: true; request: Request }
  | { ok: false; id: number | null; error: string };

export type WireGap = { id: string; line: string; needs: string[] };

export type WireOutcome =
  | { status: "finished" }
  | { status: "failed"; reason: "phases" }
  | { status: "failed"; reason: "invalid-request"; messages: string[] }
  | {
      status: "failed";
      reason: "crashed";
      error: { name: string; message: string };
    }
  | { status: "refused"; reason: "lock" }
  | { status: "refused"; reason: "preflight"; gaps: WireGap[] }
  | { status: "stopped" };

export function parseRequest(line: string): Parsed {
  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch (error) {
    return {
      ok: false,
      id: null,
      error: `the line is not JSON: ${(error as Error).message}`,
    };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, id: null, error: "the request is not an object" };
  }

  const record = value as Record<string, unknown>;
  const id =
    typeof record.id === "number" && Number.isInteger(record.id)
      ? record.id
      : null;

  if (id === null) {
    return { ok: false, id: null, error: "the request has no integer id" };
  }

  if (!OPERATIONS.includes(record.op as Operation)) {
    return {
      ok: false,
      id,
      error: `unknown op ${JSON.stringify(record.op)}`,
    };
  }

  if (
    typeof record.args !== "object" ||
    record.args === null ||
    Array.isArray(record.args)
  ) {
    return { ok: false, id, error: "args must be an object" };
  }

  return {
    ok: true,
    request: {
      id,
      op: record.op as Operation,
      args: record.args as Record<string, unknown>,
    },
  };
}

export function wireOutcome(outcome: ScanOutcome): WireOutcome {
  if (outcome.status === "refused" && outcome.reason === "preflight") {
    return {
      status: "refused",
      reason: "preflight",
      gaps: outcome.gaps.map(({ id, line, needs }) => ({ id, line, needs })),
    };
  }

  if (outcome.status === "failed" && outcome.reason === "crashed") {
    const error = outcome.error as { name?: unknown; message?: unknown };

    return {
      status: "failed",
      reason: "crashed",
      error: {
        name: typeof error?.name === "string" ? error.name : "Error",
        message:
          typeof error?.message === "string"
            ? error.message
            : String(outcome.error),
      },
    };
  }

  if (outcome.status === "failed" && outcome.reason === "invalid-request") {
    return {
      status: "failed",
      reason: "invalid-request",
      messages: outcome.messages,
    };
  }

  return outcome as WireOutcome;
}

export class ArgsError extends InputError {}

export function text(args: Record<string, unknown>, name: string): string {
  const value = args[name];

  if (typeof value !== "string" || value === "") {
    throw new ArgsError([`${name} must be a non-empty string`]);
  }

  return value;
}

export function optionalText(
  args: Record<string, unknown>,
  name: string,
): string | null {
  const value = args[name];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new ArgsError([`${name} must be a string`]);
  }

  return value;
}

export function textList(
  args: Record<string, unknown>,
  name: string,
): string[] | undefined {
  const value = args[name];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ArgsError([`${name} must be a list of strings`]);
  }

  return value as string[];
}

export function suiteMap(
  args: Record<string, unknown>,
  name: string,
): Record<string, string[]> | undefined {
  const value = args[name];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ArgsError([`${name} must map a sensor to its suite names`]);
  }

  for (const names of Object.values(value)) {
    if (
      !Array.isArray(names) ||
      names.some((item) => typeof item !== "string")
    ) {
      throw new ArgsError([`${name} must map a sensor to its suite names`]);
    }
  }

  return value as Record<string, string[]>;
}

export function knownHashes(
  args: Record<string, unknown>,
  name: string,
): Map<string, string> {
  const value = args[name];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArgsError([`${name} must map a path to its hash`]);
  }

  const known = new Map<string, string>();

  for (const [path, hash] of Object.entries(value)) {
    if (typeof hash !== "string") {
      throw new ArgsError([`${name} must map a path to its hash`]);
    }

    known.set(path, hash);
  }

  return known;
}
