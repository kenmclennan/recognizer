import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type CheckedView,
  Neighbours,
  type ResolvedView,
  staleReasonText,
  View,
  type ViewMutation,
  ViewRange,
  type ViewStep,
} from "@recognizer/core";
import type { Io } from "./cli.js";
import { InputError, Refusal } from "./errors.js";
import { visualisationFor } from "./visualisation-container.js";

export const VIEW_SUBCOMMANDS = [
  "new",
  "add",
  "rule",
  "fold",
  "focus",
  "remove",
  "change",
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
  title: { type: "string" },
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
  plan: { type: "boolean" },
  "no-plan": { type: "boolean" },
  from: { type: "string" },
  clear: { type: "boolean" },
} as const;

export const VIEW_FLAGS = Object.keys(OPTIONS).map((name) => `--${name}`);

const ALLOWED: Record<Subcommand, string[]> = {
  new: ["description", "from-window", "change", "plan"],
  add: ["change", "from"],
  rule: ["folder", "uses", "used-by", "within"],
  fold: [],
  focus: [],
  remove: ["fold", "focus", "rule", "within"],
  change: ["from", "clear"],
  note: ["by", "remove", "after", "first"],
  reorder: [],
  set: ["change", "title", "description", "plan", "no-plan"],
  show: [],
  diff: [],
  list: [],
  check: ["fix"],
  rm: [],
};

const USAGE: Record<Subcommand, string> = {
  new: "recognizer views new <name> --description <text> [--change <base>..<head> | --plan] [--from-window <id>] [--repository <dir>] [--json]",
  add: "recognizer views add <name> <module>[#<member>]... [--change new|changes|moves|moves-and-changes|removed [--from <path>]] [--repository <dir>] [--json]",
  rule: "recognizer views rule <name> (--folder <folder> | --uses <module> | --used-by <module>) [--within <folder>] [--repository <dir>] [--json]",
  fold: "recognizer views fold <name> <folder> [--repository <dir>] [--json]",
  focus: "recognizer views focus <name> <folder> [--repository <dir>] [--json]",
  remove:
    "recognizer views remove <name> <path-or-module#member> [--fold | --focus | --rule folder|uses|used-by [--within <folder>]] [--repository <dir>] [--json]",
  change:
    "recognizer views change <name> <module>[#<member>] (new|changes|moves|moves-and-changes|removed [--from <path>] | --clear) [--repository <dir>] [--json]",
  note: "recognizer views note <name> <module-or-folder> (<text> [--by <name>] [--after <module-or-folder> | --first] | --remove [--by <name>]) [--repository <dir>] [--json]",
  reorder:
    "recognizer views reorder <name> <module-or-folder>... [--repository <dir>] [--json]",
  set: "recognizer views set <name> [--change <base>..<head>|none] [--plan | --no-plan] [--title <text>] [--description <text>] [--repository <dir>] [--json]",
  show: "recognizer views show <name> [--repository <dir>] [--json]",
  diff: "recognizer views diff <name> [--repository <dir>] [--json]",
  list: "recognizer views list [--repository <dir>] [--json]",
  check:
    "recognizer views check [<name>] [--fix] [--repository <dir>] [--json]",
  rm: "recognizer views rm <name> [--repository <dir>] [--json]",
};

interface Context {
  io: Io;
  root: string;
  json: boolean;
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
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

function text(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finishMutation(c: Context, result: ViewMutation): number {
  emit(
    c,
    {
      view: result.view,
      changed: result.changed,
      steps: result.steps,
      modules: result.modules,
    },
    `${result.view}: ${result.changed ? result.what : "no change"}; ${plural(result.steps, "step")}, resolves to ${plural(result.modules, "file")}`,
  );

  return 0;
}

function mutation(
  subcommand: Subcommand,
  argv: string[],
  io: Io,
  arity: (positionals: number) => boolean,
  run: (c: Context, core: ReturnType<typeof visualisationFor>) => ViewMutation,
): number {
  const c = context(subcommand, argv, io);

  if (!arity(c.positionals.length)) {
    throw usageError(subcommand);
  }

  return finishMutation(c, run(c, visualisationFor(io, c.root)));
}

function runNew(argv: string[], io: Io): number {
  const c = context("new", argv, io);

  if (c.positionals.length !== 1) {
    throw usageError("new");
  }

  return finishMutation(
    c,
    visualisationFor(io, c.root).createView({
      root: c.root,
      name: c.positionals[0],
      description: text(c.values.description),
      change: text(c.values.change),
      plan: c.values.plan === true,
      fromWindow: text(c.values["from-window"]),
    }),
  );
}

function runAdd(argv: string[], io: Io): number {
  return mutation(
    "add",
    argv,
    io,
    (count) => count >= 2,
    (c, core) =>
      core.addToView({
        root: c.root,
        name: c.positionals[0],
        paths: c.positionals.slice(1),
        change: text(c.values.change),
        from: text(c.values.from),
      }),
  );
}

function runChange(argv: string[], io: Io): number {
  return mutation(
    "change",
    argv,
    io,
    (count) => count === 2 || count === 3,
    (c, core) =>
      core.changeView({
        root: c.root,
        name: c.positionals[0],
        target: c.positionals[1] as string,
        kind: c.positionals[2],
        clear: c.values.clear === true,
        from: text(c.values.from),
        usage: USAGE.change,
      }),
  );
}

function runRule(argv: string[], io: Io): number {
  return mutation(
    "rule",
    argv,
    io,
    (count) => count === 1,
    (c, core) =>
      core.ruleView({
        root: c.root,
        name: c.positionals[0],
        folder: text(c.values.folder),
        uses: text(c.values.uses),
        usedBy: text(c.values["used-by"]),
        within: text(c.values.within),
        usage: USAGE.rule,
      }),
  );
}

function runFold(argv: string[], io: Io): number {
  return mutation(
    "fold",
    argv,
    io,
    (count) => count === 2,
    (c, core) =>
      core.foldView({
        root: c.root,
        name: c.positionals[0],
        folder: c.positionals[1] as string,
      }),
  );
}

function runFocus(argv: string[], io: Io): number {
  return mutation(
    "focus",
    argv,
    io,
    (count) => count === 2,
    (c, core) =>
      core.focusView({
        root: c.root,
        name: c.positionals[0],
        folder: c.positionals[1] as string,
      }),
  );
}

function runRemove(argv: string[], io: Io): number {
  return mutation(
    "remove",
    argv,
    io,
    (count) => count === 2,
    (c, core) =>
      core.removeFromView({
        root: c.root,
        name: c.positionals[0],
        path: c.positionals[1] as string,
        fold: c.values.fold === true,
        focus: c.values.focus === true,
        rule: text(c.values.rule),
        within: text(c.values.within),
      }),
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

  return mutation(
    "note",
    argv,
    io,
    (count) => (removing ? count === 2 : count === 3),
    (c, core) =>
      core.noteView({
        root: c.root,
        name: c.positionals[0],
        path: c.positionals[1] as string,
        text: c.positionals[2],
        by: text(c.values.by),
        remove: removing,
        after: text(after),
        first,
      }),
  );
}

function runReorder(argv: string[], io: Io): number {
  return mutation(
    "reorder",
    argv,
    io,
    (count) => count >= 2,
    (c, core) =>
      core.reorderViewNotes({
        root: c.root,
        name: c.positionals[0],
        paths: c.positionals.slice(1),
      }),
  );
}

function runSet(argv: string[], io: Io): number {
  const probe = context("set", argv, io);

  if (
    probe.values.change === undefined &&
    probe.values.title === undefined &&
    probe.values.description === undefined &&
    probe.values.plan !== true &&
    probe.values["no-plan"] !== true
  ) {
    throw usageError("set");
  }

  return mutation(
    "set",
    argv,
    io,
    (count) => count === 1,
    (c, core) =>
      core.setView({
        root: c.root,
        name: c.positionals[0],
        change: text(c.values.change),
        title: text(c.values.title),
        description: text(c.values.description),
        plan: c.values.plan === true,
        noPlan: c.values["no-plan"] === true,
      }),
  );
}

function resolvedJson(resolved: ResolvedView, view: View) {
  return {
    modules: resolved.modules,
    ...(view.plan === true ? { planned: resolved.planned } : {}),
    folded: resolved.folded,
    focus: resolved.focus,
  };
}

function runDiff(argv: string[], io: Io): number {
  const c = context("diff", argv, io);

  if (c.positionals.length !== 1) {
    throw usageError("diff");
  }

  const diffed = visualisationFor(io, c.root).diffView({
    root: c.root,
    name: c.positionals[0],
  });
  const { modules, unmatched, range } = diffed;

  emit(
    c,
    {
      view: diffed.view,
      range,
      baseCommit: diffed.baseCommit,
      headCommit: diffed.headCommit,
      modules,
      unmatched,
    },
    [
      `${diffed.view}: ${range} (${diffed.baseCommit.slice(0, 7)}..${diffed.headCommit.slice(0, 7)})`,
      modules.length === 0
        ? "no changed files"
        : `${plural(modules.length, "changed file")}:`,
      ...modules.map(
        (entry) =>
          `  ${entry.mark} ${entry.id}${entry.box === "none" ? " (no box)" : ""}`,
      ),
      ...(unmatched > 0
        ? [`${plural(unmatched, "changed file")} matched no file`]
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

  const { name, view, resolved, warnings } = visualisationFor(
    io,
    c.root,
  ).showView({ root: c.root, name: c.positionals[0] });

  if (c.json) {
    emit(
      c,
      {
        name,
        ...(view.title === undefined ? {} : { title: view.title }),
        description: view.description,
        commit: view.commit,
        ...(view.change === undefined ? {} : { change: view.change }),
        ...(view.plan === true
          ? { plan: true, proposed: view.proposedList() }
          : {}),
        steps: view.steps,
        notes: view.noteList().map((note, index) => ({
          ...note,
          number: index + 1,
        })),
        resolved: resolvedJson(resolved, view),
        unresolved: resolved.unresolved,
        warnings,
      },
      "",
    );

    return 0;
  }

  const lines = [
    ...(view.title === undefined
      ? [`${name}: ${view.description}`]
      : [`${name}: ${view.title}`, view.description]),
    ...(view.plan === true ? ["plan"] : []),
    `saved at ${view.commit ?? "none"}`,
    ...(view.change === undefined
      ? []
      : [`change: ${ViewRange.text(view.change)}`]),
    view.steps.length === 0 ? "no steps" : "steps:",
    ...view.steps.map((step, index) => `  ${index + 1}. ${describeStep(step)}`),
    `resolves to ${plural(resolved.modules.length, "file")}`,
    ...resolved.modules.map((module) => `  ${module}`),
    ...view
      .moduleProposed()
      .map(
        (entry) =>
          `  ${entry.kind} ${entry.module}${entry.from === undefined ? "" : ` (from ${entry.from})`}${resolved.planned.includes(entry.module) ? " (planned)" : ""}`,
      ),
    ...view
      .memberProposed()
      .map(
        (entry) =>
          `  ${entry.kind} ${View.memberReference(entry.module, entry.member as string)}`,
      ),
  ];

  const onView = new Set([...resolved.modules, ...resolved.planned]);
  const notedOnView = (path: string) =>
    path.endsWith("/")
      ? [...onView].some((module) => Neighbours.under(module, folderPath(path)))
      : onView.has(path);
  const notes = view.noteList();

  if (notes.length > 0) {
    lines.push(
      "notes:",
      ...notes.map(
        (note, index) =>
          `  ${index + 1}. ${note.module}: ${note.text} (${note.by})${notedOnView(note.module) ? "" : " (not on the view)"}`,
      ),
    );
  }

  lines.push(...warnings.map((warning) => `warning: ${warning}`));

  if (resolved.unresolved.length > 0) {
    lines.push(
      "unresolved:",
      ...resolved.unresolved.map(
        (u) =>
          `  step ${u.step} ${u.kind} ${u.path} - no such ${u.what === "module" ? "file" : u.what}`,
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

  const rows = visualisationFor(io, c.root).listViews({ root: c.root });

  emit(
    c,
    { views: rows },
    rows
      .map((row) =>
        "error" in row
          ? `${row.name}  invalid: ${row.error}`
          : [
              `${row.name}  ${row.plan === true ? "plan  " : ""}${row.change === undefined ? "" : `${ViewRange.text(row.change)}  `}${plural(row.steps, "step")}  ${row.commit ?? "none"}  ${row.title !== undefined ? `${row.title} - ` : ""}${row.description}`,
              ...row.stale.map(
                (reason) => `  stale: ${staleReasonText(reason)}`,
              ),
            ].join("\n"),
      )
      .join("\n"),
  );

  return 0;
}

function checkLines(results: CheckedView[]): string[] {
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
        `  step ${u.step} ${u.kind} ${u.path} - no such ${u.what === "module" ? "file" : u.what}${u.renamedTo === null ? "" : ` (renamed to ${u.renamedTo})`}`,
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

  return lines;
}

function runCheck(argv: string[], io: Io): number {
  const c = context("check", argv, io);

  if (c.positionals.length > 1) {
    throw usageError("check");
  }

  const results = visualisationFor(io, c.root).checkViews({
    root: c.root,
    name: c.positionals[0],
    fix: c.values.fix === true,
  });
  const ok = results.every((result) => result.ok);

  if (c.json) {
    io.stdout(`${JSON.stringify({ ok, views: results }, null, 2)}\n`);

    return ok ? 0 : 1;
  }

  const lines = checkLines(results);

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

  const removed = visualisationFor(io, c.root).removeView({
    root: c.root,
    name: c.positionals[0],
  });

  emit(c, removed, `${removed.view}: removed`);

  return 0;
}

const HANDLERS: Record<Subcommand, (argv: string[], io: Io) => number> = {
  new: runNew,
  add: runAdd,
  rule: runRule,
  fold: runFold,
  focus: runFocus,
  remove: runRemove,
  change: runChange,
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
