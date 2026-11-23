import { InvalidRequest } from "../../../domain/invalid-request.js";
import type { Repository } from "../../../domain/repository.js";
import { Neighbours } from "../../../domain/visualisation/neighbours.js";
import {
  type ProposedKind,
  View,
  type ViewProposedChange,
} from "../../../domain/visualisation/view.js";

const MODULE_PATH = /^(?!\.\/)(?!\/)[^\\]*[^\\/]$/;

export function requireFolder(repository: Repository, folder: string): void {
  if (
    !Neighbours.moduleNames(repository).some((module) =>
      Neighbours.under(module, folder),
    )
  ) {
    throw new InvalidRequest([`no such folder: ${folder}`]);
  }
}

export function requireModules(repository: Repository, paths: string[]): void {
  const known = new Set(Neighbours.moduleNames(repository));
  const missing = paths.filter((path) => !known.has(path));

  if (missing.length > 0) {
    throw new InvalidRequest(missing.map((path) => `no such file: ${path}`));
  }
}

export function parseKind(text: string): ProposedKind {
  const kind = View.PROPOSED_KINDS.find((entry) => entry === text);

  if (kind === undefined) {
    throw new InvalidRequest([
      `a proposed change is one of ${View.PROPOSED_KINDS.join(", ")}, not ${text}`,
    ]);
  }

  return kind;
}

export function checkProposed(
  kind: ProposedKind,
  module: string,
  from: string | undefined,
): ViewProposedChange {
  if (!MODULE_PATH.test(module)) {
    throw new InvalidRequest([`not a file path: ${module}`]);
  }

  if (!View.movesKind(kind)) {
    if (from !== undefined) {
      throw new InvalidRequest([`--from does not apply to ${kind}`]);
    }

    return { module, kind };
  }

  if (from === undefined) {
    throw new InvalidRequest([
      `${kind} needs --from <path> naming where it was`,
    ]);
  }

  if (!MODULE_PATH.test(from)) {
    throw new InvalidRequest([`not a file path: ${from}`]);
  }

  if (from === module) {
    throw new InvalidRequest(["--from must differ from the file"]);
  }

  return { module, kind, from };
}

export function checkMemberProposed(
  kind: ProposedKind,
  reference: string,
  from: string | undefined,
): ViewProposedChange {
  const split = View.splitMemberReference(reference);

  if (split === null || !MODULE_PATH.test(split.module)) {
    throw new InvalidRequest([`not a member reference: ${reference}`]);
  }

  if (!View.MEMBER_PROPOSED_KINDS.some((k) => k === kind)) {
    throw new InvalidRequest(["a member takes new, changes or removed"]);
  }

  if (from !== undefined) {
    throw new InvalidRequest([
      `--from does not apply to a member: ${reference}`,
    ]);
  }

  return { module: split.module, member: split.member, kind };
}

export function requireMemberTarget(
  view: View,
  repository: Repository,
  entry: ViewProposedChange,
): void {
  const resolved = view.resolve(repository);
  const own = view.moduleProposed().find((e) => e.module === entry.module);

  if (resolved.planned.includes(entry.module)) {
    throw new InvalidRequest([
      `${entry.module} is wholly new; mark the file only`,
    ]);
  }

  if (own !== undefined && (own.kind === "new" || own.kind === "removed")) {
    throw new InvalidRequest([
      `${entry.module} is wholly ${own.kind}; mark the file only`,
    ]);
  }

  requireModules(repository, [entry.module]);

  const member = entry.member as string;

  if (
    entry.kind !== "new" &&
    !view.holdsMember(repository, entry.module, member)
  ) {
    throw new InvalidRequest([
      `no such member: ${View.memberReference(entry.module, member)}`,
    ]);
  }
}

export function requireNoMemberEntries(
  view: View,
  entry: ViewProposedChange,
): void {
  if (
    entry.member === undefined &&
    (entry.kind === "new" || entry.kind === "removed") &&
    view.memberProposed().some((e) => e.module === entry.module)
  ) {
    throw new InvalidRequest([
      `${entry.module} is wholly ${entry.kind}; mark the file only`,
    ]);
  }
}

export function requirePlan(view: View, what: string): void {
  if (view.plan !== true) {
    throw new InvalidRequest([`${what} applies only to a plan`]);
  }
}

export function requireScanFor(
  repository: Repository,
  entry: ViewProposedChange,
): void {
  if (entry.kind === "changes" || entry.kind === "removed") {
    requireModules(repository, [entry.module]);
  }
}

export function withProposed(
  view: View,
  entry: ViewProposedChange | null,
  module: string,
  member?: string,
): View {
  const migrated = view.migrated();
  const kept = migrated
    .proposedList()
    .filter((e) => !(e.module === module && e.member === member));
  const next = entry === null ? kept : [...kept, entry];

  return migrated.with({ proposed: next.length === 0 ? undefined : next });
}

export function withoutMemberEntries(
  view: View,
  module: string,
): [View, number] {
  const migrated = view.migrated();
  const all = migrated.proposedList();
  const kept = all.filter(
    (e) => !(e.module === module && e.member !== undefined),
  );

  return [
    migrated.with({ proposed: kept.length === 0 ? undefined : kept }),
    all.length - kept.length,
  ];
}

export function withNotes(
  view: View,
  notes: { module: string; text: string; by: string }[],
): View {
  return view
    .migrated()
    .with({ notes: notes.length === 0 ? undefined : notes });
}
