import {
  type Ghost,
  type ProposedKind,
  type ResolvedMemberEntry,
  type ResolvedView,
  resolveMembers,
  type Scan,
  type View,
  type ViewProposedChange,
  viewModuleProposed,
} from "recognizer";

export type PlanOverlay = {
  proposed: ReadonlyMap<string, ViewProposedChange>;
  members: ReadonlyMap<string, ResolvedMemberEntry[]>;
  planned: string[];
  ghosts: Ghost[];
};

export function planOverlay(
  view: View | null,
  resolved: ResolvedView,
  scans: Scan[] = [],
): PlanOverlay | null {
  if (view === null || view.plan !== true) {
    return null;
  }

  const drawn = new Set([...resolved.modules, ...resolved.planned]);

  return {
    proposed: new Map(
      viewModuleProposed(view)
        .filter((entry) => drawn.has(entry.module))
        .map((entry) => [entry.module, entry]),
    ),
    members: resolveMembers(view, scans).byModule,
    planned: resolved.planned,
    ghosts: resolved.ghosts,
  };
}

export function proposedClass(kind: ProposedKind): string {
  return `proposed-${kind}`;
}

export const PROPOSED_WORDS: Record<ProposedKind, string> = {
  new: "New",
  changes: "Changes",
  moves: "Moves, code unchanged",
  "moves-and-changes": "Moves and changes",
  removed: "Removed",
};

export function ghostId(from: string): string {
  return `ghost:${from}`;
}

export function isGhostId(id: string): boolean {
  return id.startsWith("ghost:");
}
