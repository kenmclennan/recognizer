import { button, el } from "./dom";

export type HoldingView = {
  update: (line: string | null) => void;
  remove: () => void;
};

export function showHolding(
  container: HTMLElement,
  stop: () => void,
  line: string | null,
): HoldingView {
  const holder = el("div", "centered holding");
  const title = el("p", "message", "A scan is running on this repository");
  const progress = el("p", "message holding-line", line ?? "");
  const stopButton = button("Stop", "holding-stop", stop);

  title.setAttribute("role", "status");
  holder.append(title, progress, stopButton);
  container.replaceChildren(holder);

  return {
    update: (next) => {
      progress.textContent = next ?? "";
    },
    remove: () => holder.remove(),
  };
}
