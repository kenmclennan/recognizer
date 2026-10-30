import type { InspectorTab } from "./inspector-model";
import type { Trail } from "./trail-model";

export type Snapshot = {
  view: string | null;
  modules: string[];
  folded: string[];
  focus: string | null;
  selection: { kind: "module" | "folder" | "edge"; id: string } | null;
};

export type WindowTrailPanel = {
  selection: { kind: "module" | "folder" | "edge"; id: string } | null;
  relation: "uses" | "used-by" | null;
  tab: InspectorTab;
  active: boolean;
};

export type WindowState = {
  view: string | null;
  modules: string[];
  folded: string[];
  focus: string | null;
  selection: { kind: "module" | "folder" | "edge"; id: string } | null;
  trail: WindowTrailPanel[];
  inspector: { open: boolean; tab: InspectorTab };
};

export function windowStateOf(
  snapshot: Snapshot,
  trail: Trail,
  inspector: { open: boolean; tab: InspectorTab },
): WindowState {
  return {
    view: snapshot.view,
    modules: [...snapshot.modules].sort((a, b) => a.localeCompare(b)),
    folded: [...snapshot.folded].sort((a, b) => a.localeCompare(b)),
    focus: snapshot.focus,
    selection: snapshot.selection,
    trail: trail.panels.map((panel, index) => ({
      selection: panel.selection === null ? null : { ...panel.selection },
      relation:
        panel.relation === null
          ? null
          : panel.relation === "usedBy"
            ? "used-by"
            : "uses",
      tab: panel.tab,
      active: index === trail.active,
    })),
    inspector: { open: inspector.open, tab: inspector.tab },
  };
}

export function latestWins(
  write: (text: string) => Promise<void>,
): (text: string) => void {
  let inFlight = false;
  let pending: string | null = null;

  async function run(text: string): Promise<void> {
    inFlight = true;

    await write(text).catch(() => undefined);
    inFlight = false;

    if (pending !== null) {
      const next = pending;

      pending = null;
      await run(next);
    }
  }

  return (text) => {
    if (inFlight) {
      pending = text;

      return;
    }

    void run(text);
  };
}
