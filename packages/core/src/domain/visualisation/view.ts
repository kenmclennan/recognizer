import { Neighbours } from "../neighbours.js";
import type { Repository } from "../repository.js";
import type { ChangeFacts, StaleReason } from "./stale-reason.js";
import { ViewNotes } from "./view-notes.js";

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
  name?: string;
}

export type ProposedKind =
  | "new"
  | "changes"
  | "moves"
  | "moves-and-changes"
  | "removed";

export type MemberProposedKind = "new" | "changes" | "removed";

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

export interface ViewFields {
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

export class View implements ViewFields {
  declare schema_version: 1 | 2 | 3 | 4;
  declare change?: ViewChange;
  declare plan?: true;
  declare proposed?: ViewProposedChange[];
  declare title?: string;
  declare description: string;
  declare commit: string | null;
  declare note?: Note;
  declare module_notes?: Record<string, Note>;
  declare notes?: ViewNote[];
  declare steps: ViewStep[];

  static readonly PROPOSED_KINDS: ProposedKind[] = [
    "new",
    "changes",
    "moves",
    "moves-and-changes",
    "removed",
  ];

  static readonly MEMBER_PROPOSED_KINDS: MemberProposedKind[] = [
    "new",
    "changes",
    "removed",
  ];

  private constructor(fields: ViewFields) {
    Object.assign(this, fields);
  }

  static of(fields: ViewFields): View {
    return new View(fields);
  }

  static movesKind(kind: ProposedKind): boolean {
    return kind === "moves" || kind === "moves-and-changes";
  }

  static memberReference(module: string, member: string): string {
    return `${module}#${member}`;
  }

  static splitMemberReference(
    reference: string,
  ): { module: string; member: string } | null {
    const at = reference.lastIndexOf("#");

    if (at <= 0 || at === reference.length - 1) {
      return null;
    }

    return { module: reference.slice(0, at), member: reference.slice(at + 1) };
  }

  static splitMember(member: string): { name: string; method: string | null } {
    const dot = member.indexOf(".");

    return dot < 0
      ? { name: member, method: null }
      : { name: member.slice(0, dot), method: member.slice(dot + 1) };
  }

  static proposedKey(entry: { module: string; member?: string }): string {
    return entry.member === undefined
      ? entry.module
      : `${entry.module}#${entry.member}`;
  }

  static orderedProposed(proposed: ViewProposedChange): ViewProposedChange {
    return {
      module: proposed.module,
      ...(proposed.member === undefined ? {} : { member: proposed.member }),
      kind: proposed.kind,
      ...(proposed.from === undefined ? {} : { from: proposed.from }),
    };
  }

  static orderedStep(step: ViewStep): ViewStep {
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

  static lastProposedPerModule(
    proposed: ViewProposedChange[],
  ): ViewProposedChange[] {
    const lastIndex = new Map<string, number>();

    proposed.forEach((entry, index) => {
      lastIndex.set(View.proposedKey(entry), index);
    });

    return proposed.filter(
      (entry, index) => lastIndex.get(View.proposedKey(entry)) === index,
    );
  }

  clone(): View {
    return new View(JSON.parse(JSON.stringify({ ...this })) as ViewFields);
  }

  with(changes: Partial<ViewFields>): View {
    const merged = { ...this, ...changes } as unknown as Record<
      string,
      unknown
    >;

    for (const key of Object.keys(merged)) {
      if (merged[key] === undefined) {
        delete merged[key];
      }
    }

    return new View(merged as unknown as ViewFields);
  }

  noteList(): ViewNote[] {
    return ViewNotes.lastPerPath(this.rawNotes());
  }

  noteWarnings(): string[] {
    const all = this.rawNotes();
    const dropped = all.length - ViewNotes.lastPerPath(all).length;

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

  proposedList(): ViewProposedChange[] {
    return this.proposedChanges();
  }

  moduleProposed(): ViewProposedChange[] {
    return this.proposedChanges().filter((entry) => entry.member === undefined);
  }

  memberProposed(): ViewProposedChange[] {
    return this.proposedChanges().filter((entry) => entry.member !== undefined);
  }

  migrated(): View {
    const notes = this.noteList();

    return View.of({
      schema_version: 4,
      ...(this.title === undefined ? {} : { title: this.title }),
      description: this.description,
      commit: this.commit,
      ...(this.change === undefined
        ? {}
        : {
            change: {
              base: this.change.base,
              head: this.change.head,
              ...(this.change.name === undefined
                ? {}
                : { name: this.change.name }),
            },
          }),
      ...(this.plan === true ? { plan: true as const } : {}),
      ...(notes.length === 0 ? {} : { notes }),
      ...(this.plan === true && this.proposed !== undefined
        ? { proposed: this.proposedChanges() }
        : {}),
      steps: this.steps,
    });
  }

  document(): ViewFields {
    const migrated = this.migrated();

    return {
      schema_version: 4,
      ...(migrated.title === undefined ? {} : { title: migrated.title }),
      description: migrated.description,
      commit: migrated.commit,
      ...(migrated.change === undefined ? {} : { change: migrated.change }),
      ...(migrated.plan === true ? { plan: true as const } : {}),
      ...(migrated.notes === undefined
        ? {}
        : { notes: migrated.notes.map(ViewNotes.ordered) }),
      ...(migrated.proposed === undefined
        ? {}
        : { proposed: migrated.proposed.map(View.orderedProposed) }),
      steps: migrated.steps.map(View.orderedStep),
    };
  }

  sameContent(other: View): boolean {
    return JSON.stringify(this.document()) === JSON.stringify(other.document());
  }

  holdsMember(repository: Repository, module: string, member: string): boolean {
    const { name, method } = View.splitMember(member);

    for (const entry of repository.files) {
      if (entry.path !== module) {
        continue;
      }

      for (const held of entry.members) {
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

    return false;
  }

  resolveMembers(repository: Repository): ResolvedMembers {
    const byModule = new Map<string, ResolvedMemberEntry[]>();
    const warnings: string[] = [];

    if (this.plan !== true) {
      return { byModule, warnings };
    }

    const resolved = this.resolve(repository);
    const onView = new Set(resolved.modules);
    const moduleEntries = new Map(
      this.moduleProposed().map((entry) => [entry.module, entry]),
    );

    for (const entry of this.memberProposed()) {
      const member = entry.member as string;
      const reference = View.memberReference(entry.module, member);
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
          `proposed change on ${reference} is not drawn: the file is not on the view`,
        );

        continue;
      }

      const inScan = this.holdsMember(repository, entry.module, member);

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

  proposedWarnings(resolved: ResolvedView, repository?: Repository): string[] {
    const all = this.proposed ?? [];
    const warnings: string[] = [];
    const dropped = all.length - View.lastProposedPerModule(all).length;

    if (dropped > 0) {
      const counts = new Map<string, number>();

      for (const entry of all) {
        const key = View.proposedKey(entry);

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

    for (const entry of this.moduleProposed()) {
      if (!present.has(entry.module)) {
        warnings.push(
          `proposed change on ${entry.module} is not drawn: the file is not on the view`,
        );
      }
    }

    if (repository !== undefined) {
      warnings.push(...this.resolveMembers(repository).warnings);
    }

    return warnings;
  }

  staleReasons(
    unresolved: ResolvedView["unresolved"],
    facts: ChangeFacts | null,
  ): StaleReason[] {
    const reasons: StaleReason[] = unresolved.map((pick) => ({
      kind: "pick-unresolved",
      step: pick.step,
      path: pick.path,
    }));

    if (facts !== null && this.change !== undefined) {
      if (facts.headCommit === null) {
        reasons.push({ kind: "head-missing", head: this.change.head });
      } else if (facts.merged) {
        reasons.push({
          kind: "merged",
          head: this.change.head,
          base: this.change.base,
        });
      }
    }

    return reasons;
  }

  resolve(repository: Repository): ResolvedView {
    const modules = Neighbours.moduleNames(repository);
    const neighbours = new Neighbours(repository, modules);
    const known = new Set(modules);
    const hasFolder = (folder: string) =>
      modules.some((module) => Neighbours.under(module, folder));
    const picked = new Set<string>();
    const ruled = new Set<string>();
    const leftOut = new Set<string>();
    const folded: string[] = [];
    const unresolved: ResolvedView["unresolved"] = [];
    let focus: string | null = null;

    this.steps.forEach((step, index) => {
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
              if (Neighbours.under(module, step.of)) {
                ruled.add(module);
              }
            }
          } else {
            const rows =
              step.relation === "uses"
                ? neighbours.usesOf(step.of)
                : neighbours.usedByOf(step.of);

            for (const row of rows) {
              if (
                row.id !== step.of &&
                (step.within === undefined ||
                  Neighbours.under(row.id, step.within))
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

    if (this.plan === true) {
      for (const entry of this.moduleProposed()) {
        const isPlanned =
          !known.has(entry.module) &&
          !leftOut.has(entry.module) &&
          (entry.kind === "new" || View.movesKind(entry.kind));

        if (isPlanned) {
          planned.push(entry.module);
        }

        if (
          View.movesKind(entry.kind) &&
          entry.from !== undefined &&
          (isPlanned || onViewSet.has(entry.module))
        ) {
          ghosts.push({ from: entry.from, to: entry.module });
        }
      }

      planned.sort((a, b) => a.localeCompare(b));
    }

    return { modules: onView, planned, ghosts, folded, focus, unresolved };
  }

  private proposedChanges(): ViewProposedChange[] {
    return View.lastProposedPerModule(this.proposed ?? []).map(
      View.orderedProposed,
    );
  }

  private rawNotes(): ViewNote[] {
    if (this.schema_version >= 3) {
      return (this.notes ?? []).map((note) => ({ ...note }));
    }

    if (this.schema_version === 2) {
      return Object.entries(this.module_notes ?? {})
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([module, note]) => ({ module, text: note.text, by: note.by }));
    }

    return [];
  }
}
