import type { Mark } from "./view-history";

export const AGENT_LINE_MS = 6000;

export type AgentLineView = { text: string; onUndo: () => void } | null;

export type CancelTimer = () => void;

export type SetTimer = (run: () => void, ms: number) => CancelTimer;

export type AgentLine = {
  show: (mark: Mark, onUndo: () => void) => void;
  clear: () => void;
};

export function agentLineOf(mark: Mark): string {
  return `${mark.by} ${mark.summary}`;
}

export function backLabel(mark: Mark | null): string {
  return mark === null ? "Back" : `Back - undo ${mark.by}: ${mark.summary}`;
}

export function forwardLabel(mark: Mark | null): string {
  return mark === null
    ? "Forward"
    : `Forward - redo ${mark.by}: ${mark.summary}`;
}

export function createAgentLine(
  display: (line: AgentLineView) => void,
  setTimer: SetTimer,
): AgentLine {
  let cancel: CancelTimer | null = null;

  function clear() {
    cancel?.();
    cancel = null;
    display(null);
  }

  return {
    show(mark, onUndo) {
      cancel?.();
      display({ text: agentLineOf(mark), onUndo });
      cancel = setTimer(clear, AGENT_LINE_MS);
    },
    clear,
  };
}

export const realTimer: SetTimer = (run, ms) => {
  const id = setTimeout(run, ms);

  return () => clearTimeout(id);
};
