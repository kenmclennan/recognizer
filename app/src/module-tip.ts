import { el } from "./dom";
import { placeTip } from "./tip-placement";

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

function show(row: HTMLElement, tip: ModuleTip): () => void {
  const node = el("div", "module-tip");

  node.append(el("div", "module-tip-path", tip.path));

  if (tip.description !== null) {
    node.append(el("div", "module-tip-description", tip.description));
  }

  document.body.append(node);

  const anchor = row.getBoundingClientRect();
  const at = placeTip(
    {
      left: anchor.left,
      top: anchor.top,
      width: anchor.width,
      height: anchor.height,
    },
    { width: node.offsetWidth, height: node.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
  );

  node.style.left = `${at.left}px`;
  node.style.top = `${at.top}px`;

  return () => node.remove();
}

export function attachModuleTip(row: HTMLElement, tip: ModuleTip): void {
  let hide: (() => void) | null = null;
  const close = () => {
    hide?.();
    hide = null;
  };

  row.dataset.tipPath = tip.path;
  row.addEventListener("mouseenter", () => {
    close();
    hide = show(row, tip);
  });
  row.addEventListener("mouseleave", close);
  row.addEventListener("pointerdown", close);
}
