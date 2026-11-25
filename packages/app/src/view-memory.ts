import type { Selection } from "./canvas-state";
import type { CommitsTab } from "./commits-panel-view";
import type { InspectorTab } from "./inspector-model";
import type { NoteFocus } from "./note-focus";
import type { ResultsMode } from "./scan-freshness";
import { reconcile, type Trail, withCapacity } from "./trail-model";

export type ViewMemory = {
  expanded: string[];
  filter: { text: string; onCanvas: boolean; needsAttention: boolean };
  inspector: {
    open: boolean;
    tab: InspectorTab;
    trail: Trail;
    folds: string[];
    pickerFilter: string;
  };
  note: { focus: NoteFocus | null; draft: string };
  findings: {
    openGroups: string[];
    onlyThisView: boolean;
    oriented: string | null;
  };
  resultsMode: ResultsMode;
  commits: { tab: CommitsTab; hide: boolean };
};

export type MemoryFacts = {
  modules: readonly string[];
  selection: Selection;
  dependenciesShown: boolean;
  findingIds: ReadonlySet<string>;
  findingKept: (id: string) => boolean;
  noteKept: (focus: NoteFocus) => boolean;
  groupKeys: ReadonlySet<string>;
  capacity: number;
};

export function pruneMemory(
  memory: ViewMemory,
  facts: MemoryFacts,
): ViewMemory {
  const known = new Set(facts.modules);
  const isFolder = (id: string) =>
    facts.modules.some((module) => module.startsWith(`${id}/`));
  const oriented =
    memory.findings.oriented !== null &&
    facts.findingIds.has(memory.findings.oriented) &&
    facts.findingKept(memory.findings.oriented)
      ? memory.findings.oriented
      : null;
  const focus =
    memory.note.focus !== null && facts.noteKept(memory.note.focus)
      ? memory.note.focus
      : null;
  const tab =
    memory.inspector.tab === "dependencies" && !facts.dependenciesShown
      ? "contents"
      : memory.inspector.tab;

  return {
    ...memory,
    expanded: memory.expanded.filter(isFolder),
    inspector: {
      ...memory.inspector,
      tab,
      trail: withCapacity(
        reconcile(memory.inspector.trail, known),
        facts.capacity,
      ),
    },
    note: {
      focus,
      draft: focus?.editing ? memory.note.draft : "",
    },
    findings: {
      ...memory.findings,
      openGroups: memory.findings.openGroups.filter((key) =>
        facts.groupKeys.has(key),
      ),
      oriented,
    },
  };
}
