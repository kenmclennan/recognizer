import { el } from "./dom";
import { attachHoverTip } from "./hover-tip";

export type ModuleTip = { path: string; description: string | null };

export function descriptionOf(state: {
  kind: string;
  line?: string;
  reasons?: string[];
}): string | null {
  if (state.line === undefined || state.line === "") {
    return null;
  }

  if (state.kind === "current") {
    return state.line;
  }

  return state.kind === "out-of-date" && !state.reasons?.includes("source")
    ? state.line
    : null;
}

export function attachModuleTip(row: HTMLElement, tip: ModuleTip): void {
  row.dataset.tipPath = tip.path;
  attachHoverTip(row, "module-tip", (node) => {
    node.append(el("div", "module-tip-path", tip.path));

    if (tip.description !== null) {
      node.append(el("div", "module-tip-description", tip.description));
    }
  });
}
