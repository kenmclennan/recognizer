export type Snapshot = {
  view: string | null;
  modules: string[];
  folded: string[];
  focus: string | null;
  selection: { kind: "module" | "folder" | "edge"; id: string } | null;
};

export type CurrentView = {
  schema_version: 1;
  view: string | null;
  modules: string[];
  folded: string[];
  focus: string | null;
  selection: { kind: "module" | "folder" | "edge"; id: string } | null;
};

export function currentViewOf(snapshot: Snapshot): CurrentView {
  return {
    schema_version: 1,
    view: snapshot.view,
    modules: [...snapshot.modules].sort((a, b) => a.localeCompare(b)),
    folded: [...snapshot.folded].sort((a, b) => a.localeCompare(b)),
    focus: snapshot.focus,
    selection: snapshot.selection,
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
