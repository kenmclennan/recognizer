import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { changeMarks, parseNameStatus } from "./change-marks.js";
import type { Io } from "./cli.js";
import { InputError, Refusal } from "./errors.js";
import { freshScans } from "./freshness.js";
import { changeFacts, diffNameStatus, parseChangeFlag } from "./git-range.js";
import { moduleNames, under } from "./neighbours.js";
import { appendNote, placeNote, reorderNotes } from "./notes-order.js";
import type { RecordedScan, Scan } from "./scan.js";
import { resolveCommit } from "./scan-command.js";
import {
  type ChangeFacts,
  type StaleReason,
  staleReasons,
  staleReasonText,
} from "./view-staleness.js";
import {
  lastNotePerPath,
  migrateView,
  noteWarnings,
  orderedStep,
  type ResolvedView,
  rangeText,
  resolveView,
  serialiseView,
  type View,
  type ViewNote,
  type ViewStep,
  validateView,
  viewNotes,
} from "./views.js";
import { windowOrFail } from "./window-commands.js";

export const VIEW_SUBCOMMANDS = [
  "new",
  "add",
  "rule",
  "fold",
  "focus",
  "remove",
  "note",
  "reorder",
  "set",
  "show",
  "diff",
  "list",
  "check",
  "rm",
] as const;

type Subcommand = (typeof VIEW_SUBCOMMANDS)[number];

const OPTIONS = {
  repository: { type: "string" },
  json: { type: "boolean" },
  description: { type: "string" },
  folder: { type: "string" },
  uses: { type: "string" },
  "used-by": { type: "string" },
  within: { type: "string" },
  fold: { type: "boolean" },
  focus: { type: "boolean" },
  rule: { type: "string" },
  fix: { type: "boolean" },
  "from-window": { type: "string" },
  by: { type: "string" },
  remove: { type: "boolean" },
  after: { type: "string" },
  first: { type: "boolean" },
  change: { type: "string" },
} as const;

export const VIEW_FLAGS = Object.keys(OPTIONS).map((name) => `--${name}`);

const ALLOWED: Record<Subcommand, string[]> = {
  new: ["description", "from-window", "change"],
  add: [],
  rule: ["folder", "uses", "used-by", "within"],
  fold: [],
  focus: [],
  remove: ["fold", "focus", "rule", "within"],
  note: ["by", "remove", "after", "first"],
  reorder: [],
  set: ["change"],
  show: [],
  diff: [],
  list: [],
  check: ["fix"],
  rm: [],
};

const USAGE: Record<Subcommand, string> = {
  new: "recognizer views new <name> --description <text> [--change <base>..<head>] [--from-window <id>] [--repository <dir>] [--json]",
  add: "recognizer views add <name> <module>... [--repository <dir>] [--json]",
  rule: "recognizer views rule <name> (--folder <folder> | --uses <module> | --used-by <module>) [--within <folder>] [--repository <dir>] [--json]",
  fold: "recognizer views fold <name> <folder> [--repository <dir>] [--json]",
  focus: "recognizer views focus <name> <folder> [--repository <dir>] [--json]",
  remove:
    "recognizer views remove <name> <path> [--fold | --focus | --rule folder|uses|used-by [--within <folder>]] [--repository <dir>] [--json]",
  note: "recognizer views note <name> <module-or-folder> (<text> [--by <name>] [--after <module-or-folder> | --first] | --remove [--by <name>]) [--repository <dir>] [--json]",
  reorder:
    "recognizer views reorder <name> <module-or-folder>... [--repository <dir>] [--json]",
  set: "recognizer views set <name> --change <base>..<head>|none [--repository <dir>] [--json]",
  show: "recognizer views show <name> [--repository <dir>] [--json]",
  diff: "recognizer views diff <name> [--repository <dir>] [--json]",
  list: "recognizer views list [--repository <dir>] [--json]",
  check:
    "recognizer views check [<name>] [--fix] [--repository <dir>] [--json]",
  rm: "recognizer views rm <name> [--repository <dir>] [--json]",
};

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RELATIONS = ["folder", "uses", "used-by"];

interface Context {
  io: Io;
  root: string;
  json: boolean;
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

interface Changed {
  view: View;
  what: string;
}

function viewsDirectory(root: string): string {
  return join(root, ".recognizer", "views");
}

function viewFile(root: string, name: string): string {
  return join(viewsDirectory(root), `${name}.json`);
}

function writeViewFile(io: Io, file: string, view: View): void {
  const temp = `${file}.tmp`;

  io.writeFile(temp, serialiseView(view));
  io.rename(temp, file);
}

function folderPath(path: string): string {
  return path.replace(/\/+$/, "");
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function emit(context: Context, document: unknown, text: string): void {
  context.io.stdout(
    context.json ? `${JSON.stringify(document, null, 2)}\n` : `${text}\n`,
  );
}

function checkName(name: string | undefined): string {
  if (name === undefined || !NAME.test(name)) {
    throw new InputError([
      `invalid view name: ${name ?? ""} (letters, digits, - and _, starting with a letter or digit, at most 64)`,
    ]);
  }

  return name;
}

function readView(io: Io, root: string, name: string): View {
  const file = viewFile(root, name);

  if (!io.exists(file)) {
    throw new InputError([`no such view: ${name}`]);
  }

  return parseView(io, file, name);
}

function parseView(io: Io, file: string, name: string): View {
  let parsed: unknown;

  try {
    parsed = JSON.parse(io.readFile(file));
  } catch {
    throw new InputError([`view ${name} is not valid JSON`]);
  }

  try {
    return validateView(parsed);
  } catch (error) {
    throw new InputError([
      `view ${name} is invalid`,
      ...(error as InputError).messages,
    ]);
  }
}

function viewNames(io: Io, root: string): string[] {
  try {
    return io
      .readDir(viewsDirectory(root))
      .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -".json".length))
      .filter((name) => NAME.test(name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function describeStep(step: ViewStep): string {
  switch (step.kind) {
    case "pick":
      return `pick ${step.module}`;
    case "left-out":
      return `left-out ${step.module}`;
    case "fold":
      return `fold ${step.folder}`;
    case "focus":
      return `focus ${step.folder}`;
    case "rule":
      return `rule ${step.relation} ${step.of}${step.relation !== "folder" && step.within !== undefined ? ` within ${step.within}` : ""}`;
  }
}

function sameStep(a: ViewStep, b: ViewStep): boolean {
  return JSON.stringify(orderedStep(a)) === JSON.stringify(orderedStep(b));
}

function context(subcommand: Subcommand, argv: string[], io: Io): Context {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: OPTIONS,
  });
  const allowed = new Set(["repository", "json", ...ALLOWED[subcommand]]);

  for (const flag of Object.keys(values)) {
    if (!allowed.has(flag)) {
      throw new InputError([
        `--${flag} does not apply to views ${subcommand}`,
        `usage: ${USAGE[subcommand]}`,
      ]);
    }
  }

  return {
    io,
    root: resolve((values.repository as string | undefined) ?? "."),
    json: values.json === true,
    values,
    positionals,
  };
}

function usageError(subcommand: Subcommand): InputError {
  return new InputError([`usage: ${USAGE[subcommand]}`]);
}

function requireFolder(scans: Scan[], folder: string): void {
  if (!moduleNames(scans).some((module) => under(module, folder))) {
    throw new InputError([`no such folder: ${folder}`]);
  }
}

function requireModules(scans: Scan[], paths: string[]): void {
  const known = new Set(moduleNames(scans));
  const missing = paths.filter((path) => !known.has(path));

  if (missing.length > 0) {
    throw new InputError(missing.map((path) => `no such module: ${path}`));
  }
}

function finishMutation(
  c: Context,
  name: string,
  view: View,
  before: View,
  scans: Scan[],
  what: string,
): number {
  const changed = serialiseView(view) !== serialiseView(before);
  const modules = resolveView(view, scans).modules.length;

  if (changed) {
    writeViewFile(c.io, viewFile(c.root, name), view);
  }

  emit(
    c,
    { view: name, changed, steps: view.steps.length, modules },
    `${name}: ${changed ? what : "no change"}; ${plural(view.steps.length, "step")}, resolves to ${plural(modules, "module")}`,
  );

  return 0;
}

function mutate(
  subcommand: Subcommand,
  argv: string[],
  io: Io,
  change: (c: Context, view: View, scans: Scan[]) => Changed,
  arity: (positionals: number) => boolean,
): number {
  const c = context(subcommand, argv, io);

  if (!arity(c.positionals.length)) {
    throw usageError(subcommand);
  }

  const name = checkName(c.positionals[0]);
  const before = readView(io, c.root, name);
  const { scans } = freshScans(io, c.root);
  const { view, what } = change(c, structuredClone(before), scans);

  return finishMutation(c, name, view, before, scans, what);
}

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function windowSteps(
  c: Context,
  id: string,
): { steps: ViewStep[]; scans: Scan[] } {
  const state = windowOrFail(c.io, id);

  if (folderPath(state.folder) !== folderPath(c.root)) {
    throw new InputError([`${state.id} shows ${state.folder}, not ${c.root}`]);
  }

  const { scans } = freshScans(c.io, c.root);

  requireModules(scans, state.modules);

  return {
    steps: [
      ...[...state.modules]
        .sort(byText)
        .map((module) => ({ kind: "pick" as const, module })),
      ...[...state.folded]
        .sort(byText)
        .map((folder) => ({ kind: "fold" as const, folder })),
      ...(state.focus === null
        ? []
        : [{ kind: "focus" as const, folder: state.focus }]),
    ],
    scans,
  };
}

function runNew(argv: string[], io: Io): number {
  const c = context("new", argv, io);

  if (c.positionals.length !== 1) {
    throw usageError("new");
  }

  const name = checkName(c.positionals[0]);
  const description = c.values.description;

  if (typeof description !== "string" || description.trim() === "") {
    throw new InputError(["--description is required and must not be blank"]);
  }

  if (io.exists(viewFile(c.root, name))) {
    throw new InputError([`view already exists: ${name}`]);
  }

  const changeFlag = c.values.change;
  const change =
    typeof changeFlag === "string"
      ? parseChangeFlag(io, c.root, changeFlag)
      : undefined;
  const windowId = c.values["from-window"];
  const fromWindow =
    typeof windowId === "string" ? windowSteps(c, windowId) : null;

  const view: View = {
    schema_version: 4,
    description,
    commit: resolveCommit(io, c.root),
    ...(change === undefined ? {} : { change }),
    steps: fromWindow?.steps ?? [],
  };

  writeViewFile(io, viewFile(c.root, name), view);

  const modules = fromWindow
    ? resolveView(view, fromWindow.scans).modules.length
    : 0;

  emit(
    c,
    { view: name, changed: true, steps: view.steps.length, modules },
    `${name}: created; ${plural(view.steps.length, "step")}, resolves to ${plural(modules, "module")}`,
  );

  return 0;
}

function runAdd(argv: string[], io: Io): number {
  return mutate(
    "add",
    argv,
    io,
    (c, view, scans) => {
      const paths = [...new Set(c.positionals.slice(1))];

      requireModules(scans, paths);

      const picked = new Set(
        view.steps.flatMap((s) => (s.kind === "pick" ? [s.module] : [])),
      );
      const added = paths.filter((path) => !picked.has(path));

      view.steps = view.steps.filter(
        (s) => !(s.kind === "left-out" && paths.includes(s.module)),
      );
      view.steps.push(
        ...added.map((module) => ({ kind: "pick" as const, module })),
      );

      return { view, what: `added ${plural(added.length, "pick")}` };
    },
    (count) => count >= 2,
  );
}

function runRule(argv: string[], io: Io): number {
  return mutate(
    "rule",
    argv,
    io,
    (c, view, scans) => {
      const relations = RELATIONS.filter(
        (relation) => c.values[relation] !== undefined,
      );

      if (relations.length !== 1) {
        throw new InputError([
          "exactly one of --folder, --uses or --used-by is required",
          `usage: ${USAGE.rule}`,
        ]);
      }

      const relation = relations[0] as "folder" | "uses" | "used-by";
      const within =
        c.values.within === undefined
          ? undefined
          : folderPath(c.values.within as string);

      if (relation === "folder" && within !== undefined) {
        throw new InputError(["--within does not apply to --folder"]);
      }

      let step: ViewStep;

      if (relation === "folder") {
        const of = folderPath(c.values.folder as string);

        requireFolder(scans, of);
        step = { kind: "rule", relation, of };
      } else {
        const of = c.values[relation] as string;

        requireModules(scans, [of]);

        if (within !== undefined) {
          requireFolder(scans, within);
        }

        step = {
          kind: "rule",
          relation,
          of,
          ...(within === undefined ? {} : { within }),
        };
      }

      if (!view.steps.some((existing) => sameStep(existing, step))) {
        view.steps.push(step);
      }

      return { view, what: `added ${describeStep(step)}` };
    },
    (count) => count === 1,
  );
}

function runFold(argv: string[], io: Io): number {
  return mutate(
    "fold",
    argv,
    io,
    (c, view, scans) => {
      const folder = folderPath(c.positionals[1] as string);

      requireFolder(scans, folder);

      const step: ViewStep = { kind: "fold", folder };

      if (!view.steps.some((existing) => sameStep(existing, step))) {
        view.steps.push(step);
      }

      return { view, what: `added ${describeStep(step)}` };
    },
    (count) => count === 2,
  );
}

function runFocus(argv: string[], io: Io): number {
  return mutate(
    "focus",
    argv,
    io,
    (c, view, scans) => {
      const folder = folderPath(c.positionals[1] as string);

      requireFolder(scans, folder);

      const step: ViewStep = { kind: "focus", folder };
      const position = view.steps.findIndex(
        (existing) => existing.kind === "focus",
      );

      if (position === -1) {
        view.steps.push(step);
      } else {
        view.steps[position] = step;
      }

      return { view, what: `set ${describeStep(step)}` };
    },
    (count) => count === 2,
  );
}

function runRemove(argv: string[], io: Io): number {
  return mutate(
    "remove",
    argv,
    io,
    (c, view, scans) => {
      const path = c.positionals[1] as string;
      const chosen = [
        c.values.fold === true,
        c.values.focus === true,
        c.values.rule !== undefined,
      ].filter(Boolean).length;

      if (chosen > 1) {
        throw new InputError(["use at most one of --fold, --focus and --rule"]);
      }

      if (c.values.within !== undefined && c.values.rule === undefined) {
        throw new InputError(["--within needs --rule"]);
      }

      if (c.values.fold === true || c.values.focus === true) {
        const kind = c.values.fold === true ? "fold" : "focus";
        const folder = folderPath(path);
        const kept = view.steps.filter(
          (s) => !(s.kind === kind && s.folder === folder),
        );

        if (kept.length === view.steps.length) {
          throw new InputError([`no ${kind} step for ${folder}`]);
        }

        view.steps = kept;

        return { view, what: `removed ${kind} ${folder}` };
      }

      if (c.values.rule !== undefined) {
        const relation = c.values.rule as string;

        if (!RELATIONS.includes(relation)) {
          throw new InputError([
            `--rule takes ${RELATIONS.join(", ")}, not ${relation}`,
          ]);
        }

        const of = relation === "folder" ? folderPath(path) : path;
        const within =
          c.values.within === undefined
            ? undefined
            : folderPath(c.values.within as string);
        const kept = view.steps.filter(
          (s) =>
            !(
              s.kind === "rule" &&
              s.relation === relation &&
              s.of === of &&
              (s.relation === "folder" ? undefined : s.within) === within
            ),
        );

        if (kept.length === view.steps.length) {
          throw new InputError([`no ${relation} rule for ${of}`]);
        }

        view.steps = kept;

        return { view, what: `removed rule ${relation} ${of}` };
      }

      if (!resolveView(view, scans).modules.includes(path)) {
        throw new InputError([`${path} is not on the view`]);
      }

      view.steps = view.steps.filter(
        (s) => !(s.kind === "pick" && s.module === path),
      );

      if (resolveView(view, scans).modules.includes(path)) {
        view.steps.push({ kind: "left-out", module: path });
      }

      return { view, what: `took ${path} off` };
    },
    (count) => count === 2,
  );
}

function runNote(argv: string[], io: Io): number {
  const probe = context("note", argv, io);
  const removing = probe.values.remove === true;
  const after = probe.values.after;
  const first = probe.values.first === true;

  if (
    (after !== undefined && first) ||
    (removing && (after !== undefined || first))
  ) {
    throw new InputError([
      "--after, --first and --remove cannot be combined",
      `usage: ${USAGE.note}`,
    ]);
  }

  return mutate(
    "note",
    argv,
    io,
    (c, view, scans) => {
      const path = c.positionals[1] as string;
      const notes = viewNotes(view);
      const rawBy = c.values.by as string | undefined;

      if (removing) {
        const author = rawBy?.trim();
        const existing = notes.find((note) => note.module === path);

        if (existing === undefined) {
          throw new InputError([`no note on ${path}`]);
        }

        if (author !== undefined && existing.by !== author) {
          throw new InputError([
            `the note on ${path} is by ${existing.by}, not ${author}`,
          ]);
        }

        return {
          view: withNotes(
            view,
            notes.filter((note) => note.module !== path),
          ),
          what: `removed the note on ${path}`,
        };
      }

      const modules = resolveView(view, scans).modules;

      if (path.endsWith("/")) {
        if (!modules.some((module) => under(module, folderPath(path)))) {
          throw new InputError([`${path} has no module on the view`]);
        }
      } else if (!modules.includes(path)) {
        throw new InputError([`${path} is not on the view`]);
      }

      const text = (c.positionals[2] as string).trim();
      const by = (rawBy ?? "agent").trim();

      if (text === "") {
        throw new InputError(["the note text must not be blank"]);
      }

      if (by === "" || by.length > 64) {
        throw new InputError([
          "--by must not be blank and is at most 64 characters",
        ]);
      }

      const entry = { module: path, text, by };
      const next =
        typeof after === "string"
          ? placeNote(notes, entry, { after })
          : first
            ? placeNote(notes, entry, "first")
            : appendNote(notes, entry);

      return {
        view: withNotes(view, next),
        what: `set the note on ${path}`,
      };
    },
    (count) => (removing ? count === 2 : count === 3),
  );
}

function runReorder(argv: string[], io: Io): number {
  return mutate(
    "reorder",
    argv,
    io,
    (c, view) => {
      const notes = viewNotes(view);

      if (notes.length === 0) {
        throw new InputError(["no notes to reorder"]);
      }

      return {
        view: withNotes(view, reorderNotes(notes, c.positionals.slice(1))),
        what: "reordered the notes",
      };
    },
    (count) => count >= 2,
  );
}

function runSet(argv: string[], io: Io): number {
  const probe = context("set", argv, io);
  const changeFlag = probe.values.change;

  if (changeFlag === undefined) {
    throw usageError("set");
  }

  const change =
    typeof changeFlag === "string" && changeFlag !== "none"
      ? parseChangeFlag(io, probe.root, changeFlag)
      : undefined;

  return mutate(
    "set",
    argv,
    io,
    (_c, view) => {
      const migrated = migrateView(view);

      if (change === undefined) {
        delete migrated.change;
      } else {
        migrated.change = change;
      }

      return {
        view: migrated,
        what:
          change === undefined
            ? "removed the range"
            : `set the range to ${rangeText(change)}`,
      };
    },
    (count) => count === 1,
  );
}

function withNotes(view: View, notes: ViewNote[]): View {
  const migrated = migrateView(view);

  if (notes.length === 0) {
    delete migrated.notes;
  } else {
    migrated.notes = notes;
  }

  return migrated;
}

function resolvedJson(resolved: ResolvedView) {
  return {
    modules: resolved.modules,
    folded: resolved.folded,
    focus: resolved.focus,
  };
}

function staleOf(
  io: Io,
  root: string,
  view: View,
  scans: Scan[],
): StaleReason[] {
  const facts: ChangeFacts | null =
    view.change === undefined ? null : changeFacts(io, root, view.change);

  return staleReasons(view, resolveView(view, scans).unresolved, facts);
}

function runDiff(argv: string[], io: Io): number {
  const c = context("diff", argv, io);

  if (c.positionals.length !== 1) {
    throw usageError("diff");
  }

  const name = checkName(c.positionals[0]);
  const view = readView(io, c.root, name);

  if (view.change === undefined) {
    throw new Refusal([`view ${name} is not a change view`]);
  }

  const facts = changeFacts(io, c.root, view.change);

  if (facts.headCommit === null) {
    throw new Refusal([`head ${view.change.head} is not in the repository`]);
  }

  if (facts.baseCommit === null) {
    throw new Refusal([`base ${view.change.base} is not in the repository`]);
  }

  const stdout = diffNameStatus(io, c.root, view.change);

  if (stdout === null) {
    throw new Refusal(["git could not diff the range"]);
  }

  const scans = freshScans(io, c.root).scans as RecordedScan[];
  const parsed = parseNameStatus(stdout);
  const base =
    scans.length > 0 && scans.every((scan) => scan.commit === facts.baseCommit)
      ? scans
      : null;
  const { modules, unmatched } = changeMarks(parsed.changes, scans, base);
  const range = rangeText(view.change);

  emit(
    c,
    {
      view: name,
      range,
      baseCommit: facts.baseCommit,
      headCommit: facts.headCommit,
      modules,
      unmatched,
    },
    [
      `${name}: ${range} (${facts.baseCommit.slice(0, 7)}..${facts.headCommit.slice(0, 7)})`,
      modules.length === 0
        ? "no changed modules"
        : `${plural(modules.length, "changed module")}:`,
      ...modules.map(
        (entry) =>
          `  ${entry.mark} ${entry.id}${entry.box === "none" ? " (no box)" : ""}`,
      ),
      ...(unmatched > 0
        ? [`${plural(unmatched, "changed file")} matched no module`]
        : []),
    ].join("\n"),
  );

  return 0;
}

function runShow(argv: string[], io: Io): number {
  const c = context("show", argv, io);

  if (c.positionals.length !== 1) {
    throw usageError("show");
  }

  const name = checkName(c.positionals[0]);
  const view = readView(io, c.root, name);
  const { scans } = freshScans(io, c.root);
  const resolved = resolveView(view, scans);

  if (c.json) {
    emit(
      c,
      {
        name,
        description: view.description,
        commit: view.commit,
        ...(view.change === undefined ? {} : { change: view.change }),
        steps: view.steps,
        notes: viewNotes(view).map((note, index) => ({
          ...note,
          number: index + 1,
        })),
        resolved: resolvedJson(resolved),
        unresolved: resolved.unresolved,
        warnings: noteWarnings(view),
      },
      "",
    );

    return 0;
  }

  const lines = [
    `${name}: ${view.description}`,
    `saved at ${view.commit ?? "none"}`,
    ...(view.change === undefined ? [] : [`change: ${rangeText(view.change)}`]),
    view.steps.length === 0 ? "no steps" : "steps:",
    ...view.steps.map((step, index) => `  ${index + 1}. ${describeStep(step)}`),
    `resolves to ${plural(resolved.modules.length, "module")}`,
    ...resolved.modules.map((module) => `  ${module}`),
  ];

  const onView = new Set(resolved.modules);
  const notedOnView = (path: string) =>
    path.endsWith("/")
      ? resolved.modules.some((module) => under(module, folderPath(path)))
      : onView.has(path);
  const notes = viewNotes(view);

  if (notes.length > 0) {
    lines.push(
      "notes:",
      ...notes.map(
        (note, index) =>
          `  ${index + 1}. ${note.module}: ${note.text} (${note.by})${notedOnView(note.module) ? "" : " (not on the view)"}`,
      ),
    );
  }

  lines.push(...noteWarnings(view).map((warning) => `warning: ${warning}`));

  if (resolved.unresolved.length > 0) {
    lines.push(
      "unresolved:",
      ...resolved.unresolved.map(
        (u) => `  step ${u.step} ${u.kind} ${u.path} - no such ${u.what}`,
      ),
    );
  }

  if (resolved.folded.length > 0) {
    lines.push(`folded: ${resolved.folded.join(", ")}`);
  }

  if (resolved.focus !== null) {
    lines.push(`focus: ${resolved.focus}`);
  }

  io.stdout(`${lines.join("\n")}\n`);

  return 0;
}

function runList(argv: string[], io: Io): number {
  const c = context("list", argv, io);

  if (c.positionals.length !== 0) {
    throw usageError("list");
  }

  const listed = viewNames(io, c.root);
  const scans = listed.length === 0 ? [] : freshScans(io, c.root).scans;
  const rows = listed.map((name) => {
    try {
      const view = parseView(io, viewFile(c.root, name), name);

      return {
        name,
        description: view.description,
        commit: view.commit,
        steps: view.steps.length,
        ...(view.change === undefined ? {} : { change: view.change }),
        stale: staleOf(io, c.root, view, scans),
      };
    } catch (error) {
      return { name, error: (error as InputError).messages.join("; ") };
    }
  });

  emit(
    c,
    { views: rows },
    rows
      .map((row) =>
        "error" in row
          ? `${row.name}  invalid: ${row.error}`
          : [
              `${row.name}  ${row.change === undefined ? "" : `${rangeText(row.change)}  `}${plural(row.steps, "step")}  ${row.commit ?? "none"}  ${row.description}`,
              ...row.stale.map(
                (reason) => `  stale: ${staleReasonText(reason)}`,
              ),
            ].join("\n"),
      )
      .join("\n"),
  );

  return 0;
}

interface CheckedStep {
  step: number;
  kind: ViewStep["kind"];
  path: string;
  what: "module" | "folder";
  renamedTo: string | null;
}

interface CheckedView {
  name: string;
  ok: boolean;
  error?: string;
  unresolved: CheckedStep[];
  fixed: { step: number; from: string; to: string }[];
  warnings: string[];
  stale: StaleReason[];
}

function parseRenames(stdout: string): Map<string, string> {
  const tokens = stdout.split("\0").filter((token) => token !== "");
  const renames = new Map<string, string>();

  for (let index = 0; index + 2 < tokens.length; index += 3) {
    if ((tokens[index] as string).startsWith("R")) {
      renames.set(tokens[index + 1] as string, tokens[index + 2] as string);
    }
  }

  return renames;
}

function runCheck(argv: string[], io: Io): number {
  const c = context("check", argv, io);

  if (c.positionals.length > 1) {
    throw usageError("check");
  }

  const existing = viewNames(io, c.root);
  const requested = c.positionals[0];
  const names = requested === undefined ? existing : [checkName(requested)];

  if (requested !== undefined && !existing.includes(requested)) {
    throw new InputError([`no such view: ${requested}`]);
  }

  const fix = c.values.fix === true;
  const results: CheckedView[] = [];

  if (names.length > 0) {
    const { scans } = freshScans(io, c.root);
    const known = new Set(moduleNames(scans));
    const renameCache = new Map<string, Map<string, string>>();
    const renamesSince = (commit: string): Map<string, string> => {
      const cached = renameCache.get(commit);

      if (cached !== undefined) {
        return cached;
      }

      const result = io.run("git", [
        "-C",
        c.root,
        "diff",
        "-M",
        "--relative",
        "--name-status",
        "--diff-filter=R",
        "-z",
        commit,
      ]);
      const renames =
        result.started && result.status === 0
          ? parseRenames(result.stdout)
          : new Map<string, string>();

      renameCache.set(commit, renames);

      return renames;
    };

    for (const name of names) {
      let view: View;

      try {
        view = parseView(io, viewFile(c.root, name), name);
      } catch (error) {
        results.push({
          name,
          ok: false,
          error: (error as InputError).messages.join("; "),
          unresolved: [],
          fixed: [],
          warnings: [],
          stale: [],
        });

        continue;
      }

      const warnings = noteWarnings(view);

      const annotate = (current: View): CheckedStep[] =>
        resolveView(current, scans).unresolved.map((u) => {
          const renamed =
            u.kind === "pick" && current.commit !== null
              ? renamesSince(current.commit).get(u.path)
              : undefined;

          return {
            ...u,
            renamedTo:
              renamed !== undefined && known.has(renamed) ? renamed : null,
          };
        });

      let unresolved = annotate(view);
      const fixed: CheckedView["fixed"] = [];

      if (fix && unresolved.some((u) => u.renamedTo !== null)) {
        const renames = new Map(
          unresolved
            .filter((u) => u.renamedTo !== null)
            .map((u) => [u.step, u.renamedTo as string]),
        );
        const steps: ViewStep[] = [];
        const picked = new Set(
          view.steps.flatMap((s) => (s.kind === "pick" ? [s.module] : [])),
        );

        view.steps.forEach((step, index) => {
          const to = renames.get(index + 1);

          if (step.kind !== "pick" || to === undefined) {
            steps.push(step);

            return;
          }

          fixed.push({ step: index + 1, from: step.module, to });

          if (!picked.has(to)) {
            picked.add(to);
            steps.push({ kind: "pick", module: to });
          }
        });

        const renamed = new Map(fixed.map(({ from, to }) => [from, to]));

        view = {
          ...migrateView(view),
          steps,
        };

        if (view.notes !== undefined) {
          view.notes = lastNotePerPath(
            view.notes.map((note) => ({
              ...note,
              module: renamed.get(note.module) ?? note.module,
            })),
          );
        }

        writeViewFile(io, viewFile(c.root, name), view);
        unresolved = annotate(view);
      }

      results.push({
        name,
        ok: unresolved.length === 0,
        unresolved,
        fixed,
        warnings,
        stale: staleOf(io, c.root, view, scans),
      });
    }
  }

  const ok = results.every((result) => result.ok);

  if (c.json) {
    io.stdout(`${JSON.stringify({ ok, views: results }, null, 2)}\n`);

    return ok ? 0 : 1;
  }

  const lines: string[] = [];

  for (const result of results) {
    if (result.error !== undefined) {
      lines.push(`${result.name}: invalid - ${result.error}`);

      continue;
    }

    lines.push(
      result.unresolved.length === 0
        ? `${result.name}: ok`
        : `${result.name}: ${result.unresolved.length} unresolved`,
    );

    for (const fixedStep of result.fixed) {
      lines.push(
        `  fixed step ${fixedStep.step} ${fixedStep.from} -> ${fixedStep.to}`,
      );
    }

    for (const u of result.unresolved) {
      lines.push(
        `  step ${u.step} ${u.kind} ${u.path} - no such ${u.what}${u.renamedTo === null ? "" : ` (renamed to ${u.renamedTo})`}`,
      );
    }

    for (const warning of result.warnings) {
      lines.push(`  warning: ${warning}`);
    }

    for (const reason of result.stale.filter(
      (entry) => entry.kind !== "pick-unresolved",
    )) {
      lines.push(`  stale: ${staleReasonText(reason)}`);
    }
  }

  if (lines.length > 0) {
    io.stdout(`${lines.join("\n")}\n`);
  }

  return ok ? 0 : 1;
}

function runRm(argv: string[], io: Io): number {
  const c = context("rm", argv, io);

  if (c.positionals.length !== 1) {
    throw usageError("rm");
  }

  const name = checkName(c.positionals[0]);

  const file = viewFile(c.root, name);

  if (!io.exists(file)) {
    throw new InputError([`no such view: ${name}`]);
  }

  io.remove(file);
  emit(c, { view: name, removed: true }, `${name}: removed`);

  return 0;
}

const HANDLERS: Record<Subcommand, (argv: string[], io: Io) => number> = {
  new: runNew,
  add: runAdd,
  rule: runRule,
  fold: runFold,
  focus: runFocus,
  remove: runRemove,
  note: runNote,
  reorder: runReorder,
  set: runSet,
  show: runShow,
  diff: runDiff,
  list: runList,
  check: runCheck,
  rm: runRm,
};

export function runViews(argv: string[], io: Io): number {
  const [subcommand, ...rest] = argv;
  const known = VIEW_SUBCOMMANDS.find((entry) => entry === subcommand);

  if (known === undefined) {
    throw new InputError(
      VIEW_SUBCOMMANDS.map((entry) => `usage: ${USAGE[entry]}`),
    );
  }

  try {
    return HANDLERS[known](rest, io);
  } catch (error) {
    if (error instanceof Refusal) {
      io.stderr(`${error.messages.join("\n")}\n`);

      return 1;
    }

    throw error;
  }
}
