import { el } from "./dom";
import { attachHoverTip } from "./hover-tip";

export type ModuleTip = { path: string; description: string | null };

export function descriptionOf(state: {
  kind: string;
  line?: string;
}): string | null {
  return (state.kind === "current" || state.kind === "out-of-date") &&
    state.line !== undefined &&
    state.line !== ""
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
