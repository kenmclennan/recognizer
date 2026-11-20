import { el } from "./dom";

export function showMessage(
  container: HTMLElement,
  text: string,
  blocking = false,
): void {
  const message = el("p", blocking ? "message blocking" : "message", text);

  message.setAttribute("role", blocking ? "alert" : "status");

  const holder = el("div", "centered");

  holder.append(message);
  container.replaceChildren(holder);
}
