import type { Changes, ScanState } from "./footer-scan";

export type ChangesHandlerDeps = {
  state: () => ScanState | null;
  setState: (next: ScanState) => void;
  refreshPanel: () => void;
};

export function createChangesHandler(
  deps: ChangesHandlerDeps,
): (changes: Changes) => void {
  return (changes) => {
    const state = deps.state();

    if (state === null) {
      return;
    }

    deps.setState({ ...state, changes });
    deps.refreshPanel();
  };
}
