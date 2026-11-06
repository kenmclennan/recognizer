import { InputError } from "./errors.js";
import validate from "./generated/view-validator.js";
import { moduleNames, under, usedByOf, usesOf } from "./neighbours.js";
import type { Scan } from "./scan.js";

export type ViewStep =
  | { kind: "pick"; module: string }
  | { kind: "rule"; relation: "folder"; of: string }
  | { kind: "rule"; relation: "uses" | "used-by"; of: string; within?: string }
  | { kind: "fold"; folder: string }
  | { kind: "focus"; folder: string }
  | { kind: "left-out"; module: string };

export interface Note {
  text: string;
  by: string;
}

export interface ViewNote {
  module: string;
  text: string;
  by: string;
}

export interface ViewChange {
  base: string;
  head: string;
}

export type ProposedKind =
  | "new"
  | "changes"
  | "moves"
  | "moves-and-changes"
  | "removed";

export const PROPOSED_KINDS: ProposedKind[] = [
  "new",
  "changes",
  "moves",
  "moves-and-changes",
  "removed",
];

export interface ViewProposedChange {
  module: string;
  kind: ProposedKind;
  from?: string;
}

export interface Ghost {
  from: string;
  to: string;
}

export function movesKind(kind: ProposedKind): boolean {
  return kind === "moves" || kind === "moves-and-changes";
}

export interface View {
  schema_version: 1 | 2 | 3 | 4;
  change?: ViewChange;
  plan?: true;
  proposed?: ViewProposedChange[];
  title?: string;
  description: string;
  commit: string | null;
  note?: Note;
  module_notes?: Record<string, Note>;
  notes?: ViewNote[];
  steps: ViewStep[];
}

export interface ResolvedView {
  modules: string[];
  planned: string[];
  ghosts: Ghost[];
  folded: string[];
  focus: string | null;
  unresolved: {
    step: number;
    kind: ViewStep["kind"];
    path: string;
    what: "module" | "folder";
  }[];
}

export function validateView(value: unknown): View {
  if (validate(value)) {
    return value as unknown as View;
  }

  const messages = (validate.errors ?? []).map(
    (error) => `view${error.instancePath} ${error.message ?? "is invalid"}`,
  );

  throw new InputError(messages.length > 0 ? messages : ["view is invalid"]);
}

function rawNotes(view: View): ViewNote[] {
  if (view.schema_version >= 3) {
    return (view.notes ?? []).map((note) => ({ ...note }));
  }

  if (view.schema_version === 2) {
    return Object.entries(view.module_notes ?? {})
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([module, note]) => ({ module, text: note.text, by: note.by }));
  }

  return [];
}

export function lastNotePerPath(notes: ViewNote[]): ViewNote[] {
  const lastIndex = new Map<string, number>();

  notes.forEach((note, index) => {
    lastIndex.set(note.module, index);
  });

  return notes.filter((note, index) => lastIndex.get(note.module) === index);
}

export function viewNotes(view: View): ViewNote[] {
  return lastNotePerPath(rawNotes(view));
}

export function noteWarnings(view: View): string[] {
  const all = rawNotes(view);
  const dropped = all.length - lastNotePerPath(all).length;

  if (dropped === 0) {
    return [];
  }

  const counts = new Map<string, number>();

  for (const note of all) {
    counts.set(note.module, (counts.get(note.module) ?? 0) + 1);
  }

  const repeated = [...counts]
    .filter(([, count]) => count > 1)
    .map(([path]) => path);

  return [
    `view holds ${dropped} ${dropped === 1 ? "note" : "notes"} on ${repeated.join(", ")}; kept the last on each`,
  ];
}

export function orderedProposed(
  proposed: ViewProposedChange,
): ViewProposedChange {
  return {
    module: proposed.module,
    kind: proposed.kind,
    ...(proposed.from === undefined ? {} : { from: proposed.from }),
  };
}

export function lastProposedPerModule(
  proposed: ViewProposedChange[],
): ViewProposedChange[] {
  const lastIndex = new Map<string, number>();

  proposed.forEach((entry, index) => {
    lastIndex.set(entry.module, index);
  });

  return proposed.filter(
    (entry, index) => lastIndex.get(entry.module) === index,
  );
}

export function viewProposed(view: View): ViewProposedChange[] {
  return lastProposedPerModule(view.proposed ?? []).map(orderedProposed);
}

export function proposedWarnings(view: View, resolved: ResolvedView): string[] {
  const all = view.proposed ?? [];
  const warnings: string[] = [];
  const dropped = all.length - lastProposedPerModule(all).length;

  if (dropped > 0) {
    const counts = new Map<string, number>();

    for (const entry of all) {
      counts.set(entry.module, (counts.get(entry.module) ?? 0) + 1);
    }

    const repeated = [...counts]
      .filter(([, count]) => count > 1)
      .map(([path]) => path);

    warnings.push(
      `view holds ${dropped} ${dropped === 1 ? "proposed change" : "proposed changes"} on ${repeated.join(", ")}; kept the last on each`,
    );
  }

  const present = new Set([...resolved.modules, ...resolved.planned]);

  for (const entry of viewProposed(view)) {
    if (!present.has(entry.module)) {
      warnings.push(
        `proposed change on ${entry.module} is not drawn: the module is not on the view`,
      );
    }
  }

  return warnings;
}

export function isValidRef(ref: string): boolean {
  return /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_./@+-]*$/.test(ref);
}

export function parseRange(text: string): ViewChange | null {
  const at = text.indexOf("..");

  if (at < 0) {
    return null;
  }

  const base = text.slice(0, at);
  const head = text.slice(at + 2);

  return isValidRef(base) && isValidRef(head) ? { base, head } : null;
}

export function rangeText(change: ViewChange): string {
  return `${change.base}..${change.head}`;
}

export function migrateView(view: View): View {
  const notes = viewNotes(view);

  return {
    schema_version: 4,
    ...(view.title === undefined ? {} : { title: view.title }),
    description: view.description,
    commit: view.commit,
    ...(view.change === undefined
      ? {}
      : { change: { base: view.change.base, head: view.change.head } }),
    ...(view.plan === true ? { plan: true as const } : {}),
    ...(notes.length === 0 ? {} : { notes }),
    ...(view.plan === true && view.proposed !== undefined
      ? { proposed: viewProposed(view) }
      : {}),
    steps: view.steps,
  };
}

export function serialiseView(view: View): string {
  const migrated = migrateView(view);

  return `${JSON.stringify(
    {
      schema_version: 4,
      ...(migrated.title === undefined ? {} : { title: migrated.title }),
      description: migrated.description,
      commit: migrated.commit,
      ...(migrated.change === undefined ? {} : { change: migrated.change }),
      ...(migrated.plan === true ? { plan: true } : {}),
      ...(migrated.notes === undefined
        ? {}
        : { notes: migrated.notes.map(orderedNote) }),
      ...(migrated.proposed === undefined
        ? {}
        : { proposed: migrated.proposed.map(orderedProposed) }),
      steps: migrated.steps.map(orderedStep),
    },
    null,
    2,
  )}\n`;
}

export function orderedNote(note: ViewNote): ViewNote {
  return { module: note.module, text: note.text, by: note.by };
}

export function orderedStep(step: ViewStep): ViewStep {
  switch (step.kind) {
    case "pick":
    case "left-out":
      return { kind: step.kind, module: step.module };
    case "fold":
    case "focus":
      return { kind: step.kind, folder: step.folder };
    case "rule":
      return step.relation === "folder"
        ? { kind: "rule", relation: "folder", of: step.of }
        : {
            kind: "rule",
            relation: step.relation,
            of: step.of,
            ...(step.within === undefined ? {} : { within: step.within }),
          };
  }
}

export function resolveView(view: View, scans: Scan[]): ResolvedView {
  const modules = moduleNames(scans);
  const known = new Set(modules);
  const hasFolder = (folder: string) =>
    modules.some((module) => under(module, folder));
  const picked = new Set<string>();
  const ruled = new Set<string>();
  const leftOut = new Set<string>();
  const folded: string[] = [];
  const unresolved: ResolvedView["unresolved"] = [];
  let focus: string | null = null;

  view.steps.forEach((step, index) => {
    const missing = (path: string, what: "module" | "folder") => {
      unresolved.push({ step: index + 1, kind: step.kind, path, what });
    };

    switch (step.kind) {
      case "pick":
        if (known.has(step.module)) {
          picked.add(step.module);
        } else {
          missing(step.module, "module");
        }

        break;
      case "left-out":
        leftOut.add(step.module);

        break;
      case "fold":
      case "focus":
        if (!hasFolder(step.folder)) {
          missing(step.folder, "folder");
        } else if (step.kind === "fold") {
          folded.push(step.folder);
        } else {
          focus = step.folder;
        }

        break;
      case "rule": {
        const anchorIsFolder = step.relation === "folder";
        const anchorExists = anchorIsFolder
          ? hasFolder(step.of)
          : known.has(step.of);
        const withinMissing =
          step.relation !== "folder" &&
          step.within !== undefined &&
          !hasFolder(step.within);

        if (!anchorExists) {
          missing(step.of, anchorIsFolder ? "folder" : "module");
        }

        if (withinMissing) {
          missing(step.within as string, "folder");
        }

        if (!anchorExists || withinMissing) {
          break;
        }

        if (step.relation === "folder") {
          for (const module of modules) {
            if (under(module, step.of)) {
              ruled.add(module);
            }
          }
        } else {
          const rows =
            step.relation === "uses"
              ? usesOf(scans, modules, step.of)
              : usedByOf(scans, modules, step.of);

          for (const row of rows) {
            if (
              row.id !== step.of &&
              (step.within === undefined || under(row.id, step.within))
            ) {
              ruled.add(row.id);
            }
          }
        }

        break;
      }
    }
  });

  for (const module of leftOut) {
    ruled.delete(module);
  }

  const onView = [...new Set([...picked, ...ruled])].sort((a, b) =>
    a.localeCompare(b),
  );
  const onViewSet = new Set(onView);
  const planned: string[] = [];
  const ghosts: Ghost[] = [];

  if (view.plan === true) {
    for (const entry of viewProposed(view)) {
      const isPlanned =
        !known.has(entry.module) &&
        !leftOut.has(entry.module) &&
        (entry.kind === "new" || movesKind(entry.kind));

      if (isPlanned) {
        planned.push(entry.module);
      }

      if (
        movesKind(entry.kind) &&
        entry.from !== undefined &&
        (isPlanned || onViewSet.has(entry.module))
      ) {
        ghosts.push({ from: entry.from, to: entry.module });
      }
    }

    planned.sort((a, b) => a.localeCompare(b));
  }

  return {
    modules: onView,
    planned,
    ghosts,
    folded,
    focus,
    unresolved,
  };
}
