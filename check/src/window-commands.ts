import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";

const SOCKET_ENV = "RECOGNIZER_APP_SOCKET";
const MAX_SOCKET_BYTES = 100;

interface Selection {
  kind: string;
  id: string;
}

export interface WindowListing {
  id: string;
  folder: string;
  view: string | null;
  selection: Selection | null;
}

export interface TrailPanel {
  selection: Selection;
  relation: "uses" | "used-by" | null;
  tab: string;
  active: boolean;
}

export interface WindowState extends WindowListing {
  modules: string[];
  folded: string[];
  focus: string | null;
  trail: TrailPanel[];
  inspector: { open: boolean; tab: string };
}

export type Answer =
  | { kind: "done"; result: unknown }
  | { kind: "refused"; reason: string }
  | { kind: "unreachable"; message: string };

export function socketPath(io: Io): string {
  const override = io.env(SOCKET_ENV);
  const home = io.env("HOME");
  const path =
    override !== undefined && override !== ""
      ? override
      : join(
          home ?? "",
          "Library",
          "Application Support",
          "com.kenmclennan.recognizer",
          "app.sock",
        );

  if (Buffer.byteLength(path) > MAX_SOCKET_BYTES) {
    throw new InputError([
      `the socket path ${path} is longer than ${MAX_SOCKET_BYTES} bytes`,
    ]);
  }

  return path;
}

export function askApp(io: Io, body: Record<string, unknown>): Answer {
  const path = socketPath(io);
  const reply = io.request(path, JSON.stringify({ v: 1, ...body }));

  if (!reply.connected) {
    return {
      kind: "unreachable",
      message: `the Recognizer app is not running (no socket at ${path})`,
    };
  }

  let parsed: {
    v?: unknown;
    status?: unknown;
    result?: unknown;
    reason?: unknown;
  };

  try {
    parsed = JSON.parse(reply.response);
  } catch {
    return {
      kind: "unreachable",
      message: `the Recognizer app at ${path} sent an answer that is not JSON`,
    };
  }

  if (parsed.v !== 1) {
    return {
      kind: "unreachable",
      message: `the Recognizer app at ${path} speaks another version of the socket protocol`,
    };
  }

  if (parsed.status === "done") {
    return { kind: "done", result: parsed.result };
  }

  return {
    kind: "refused",
    reason:
      typeof parsed.reason === "string"
        ? parsed.reason
        : "the app refused the request",
  };
}

export function windowOrFail(io: Io, id: string | undefined): WindowState {
  const answer = askApp(
    io,
    id === undefined ? { command: "window" } : { command: "window", id },
  );

  if (answer.kind === "done") {
    return answer.result as WindowState;
  }

  throw new InputError([
    answer.kind === "refused" ? answer.reason : answer.message,
  ]);
}

function selectionText(selection: Selection | null): string {
  return selection === null ? "-" : `${selection.kind} ${selection.id}`;
}

function parse(argv: string[], usage: string, positionals: number) {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { json: { type: "boolean" } },
  });

  if (parsed.positionals.length > positionals) {
    throw new InputError([`usage: ${usage}`]);
  }

  return parsed;
}

function failure(io: Io, answer: Answer): number {
  io.stderr(
    `${answer.kind === "refused" ? answer.reason : answer.kind === "unreachable" ? answer.message : ""}\n`,
  );

  return 1;
}

export function runWindows(argv: string[], io: Io): number {
  const { values } = parse(argv, "recognizer windows [--json]", 0);
  const answer = askApp(io, { command: "windows" });

  if (answer.kind !== "done") {
    return failure(io, answer);
  }

  const windows = answer.result as WindowListing[];

  if (values.json === true) {
    io.stdout(`${JSON.stringify(windows, null, 2)}\n`);

    return 0;
  }

  io.stdout(
    windows.length === 0
      ? "no windows are open\n"
      : `${windows
          .map(
            (w) =>
              `${w.id}  ${w.folder}  view: ${w.view ?? "-"}  selection: ${selectionText(w.selection)}`,
          )
          .join("\n")}\n`,
  );

  return 0;
}

function trailLine(panel: TrailPanel): string {
  const relation = panel.relation === null ? "" : `${panel.relation}  `;

  return `  ${selectionText(panel.selection)}  ${relation}tab: ${panel.tab}${panel.active ? "  (active)" : ""}`;
}

function windowBlock(state: WindowState): string {
  const list = (items: string[]) => items.map((item) => `  ${item}`);

  return [
    `${state.id}  ${state.folder}`,
    `view: ${state.view ?? "-"}`,
    `modules: ${state.modules.length}`,
    ...list(state.modules),
    `folded: ${state.folded.length}`,
    ...list(state.folded),
    `focus: ${state.focus ?? "-"}`,
    `selection: ${selectionText(state.selection)}`,
    `trail: ${state.trail.length}`,
    ...state.trail.map(trailLine),
    `inspector: ${state.inspector.open ? "open" : "closed"}, tab: ${state.inspector.tab}`,
  ].join("\n");
}

const DRIVE_VERBS: Record<string, { min: number; max: number; need: string }> =
  {
    add: { min: 1, max: Infinity, need: "one or more module paths" },
    remove: { min: 1, max: Infinity, need: "one or more module paths" },
    fold: { min: 1, max: Infinity, need: "one or more folder ids" },
    focus: { min: 1, max: 1, need: "one folder id" },
    select: { min: 1, max: 1, need: "one module path or folder id" },
    trail: { min: 2, max: 2, need: "uses or used-by, then a module path" },
    "open-view": { min: 1, max: 1, need: "one saved view name" },
    clear: {
      min: 1,
      max: 1,
      need: "one of modules, folds, focus, selection, all",
    },
  };

const DEFAULT_BY = "Agent";
const VALID_BY = /^[A-Za-z0-9 _-]{1,32}$/;

const DRIVE_USAGE =
  "recognizer window <id> add|remove|fold|focus|select|trail|open-view|clear <argument>... [--by <name>] [--json]";

const DRIVE_OPTIONS = {
  json: { type: "boolean" },
  off: { type: "boolean" },
  by: { type: "string" },
} as const;

function runDrive(parsed: ReturnType<typeof parseDrive>, io: Io): number {
  const [id, verb, ...args] = parsed.positionals as [
    string,
    string,
    ...string[],
  ];
  const rule = DRIVE_VERBS[verb];
  const by = parsed.values.by ?? DEFAULT_BY;

  if (rule === undefined) {
    throw new InputError([
      `${verb} is not a window verb`,
      `usage: ${DRIVE_USAGE}`,
    ]);
  }

  if (args.length < rule.min || args.length > rule.max) {
    throw new InputError([
      `${verb} needs ${rule.need}`,
      `usage: ${DRIVE_USAGE}`,
    ]);
  }

  if (parsed.values.off === true && verb !== "fold") {
    throw new InputError(["--off applies only to fold"]);
  }

  if (!VALID_BY.test(by)) {
    throw new InputError([
      "--by takes 1-32 characters of letters, digits, space, - and _",
    ]);
  }

  const answer = askApp(io, {
    command: "drive",
    id,
    action: verb,
    args,
    options: parsed.values.off === true ? { off: true } : {},
    by,
  });

  if (answer.kind !== "done") {
    return failure(io, answer);
  }

  const result = answer.result as { summary: string };

  io.stdout(
    parsed.values.json === true
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${result.summary}\n`,
  );

  return 0;
}

function parseDrive(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: DRIVE_OPTIONS,
  });
}

export function runWindow(argv: string[], io: Io): number {
  const drive = parseDrive(argv);

  if (drive.positionals.length >= 2) {
    return runDrive(drive, io);
  }

  const { values, positionals } = parse(
    argv,
    "recognizer window [<id>] [--json]",
    1,
  );
  const id = positionals[0];
  const answer = askApp(
    io,
    id === undefined ? { command: "window" } : { command: "window", id },
  );

  if (answer.kind !== "done") {
    return failure(io, answer);
  }

  io.stdout(
    values.json === true
      ? `${JSON.stringify(answer.result, null, 2)}\n`
      : `${windowBlock(answer.result as WindowState)}\n`,
  );

  return 0;
}
