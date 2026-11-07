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
  member?: string;
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

export type MemberProposedKind = "new" | "changes" | "removed";

export const MEMBER_PROPOSED_KINDS: MemberProposedKind[] = [
  "new",
  "changes",
  "removed",
];

export interface ResolvedMemberEntry {
  module: string;
  member: string;
  kind: MemberProposedKind;
  inScan: boolean;
}

export interface ResolvedMembers {
  byModule: Map<string, ResolvedMemberEntry[]>;
  warnings: string[];
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
    ...(proposed.member === undefined ? {} : { member: proposed.member }),
    kind: proposed.kind,
    ...(proposed.from === undefined ? {} : { from: proposed.from }),
  };
}

export function proposedKey(entry: {
  module: string;
  member?: string;
}): string {
  return entry.member === undefined
    ? entry.module
    : `${entry.module}#${entry.member}`;
}

export function memberReference(module: string, member: string): string {
  return `${module}#${member}`;
}

export function splitMemberReference(
  reference: string,
): { module: string; member: string } | null {
  const at = reference.lastIndexOf("#");

  if (at <= 0 || at === reference.length - 1) {
    return null;
  }

  return { module: reference.slice(0, at), member: reference.slice(at + 1) };
}

export function splitMember(member: string): {
  name: string;
  method: string | null;
} {
  const dot = member.indexOf(".");

  return dot < 0
    ? { name: member, method: null }
    : { name: member.slice(0, dot), method: member.slice(dot + 1) };
}

export function lastProposedPerModule(
  proposed: ViewProposedChange[],
): ViewProposedChange[] {
  const lastIndex = new Map<string, number>();

  proposed.forEach((entry, index) => {
    lastIndex.set(proposedKey(entry), index);
  });

  return proposed.filter(
    (entry, index) => lastIndex.get(proposedKey(entry)) === index,
  );
}

export function viewProposed(view: View): ViewProposedChange[] {
  return lastProposedPerModule(view.proposed ?? []).map(orderedProposed);
}

export function viewModuleProposed(view: View): ViewProposedChange[] {
  return viewProposed(view).filter((entry) => entry.member === undefined);
}

export function viewMemberProposed(view: View): ViewProposedChange[] {
  return viewProposed(view).filter((entry) => entry.member !== undefined);
}

export function scanHoldsMember(
  scans: Scan[],
  module: string,
  member: string,
): boolean {
  const { name, method } = splitMember(member);

  for (const scan of scans) {
    for (const entry of scan.modules) {
      if (entry.id !== module) {
        continue;
      }

      for (const held of entry.members ?? []) {
        if (held.name !== name) {
          continue;
        }

        if (
          method === null ||
          (held.methods ?? []).some((m) => m.name === method)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

export function resolveMembers(view: View, scans: Scan[]): ResolvedMembers {
  const byModule = new Map<string, ResolvedMemberEntry[]>();
  const warnings: string[] = [];

  if (view.plan !== true) {
    return { byModule, warnings };
  }

  const resolved = resolveView(view, scans);
  const onView = new Set(resolved.modules);
  const moduleEntries = new Map(
    viewModuleProposed(view).map((entry) => [entry.module, entry]),
  );

  for (const entry of viewMemberProposed(view)) {
    const member = entry.member as string;
    const reference = memberReference(entry.module, member);
    const wholly = moduleEntries.get(entry.module);

    if (resolved.planned.includes(entry.module)) {
      warnings.push(
        `proposed change on ${reference} is not drawn: ${entry.module} is planned`,
      );

      continue;
    }

    if (
      wholly !== undefined &&
      (wholly.kind === "new" || wholly.kind === "removed")
    ) {
      warnings.push(
        `proposed change on ${reference} is not drawn: ${entry.module} is wholly ${wholly.kind}`,
      );

      continue;
    }

    if (!onView.has(entry.module)) {
      warnings.push(
        `proposed change on ${reference} is not drawn: the module is not on the view`,
      );

      continue;
    }

    const inScan = scanHoldsMember(scans, entry.module, member);

    if (!inScan && entry.kind !== "new") {
      warnings.push(
        `proposed change on ${reference} is not drawn: the member is not in the scan`,
      );

      continue;
    }

    const list = byModule.get(entry.module) ?? [];

    list.push({
      module: entry.module,
      member,
      kind: entry.kind as MemberProposedKind,
      inScan,
    });
    byModule.set(entry.module, list);
  }

  return { byModule, warnings };
}

export function proposedWarnings(
  view: View,
  resolved: ResolvedView,
  scans?: Scan[],
): string[] {
  const all = view.proposed ?? [];
  const warnings: string[] = [];
  const dropped = all.length - lastProposedPerModule(all).length;

  if (dropped > 0) {
    const counts = new Map<string, number>();

    for (const entry of all) {
      const key = proposedKey(entry);

      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const repeated = [...counts]
      .filter(([, count]) => count > 1)
      .map(([path]) => path);

    warnings.push(
      `view holds ${dropped} ${dropped === 1 ? "proposed change" : "proposed changes"} on ${repeated.join(", ")}; kept the last on each`,
    );
  }

  const present = new Set([...resolved.modules, ...resolved.planned]);

  for (const entry of viewModuleProposed(view)) {
    if (!present.has(entry.module)) {
      warnings.push(
        `proposed change on ${entry.module} is not drawn: the module is not on the view`,
      );
    }
  }

  if (scans !== undefined) {
    warnings.push(...resolveMembers(view, scans).warnings);
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
    for (const entry of viewModuleProposed(view)) {
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
