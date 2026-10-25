import { button, el } from "./dom";

export function showEmpty(container: HTMLElement, choose: () => void): void {
  const holder = el("div", "centered");

  holder.append(
    el("p", "message", "No folder is open in this window."),
    button("Open a folder", "primary", choose),
  );
  container.replaceChildren(holder);
}
